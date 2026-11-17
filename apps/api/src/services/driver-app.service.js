// ─── Driver app ──────────────────────────────────────────────────────────────
// A driver gets a login (template sys:agency_driver → driverapp.use only),
// linked through drivers.user_id. In the app (/driver) the driver:
//   • sees own assignments (orders.driver_id = me)
//   • Mulai trip: time, odometer, fuel level (0–8), photos, optional GPS point
//     → order confirmed → active
//   • Selesai trip: same data → order active → completed, plus a SUGGESTED
//     lembur (hours beyond 12 h per rental day for with-driver packages);
//     staff decide whether to bill it
//   • Catat biaya: BBM / tol / parkir / lainnya with receipt photo → Books
//     DRAFT entry (Dr beban, Cr 2-1200 Utang ke driver) for finance to post
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'crypto';
import { hashPassword } from '@better-auth/utils/password';
import { db } from '../db/index.js';
import { drivers, orders, cars, customers, driverTrips, driverExpenses, user as userTable, account, session } from '../db/schema.js';
import { and, eq, inArray, gte, lte, desc } from 'drizzle-orm';
import { booksService } from './books.service.js';
import { decryptField } from './crypto.service.js';
import { recordOdometer } from './fleetcare.service.js';
import { invalidateUser } from './access.service.js';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

export const EXPENSE_TYPES = {
    bbm: { label: 'BBM', code: '5-1200' },
    tol: { label: 'Tol', code: '5-1300' },
    parkir: { label: 'Parkir', code: '5-1300' },
    lainnya: { label: 'Lainnya', code: '6-1900' },
};
const DRIVER_PAYABLE = '2-1200';
export { suggestOvertime } from './phasebc-core.js';
import { suggestOvertime } from './phasebc-core.js';

async function driverOf(user) {
    const [d] = await db.select().from(drivers).where(eq(drivers.userId, user.id)).limit(1);
    if (!d) throw httpError(403, 'Akun ini belum terhubung ke data driver.');
    return d;
}

async function ownOrder(driver, orderId) {
    const [o] = await db.select().from(orders).where(and(eq(orders.id, Number(orderId)), eq(orders.driverId, driver.id))).limit(1);
    if (!o) throw httpError(404, 'Penugasan tidak ditemukan.');
    return o;
}

export const driverAppService = {
    // ─── Agency side: create / reset / revoke the driver's login ────────
    async grantAccess(actor, driverId, { email, password }) {
        const [d] = await db.select().from(drivers).where(eq(drivers.id, Number(driverId))).limit(1);
        if (!d) throw httpError(404, 'Driver tidak ditemukan.');
        if (d.userId) throw httpError(409, 'Driver ini sudah punya akses aplikasi.');
        const mail = String(email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw httpError(400, 'Email tidak valid.');
        if (String(password || '').length < 8) throw httpError(400, 'Password minimal 8 karakter.');
        const [dup] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, mail)).limit(1);
        if (dup) throw httpError(409, 'Email sudah dipakai akun lain.');
        const id = randomUUID(), now = new Date();
        await db.transaction(async (tx) => {
            await tx.insert(userTable).values({
                id, name: d.name, email: mail, emailVerified: true, role: 'user', accountType: 'agency',
                templateKey: 'sys:agency_driver', organizationId: d.organizationId || actor.organizationId || null,
                isActive: true, isDemo: false, createdAt: now, updatedAt: now,
            });
            await tx.insert(account).values({ id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: await hashPassword(password), createdAt: now, updatedAt: now });
            await tx.update(drivers).set({ userId: id, updatedAt: now }).where(eq(drivers.id, d.id));
        });
        return { driverId: d.id, userId: id, email: mail };
    },

    async resetPassword(driverId, password) {
        const [d] = await db.select().from(drivers).where(eq(drivers.id, Number(driverId))).limit(1);
        if (!d?.userId) throw httpError(404, 'Driver belum punya akses aplikasi.');
        if (String(password || '').length < 8) throw httpError(400, 'Password minimal 8 karakter.');
        await db.update(account).set({ password: await hashPassword(password), updatedAt: new Date() })
            .where(and(eq(account.userId, d.userId), eq(account.providerId, 'credential')));
        await db.delete(session).where(eq(session.userId, d.userId));
        return { ok: true };
    },

    async revokeAccess(driverId) {
        const [d] = await db.select().from(drivers).where(eq(drivers.id, Number(driverId))).limit(1);
        if (!d?.userId) throw httpError(404, 'Driver belum punya akses aplikasi.');
        await db.update(userTable).set({ isActive: false, updatedAt: new Date() }).where(eq(userTable.id, d.userId));
        await db.delete(session).where(eq(session.userId, d.userId));
        await db.update(drivers).set({ userId: null, updatedAt: new Date() }).where(eq(drivers.id, d.id));
        invalidateUser(d.userId);
        return { ok: true };
    },

    async accessInfo(driverId) {
        const [d] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, Number(driverId))).limit(1);
        if (!d?.userId) return { hasAccess: false };
        const [u] = await db.select({ email: userTable.email, isActive: userTable.isActive }).from(userTable).where(eq(userTable.id, d.userId)).limit(1);
        return { hasAccess: true, email: u?.email || null, isActive: u?.isActive !== false };
    },

    // ─── Driver side ──────────────────────────────────────────────────
    async me(user) {
        const d = await driverOf(user);
        return { id: d.id, name: d.name, phone: d.phone, licenseNumber: decryptField(d.licenseNumber), licenseExpiry: d.licenseExpiry, joinDate: d.joinDate, status: d.status };
    },

    async assignments(user) {
        const d = await driverOf(user);
        const now = Date.now();
        const rows = await db.select({ order: orders, car: { brand: cars.brand, name: cars.name, licensePlate: cars.licensePlate }, customer: { name: customers.name, phone: customers.phone, whatsapp: customers.whatsapp, companyName: customers.companyName } })
            .from(orders).leftJoin(cars, eq(cars.id, orders.carId)).leftJoin(customers, eq(customers.id, orders.customerId))
            .where(and(
                eq(orders.driverId, d.id),
                inArray(orders.status, ['pending', 'confirmed', 'active', 'completed']),
                gte(orders.returnDate, new Date(now - 3 * 86400000)),
                lte(orders.pickupDate, new Date(now + 21 * 86400000)),
            ))
            .orderBy(orders.pickupDate).limit(100);
        const ids = rows.map((r) => r.order.id);
        const trips = ids.length ? await db.select().from(driverTrips).where(inArray(driverTrips.orderId, ids)) : [];
        const tripBy = new Map(trips.map((t) => [t.orderId, t]));
        return {
            data: rows.map(({ order: o, car, customer }) => ({
                id: o.id, orderNumber: o.orderNumber, status: o.status, pickupDate: o.pickupDate, returnDate: o.returnDate, totalDays: o.totalDays,
                package: o.package, pickupLocation: o.pickupLocation, destination: o.destination, notes: o.notes,
                passenger: o.customerName || customer?.name || '-', company: customer?.companyName || null,
                contact: customer?.whatsapp || customer?.phone || null,
                car: car?.name ? `${car.brand || ''} ${car.name}`.trim() : null, plate: car?.licensePlate || null, carId: o.carId || null,
                trip: tripBy.get(o.id) ? this._tripView(tripBy.get(o.id)) : null,
            })),
        };
    },

    _tripView(t) {
        return {
            status: t.status, startedAt: t.startedAt, endedAt: t.endedAt, startOdometer: t.startOdometer, endOdometer: t.endOdometer,
            km: t.endOdometer != null && t.startOdometer != null ? t.endOdometer - t.startOdometer : null,
            startFuel: t.startFuel, endFuel: t.endFuel,
            startPhotos: (t.startPhotos || []).length, endPhotos: (t.endPhotos || []).length,
            overtimeHoursSuggested: t.overtimeHoursSuggested == null ? null : Number(t.overtimeHoursSuggested), notes: t.notes,
            startLat: t.startLat, startLng: t.startLng, endLat: t.endLat, endLng: t.endLng,
        };
    },

    async startTrip(user, orderId, body, photoRefs) {
        const d = await driverOf(user);
        const o = await ownOrder(d, orderId);
        if (['cancelled', 'completed'].includes(o.status)) throw httpError(400, 'Order ini sudah selesai/dibatalkan.');
        const [exists] = await db.select({ id: driverTrips.id }).from(driverTrips).where(eq(driverTrips.orderId, o.id)).limit(1);
        if (exists) throw httpError(409, 'Perjalanan sudah dimulai.');
        const odo = num(body.odometer);
        if (!(odo >= 0)) throw httpError(400, 'Isi angka odometer.');
        const [t] = await db.insert(driverTrips).values({
            orderId: o.id, driverId: d.id, organizationId: d.organizationId, status: 'started', startedAt: new Date(),
            startOdometer: Math.round(odo), startFuel: num(body.fuel) == null ? null : Math.max(0, Math.min(8, Math.round(num(body.fuel)))),
            startPhotos: photoRefs, startLat: num(body.lat) == null ? null : String(num(body.lat)), startLng: num(body.lng) == null ? null : String(num(body.lng)),
            notes: body.notes ? String(body.notes).slice(0, 1000) : null,
        }).returning();
        if (o.status === 'confirmed' || o.status === 'pending') {
            await db.update(orders).set({ status: 'active', updatedAt: new Date() }).where(eq(orders.id, o.id));
        }
        if (o.carId) await recordOdometer(o.carId, odo, { source: 'trip', userId: user.id }).catch(() => {});
        return this._tripView(t);
    },

    async finishTrip(user, orderId, body, photoRefs) {
        const d = await driverOf(user);
        const o = await ownOrder(d, orderId);
        const [t] = await db.select().from(driverTrips).where(eq(driverTrips.orderId, o.id)).limit(1);
        if (!t) throw httpError(400, 'Mulai perjalanan dulu.');
        if (t.status === 'finished') throw httpError(409, 'Perjalanan sudah diselesaikan.');
        const odo = num(body.odometer);
        if (!(odo >= 0)) throw httpError(400, 'Isi angka odometer.');
        if (t.startOdometer != null && odo < t.startOdometer) throw httpError(400, `Odometer akhir tidak boleh lebih kecil dari awal (${t.startOdometer}).`);
        const endedAt = new Date();
        const suggested = suggestOvertime({ startedAt: t.startedAt, endedAt, totalDays: o.totalDays, pkg: o.package });
        const [u] = await db.update(driverTrips).set({
            status: 'finished', endedAt, endOdometer: Math.round(odo),
            endFuel: num(body.fuel) == null ? null : Math.max(0, Math.min(8, Math.round(num(body.fuel)))),
            endPhotos: photoRefs, endLat: num(body.lat) == null ? null : String(num(body.lat)), endLng: num(body.lng) == null ? null : String(num(body.lng)),
            overtimeHoursSuggested: String(suggested),
            notes: [t.notes, body.notes].filter(Boolean).join('\n').slice(0, 2000) || null,
        }).where(eq(driverTrips.id, t.id)).returning();
        if (o.status === 'active') await db.update(orders).set({ status: 'completed', updatedAt: new Date() }).where(eq(orders.id, o.id));
        if (o.carId) await recordOdometer(o.carId, odo, { source: 'trip', userId: user.id }).catch(() => {});
        return this._tripView(u);
    },

    async addExpense(user, body, receiptRef) {
        const d = await driverOf(user);
        const type = EXPENSE_TYPES[body.type] ? body.type : null;
        if (!type) throw httpError(400, 'Jenis biaya tidak dikenal.');
        const amount = Math.round(Number(body.amount) || 0);
        if (!(amount > 0)) throw httpError(400, 'Jumlah harus lebih dari 0.');
        let o = null;
        if (body.orderId) o = await ownOrder(d, body.orderId);
        const spentAt = body.spentAt ? new Date(body.spentAt) : new Date();
        const [e] = await db.insert(driverExpenses).values({
            organizationId: d.organizationId, driverId: d.id, orderId: o?.id || null, carId: o?.carId || null,
            type, amount: String(amount), spentAt: isNaN(spentAt) ? new Date() : spentAt, receipt: receiptRef,
            note: body.note ? String(body.note).slice(0, 300) : null,
        }).returning();
        // Books: a DRAFT for finance to check against the receipt and post.
        try {
            const accs = await booksService.listAccounts(user);
            const by = new Map(accs.filter((a) => a.isActive !== false).map((a) => [a.code, a.id]));
            const dr = by.get(EXPENSE_TYPES[type].code), cr = by.get(DRIVER_PAYABLE);
            if (dr && cr) {
                const tx = await booksService.createTransaction(user, {
                    date: e.spentAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
                    description: `${EXPENSE_TYPES[type].label} — ${d.name}${o ? ` (${o.orderNumber})` : ''}${e.note ? ` · ${e.note}` : ''}`.slice(0, 500),
                    reference: `DRV-EXP-${e.id}`,
                    lines: [
                        { accountId: dr, debit: amount, credit: 0, orderNumber: o?.orderNumber || null, carId: o?.carId || null, memo: 'Biaya driver' },
                        { accountId: cr, debit: 0, credit: amount, memo: `Utang ke driver ${d.name}` },
                    ],
                    source: 'driver', post: false,
                });
                await db.update(driverExpenses).set({ bookTransactionId: tx.id }).where(eq(driverExpenses.id, e.id));
            }
        } catch (err) { console.warn('[driver-app] expense → books skipped:', err.message); }
        return { id: e.id, type, amount, spentAt: e.spentAt };
    },

    async expenses(user) {
        const d = await driverOf(user);
        const rows = await db.select().from(driverExpenses).where(eq(driverExpenses.driverId, d.id)).orderBy(desc(driverExpenses.spentAt)).limit(100);
        return { data: rows.map((r) => ({ id: r.id, type: r.type, amount: Number(r.amount), spentAt: r.spentAt, orderId: r.orderId, note: r.note, hasReceipt: !!r.receipt })) };
    },

    // ─── Staff view of a trip (order detail) ──────────────────────────
    async tripForOrder(orderId) {
        const [t] = await db.select().from(driverTrips).where(eq(driverTrips.orderId, Number(orderId))).limit(1);
        const exp = await db.select({ type: driverExpenses.type, amount: driverExpenses.amount, spentAt: driverExpenses.spentAt, note: driverExpenses.note, id: driverExpenses.id })
            .from(driverExpenses).where(eq(driverExpenses.orderId, Number(orderId))).orderBy(driverExpenses.spentAt);
        return { trip: t ? this._tripView(t) : null, expenses: exp.map((x) => ({ ...x, amount: Number(x.amount) })) };
    },

    async tripPhotoRef(orderId, phase, idx) {
        const [t] = await db.select().from(driverTrips).where(eq(driverTrips.orderId, Number(orderId))).limit(1);
        const list = (phase === 'end' ? t?.endPhotos : t?.startPhotos) || [];
        return list[Number(idx)] || null;
    },

    async expenseReceiptRef(expenseId, orderId) {
        const [x] = await db.select({ receipt: driverExpenses.receipt }).from(driverExpenses)
            .where(and(eq(driverExpenses.id, Number(expenseId)), eq(driverExpenses.orderId, Number(orderId)))).limit(1);
        return x?.receipt || null;
    },
};

export default driverAppService;
