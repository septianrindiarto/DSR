// ─── Marketplace quality: ratings, agency profile, claim reminders ──────────
// • Clients rate a COMPLETED booking once (1–5 + comment) → reviews.agency_org_id
// • Agency profile: verified legal docs, units, rating, claim speed, volume
// • Claim SLA: an unclaimed booking older than 30 min is re-announced every
//   30 min (Telegram to the platform + email to the related agencies' admins)
//   until an agency claims it or its rental date passes; after 60 min it is
//   flagged "lewat 1 jam". Unclaimed orders stay visible to superadmin as before.
// ─────────────────────────────────────────────────────────────────────────────
import { db, withDbRetry } from '../db/index.js';
import { reviews, orders, organizations, cars, drivers, customers, clientAgencyLinks, user as userTable } from '../db/schema.js';
import { and, eq, inArray, sql, desc, isNull, or, lte, gte } from 'drizzle-orm';
import { canAccessBooking } from '../middleware/order-access.js';
import { legalComplete } from './access-core.js';
import { notifyAdmin } from './telegram.service.js';
import { sendEmail } from './email.service.js';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const REMINDER_MINUTES = () => Math.max(5, Number(process.env.CLAIM_REMINDER_MINUTES) || 30);
export const OVERDUE_MINUTES = () => Math.max(10, Number(process.env.CLAIM_OVERDUE_MINUTES) || 60);

export { reminderDue } from './phasebc-core.js';

export const marketplaceService = {
    // ─── Ratings ────────────────────────────────────────────────────────
    async rate(user, orderNumber, { rating, comment }) {
        const isClient = user.accountType === 'client' || user.role === 'client' || user.role === 'client_admin';
        if (!isClient) throw httpError(403, 'Penilaian diberikan oleh klien.');
        if (!(await canAccessBooking(user, orderNumber))) throw httpError(404, 'Pesanan tidak ditemukan.');
        const rows = await db.select().from(orders).where(eq(orders.orderNumber, String(orderNumber)));
        if (!rows.some((r) => r.status === 'completed')) throw httpError(400, 'Penilaian hanya untuk pesanan yang sudah selesai.');
        const agencyOrgId = rows.find((r) => r.claimedByAgencyId)?.claimedByAgencyId || null;
        if (!agencyOrgId) throw httpError(400, 'Pesanan ini belum ditangani agency.');
        const [dup] = await db.select({ id: reviews.id }).from(reviews).where(inArray(reviews.orderId, rows.map((r) => r.id))).limit(1);
        if (dup) throw httpError(409, 'Pesanan ini sudah dinilai.');
        const r = Math.round(Number(rating));
        if (!(r >= 1 && r <= 5)) throw httpError(400, 'Nilai 1–5.');
        const [row] = await db.insert(reviews).values({
            customerId: rows[0].customerId, orderId: rows[0].id, rating: r, comment: comment ? String(comment).slice(0, 1000) : null,
            agencyOrgId, organizationId: user.organizationId || null, createdBy: user.id, isDemo: !!user.isDemo,
        }).returning();
        return row;
    },

    /** orderNumbers the caller (client) has already rated. */
    async reviewedBy(user) {
        const rows = await db.select({ orderNumber: orders.orderNumber }).from(reviews)
            .innerJoin(orders, eq(orders.id, reviews.orderId)).where(eq(reviews.createdBy, user.id));
        return { orderNumbers: [...new Set(rows.map((r) => r.orderNumber))] };
    },

    /** { agencyId → { avg, count } } */
    async ratingsFor(agencyIds) {
        const ids = [...new Set((agencyIds || []).filter(Boolean).map(Number))];
        if (!ids.length) return {};
        const rows = await db.select({ id: reviews.agencyOrgId, avg: sql`AVG(${reviews.rating})::float`, n: sql`COUNT(*)::int` })
            .from(reviews).where(inArray(reviews.agencyOrgId, ids)).groupBy(reviews.agencyOrgId);
        return Object.fromEntries(rows.map((r) => [r.id, { avg: Math.round(Number(r.avg) * 10) / 10, count: r.n }]));
    },

    // ─── Agency profile ────────────────────────────────────────────────
    async profile(agencyId) {
        const [o] = await db.select().from(organizations).where(eq(organizations.id, Number(agencyId))).limit(1);
        if (!o || o.parentAgencyId) throw httpError(404, 'Agency tidak ditemukan.');
        const since = new Date(Date.now() - 90 * 86400000);
        const [[units], [drv], [claim], [vol], ratings, latest] = await Promise.all([
            db.select({ n: sql`COUNT(*)::int` }).from(cars).where(and(eq(cars.organizationId, o.id), eq(cars.isDemo, false))),
            db.select({ n: sql`COUNT(*)::int` }).from(drivers).where(and(eq(drivers.organizationId, o.id), eq(drivers.status, 'active'))),
            db.select({ min: sql`AVG(EXTRACT(EPOCH FROM (${orders.claimedAt} - ${orders.createdAt})) / 60)::float`, n: sql`COUNT(DISTINCT ${orders.orderNumber})::int` })
                .from(orders).where(and(eq(orders.claimedByAgencyId, o.id), sql`${orders.claimedAt} IS NOT NULL`, sql`${orders.claimedByUserId} IS NOT NULL`,
                    sql`${orders.createdBy} IS DISTINCT FROM ${orders.claimedByUserId}`, gte(orders.createdAt, since))),
            db.select({ n: sql`COUNT(DISTINCT ${orders.orderNumber})::int` }).from(orders)
                .where(and(eq(orders.claimedByAgencyId, o.id), eq(orders.status, 'completed'), gte(orders.returnDate, since))),
            this.ratingsFor([o.id]),
            db.select({ rating: reviews.rating, comment: reviews.comment, createdAt: reviews.createdAt }).from(reviews)
                .where(eq(reviews.agencyOrgId, o.id)).orderBy(desc(reviews.createdAt)).limit(5),
        ]);
        return {
            id: o.id, name: o.name, displayId: o.displayId, memberSince: o.createdAt,
            verified: o.legalStatus === 'active' && legalComplete(o),
            units: units?.n || 0, drivers: drv?.n || 0,
            rating: ratings[o.id] || { avg: null, count: 0 },
            avgClaimMinutes: claim?.min == null ? null : Math.round(claim.min), claimedBookings90d: claim?.n || 0,
            completedBookings90d: vol?.n || 0,
            latestReviews: latest,
        };
    },

    // ─── Claim reminders (every 5 min tick) ───────────────────────────
    async runClaimReminders(now = new Date()) {
        const every = REMINDER_MINUTES(), overdueAt = OVERDUE_MINUTES();
        const cutoff = new Date(now - every * 60000);
        // Atomically take the bookings that are due (safe if two ticks overlap).
        const due = await db.update(orders).set({ claimReminderCount: sql`${orders.claimReminderCount} + 1`, lastClaimReminderAt: now })
            .where(and(
                or(eq(orders.claimStatus, 'unclaimed'), isNull(orders.claimStatus)),
                eq(orders.status, 'pending'), eq(orders.isDemo, false),
                lte(orders.createdAt, cutoff), gte(orders.returnDate, now),
                or(isNull(orders.lastClaimReminderAt), lte(orders.lastClaimReminderAt, cutoff)),
            )).returning();
        if (!due.length) return { bookings: 0 };
        const byCode = new Map();
        for (const r of due) { if (!byCode.has(r.orderNumber)) byCode.set(r.orderNumber, []); byCode.get(r.orderNumber).push(r); }
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        for (const [code, rows] of byCode) {
            const head = rows[0];
            const age = Math.round((now - new Date(head.createdAt)) / 60000);
            const overdue = age >= overdueAt;
            const [org] = head.organizationId ? await db.select({ name: organizations.name, parent: organizations.parentAgencyId }).from(organizations).where(eq(organizations.id, head.organizationId)).limit(1) : [];
            const [cust] = await db.select({ name: customers.name, company: customers.companyName }).from(customers).where(eq(customers.id, head.customerId)).limit(1);
            const who = org?.name || cust?.company || head.customerName || cust?.name || '-';
            const pickup = new Date(head.pickupDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' });
            const text = `${overdue ? '🔴 <b>LEWAT 1 JAM</b> — ' : '⏰ '}Order <code>${esc(code)}</code> belum diklaim (${age} menit)\n${esc(who)} · ${rows.length} kendaraan · mulai ${esc(pickup)}\n${appUrl}/admin/claim-orders`;
            notifyAdmin(text, { parseMode: 'HTML', disablePreview: true }).catch(() => {});
            // Related agencies = the client company's agencies (parent + active links).
            let agencyIds = [];
            if (head.organizationId) {
                const links = await db.select({ id: clientAgencyLinks.agencyOrgId }).from(clientAgencyLinks)
                    .where(and(eq(clientAgencyLinks.clientOrgId, head.organizationId), eq(clientAgencyLinks.status, 'active')));
                agencyIds = [...new Set([org?.parent, ...links.map((l) => l.id)].filter(Boolean))];
            }
            if (!agencyIds.length) continue;
            const admins = await db.select({ email: userTable.email, name: userTable.name }).from(userTable).where(and(
                inArray(userTable.organizationId, agencyIds), eq(userTable.accountType, 'agency'), eq(userTable.role, 'admin'), eq(userTable.isActive, true),
            ));
            for (const a of admins.slice(0, 30)) {
                sendEmail({
                    to: a.email,
                    subject: `${overdue ? '[Lewat 1 jam] ' : ''}Order ${code} menunggu diklaim`,
                    html: `<p>Halo ${esc(a.name)},</p><p>Order <b>${esc(code)}</b> dari <b>${esc(who)}</b> (${rows.length} kendaraan, mulai ${esc(pickup)}) belum diklaim sejak ${age} menit.</p><p><a href="${appUrl}/admin/claim-orders">Buka Klaim Order</a></p>`,
                    text: `Order ${code} dari ${who} belum diklaim sejak ${age} menit. ${appUrl}/admin/claim-orders`,
                }).catch(() => {});
            }
        }
        return { bookings: byCode.size };
    },
};

export function startClaimReminders() {
    if (process.env.CLAIM_REMINDERS_DISABLED === 'true') return null;
    const tick = () => withDbRetry(() => marketplaceService.runClaimReminders(), { tries: 2, delayMs: 5000 })
        .catch((e) => console.warn(`[claim-sla] tick failed${e.code || e.cause?.code ? ` (${e.code || e.cause?.code})` : ''}:`, String(e.message || '').split('\n')[0]));
    const timer = setInterval(tick, 5 * 60000);
    timer.unref?.();
    console.log(`[claim-sla] reminders on: every ${REMINDER_MINUTES()} min, overdue after ${OVERDUE_MINUTES()} min`);
    return timer;
}

export default marketplaceService;
