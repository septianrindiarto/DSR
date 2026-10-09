// ─── Unified booking edit (Rekap Order ✏️) ──────────────────────────────────
// One endpoint behind the single edit form used for BOTH single orders and
// multi-car bookings. A "booking" = all order rows sharing one order_number.
//
//   customer  booking-level (applies to EVERY row sharing the code, so a
//             booking never ends up split across customers). Resolved through
//             customerService.findOrCreate on the (name, phone, type, company)
//             identity key — the shared customer record is never mutated —
//             and the typed name is snapshotted on orders.customer_name.
//   items     per-vehicle patches [{ orderId, carId, driverId, package,
//             destination, pickupDate, returnDate, pickupLocation, totalPrice,
//             overnightNights, overtimeHours, bailout, status, notes }].
//
// Mandatory (per vehicle): mobil, driver, paket, tujuan, tgl mulai, tgl selesai.
// Mandatory (booking):     nama, tipe pelanggan, company (if company).
// totalDays is derived from the dates; dailyRate from price ÷ days.
//
// Schedule clashes (same car or driver on overlapping dates in ANOTHER active
// booking, or the same car/driver twice inside this booking) are reported as a
// 409 unless `force` is set — legacy data already contains overlaps, so this
// warns instead of hard-blocking.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { orders, customers, invoices } from '../db/schema.js';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';
import { customerService } from './customer.service.js';

const DAY_MS = 86400000;
const ACTIVE_STATUSES = ['pending', 'confirmed', 'active'];
const STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled'];

function httpError(status, message, extra = {}) {
    const e = new Error(message);
    e.status = status;
    Object.assign(e, extra);
    return e;
}

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const toDate = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
const daySpan = (a, b) => Math.max(1, Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS) + 1);
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

export const bookingEditService = {
    async update({ customer, items, force = false }, user) {
        if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'Tidak ada kendaraan untuk disimpan.');
        const ids = items.map((i) => Number(i.orderId));

        // ── Scope: caller must see every row (own + claimed, like Rekap) ──
        const scopeConds = buildScopeConditions(user, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
            claimedByAgencyId: orders.claimedByAgencyId,
        });
        const rows = await db.select().from(orders).where(and(inArray(orders.id, ids), ...scopeConds));
        if (rows.length !== new Set(ids).size) throw httpError(404, 'Sebagian order tidak ditemukan atau di luar akses Anda.');
        const codes = new Set(rows.map((r) => r.orderNumber));
        if (codes.size !== 1) throw httpError(400, 'Semua kendaraan harus berasal dari satu kode transaksi.');
        const orderNumber = rows[0].orderNumber;
        const byId = new Map(rows.map((r) => [r.id, r]));

        // ── Validate + build per-row patches ──────────────────────────────
        const errors = [];
        const patches = items.map((it, idx) => {
            const label = `Kendaraan #${idx + 1}`;
            const p = { updatedAt: new Date() };
            const req = { carId: 'Mobil', driverId: 'Driver', package: 'Paket', destination: 'Tujuan', pickupDate: 'Tgl Mulai', returnDate: 'Tgl Selesai' };
            for (const [k, name] of Object.entries(req)) if (blank(it[k])) errors.push(`${label}: ${name} wajib diisi`);

            const pick = toDate(it.pickupDate), ret = toDate(it.returnDate);
            if (pick && ret && ret < pick) errors.push(`${label}: Tgl Selesai tidak boleh sebelum Tgl Mulai`);
            if (it.status !== undefined && !STATUSES.includes(it.status)) errors.push(`${label}: status tidak valid`);

            p.carId = it.carId ? Number(it.carId) : null;
            p.driverId = it.driverId ? Number(it.driverId) : null;
            p.package = blank(it.package) ? null : String(it.package).trim();
            p.destination = blank(it.destination) ? null : String(it.destination).trim();
            if (pick) p.pickupDate = pick;
            if (ret) p.returnDate = ret;
            const days = pick && ret ? daySpan(pick, ret) : (byId.get(Number(it.orderId))?.totalDays || 1);
            p.totalDays = days;
            if (it.pickupLocation !== undefined) p.pickupLocation = blank(it.pickupLocation) ? null : String(it.pickupLocation);
            if (it.totalPrice !== undefined && !blank(it.totalPrice)) {
                const price = Number(it.totalPrice) || 0;
                p.totalPrice = String(price);
                p.dailyRate = String(days > 0 ? price / days : price);
            }
            if (it.overnightNights !== undefined) p.overnightNights = Number(it.overnightNights) || 0;
            if (it.overtimeHours !== undefined) p.overtimeHours = String(Number(it.overtimeHours) || 0);
            if (it.bailout !== undefined) p.bailout = String(Number(it.bailout) || 0);
            if (it.status !== undefined) p.status = it.status;
            if (it.notes !== undefined) p.notes = blank(it.notes) ? null : String(it.notes);
            return { id: Number(it.orderId), patch: p };
        });

        let customerPatch = null;
        if (customer) {
            const name = String(customer.customerName || '').trim();
            const type = customer.customerType === 'company' ? 'company' : 'private';
            const company = type === 'company' ? String(customer.companyName || '').trim() : '';
            if (!name) errors.push('Nama wajib diisi');
            if (type === 'company' && !company) errors.push('Company Name wajib diisi untuk pelanggan perusahaan');
            customerPatch = { name, type, company, phone: String(customer.customerPhone || '').trim() };
        }
        if (errors.length) throw httpError(400, errors.join('; '), { details: errors });

        // ── Schedule clash check ───────────────────────────────────────────
        if (!force) {
            const conflicts = [];
            const seenCar = new Map(), seenDriver = new Map();
            for (const { patch } of patches) {
                const status = patch.status || 'pending';
                if (!ACTIVE_STATUSES.includes(status)) continue;
                if (patch.carId) { if (seenCar.has(patch.carId)) conflicts.push(`Mobil yang sama dipakai 2× di booking ini`); seenCar.set(patch.carId, true); }
                if (patch.driverId) { if (seenDriver.has(patch.driverId)) conflicts.push(`Driver yang sama dipakai 2× di booking ini`); seenDriver.set(patch.driverId, true); }
            }
            for (const { patch } of patches) {
                const status = patch.status || 'pending';
                if (!ACTIVE_STATUSES.includes(status) || !patch.pickupDate || !patch.returnDate) continue;
                const overlap = and(
                    notInArray(orders.id, ids),
                    inArray(orders.status, ACTIVE_STATUSES),
                    sql`${orders.pickupDate}::date <= ${patch.returnDate.toISOString()}::date`,
                    sql`${orders.returnDate}::date >= ${patch.pickupDate.toISOString()}::date`,
                );
                if (patch.carId) {
                    const hit = await db.select({ code: orders.orderNumber }).from(orders)
                        .where(and(overlap, eq(orders.carId, patch.carId))).limit(1);
                    if (hit[0]) conflicts.push(`Mobil bentrok dengan booking ${hit[0].code}`);
                }
                if (patch.driverId) {
                    const hit = await db.select({ code: orders.orderNumber }).from(orders)
                        .where(and(overlap, eq(orders.driverId, patch.driverId))).limit(1);
                    if (hit[0]) conflicts.push(`Driver bentrok dengan booking ${hit[0].code}`);
                }
            }
            if (conflicts.length) {
                throw httpError(409, 'Jadwal bentrok', { code: 'SCHEDULE_CONFLICT', conflicts: [...new Set(conflicts)] });
            }
        }

        // ── Resolve customer (identity key) before the transaction ─────────
        let customerId = null;
        if (customerPatch) {
            const [cur] = await db.select().from(customers).where(eq(customers.id, rows[0].customerId)).limit(1);
            const c = await customerService.findOrCreate({
                name: customerPatch.name,
                phone: customerPatch.phone || null,
                whatsapp: customerPatch.phone || null,
                customerType: customerPatch.type,
                companyName: customerPatch.type === 'company' ? customerPatch.company : null,
                ...(cur?.organizationId ? { organizationId: cur.organizationId } : {}),
                ...(cur?.isDemo ? { isDemo: true } : {}),
            });
            customerId = c?.id || null;
        }

        // ── Apply atomically ──────────────────────────────────────────────
        const updated = await db.transaction(async (tx) => {
            const out = [];
            for (const { id, patch } of patches) {
                const [r] = await tx.update(orders).set(patch).where(eq(orders.id, id)).returning();
                if (r) out.push(r);
            }
            if (customerId) {
                // Booking-level: every row sharing the code gets the same customer.
                await tx.update(orders)
                    .set({ customerId, customerName: customerPatch.name, updatedAt: new Date() })
                    .where(eq(orders.orderNumber, orderNumber));
            }
            // Keep linked invoice totals in step with price edits.
            const invIds = [...new Set(rows.map((r) => r.invoiceId).filter(Boolean))];
            if (invIds.length) {
                await tx.execute(sql`
                    UPDATE invoices i SET total_amount = s.t, updated_at = NOW()
                    FROM (SELECT invoice_id, COALESCE(SUM(total_price), 0) AS t FROM orders
                          WHERE invoice_id IN (${sql.join(invIds, sql`, `)}) GROUP BY invoice_id) s
                    WHERE i.id = s.invoice_id`);
            }
            return out;
        });
        return { orderNumber, updated: updated.length };
    },
};

export default bookingEditService;
