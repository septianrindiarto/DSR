// ─── Fleet care — documents, service plan, odometer, daily alerts ───────────
// Per unit: STNK / pajak / KIR / asuransi expiry, service interval (km &
// months), last service, current odometer (from manual readings, driver-app
// trips and service records). A daily job (08:00 WIB) sends one digest per
// agency of everything expired / due soon (Telegram + agency admins' email).
// Rules: fleetcare-core.js.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { cars, drivers, maintenance, odometerReadings, organizations, user as userTable } from '../db/schema.js';
import { and, eq, sql, desc, inArray } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';
import * as F from './fleetcare-core.js';
import { docStatus } from './fleetcare-core.js';
import { notifyAdmin } from './telegram.service.js';
import { sendEmail } from './email.service.js';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOC_LABEL = { stnkExpiry: 'STNK', taxExpiry: 'Pajak tahunan', kirExpiry: 'KIR', insuranceExpiry: 'Asuransi', service: 'Servis berkala', sim: 'SIM driver' };

/** Record a km reading and move the unit's current odometer forward. */
export async function recordOdometer(carId, km, { source = 'manual', userId = null, when = new Date() } = {}) {
    const n = Math.round(Number(km));
    if (!carId || !(n >= 0)) return null;
    await db.insert(odometerReadings).values({ carId: Number(carId), km: n, readingDate: when, source, createdBy: userId });
    await db.update(cars).set({ currentOdometer: n, odometerUpdatedAt: new Date() })
        .where(and(eq(cars.id, Number(carId)), sql`(${cars.currentOdometer} IS NULL OR ${cars.currentOdometer} <= ${n})`));
    return n;
}

const carScope = (user) => buildScopeConditions(user, { organizationId: cars.organizationId, isDemo: cars.isDemo, createdBy: cars.createdBy });

export const fleetCareService = {
    async list(user) {
        const today = todayWib();
        const rows = await db.select().from(cars).where(and(...carScope(user))).orderBy(cars.name).limit(1000);
        return {
            today,
            data: rows.map((c) => {
                const docs = Object.fromEntries(F.DOCS.map((k) => [k, c[k] ? { date: c[k], ...docStatus(c[k], today) } : null]));
                return {
                    id: c.id, name: c.name, brand: c.brand, plate: c.licensePlate, status: c.status,
                    currentOdometer: c.currentOdometer, odometerUpdatedAt: c.odometerUpdatedAt,
                    serviceIntervalKm: c.serviceIntervalKm, serviceIntervalMonths: c.serviceIntervalMonths,
                    lastServiceKm: c.lastServiceKm, lastServiceDate: c.lastServiceDate,
                    service: F.serviceStatus(c, today), docs, alerts: F.unitAlerts(c, today),
                };
            }),
        };
    },

    async _ownCar(user, carId) {
        const [c] = await db.select().from(cars).where(and(eq(cars.id, Number(carId)), ...carScope(user))).limit(1);
        if (!c) throw httpError(404, 'Unit tidak ditemukan.');
        return c;
    },

    /** Edit documents & service plan (whitelisted fields only). */
    async update(user, carId, body) {
        const c = await this._ownCar(user, carId);
        const patch = { updatedAt: new Date() };
        const date = (v) => (v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (() => { throw httpError(400, 'Format tanggal YYYY-MM-DD.'); })()) : null);
        for (const k of [...F.DOCS, 'lastServiceDate']) if (body[k] !== undefined) patch[k] = date(body[k]);
        for (const k of ['serviceIntervalKm', 'serviceIntervalMonths', 'lastServiceKm']) if (body[k] !== undefined) patch[k] = body[k] === '' || body[k] === null ? null : Math.max(0, Math.round(Number(body[k])));
        await db.update(cars).set(patch).where(eq(cars.id, c.id));
        if (body.currentOdometer !== undefined && body.currentOdometer !== '' && body.currentOdometer !== null) await recordOdometer(c.id, body.currentOdometer, { userId: user.id });
        return { ok: true };
    },

    async addReading(user, carId, { km, readingDate }) {
        const c = await this._ownCar(user, carId);
        const when = readingDate ? new Date(readingDate) : new Date();
        const n = await recordOdometer(c.id, km, { userId: user.id, when: isNaN(when) ? new Date() : when });
        if (n == null) throw httpError(400, 'Angka odometer tidak valid.');
        return { ok: true, km: n };
    },

    async readings(user, carId) {
        const c = await this._ownCar(user, carId);
        return db.select().from(odometerReadings).where(eq(odometerReadings.carId, c.id)).orderBy(desc(odometerReadings.readingDate)).limit(50);
    },

    /** Record a completed service: maintenance row + resets the service plan. */
    async recordService(user, carId, { date, odometer, cost, description, type = 'routine' }) {
        const c = await this._ownCar(user, carId);
        const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayWib();
        const km = odometer === '' || odometer == null ? null : Math.round(Number(odometer));
        await db.insert(maintenance).values({
            carId: c.id, type: ['routine', 'repair', 'inspection'].includes(type) ? type : 'routine',
            description: description ? String(description).slice(0, 1000) : 'Servis berkala', scheduledDate: new Date(`${d}T08:00:00+07:00`),
            completedDate: new Date(`${d}T17:00:00+07:00`), cost: cost ? String(Number(cost)) : null, status: 'completed', odometer: km,
            organizationId: c.organizationId, createdBy: user.id, isDemo: !!user.isDemo,
        });
        if (type === 'routine' || !type) await db.update(cars).set({ lastServiceDate: d, ...(km != null ? { lastServiceKm: km } : {}), updatedAt: new Date() }).where(eq(cars.id, c.id));
        if (km != null) await recordOdometer(c.id, km, { source: 'service', userId: user.id, when: new Date(`${d}T17:00:00+07:00`) });
        return { ok: true };
    },

    /** Daily digest per agency (expired + due within 30 days). */
    async runDailyAlerts() {
        const today = todayWib();
        const allCars = await db.select().from(cars).where(eq(cars.isDemo, false));
        const allDrivers = await db.select({ id: drivers.id, name: drivers.name, licenseExpiry: drivers.licenseExpiry, organizationId: drivers.organizationId, status: drivers.status })
            .from(drivers).where(and(eq(drivers.isDemo, false), eq(drivers.status, 'active')));
        const byOrg = new Map();
        const push = (org, line) => { if (!org) return; if (!byOrg.has(org)) byOrg.set(org, []); byOrg.get(org).push(line); };
        for (const c of allCars) {
            for (const a of F.unitAlerts(c, today)) {
                const when = a.kind === 'service'
                    ? [a.kmLeft != null ? `${a.kmLeft} km lagi` : null, a.daysLeft != null ? `${a.daysLeft} hari lagi` : null].filter(Boolean).join(' / ')
                    : (a.daysLeft < 0 ? `lewat ${-a.daysLeft} hari` : `${a.daysLeft} hari lagi`);
                push(c.organizationId, { level: a.status, text: `${DOC_LABEL[a.kind]} — ${c.brand || ''} ${c.name}${c.licensePlate ? ` (${c.licensePlate})` : ''}: ${when}` });
            }
        }
        for (const d of allDrivers) {
            const s = d.licenseExpiry ? docStatus(new Date(d.licenseExpiry).toISOString().slice(0, 10), today) : null;
            if (s && s.status !== 'ok') push(d.organizationId, { level: s.status, text: `SIM driver — ${d.name}: ${s.daysLeft < 0 ? `lewat ${-s.daysLeft} hari` : `${s.daysLeft} hari lagi`}` });
        }
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        let orgs = 0;
        for (const [orgId, lines] of byOrg) {
            lines.sort((a, b) => (a.level === 'expired' ? -1 : 1) - (b.level === 'expired' ? -1 : 1));
            const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
            const list = lines.slice(0, 40).map((l) => `${l.level === 'expired' ? '🔴' : '🟡'} ${esc(l.text)}`).join('\n');
            notifyAdmin(`🛠 <b>Pengingat armada — ${esc(org?.name || '')}</b>\n${list}\n${appUrl}/admin/fleet-care`, { parseMode: 'HTML', disablePreview: true }).catch(() => {});
            const admins = await db.select({ email: userTable.email, name: userTable.name }).from(userTable)
                .where(and(eq(userTable.organizationId, orgId), eq(userTable.role, 'admin'), eq(userTable.isActive, true)));
            for (const a of admins.slice(0, 10)) {
                sendEmail({
                    to: a.email, subject: `Pengingat armada: ${lines.filter((l) => l.level === 'expired').length} lewat, ${lines.filter((l) => l.level !== 'expired').length} segera`,
                    html: `<p>Halo ${esc(a.name)},</p><ul>${lines.slice(0, 60).map((l) => `<li>${l.level === 'expired' ? '🔴' : '🟡'} ${esc(l.text)}</li>`).join('')}</ul><p><a href="${appUrl}/admin/fleet-care">Buka Perawatan & Dokumen</a></p>`,
                    text: lines.map((l) => `- ${l.text}`).join('\n'),
                }).catch(() => {});
            }
            orgs++;
        }
        return { orgs };
    },
};

export default fleetCareService;
