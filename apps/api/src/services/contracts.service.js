// ─── Long-term contracts (monthly / yearly corporate leases) ────────────────
// A contract binds a client company to N units (+ optional drivers) for a
// period with a monthly fee per unit, a km allowance and an excess-km rate.
// Monthly billing ("Siapkan tagihan") turns a period into:
//   one order row per unit (status completed, package "Kontrak …") sharing
//   one booking code M###. The invoice is then made in Dokumen → Invoice from
//   that code (X-05) → Books auto-posting when sent.
// So Rekap, invoices, payments (incl. Xendit) and Keuangan need no special
// handling for contracts. Rules: contracts-core.js.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import {
    leaseContracts, leaseContractUnits, leaseBillings, odometerReadings, organizations, cars, drivers,
    orders, user as userTable, contractDocuments, clientAgencyLinks,
} from '../db/schema.js';
import { and, eq, inArray, asc, desc, lte, lt, sql } from 'drizzle-orm';
import * as K from './contracts-core.js';
import { companyScope } from './company.service.js';
import { customerService } from './customer.service.js';
import { orderService, generateOrderNumber } from './order.service.js';
import { buildScopeConditions } from '../middleware/scope.js';
import { notifyAdmin } from './telegram.service.js';
import { sendEmail } from './email.service.js';
import { recordOdometer } from './fleetcare.service.js';
import { policyOf, policyBlockers, effectivePolicy } from './ops-core.js';
import { removePrivateRef } from './private-files.js';
import { contractBillingService } from './contract-billing.service.js';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isClient = (u) => u && (u.accountType === 'client' || u.role === 'client' || u.role === 'client_admin');
const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

function scopeCond(user) {
    if (user.role === 'superadmin') return [];
    if (isClient(user)) return user.organizationId ? [eq(leaseContracts.clientOrgId, user.organizationId)] : [sql`false`];
    return user.organizationId ? [eq(leaseContracts.agencyOrgId, user.organizationId)] : [sql`false`];
}

async function loadOwned(user, id) {
    const [c] = await db.select().from(leaseContracts).where(and(eq(leaseContracts.id, Number(id)), ...scopeCond(user))).limit(1);
    if (!c) throw httpError(404, 'Kontrak tidak ditemukan.');
    return c;
}

/** km used by a car in a period (last reading ≤ end − last reading before start). */
async function kmUsedInPeriod(carId, period) {
    if (!carId) return null;
    const { from, to } = K.periodRange(period);
    const end = new Date(`${to}T23:59:59+07:00`), start = new Date(`${from}T00:00:00+07:00`);
    const [last] = await db.select({ km: odometerReadings.km }).from(odometerReadings)
        .where(and(eq(odometerReadings.carId, carId), lte(odometerReadings.readingDate, end))).orderBy(desc(odometerReadings.readingDate)).limit(1);
    const [before] = await db.select({ km: odometerReadings.km }).from(odometerReadings)
        .where(and(eq(odometerReadings.carId, carId), lt(odometerReadings.readingDate, start))).orderBy(desc(odometerReadings.readingDate)).limit(1);
    if (!last || !before) return null;
    return Math.max(0, last.km - before.km);
}

// Rekap Operasional & Lembur settings (X-02, X-08, cut-off). partial = only keys present.
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
function opsSettings(body, partial = false) {
    const out = {};
    // Owner 2026-11-05: the "Penagihan lembur & operasional" choice is removed —
    // every approved L/R form is billable and invoiced by code in Dokumen (it can
    // join the monthly M invoice by using the same invoice number). Old 'none'
    // contracts keep their value; new ones default to 'separate'.
    if (!partial || body.extrasMode !== undefined) out.extrasMode = ['included', 'separate', 'none'].includes(body.extrasMode) ? body.extrasMode : 'separate';
    if (!partial || body.cutoffDay !== undefined) out.cutoffDay = Number(body.cutoffDay) >= 1 && Number(body.cutoffDay) <= 28 ? Number(body.cutoffDay) : null;
    if (!partial || body.workStart !== undefined) out.workStart = HM.test(body.workStart || '') ? body.workStart : null;
    if (!partial || body.workEnd !== undefined) out.workEnd = HM.test(body.workEnd || '') ? body.workEnd : null;
    if ((out.workStart && out.workEnd) && out.workEnd <= out.workStart) throw httpError(400, 'Jam kerja selesai harus setelah jam mulai.');
    if (!partial || body.opsPolicy !== undefined) out.opsPolicy = policyOf(body.opsPolicy);
    return out;
}

// Email the admins of one side of a contract (best effort, never throws).
async function notifySide(c, side, subject, line) {
    try {
        const orgId = side === 'client' ? c.clientOrgId : c.agencyOrgId;
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        const people = await db.select({ email: userTable.email, name: userTable.name }).from(userTable)
            .where(and(eq(userTable.organizationId, orgId), eq(userTable.role, 'admin'), eq(userTable.isActive, true)));
        for (const p of people.slice(0, 20)) {
            sendEmail({
                to: p.email, subject: `[${c.contractNumber}] ${subject}`,
                html: `<p>Halo ${esc(p.name)},</p><p>${esc(line)}</p><p><a href="${appUrl}/admin/contracts?tab=contracts&contract=${c.id}">Buka kontrak ${esc(c.contractNumber)}</a></p>`,
                text: `${line}\n${appUrl}/admin/contracts?tab=contracts&contract=${c.id}`,
            }).catch(() => {});
        }
    } catch { /* best effort */ }
}

// Agencies a client company may contract with: its parent agency + active links.
async function clientAgencies(clientOrgId) {
    const [o] = await db.select({ parent: organizations.parentAgencyId }).from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
    const links = await db.select({ id: clientAgencyLinks.agencyOrgId }).from(clientAgencyLinks)
        .where(and(eq(clientAgencyLinks.clientOrgId, clientOrgId), eq(clientAgencyLinks.status, 'active')));
    return [...new Set([o?.parent, ...links.map((l) => l.id)].filter(Boolean))];
}

const NUMERIC_KEYS = new Set(['clientOrgId', 'agencyOrgId', 'billingDay', 'kmAllowanceMonth', 'excessKmRate', 'cutoffDay']);
const norm = (k, v) => {
    if (v === undefined || v === '' ) v = null;
    if (NUMERIC_KEYS.has(k)) return v == null ? null : Number(v);
    if (k === 'includes') return Object.keys(v || {}).filter((x) => v[x]).sort();
    if (k === 'opsPolicy') return policyOf(v);
    return v;
};
const sameTerm = (k, a, b) => JSON.stringify(norm(k, a)) === JSON.stringify(norm(k, b));
const NO_APPROVAL = { agencyApprovedAt: null, agencyApprovedBy: null, clientApprovedAt: null, clientApprovedBy: null };

const unitLabel = (u) => [u.carName ? `${u.carBrand || ''} ${u.carName}`.trim() : null, u.plate].filter(Boolean).join(' · ') || `Unit #${u.id}`;

export const contractsService = {
    async list(user, { status } = {}) {
        const conds = [...scopeCond(user)];
        if (status) conds.push(eq(leaseContracts.status, status));
        const rows = await db.select({ c: leaseContracts, client: organizations.name }).from(leaseContracts)
            .leftJoin(organizations, eq(organizations.id, leaseContracts.clientOrgId))
            .where(conds.length ? and(...conds) : undefined).orderBy(desc(leaseContracts.createdAt)).limit(500);
        const ids = rows.map((r) => r.c.id);
        const units = ids.length ? await db.select().from(leaseContractUnits).where(inArray(leaseContractUnits.contractId, ids)) : [];
        const bills = ids.length ? await db.select({ contractId: leaseBillings.contractId, period: leaseBillings.period }).from(leaseBillings).where(inArray(leaseBillings.contractId, ids)) : [];
        const today = todayWib();
        const agencyIds = [...new Set(rows.map((r) => r.c.agencyOrgId))];
        const agencyNames = agencyIds.length ? Object.fromEntries((await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, agencyIds))).map((o) => [o.id, o.name])) : {};
        const docs = ids.length ? await db.select({ contractId: contractDocuments.contractId, status: contractDocuments.status, mandatory: contractDocuments.mandatory, requiredFrom: contractDocuments.requiredFrom }).from(contractDocuments).where(inArray(contractDocuments.contractId, ids)) : [];
        const mySide = K.sideOf(user);
        return {
            data: rows.map(({ c, client }) => {
                const ds = docs.filter((d) => d.contractId === c.id);
                const us = units.filter((u) => u.contractId === c.id);
                const billed = bills.filter((b) => b.contractId === c.id).map((b) => b.period).sort();
                return {
                    ...c, clientName: client, agencyName: agencyNames[c.agencyOrgId] || '-', unitCount: us.length,
                    docsTotal: ds.length, docsApproved: ds.filter((d) => d.status === 'approved').length,
                    // what waits for ME: documents I must upload / review
                    docsForMe: mySide === 'super' ? 0 : ds.filter((d) => (d.requiredFrom === mySide && ['pending', 'rejected'].includes(d.status)) || (d.requiredFrom !== mySide && d.status === 'uploaded')).length,
                    monthlyTotal: us.reduce((t, u) => t + Number(u.monthlyFee || 0), 0),
                    lastBilled: billed[billed.length - 1] || null,
                    daysLeft: Math.round((new Date(c.endDate) - new Date(today)) / 86400000),
                };
            }),
        };
    },

    /**
     * Every invoice that bills this contract (M monthly, L lembur, R operasional)
     * with its surat pengantar and faktur pajak — Kontrak → Penagihan.
     */
    async invoices(user, id) {
        const c = await loadOwned(user, id);
        const res = await db.execute(sql`
            SELECT i.id, i.invoice_number, i.letter_number, i.sent_date, i.due_date, i.paid_date, i.is_cancelled,
                   i.total_amount, i.paid_amount, i.dpp, i.ppn_amount, i.pph_mode, i.pph_amount,
                   fp.id AS faktur_id, fp.nsfp, fp.status AS faktur_status,
                   ARRAY_AGG(DISTINCT o.order_number) AS codes
              FROM invoices i
              JOIN orders o ON o.invoice_id = i.id
              LEFT JOIN faktur_pajak fp ON fp.id = i.faktur_id
             WHERE COALESCE(o.contract_id,
                     (SELECT lb.contract_id FROM lease_billings lb WHERE lb.order_number = o.order_number LIMIT 1),
                     (SELECT oe.contract_id FROM ops_entries oe WHERE oe.code = o.order_number LIMIT 1)) = ${c.id}
             GROUP BY i.id, fp.id
             ORDER BY i.sent_date DESC NULLS FIRST, i.id DESC`);
        // Cancelled invoices keep their codes in cancelled_meta (their rows were unlinked).
        const cancelled = await db.execute(sql`
            SELECT i.id, i.invoice_number, i.letter_number, i.sent_date, i.due_date, i.paid_date, i.is_cancelled,
                   i.total_amount, i.paid_amount, i.dpp, i.ppn_amount, i.pph_mode, i.pph_amount, i.cancel_reason,
                   NULL::int AS faktur_id, NULL AS nsfp, NULL AS faktur_status,
                   ARRAY(SELECT jsonb_array_elements_text(i.cancelled_meta->'codes')) AS codes
              FROM invoices i
             WHERE i.is_cancelled = true AND i.cancelled_meta->'contractIds' @> ${JSON.stringify([c.id])}::jsonb
             ORDER BY i.cancelled_at DESC`);
        const seen = new Set();
        const rows = [...(res.rows || res), ...(cancelled.rows || cancelled)].filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
        const data = rows.map((r) => ({
            id: r.id, invoiceNumber: r.invoice_number, letterNumber: r.letter_number, sentDate: r.sent_date, dueDate: r.due_date,
            paidDate: r.paid_date, isCancelled: r.is_cancelled, total: Number(r.total_amount || 0), paid: Number(r.paid_amount || 0),
            dpp: Number(r.dpp || 0), ppn: Number(r.ppn_amount || 0), pphMode: r.pph_mode, pph: Number(r.pph_amount || 0),
            fakturId: r.faktur_id, fakturNsfp: r.nsfp, fakturStatus: r.faktur_status, cancelReason: r.cancel_reason || null,
            codes: (r.codes || []).filter(Boolean).sort(),
        }));
        return { data, total: data.length, page: 1 };
    },

    async get(user, id) {
        const c = await loadOwned(user, id);
        const [client] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, c.clientOrgId)).limit(1);
        const units = await db.select({
            id: leaseContractUnits.id, carId: leaseContractUnits.carId, driverId: leaseContractUnits.driverId, monthlyFee: leaseContractUnits.monthlyFee,
            startDate: leaseContractUnits.startDate, endDate: leaseContractUnits.endDate, notes: leaseContractUnits.notes,
            carName: cars.name, carBrand: cars.brand, plate: cars.licensePlate, currentOdometer: cars.currentOdometer, driverName: drivers.name,
        }).from(leaseContractUnits).leftJoin(cars, eq(cars.id, leaseContractUnits.carId)).leftJoin(drivers, eq(drivers.id, leaseContractUnits.driverId))
            .where(eq(leaseContractUnits.contractId, c.id)).orderBy(asc(leaseContractUnits.id));
        const billings = await db.select().from(leaseBillings).where(eq(leaseBillings.contractId, c.id)).orderBy(desc(leaseBillings.period));
        const [agency] = await db.select({ name: organizations.name, opsDefault: organizations.opsPolicyDefault }).from(organizations).where(eq(organizations.id, c.agencyOrgId)).limit(1);
        // Contract without its own lembur / perjalanan dinas terms → agency default (Pengaturan).
        const effective = effectivePolicy(c.opsPolicy, agency?.opsDefault);
        const docs = (await db.select().from(contractDocuments).where(eq(contractDocuments.contractId, c.id)).orderBy(asc(contractDocuments.id)))
            .map(({ fileRef, ...d }) => ({ ...d, hasFile: !!fileRef }));   // never expose the storage ref
        const unitsOut = units.map((u) => ({ ...u, monthlyFee: Number(u.monthlyFee), label: unitLabel(u) }));
        // Amendments: the contract this one amends, and amendments of this one.
        const [amends] = c.amendsContractId ? await db.select({ id: leaseContracts.id, contractNumber: leaseContracts.contractNumber, status: leaseContracts.status, endDate: leaseContracts.endDate })
            .from(leaseContracts).where(eq(leaseContracts.id, c.amendsContractId)).limit(1) : [];
        const amendments = await db.select({ id: leaseContracts.id, contractNumber: leaseContracts.contractNumber, status: leaseContracts.status, startDate: leaseContracts.startDate, amendmentNo: leaseContracts.amendmentNo })
            .from(leaseContracts).where(eq(leaseContracts.amendsContractId, c.id)).orderBy(asc(leaseContracts.id));
        // Mandatory step after an amendment becomes active: stop the old contract.
        const mustStop = c.status === 'active' && amends?.status === 'active'
            ? { oldId: amends.id, oldNumber: amends.contractNumber, newId: c.id, newNumber: c.contractNumber, suggestedEnd: K.dayBefore(c.startDate) }
            : (() => {
                const act = c.status === 'active' && amendments.find((a) => a.status === 'active');
                return act ? { oldId: c.id, oldNumber: c.contractNumber, newId: act.id, newNumber: act.contractNumber, suggestedEnd: K.dayBefore(act.startDate) } : null;
            })();
        return {
            amendsContract: amends || null, amendments, mustStop,
            ...c, opsPolicy: policyOf(c.opsPolicy), opsPolicyEffective: effective, clientName: client?.name || '-', agencyName: agency?.name || '-',
            units: unitsOut, billings, periods: K.contractPeriods(c.startDate, c.endDate),
            documents: docs, mySide: K.sideOf(user),
            blockers: [
                ...K.approvalBlockers({ contract: c, units: unitsOut, docs }),
                ...(c.status === 'draft' ? [...K.termBlockers(c, effective), ...policyBlockers(effective).map((m) => (effective.source === 'default' ? `${m} (default Pengaturan)` : m))] : []),
            ],
        };
    },

    async _validate(user, body, existing = null) {
        const side = K.sideOf(user);
        let agencyOrgId, clientOrgId;
        if (side === 'client') {
            clientOrgId = existing?.clientOrgId || user.organizationId;
            if (!clientOrgId) throw httpError(400, 'Akun Anda belum terhubung ke perusahaan.');
            agencyOrgId = existing?.agencyOrgId || Number(body.agencyOrgId);
            if (!existing && !(await clientAgencies(clientOrgId)).includes(agencyOrgId)) throw httpError(400, 'Pilih agency yang bermitra dengan perusahaan Anda.');
        } else {
            agencyOrgId = existing?.agencyOrgId || (side === 'super' ? Number(body.agencyOrgId) || user.organizationId : user.organizationId);
            if (!agencyOrgId) throw httpError(400, side === 'super' ? 'Pilih agency.' : 'Akun agency belum terhubung ke organisasi.');
            clientOrgId = Number(body.clientOrgId ?? existing?.clientOrgId);
            const [client] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, clientOrgId), ...companyScope(user))).limit(1);
            if (!client) throw httpError(400, 'Perusahaan klien tidak valid.');
        }
        const startDate = body.startDate ?? existing?.startDate, endDate = body.endDate ?? existing?.endDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || endDate < startDate) throw httpError(400, 'Tanggal mulai/selesai tidak valid.');

        let units = null;
        if (Array.isArray(body.units)) {
            const old = new Map((existing?.units || []).map((u) => [Number(u.id), u]));
            units = body.units.map((u) => {
                const prev = u.id ? old.get(Number(u.id)) : null;
                // Only the agency assigns its own cars/drivers; the client describes the need (notes) and the fee.
                const carId = side === 'client' ? (prev?.carId || null) : (u.carId ? Number(u.carId) : null);
                const driverId = side === 'client' ? (prev?.driverId || null) : (u.driverId ? Number(u.driverId) : null);
                const fee = Number(u.monthlyFee);
                if (!(fee >= 0)) throw httpError(400, 'Biaya bulanan unit tidak valid.');
                return { ...u, carId, driverId, monthlyFee: fee };
            });
            const carIds = units.map((u) => u.carId).filter(Boolean).filter((id) => ![...old.values()].some((o) => o.carId === id));
            if (carIds.length && side !== 'client') {
                const own = await db.select({ id: cars.id }).from(cars).where(and(inArray(cars.id, carIds), ...buildScopeConditions(user, { organizationId: cars.organizationId, isDemo: cars.isDemo, createdBy: cars.createdBy })));
                if (own.length !== new Set(carIds).size) throw httpError(400, 'Ada unit yang bukan milik agency Anda.');
            }
        }
        return { agencyOrgId, clientOrgId, startDate, endDate, units };
    },

    async _nextNumber(agencyOrgId) {
        const ym = todayWib().slice(0, 7).replace('-', '');
        const [r] = await db.select({ n: sql`COUNT(*)::int` }).from(leaseContracts)
            .where(and(eq(leaseContracts.agencyOrgId, agencyOrgId), sql`${leaseContracts.contractNumber} LIKE ${`KTR-${ym}-%`}`));
        return `KTR-${ym}-${String((r?.n || 0) + 1).padStart(3, '0')}`;
    },

    // Upsert by unit id (keeps ids stable: ops entries reference contract_unit_id).
    async _writeUnits(tx, contractId, units) {
        const cur = await tx.select({ id: leaseContractUnits.id }).from(leaseContractUnits).where(eq(leaseContractUnits.contractId, contractId));
        const curIds = new Set(cur.map((r) => r.id));
        const row = (u) => ({
            carId: u.carId ? Number(u.carId) : null, driverId: u.driverId ? Number(u.driverId) : null,
            monthlyFee: String(Number(u.monthlyFee) || 0), startDate: u.startDate || null, endDate: u.endDate || null,
            notes: u.notes ? String(u.notes).slice(0, 300) : null,
        });
        const keep = new Set();
        for (const u of units) {
            const id = Number(u.id);
            if (id && curIds.has(id)) {
                keep.add(id);
                await tx.update(leaseContractUnits).set(row(u)).where(eq(leaseContractUnits.id, id));
            } else {
                await tx.insert(leaseContractUnits).values({ contractId, ...row(u) });
            }
        }
        const gone = [...curIds].filter((id) => !keep.has(id));
        if (gone.length) await tx.delete(leaseContractUnits).where(inArray(leaseContractUnits.id, gone));
    },

    async create(user, body) {
        const side = K.sideOf(user);
        const v = await this._validate(user, body);
        const number = String(body.contractNumber || '').trim() || await this._nextNumber(v.agencyOrgId);
        const id = await db.transaction(async (tx) => {
            const [c] = await tx.insert(leaseContracts).values({
                agencyOrgId: v.agencyOrgId, clientOrgId: v.clientOrgId, contractNumber: number.slice(0, 40),
                title: body.title ? String(body.title).slice(0, 200) : null, startDate: v.startDate, endDate: v.endDate,
                billingDay: Number(body.billingDay) >= 1 ? Math.min(28, Number(body.billingDay)) : null,
                kmAllowanceMonth: body.kmAllowanceMonth ? Number(body.kmAllowanceMonth) : null,
                excessKmRate: body.excessKmRate ? String(Number(body.excessKmRate)) : null,
                includes: body.includes || {}, package: body.package ? String(body.package).slice(0, 40) : null,
                status: 'draft', notes: body.notes || null, createdBy: user.id,
                createdSide: side === 'client' ? 'client' : 'agency',
                ...opsSettings(body),
            }).returning();
            await this._writeUnits(tx, c.id, v.units || []);
            return c.id;
        }).catch((e) => { if ((e.code || e.cause?.code) === '23505') throw httpError(409, `No. kontrak ${number} sudah dipakai.`); throw e; });
        const out = await this.get(user, id);
        if (side !== 'super') notifySide(out, K.otherSide(side), 'Draf kontrak baru', `${side === 'client' ? out.clientName : out.agencyName} membuat draf kontrak ${out.contractNumber}. Periksa ketentuan, lengkapi dokumen yang diminta, lalu setujui.`);
        return out;
    },

    async update(user, id, body) {
        const side = K.sideOf(user);
        const c = await this.get(user, id);
        if (c.status !== 'draft' && side !== 'super') {
            // Active/ended contract: terms are agreed by both sides → locked.
            // The agency may still assign cars/drivers to the agreed units.
            if (side === 'client') throw httpError(400, 'Kontrak sudah berjalan — ketentuan tidak dapat diubah.');
            const changed = K.COMMERCIAL_KEYS.filter((k) => body[k] !== undefined && !['title', 'notes'].includes(k) && !sameTerm(k, body[k], c[k]));
            if (changed.length) throw httpError(400, 'Kontrak sudah berjalan — ketentuan dikunci (disetujui kedua pihak). Hanya mobil/driver unit, judul dan catatan yang bisa diubah.');
            if (Array.isArray(body.units)) {
                const old = new Map(c.units.map((u) => [u.id, u]));
                const bad = body.units.length !== c.units.length || body.units.some((u) => {
                    const o = old.get(Number(u.id));
                    return !o || Number(u.monthlyFee) !== Number(o.monthlyFee) || (u.startDate || null) !== (o.startDate || null) || (u.endDate || null) !== (o.endDate || null);
                });
                if (bad) throw httpError(400, 'Kontrak sudah berjalan — jumlah unit, biaya dan periode unit dikunci.');
            }
        }
        const v = await this._validate(user, body, c);
        await db.transaction(async (tx) => {
            const patch = { updatedAt: new Date(), startDate: v.startDate, endDate: v.endDate };
            // Any change to a draft = new terms → both sides must approve again.
            if (c.status === 'draft') Object.assign(patch, NO_APPROVAL);
            for (const k of ['title', 'package', 'notes']) if (body[k] !== undefined) patch[k] = body[k] || null;
            if (body.billingDay !== undefined) patch.billingDay = Number(body.billingDay) >= 1 ? Math.min(28, Number(body.billingDay)) : null;
            if (body.kmAllowanceMonth !== undefined) patch.kmAllowanceMonth = body.kmAllowanceMonth ? Number(body.kmAllowanceMonth) : null;
            if (body.excessKmRate !== undefined) patch.excessKmRate = body.excessKmRate ? String(Number(body.excessKmRate)) : null;
            if (body.includes !== undefined) patch.includes = body.includes || {};
            if (body.clientOrgId !== undefined && side !== 'client') patch.clientOrgId = v.clientOrgId;
            Object.assign(patch, opsSettings(body, true));
            await tx.update(leaseContracts).set(patch).where(eq(leaseContracts.id, c.id));
            if (v.units) await this._writeUnits(tx, c.id, v.units);
        });
        const out = await this.get(user, c.id);
        if (c.status === 'draft' && side !== 'super') notifySide(out, K.otherSide(side), 'Draf kontrak diubah', `Ketentuan kontrak ${out.contractNumber} diubah oleh ${side === 'client' ? out.clientName : out.agencyName}. Persetujuan direset — mohon periksa dan setujui kembali.`);
        return out;
    },

    // ─── Approval (both sides) ─────────────────────────────────────────
    async approve(user, id, { side: asSide } = {}) {
        let side = K.sideOf(user);
        if (side === 'super') side = asSide === 'client' ? 'client' : asSide === 'agency' ? 'agency' : null;
        if (!side) throw httpError(400, 'Pilih pihak yang disetujui (agency/klien).');
        const c = await this.get(user, id);
        if (c.blockers.length) throw httpError(400, c.blockers.join(' '));
        const patch = side === 'agency'
            ? { agencyApprovedAt: new Date(), agencyApprovedBy: user.id }
            : { clientApprovedAt: new Date(), clientApprovedBy: user.id };
        const next = { ...c, ...patch };
        if (K.bothApproved(next)) patch.status = 'active';
        patch.updatedAt = new Date();
        await db.update(leaseContracts).set(patch).where(and(eq(leaseContracts.id, c.id), eq(leaseContracts.status, 'draft')));
        const out = await this.get(user, c.id);
        if (out.status === 'active') {
            // Months already running get their M codes right away (one per unit).
            await contractBillingService.ensureContract(out.id, user.id).catch((e) => console.warn('[contracts] M codes:', e.message));
            for (const s2 of ['agency', 'client']) notifySide(out, s2, 'Kontrak aktif', `Kontrak ${out.contractNumber} disetujui kedua pihak dan sekarang AKTIF. Lembur & operasional bisa mulai dicatat.`);
        } else {
            notifySide(out, K.otherSide(side), 'Menunggu persetujuan Anda', `${side === 'client' ? out.clientName : out.agencyName} sudah menyetujui kontrak ${out.contractNumber}. Mohon periksa dan setujui.`);
        }
        return out;
    },

    // ─── Amendment (owner 2026-11-13) ──────────────────────────────────
    // Either side drafts an amendment of an ACTIVE contract: a copy of its
    // terms and units (new number "<no>-A1"), same workflow (documents, both
    // approve). The old contract keeps running until the amendment is approved;
    // then the old one must be stopped (supersede) — M codes stop there.
    async amend(user, id, { startDate } = {}) {
        const c = await this.get(user, id);
        if (c.status !== 'active') throw httpError(400, 'Amandemen hanya untuk kontrak yang sedang berjalan.');
        const open = c.amendments.find((a) => a.status === 'draft');
        if (open) throw httpError(409, `Sudah ada draf amandemen ${open.contractNumber}. Lanjutkan draf itu.`);
        const n = (c.amendments.reduce((m, a) => Math.max(m, a.amendmentNo || 0), 0) || 0) + 1;
        const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ? startDate : K.firstOfNextMonth(todayWib());
        if (start > c.endDate) throw httpError(400, 'Tanggal mulai amandemen melewati akhir kontrak.');
        const base = String(c.contractNumber).replace(/-A\d+$/, '');
        const side = K.sideOf(user);
        const newId = await db.transaction(async (tx) => {
            const [a] = await tx.insert(leaseContracts).values({
                agencyOrgId: c.agencyOrgId, clientOrgId: c.clientOrgId, contractNumber: `${base}-A${n}`.slice(0, 40),
                title: c.title, startDate: start, endDate: c.endDate, billingDay: c.billingDay,
                kmAllowanceMonth: c.kmAllowanceMonth, excessKmRate: c.excessKmRate, includes: c.includes || {}, package: c.package,
                status: 'draft', notes: c.notes, createdBy: user.id, createdSide: side === 'client' ? 'client' : 'agency',
                extrasMode: c.extrasMode, opsPolicy: c.opsPolicy, cutoffDay: c.cutoffDay, workStart: c.workStart, workEnd: c.workEnd,
                amendsContractId: c.id, amendmentNo: n,
            }).returning();
            await this._writeUnits(tx, a.id, c.units.map(({ id: _id, ...u }) => ({ ...u, startDate: null, endDate: null })));
            return a.id;
        }).catch((e) => { if ((e.code || e.cause?.code) === '23505') throw httpError(409, 'Nomor amandemen sudah dipakai.'); throw e; });
        const out = await this.get(user, newId);
        if (side !== 'super') notifySide(out, K.otherSide(side), 'Draf amandemen kontrak', `${side === 'client' ? out.clientName : out.agencyName} membuat draf amandemen ${out.contractNumber} untuk kontrak ${c.contractNumber}. Periksa perubahan, lalu setujui.`);
        return out;
    },

    /** Stop the old contract after its amendment is active (mandatory popup). id = either one. */
    async supersede(user, id, { endDate }) {
        const c = await this.get(user, id);
        if (!c.mustStop) throw httpError(400, 'Tidak ada kontrak lama yang perlu dihentikan.');
        const old = c.mustStop.oldId === c.id ? c : await this.get(user, c.mustStop.oldId);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate || '') || endDate < old.startDate || endDate > old.endDate) throw httpError(400, 'Tanggal berhenti harus di dalam masa kontrak lama.');
        await db.update(leaseContracts).set({ status: 'ended', endDate, supersededBy: c.mustStop.newId, updatedAt: new Date() }).where(eq(leaseContracts.id, old.id));
        return this.get(user, id);
    },

    // ─── Required documents ───────────────────────────────────────────
    async _doc(user, id, docId) {
        const c = await this.get(user, id);
        const [d] = await db.select().from(contractDocuments).where(and(eq(contractDocuments.id, Number(docId)), eq(contractDocuments.contractId, c.id))).limit(1);
        if (!d) throw httpError(404, 'Dokumen tidak ditemukan.');
        return { c, d, side: K.sideOf(user) };
    },
    async _touchDraft(c) {
        if (c.status === 'draft') await db.update(leaseContracts).set({ ...NO_APPROVAL, updatedAt: new Date() }).where(eq(leaseContracts.id, c.id));
    },

    async addDocument(user, id, body) {
        const side = K.sideOf(user);
        const c = await this.get(user, id);
        if (!['draft', 'active'].includes(c.status)) throw httpError(400, 'Kontrak sudah selesai.');
        const requiredFrom = side === 'super' ? (body.requiredFrom === 'client' ? 'client' : 'agency') : K.otherSide(side);
        const [d] = await db.insert(contractDocuments).values({
            contractId: c.id, requiredFrom, title: String(body.title).trim().slice(0, 150), note: body.note ? String(body.note).slice(0, 1000) : null,
            mandatory: body.mandatory !== false, dueDate: body.dueDate || null, createdBy: user.id,
        }).returning();
        await this._touchDraft(c);
        notifySide(c, requiredFrom, 'Dokumen diminta', `Mohon unggah dokumen "${d.title}" untuk kontrak ${c.contractNumber}${d.dueDate ? ` paling lambat ${d.dueDate}` : ''}.`);
        return this.get(user, c.id);
    },

    async updateDocument(user, id, docId, body) {
        const { c, d, side } = await this._doc(user, id, docId);
        if (side !== 'super' && side === d.requiredFrom) throw httpError(403, 'Hanya pihak yang meminta dokumen yang dapat mengubahnya.');
        const patch = { updatedAt: new Date() };
        if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 150);
        if (body.note !== undefined) patch.note = body.note ? String(body.note).slice(0, 1000) : null;
        if (body.mandatory !== undefined) patch.mandatory = !!body.mandatory;
        if (body.dueDate !== undefined) patch.dueDate = body.dueDate || null;
        await db.update(contractDocuments).set(patch).where(eq(contractDocuments.id, d.id));
        await this._touchDraft(c);
        return this.get(user, c.id);
    },

    async removeDocument(user, id, docId) {
        const { c, d, side } = await this._doc(user, id, docId);
        if (side !== 'super' && side === d.requiredFrom) throw httpError(403, 'Hanya pihak yang meminta dokumen yang dapat menghapusnya.');
        if (c.status !== 'draft' && d.status === 'approved' && side !== 'super') throw httpError(400, 'Dokumen yang sudah disetujui pada kontrak berjalan tidak dapat dihapus.');
        // A requirement with a file attached can't disappear under the uploader:
        // the file must be removed first (by the side that uploaded it).
        if (d.fileRef && side !== 'super') throw httpError(400, 'Masih ada file terlampir. Hapus file dulu sebelum menghapus persyaratan ini.');
        await db.delete(contractDocuments).where(eq(contractDocuments.id, d.id));
        if (d.fileRef) removePrivateRef(d.fileRef, 'contracts');
        await this._touchDraft(c);
        return this.get(user, c.id);
    },

    async uploadDocument(user, id, docId, file) {
        if (!file) throw httpError(400, 'File wajib diunggah.');
        let ctx;
        try { ctx = await this._doc(user, id, docId); }
        catch (e) { removePrivateRef(file.ref, 'contracts'); throw e; }   // stored before the check → drop it
        const { c, d, side } = ctx;
        if (side !== 'super' && side !== d.requiredFrom) {
            removePrivateRef(file.ref, 'contracts');
            throw httpError(403, 'Dokumen ini harus diunggah oleh pihak lain.');
        }
        await db.update(contractDocuments).set({
            fileRef: file.ref, fileName: String(file.name || 'dokumen').slice(0, 200), status: 'uploaded', reviewNote: null,
            uploadedBy: user.id, uploadedAt: new Date(), reviewedBy: null, reviewedAt: null, updatedAt: new Date(),
        }).where(eq(contractDocuments.id, d.id));
        if (d.fileRef && d.fileRef !== file.ref) removePrivateRef(d.fileRef, 'contracts');
        await this._touchDraft(c);
        notifySide(c, K.otherSide(d.requiredFrom), 'Dokumen diunggah', `Dokumen "${d.title}" untuk kontrak ${c.contractNumber} sudah diunggah. Mohon periksa dan setujui/tolak.`);
        return this.get(user, c.id);
    },

    /** The uploading side removes its file (not once approved on a running contract). */
    async removeDocumentFile(user, id, docId) {
        const { c, d, side } = await this._doc(user, id, docId);
        if (side !== 'super' && side !== d.requiredFrom) throw httpError(403, 'Hanya pihak yang mengunggah yang dapat menghapus file.');
        if (!d.fileRef) throw httpError(404, 'Belum ada file.');
        if (c.status !== 'draft' && d.status === 'approved' && side !== 'super') throw httpError(400, 'File yang sudah disetujui pada kontrak berjalan tidak dapat dihapus.');
        await db.update(contractDocuments).set({ fileRef: null, fileName: null, status: 'pending', reviewNote: null, uploadedBy: null, uploadedAt: null, reviewedBy: null, reviewedAt: null, updatedAt: new Date() })
            .where(eq(contractDocuments.id, d.id));
        removePrivateRef(d.fileRef, 'contracts');
        await this._touchDraft(c);
        return this.get(user, c.id);
    },

    async reviewDocument(user, id, docId, { decision, note }) {
        const { c, d, side } = await this._doc(user, id, docId);
        if (side !== 'super' && side === d.requiredFrom) throw httpError(403, 'Dokumen diperiksa oleh pihak yang memintanya.');
        if (d.status !== 'uploaded' && !(decision === 'reject' && d.status === 'approved')) throw httpError(400, 'Belum ada file baru untuk diperiksa.');
        if (decision === 'reject' && !String(note || '').trim()) throw httpError(400, 'Tulis alasan penolakan.');
        await db.update(contractDocuments).set({
            status: decision === 'approve' ? 'approved' : 'rejected', reviewNote: note ? String(note).slice(0, 500) : null,
            reviewedBy: user.id, reviewedAt: new Date(), updatedAt: new Date(),
        }).where(eq(contractDocuments.id, d.id));
        if (decision === 'reject') await this._touchDraft(c);
        notifySide(c, d.requiredFrom, decision === 'approve' ? 'Dokumen disetujui' : 'Dokumen ditolak',
            `Dokumen "${d.title}" kontrak ${c.contractNumber} ${decision === 'approve' ? 'disetujui' : `ditolak: ${note}`}.`);
        return this.get(user, c.id);
    },

    async documentFile(user, id, docId) {
        const { d } = await this._doc(user, id, docId);
        if (!d.fileRef) throw httpError(404, 'File belum diunggah.');
        return { ref: d.fileRef, name: d.fileName || `dokumen-${d.id}` };
    },

    async setStatus(user, id, status) {
        if (isClient(user)) throw httpError(403, 'Status kontrak berjalan diubah oleh agency.');
        const c = await loadOwned(user, id);
        // A draft becomes active only when BOTH sides approve (approve()).
        // Superadmin keeps a manual override.
        const allowed = { draft: user.role === 'superadmin' ? ['active'] : [], active: ['ended', 'terminated'], ended: ['active'], terminated: [] };
        if (!allowed[c.status]?.includes(status)) throw httpError(400, `Status ${c.status} tidak bisa diubah ke ${status}.`);
        await db.update(leaseContracts).set({ status, updatedAt: new Date() }).where(eq(leaseContracts.id, c.id));
        return this.get(user, c.id);
    },

    // ─── Monthly billing ───────────────────────────────────────────────
    async billingPreview(user, id, period, kmOverrides = {}) {
        const c = await this.get(user, id);
        K.periodRange(period); // validates
        const kmUsed = {};
        for (const u of c.units) kmUsed[u.id] = kmOverrides[u.id] !== undefined && kmOverrides[u.id] !== '' ? Number(kmOverrides[u.id]) : await kmUsedInPeriod(u.carId, period);
        const res = K.billingLines({ contract: c, units: c.units, period, kmUsed });
        const byId = new Map(c.units.map((u) => [u.id, u]));
        const billed = c.billings.find((b) => b.period === period) || null;
        const [agency] = await db.select({ n: organizations.docNumbering }).from(organizations).where(eq(organizations.id, c.agencyOrgId)).limit(1);
        const num = agency?.n || {};
        return {
            contractId: c.id, contractNumber: c.contractNumber, clientName: c.clientName, period, status: c.status,
            lines: res.lines.map((l) => ({ ...l, label: byId.get(l.unitId)?.label, driverId: byId.get(l.unitId)?.driverId || null })),
            total: res.total, billed,
            proposedInvoiceNumber: `${num.yearPrefix || period.slice(2, 4)}/${num.invoicePrefix || 'DSR/INV/'}${c.contractNumber}-${period.slice(5)}`.slice(0, 50),
        };
    },

    async issueBilling(user, id, { period, kmOverrides = {} }) {
        if (isClient(user)) throw httpError(403, 'Kontrak dikelola oleh agency.');
        const prev = await this.billingPreview(user, id, period, kmOverrides);
        if (prev.status !== 'active') throw httpError(400, 'Aktifkan kontrak dulu.');
        if (prev.billed) throw httpError(409, `Periode ${period} sudah ditagih.`);
        if (!prev.lines.length || !(prev.total > 0)) throw httpError(400, 'Tidak ada unit aktif di periode ini.');
        const c = await loadOwned(user, id);
        // Claim the period first (unique contract × period) — no double billing.
        let bill;
        try {
            [bill] = await db.insert(leaseBillings).values({ contractId: c.id, period, amount: String(prev.total), detail: { lines: prev.lines }, createdBy: user.id }).returning();
        } catch (e) {
            if ((e.code || e.cause?.code) === '23505') throw httpError(409, `Periode ${period} sudah ditagih.`);
            throw e;
        }
        try {
            const [client] = await db.select().from(organizations).where(eq(organizations.id, c.clientOrgId)).limit(1);
            const customer = await customerService.findOrCreate({
                name: client.name, customerType: 'company', companyName: client.name,
                phone: client.phone1 || null, whatsapp: client.phone1 || null, email: client.email || null,
                organizationId: client.id, createdBy: user.id,
            });
            const orderNumber = await generateOrderNumber(customer.id, { prefix: 'M' });
            const { from, to } = K.periodRange(period);
            const ids = [];
            for (const l of prev.lines) {
                const note = [
                    `Kontrak ${c.contractNumber} · periode ${period}`,
                    l.kmUsed != null ? `km ${l.kmUsed}/${l.kmAllowed}${l.excessKm ? `, lebih ${l.excessKm} km = Rp${l.excessCharge.toLocaleString('id-ID')}` : ''}` : null,
                ].filter(Boolean).join(' · ');
                const o = await orderService.create({
                    orderNumber, carId: l.carId || null, driverId: l.driverId || null, customerId: customer.id, customerName: client.name,
                    pickupDate: new Date(`${from}T00:00:00+07:00`), returnDate: new Date(`${to}T23:59:00+07:00`),
                    totalDays: l.activeDays, dailyRate: String(Math.round(l.fee / Math.max(1, l.activeDays))), totalPrice: String(l.total),
                    status: 'completed', package: `Kontrak ${c.package || 'Bulanan'}`.slice(0, 50), notes: note,
                    organizationId: c.clientOrgId, createdBy: user.id, sourceOrigin: 'contract', contractId: c.id,
                    claimedByAgencyId: c.agencyOrgId, claimedByUserId: user.id, claimStatus: 'agency_claimed', claimedAt: new Date(),
                });
                ids.push(o.id);
            }
            // X-05: invoices are made only in Dokumen → Invoice. This step only
            // prepares the month as booking M###; Dokumen picks it up by code.
            await db.update(leaseBillings).set({ orderNumber }).where(eq(leaseBillings.id, bill.id));
            return { period, orderNumber, total: prev.total, units: ids.length, proposedInvoiceNumber: prev.proposedInvoiceNumber };
        } catch (e) {
            await db.delete(leaseBillings).where(eq(leaseBillings.id, bill.id)).catch(() => {});
            throw e;
        }
    },

    // ─── Odometer ──────────────────────────────────────────────────────
    async addOdometer(user, carId, { km, readingDate, source = 'manual' }) {
        const when = readingDate ? new Date(readingDate) : new Date();
        const n = await recordOdometer(carId, km, { source, userId: user?.id || null, when: isNaN(when) ? new Date() : when });
        if (n == null) throw httpError(400, 'Angka odometer tidak valid.');
        return { ok: true };
    },

    async odometerHistory(carId) {
        return db.select().from(odometerReadings).where(eq(odometerReadings.carId, Number(carId))).orderBy(desc(odometerReadings.readingDate)).limit(50);
    },

    // ─── Renewal reminders (daily job) ─────────────────────────────────
    async runRenewalReminders() {
        const today = todayWib();
        const rows = await db.select({ c: leaseContracts, client: organizations.name }).from(leaseContracts)
            .leftJoin(organizations, eq(organizations.id, leaseContracts.clientOrgId))
            .where(eq(leaseContracts.status, 'active'));
        let sent = 0;
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        for (const { c, client } of rows) {
            const due = K.renewalReminderDue(c.endDate, today, c.remindersSent || {});
            if (!due) continue;
            await db.update(leaseContracts).set({ remindersSent: { ...(c.remindersSent || {}), [due.threshold]: today } }).where(eq(leaseContracts.id, c.id));
            const msg = `📄 Kontrak <b>${esc(c.contractNumber)}</b> (${esc(client)}) berakhir ${esc(c.endDate)} — ${due.daysLeft} hari lagi. Siapkan perpanjangan.`;
            notifyAdmin(msg, { parseMode: 'HTML', disablePreview: true }).catch(() => {});
            const people = await db.select({ email: userTable.email, name: userTable.name }).from(userTable).where(and(
                inArray(userTable.organizationId, [c.agencyOrgId, c.clientOrgId]), eq(userTable.role, 'admin'), eq(userTable.isActive, true)));
            for (const p of people.slice(0, 20)) {
                sendEmail({
                    to: p.email, subject: `Kontrak ${c.contractNumber} berakhir dalam ${due.daysLeft} hari`,
                    html: `<p>Halo ${esc(p.name)},</p><p>Kontrak sewa <b>${esc(c.contractNumber)}</b> (${esc(client)}) berakhir pada <b>${esc(c.endDate)}</b> (${due.daysLeft} hari lagi).</p><p>Hubungi agency/klien untuk perpanjangan. <a href="${appUrl}/admin/contracts">Lihat kontrak</a></p>`,
                    text: `Kontrak ${c.contractNumber} (${client}) berakhir ${c.endDate} (${due.daysLeft} hari lagi).`,
                }).catch(() => {});
            }
            sent++;
        }
        // Auto-end contracts past their end date.
        await db.update(leaseContracts).set({ status: 'ended', updatedAt: new Date() })
            .where(and(eq(leaseContracts.status, 'active'), lt(leaseContracts.endDate, today)));
        return { reminders: sent };
    },
};

export default contractsService;
