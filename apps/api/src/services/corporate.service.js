// ─── Corporate portal (client companies) ────────────────────────────────────
// • Settings per client company: requireApproval, costCenterRequired.
// • Cost centres (divisions) the company books against.
// • Internal approval: when requireApproval is on, an order from a user
//   WITHOUT orders.approve is stored with client_approval_status='waiting'
//   and claim_status='awaiting_approval' — invisible to every agency (agency
//   scope only matches claimed/own orders; Klaim Order lists 'unclaimed').
//   Approval routes it exactly like a normal client order (resolveInitialClaim),
//   prices it with the owning agency's rate card and sends the Telegram alert.
// • Spend dashboard: totals per month, cost centre, category, requester.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { organizations, costCenters, orders, customers, cars, user as userTable } from '../db/schema.js';
import { and, eq, asc, desc, sql, inArray } from 'drizzle-orm';
import { getAccess, hasPerm } from './access.service.js';
import { orderService } from './order.service.js';
import { requestedCategoryFromNotes, priceUnpricedRows } from './pricing.service.js';
import { notifyOrderCreated } from './telegram.service.js';
import { sendEmail } from './email.service.js';
import { invoices } from '../db/schema.js';
import { deriveInvoiceStatus } from './invoice.service.js';
import { paymentService } from './payment.service.js';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const DEFAULT_CORPORATE_SETTINGS = { requireApproval: false, costCenterRequired: false };

export function clientOrgOf(user) {
    const isClient = user && (user.accountType === 'client' || user.role === 'client' || user.role === 'client_admin');
    if (!isClient || !user.organizationId) throw httpError(403, 'Fitur ini untuk akun perusahaan klien.');
    return user.organizationId;
}

async function settingsOf(orgId) {
    const [o] = await db.select({ s: organizations.corporateSettings, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return { name: o?.name || '', ...DEFAULT_CORPORATE_SETTINGS, ...(o?.s || {}) };
}

export const corporateService = {
    DEFAULT_CORPORATE_SETTINGS,

    /** Booking-time rules for a client user (used by POST /orders/public and the booking form). */
    async bookingRules(user) {
        const orgId = user.organizationId;
        const s = await settingsOf(orgId);
        const cc = await db.select({ name: costCenters.name, code: costCenters.code }).from(costCenters)
            .where(and(eq(costCenters.organizationId, orgId), eq(costCenters.isActive, true))).orderBy(asc(costCenters.name));
        const canApprove = hasPerm(await getAccess(user.id), 'orders.approve');
        return {
            organizationId: orgId, companyName: s.name,
            requireApproval: !!s.requireApproval, costCenterRequired: !!s.costCenterRequired,
            costCenters: cc, canApprove,
            needsApproval: !!s.requireApproval && !canApprove,
        };
    },

    async getSettings(user) {
        const orgId = clientOrgOf(user);
        const s = await settingsOf(orgId);
        const cc = await db.select().from(costCenters).where(eq(costCenters.organizationId, orgId)).orderBy(asc(costCenters.name));
        return { requireApproval: !!s.requireApproval, costCenterRequired: !!s.costCenterRequired, monthlyReport: s.monthlyReport !== false, costCenters: cc };
    },

    async saveSettings(user, { requireApproval, costCenterRequired, monthlyReport }) {
        const orgId = clientOrgOf(user);
        const cur = await settingsOf(orgId);
        const next = {
            requireApproval: requireApproval !== undefined ? !!requireApproval : !!cur.requireApproval,
            costCenterRequired: costCenterRequired !== undefined ? !!costCenterRequired : !!cur.costCenterRequired,
            monthlyReport: monthlyReport !== undefined ? !!monthlyReport : cur.monthlyReport !== false,
        };
        await db.update(organizations).set({ corporateSettings: next, updatedAt: new Date() }).where(eq(organizations.id, orgId));
        return this.getSettings(user);
    },

    async addCostCenter(user, { name, code }) {
        const orgId = clientOrgOf(user);
        const n = String(name || '').trim().slice(0, 100);
        if (!n) throw httpError(400, 'Nama pusat biaya wajib diisi.');
        try {
            await db.insert(costCenters).values({ organizationId: orgId, name: n, code: code ? String(code).trim().slice(0, 30) : null });
        } catch (e) {
            if ((e.code || e.cause?.code) === '23505') throw httpError(409, `Pusat biaya "${n}" sudah ada.`);
            throw e;
        }
        return this.getSettings(user);
    },

    async updateCostCenter(user, id, patch) {
        const orgId = clientOrgOf(user);
        const set = {};
        if (patch.name !== undefined) { const n = String(patch.name || '').trim().slice(0, 100); if (!n) throw httpError(400, 'Nama wajib diisi.'); set.name = n; }
        if (patch.code !== undefined) set.code = patch.code ? String(patch.code).trim().slice(0, 30) : null;
        if (patch.isActive !== undefined) set.isActive = !!patch.isActive;
        const r = await db.update(costCenters).set(set).where(and(eq(costCenters.id, Number(id)), eq(costCenters.organizationId, orgId))).returning();
        if (!r.length) throw httpError(404, 'Pusat biaya tidak ditemukan.');
        return this.getSettings(user);
    },

    // ─── Approval queue ─────────────────────────────────────────────────
    async listApprovals(user, { status = 'waiting' } = {}) {
        const orgId = clientOrgOf(user);
        const st = ['waiting', 'approved', 'rejected'].includes(status) ? status : 'waiting';
        const rows = await db.select({
            order: orders, requester: { id: userTable.id, name: userTable.name, email: userTable.email }, car: { brand: cars.brand, name: cars.name, licensePlate: cars.licensePlate },
        }).from(orders)
            .leftJoin(userTable, eq(userTable.id, orders.createdBy))
            .leftJoin(cars, eq(cars.id, orders.carId))
            .where(and(eq(orders.organizationId, orgId), eq(orders.clientApprovalStatus, st)))
            .orderBy(st === 'waiting' ? asc(orders.createdAt) : desc(orders.clientApprovedAt))
            .limit(500);
        const byCode = new Map();
        for (const r of rows) {
            const o = r.order;
            if (!byCode.has(o.orderNumber)) {
                byCode.set(o.orderNumber, {
                    orderNumber: o.orderNumber, requester: r.requester?.name || '-', requesterEmail: r.requester?.email || null,
                    customerName: o.customerName, pickupDate: o.pickupDate, returnDate: o.returnDate, totalDays: o.totalDays,
                    costCenter: o.costCenter, notes: o.notes, createdAt: o.createdAt, status: o.clientApprovalStatus,
                    decidedAt: o.clientApprovedAt, note: o.clientApprovalNote, vehicles: [], total: 0, priced: true,
                });
            }
            const b = byCode.get(o.orderNumber);
            b.vehicles.push({
                id: o.id, category: requestedCategoryFromNotes(o.notes) || (r.car?.name ? `${r.car.brand || ''} ${r.car.name}`.trim() : '-'),
                package: o.package, destination: o.destination, pickupLocation: o.pickupLocation, price: Number(o.totalPrice) || 0,
            });
            b.total += Number(o.totalPrice) || 0;
            if (!(Number(o.totalPrice) > 0)) b.priced = false;
        }
        return { data: [...byCode.values()] };
    },

    async countWaiting(user) {
        const orgId = clientOrgOf(user);
        const [r] = await db.select({ n: sql`COUNT(DISTINCT ${orders.orderNumber})::int` }).from(orders)
            .where(and(eq(orders.organizationId, orgId), eq(orders.clientApprovalStatus, 'waiting')));
        return { waiting: r?.n || 0 };
    },

    async decide(user, orderNumber, { decision, note }) {
        const orgId = clientOrgOf(user);
        const rows = await db.select().from(orders).where(and(
            eq(orders.orderNumber, String(orderNumber)), eq(orders.organizationId, orgId), eq(orders.clientApprovalStatus, 'waiting'),
        ));
        if (!rows.length) throw httpError(404, 'Pesanan tidak ditemukan atau sudah diputuskan.');
        const now = new Date();
        const memo = note ? String(note).slice(0, 500) : null;
        let updated;
        if (decision === 'approve') {
            const claim = await orderService.resolveInitialClaim({ user: null, targetOrgId: orgId });
            updated = await db.update(orders).set({
                clientApprovalStatus: 'approved', clientApprovedBy: user.id, clientApprovedAt: now, clientApprovalNote: memo,
                ...claim, updatedAt: now,
            }).where(and(eq(orders.orderNumber, String(orderNumber)), eq(orders.organizationId, orgId))).returning();
            if (claim.claimedByAgencyId) await priceUnpricedRows(updated, claim.claimedByAgencyId);
            // Now the agency side may see it — same alert as a normal client order.
            const fresh = await db.select().from(orders).where(eq(orders.orderNumber, String(orderNumber)));
            const [customer] = fresh[0]?.customerId ? await db.select().from(customers).where(eq(customers.id, fresh[0].customerId)).limit(1) : [];
            notifyOrderCreated({ order: fresh[0], orders: fresh, customer, source: 'dashboard (disetujui)' }).catch(() => {});
        } else {
            updated = await db.update(orders).set({
                clientApprovalStatus: 'rejected', clientApprovedBy: user.id, clientApprovedAt: now, clientApprovalNote: memo,
                status: 'cancelled', claimStatus: 'client_rejected', updatedAt: now,
            }).where(and(eq(orders.orderNumber, String(orderNumber)), eq(orders.organizationId, orgId))).returning();
        }
        // Tell the requester (best-effort).
        const requesterId = rows[0].createdBy;
        if (requesterId) {
            const [req] = await db.select({ email: userTable.email, name: userTable.name }).from(userTable).where(eq(userTable.id, requesterId)).limit(1);
            if (req?.email) {
                const ok = decision === 'approve';
                sendEmail({
                    to: req.email,
                    subject: `Pesanan ${orderNumber} ${ok ? 'disetujui' : 'ditolak'} — DSR Solution`,
                    html: `<p>Halo ${esc(req.name)},</p><p>Pesanan <b>${esc(orderNumber)}</b> ${ok ? 'telah <b>disetujui</b> dan diteruskan ke agency.' : 'telah <b>ditolak</b>.'}</p>${memo ? `<p>Catatan: ${esc(memo)}</p>` : ''}`,
                    text: `Pesanan ${orderNumber} ${ok ? 'disetujui' : 'ditolak'}.${memo ? ` Catatan: ${memo}` : ''}`,
                }).catch(() => {});
            }
        }
        return { orderNumber, decision, vehicles: updated.length };
    },

    /** Email the company's approvers about a new waiting order (best-effort). */
    async notifyApprovers(orgId, { orderNumber, requesterName, vehicleCount }) {
        try {
            const members = await db.select({ id: userTable.id, email: userTable.email, name: userTable.name }).from(userTable)
                .where(and(eq(userTable.organizationId, orgId), eq(userTable.isActive, true)));
            const appUrl = process.env.APP_URL || 'http://localhost:5173';
            for (const m of members.slice(0, 50)) {
                if (!m.email || !hasPerm(await getAccess(m.id), 'orders.approve')) continue;
                await sendEmail({
                    to: m.email,
                    subject: `Persetujuan diperlukan: pesanan ${orderNumber}`,
                    html: `<p>Halo ${esc(m.name)},</p><p>${esc(requesterName)} mengajukan pesanan <b>${esc(orderNumber)}</b> (${vehicleCount} kendaraan) yang menunggu persetujuan Anda.</p><p><a href="${appUrl}/admin/contracts?tab=portal">Buka Portal Perusahaan</a></p>`,
                    text: `${requesterName} mengajukan pesanan ${orderNumber} (${vehicleCount} kendaraan). Setujui di ${appUrl}/admin/contracts?tab=portal`,
                }).catch(() => {});
            }
        } catch (e) { console.warn('[corporate] notifyApprovers failed:', e.message); }
    },

    // ─── Tagihan (client's invoices + online payment) ───────────────────
    async listInvoices(user) {
        const orgId = clientOrgOf(user);
        const rows = await db.select().from(invoices)
            .where(and(eq(invoices.clientOrgId, orgId), eq(invoices.isCancelled, false)))
            .orderBy(desc(invoices.createdAt)).limit(300);
        const out = [];
        for (const inv of rows) {
            const total = Number(inv.totalAmount || 0), paid = Number(inv.paidAmount || 0);
            const status = deriveInvoiceStatus(inv);
            if (!inv.sentDate) continue; // not issued to the client yet
            const pay = await paymentService.status(inv.organizationId);
            out.push({
                id: inv.id, invoiceNumber: inv.invoiceNumber, sentDate: inv.sentDate, dueDate: inv.dueDate, paidDate: inv.paidDate,
                total, paid, remaining: Math.max(0, total - paid), status,
                onlinePayment: pay.enabled, link: status === 'Paid' ? null : await paymentService.activeLink(inv.id),
            });
        }
        return { data: out };
    },

    async payLink(user, invoiceId) {
        const orgId = clientOrgOf(user);
        const [inv] = await db.select({ id: invoices.id, clientOrgId: invoices.clientOrgId }).from(invoices).where(eq(invoices.id, Number(invoiceId))).limit(1);
        if (!inv || inv.clientOrgId !== orgId) throw httpError(404, 'Invoice tidak ditemukan.');
        return (await paymentService.activeLink(inv.id)) || paymentService.createLink(inv.id, { user, payerEmail: user.email || null });
    },

    // ─── Spend dashboard ───────────────────────────────────────────────
    async spend(user, { year }) {
        const orgId = clientOrgOf(user);
        const y = Number(year) || new Date().getFullYear();
        const companyWide = hasPerm(await getAccess(user.id), 'corporate.view');
        const conds = [
            eq(orders.organizationId, orgId),
            sql`${orders.status} <> 'cancelled'`,
            sql`(${orders.clientApprovalStatus} IS NULL OR ${orders.clientApprovalStatus} = 'approved')`,
            sql`EXTRACT(YEAR FROM ${orders.pickupDate} AT TIME ZONE 'Asia/Jakarta') = ${y}`,
        ];
        if (!companyWide) conds.push(eq(orders.createdBy, user.id));
        const rows = await db.select({
            orderNumber: orders.orderNumber, pickupDate: orders.pickupDate, totalDays: orders.totalDays, totalPrice: orders.totalPrice,
            costCenter: orders.costCenter, notes: orders.notes, destination: orders.destination, status: orders.status,
            invoicePaymentStatus: orders.invoicePaymentStatus, invoiceId: orders.invoiceId,
            carType: cars.type, requester: userTable.name,
        }).from(orders).leftJoin(cars, eq(cars.id, orders.carId)).leftJoin(userTable, eq(userTable.id, orders.createdBy)).where(and(...conds));

        const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount: 0, vehicles: 0, days: 0 }));
        const group = () => new Map();
        const byCC = group(), byCat = group(), byReq = group(), byDest = group();
        const add = (m, k, amt, days) => { const c = m.get(k) || { key: k, amount: 0, vehicles: 0, days: 0 }; c.amount += amt; c.vehicles += 1; c.days += days; m.set(k, c); };
        const bookings = new Set();
        let total = 0, unpaid = 0;
        for (const r of rows) {
            const amt = Number(r.totalPrice) || 0, days = Number(r.totalDays) || 0;
            const m = Number(new Date(r.pickupDate).toLocaleString('en-US', { timeZone: 'Asia/Jakarta', month: 'numeric' }));
            months[m - 1].amount += amt; months[m - 1].vehicles += 1; months[m - 1].days += days;
            total += amt; bookings.add(r.orderNumber);
            if (r.invoiceId && r.invoicePaymentStatus !== 'Paid') unpaid += amt;
            add(byCC, r.costCenter || 'Tanpa pusat biaya', amt, days);
            add(byCat, r.carType || requestedCategoryFromNotes(r.notes) || 'Belum ditentukan', amt, days);
            add(byReq, r.requester || 'Admin agency', amt, days);
            add(byDest, (r.destination || '-').split(/[,–-]/)[0].trim() || '-', amt, days);
        }
        const sorted = (m) => [...m.values()].sort((a, b) => b.amount - a.amount);
        return {
            year: y, companyWide, total, unpaidInvoiced: unpaid, bookings: bookings.size, vehicles: rows.length,
            months, byCostCenter: sorted(byCC), byCategory: sorted(byCat), byRequester: sorted(byReq).slice(0, 15), topDestinations: sorted(byDest).slice(0, 10),
        };
    },
};

export default corporateService;
