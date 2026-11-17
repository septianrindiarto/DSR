// ─── Rekap Operasional & Lembur (monthly contracts) ─────────────────────────
// Entries (overtime / operational costs) are submitted by the driver, the
// agency or the client of the same contract → verified by the agency →
// grouped by the agency into a recap R### per contract × period × kind →
// approved (or individual lines rejected) by the client → billed later from
// Dokumen → Invoice (X-05). Contracts with extras_mode 'none' still record
// entries (billable = false), which stop at "verified".
//
// Scope: agency = lease_contracts.agency_org_id; client = client_org_id;
// driver = entries/units where the contract unit's driver is them.
// Evidence files are private (uploads-private/ops/…, AES-256-GCM) and only
// streamed through GET /api/ops/entries/:id/evidence/:idx.
// Rules (hours, cut-off, working days, reminders): ops-core.js.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import {
    opsEntries, opsRecaps, holidays, leaseContracts, leaseContractUnits, leaseBillings, organizations, cars, drivers, user as userTable, odometerReadings,
} from '../db/schema.js';
import { and, eq, inArray, gte, lte, lt, desc, asc, sql, isNull, isNotNull, or, ilike } from 'drizzle-orm';
import * as O from './ops-core.js';
import { agencyPolicyDefault, agencyPolicyDefaults } from './ops-policy.service.js';
import { getAccess, hasPerm } from './access.service.js';
import { accountTypeOf } from './access-core.js';
import { removePrivateRef } from './private-files.js';
import { notifyAdmin } from './telegram.service.js';
import { sendEmail } from './email.service.js';
import { recordOdometer } from './fleetcare.service.js';
import { fleetAlertsService } from './fleet-alerts.service.js';
import { notificationService } from './notifications.service.js';

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const wibDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) : null);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE = ['draft', 'submitted', 'rejected'];
const MAX_EVIDENCE = 10;
const appUrl = () => process.env.APP_URL || 'http://localhost:5173';
const rows = (r) => (Array.isArray(r) ? r : r?.rows || []);

export const TYPE_LABEL = { sppd: 'SPPD (perjalanan dinas)', lembur: 'Lembur', operasional: 'Operasional (BBM, tol, parkir …)', bbm: 'BBM', tol: 'Tol', parkir: 'Parkir', penginapan: 'Penginapan', makan: 'Makan / uang saku', lainnya: 'Lainnya' };
// Operasional form rows (owner 2026-11-13): money columns per day; penginapan belongs to perjalanan dinas.
export const OPS_COST_FIELDS = ['bbm', 'tol', 'parkir', 'makan', 'lainnya'];

// ─── Who is calling ───────────────────────────────────────────────────────
async function actorOf(user) {
    const access = await getAccess(user.id);
    const has = (p) => user.role === 'superadmin' || hasPerm(access, p);
    if (user.role === 'superadmin') return { kind: 'super', has, user };
    if (accountTypeOf(user) === 'client') return { kind: 'client', orgId: user.organizationId, has, user };
    if (has('opsrecap.view')) return { kind: 'agency', orgId: user.organizationId, has, user };
    if (has('driverapp.use')) {
        const [d] = await db.select().from(drivers).where(eq(drivers.userId, user.id)).limit(1);
        if (!d) throw httpError(403, 'Akun ini belum terhubung ke data driver.');
        return { kind: 'driver', driver: d, orgId: d.organizationId, has, user };
    }
    throw httpError(403, 'Anda tidak memiliki hak akses Rekap Operasional & Lembur.');
}

async function driverContractIds(driverId) {
    const r = await db.select({ id: leaseContractUnits.contractId }).from(leaseContractUnits).where(eq(leaseContractUnits.driverId, driverId));
    return [...new Set(r.map((x) => x.id))];
}

async function contractScope(a) {
    if (a.kind === 'super') return [];
    if (!a.orgId && a.kind !== 'driver') return [sql`false`];
    if (a.kind === 'agency') return [eq(leaseContracts.agencyOrgId, a.orgId)];
    if (a.kind === 'client') return [eq(leaseContracts.clientOrgId, a.orgId)];
    const ids = await driverContractIds(a.driver.id);
    return ids.length ? [inArray(leaseContracts.id, ids)] : [sql`false`];
}

// Drafts are private to whoever wrote them until they are submitted.
const notOthersDraft = (a) => or(sql`${opsEntries.status} <> 'draft'`, eq(opsEntries.createdBy, a.user.id));
function entryScope(a) {
    if (a.kind === 'super') return [notOthersDraft(a)];
    if (a.kind === 'agency') return a.orgId ? [eq(opsEntries.agencyOrgId, a.orgId), notOthersDraft(a)] : [sql`false`];
    if (a.kind === 'client') return a.orgId ? [eq(opsEntries.clientOrgId, a.orgId), notOthersDraft(a)] : [sql`false`];
    return [eq(opsEntries.driverId, a.driver.id), notOthersDraft(a)];
}

function recapScope(a) {
    if (a.kind === 'super') return [];
    if (a.kind === 'agency') return a.orgId ? [eq(opsRecaps.agencyOrgId, a.orgId)] : [sql`false`];
    if (a.kind === 'client') return a.orgId ? [eq(opsRecaps.clientOrgId, a.orgId)] : [sql`false`];
    return [sql`false`]; // drivers see their own entries, not recaps
}

async function loadContract(a, id) {
    const [c] = await db.select().from(leaseContracts).where(and(eq(leaseContracts.id, Number(id)), ...(await contractScope(a)))).limit(1);
    if (!c) throw httpError(404, 'Kontrak tidak ditemukan.');
    return c;
}

async function loadEntry(a, id) {
    const [e] = await db.select().from(opsEntries).where(and(eq(opsEntries.id, Number(id)), ...entryScope(a))).limit(1);
    if (!e) throw httpError(404, 'Data tidak ditemukan.');
    return e;
}

async function loadRecap(a, id) {
    const [r] = await db.select().from(opsRecaps).where(and(eq(opsRecaps.id, Number(id)), ...recapScope(a))).limit(1);
    if (!r) throw httpError(404, 'Rekap tidak ditemukan.');
    return r;
}

/** Holiday dates (national + the agency's own) as a Set of 'YYYY-MM-DD'. */
export async function holidaySet(agencyOrgId = null) {
    const list = await db.select({ date: holidays.date }).from(holidays)
        .where(agencyOrgId ? or(isNull(holidays.organizationId), eq(holidays.organizationId, agencyOrgId)) : isNull(holidays.organizationId));
    return new Set(list.map((h) => String(h.date).slice(0, 10)));
}

const canEdit = (a, e) => {
    if (a.kind === 'super' || (a.kind === 'agency' && a.has('opsrecap.edit'))) return EDITABLE.includes(e.status) || e.status === 'verified';
    // Client approvers may correct a submitted form too (owner 2026-11-13); the
    // agency then has to approve the changed form again.
    if (a.kind === 'client' && (a.has('opsrecap.approve') || a.has('opsrecap.edit'))) return ['submitted', 'verified', 'rejected'].includes(e.status) || (e.status === 'draft' && e.createdBy === a.user.id);
    return EDITABLE.includes(e.status) && e.createdBy === a.user.id;
};

/** Which approval side an editor stands for (only when they may approve). */
const editorSide = (a) => (a.kind === 'agency' && a.has('opsrecap.verify') ? 'agency' : a.kind === 'client' && a.has('opsrecap.approve') ? 'client' : null);

/** Status shown to people: a form only the client approved so far is 'client_ok'. */
export const viewStatus = (e) => (e.status === 'submitted' && e.clientApprovedAt ? 'client_ok' : e.status);

// Drivers see their hours and SPPD/cost amounts, not the overtime pay calculation.
function stripPay(detail) {
    if (!detail?.calc) return detail;
    const { amount, hourlyRate, waitingRate, ...calc } = detail.calc; // eslint-disable-line no-unused-vars
    return { ...detail, calc };
}
const publicEntry = (r, actorKind = null) => ({
    ...r.e,
    detail: actorKind === 'driver' && r.e.kind === 'overtime' ? stripPay(r.e.detail) : r.e.detail,
    hours: r.e.hours == null ? null : Number(r.e.hours),
    amount: r.e.amount == null || (actorKind === 'driver' && r.e.kind === 'overtime') ? null : Number(r.e.amount),
    evidence: (r.e.evidence || []).map((f, idx) => ({ idx, name: f.name, type: f.type, at: f.at })),
    typeLabel: TYPE_LABEL[r.e.type] || r.e.type,
    contractNumber: r.contractNumber, clientName: r.clientName, carName: r.carName ? `${r.carBrand || ''} ${r.carName}`.trim() : null,
    plate: r.plate, driverName: r.driverName, recapCode: r.recapCode,
    code: r.e.code || null, agencyApproved: !!r.e.agencyApprovedAt, clientApproved: !!r.e.clientApprovedAt,
    viewStatus: viewStatus(r.e), comments: Array.isArray(r.e.comments) ? r.e.comments : [],
});

// ─── Form codes (L### lembur, R### operasional) ───────────────────────────
// Given once, when a form leaves draft. Serialised with an advisory lock;
// R numbers continue after the old monthly recap codes so nothing collides.
async function assignCodes(ids) {
    if (!ids.length) return;
    await db.transaction(async (tx) => {
        const list = await tx.select({ id: opsEntries.id, kind: opsEntries.kind }).from(opsEntries)
            .where(and(inArray(opsEntries.id, ids), isNull(opsEntries.code), sql`${opsEntries.status} <> 'draft'`)).orderBy(asc(opsEntries.id));
        for (const e of list) {
            const prefix = O.codePrefixOf(e.kind);
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops_code_${prefix}`}))`);
            const used = (await tx.select({ code: opsEntries.code }).from(opsEntries).where(sql`${opsEntries.code} LIKE ${`${prefix}%`}`)).map((x) => x.code);
            if (prefix === 'R') used.push(...(await tx.select({ code: opsRecaps.code }).from(opsRecaps).where(sql`${opsRecaps.code} LIKE 'R%'`)).map((x) => x.code));
            await tx.update(opsEntries).set({ code: O.nextCode(prefix, used) }).where(eq(opsEntries.id, e.id));
        }
    });
}
const CLEAR_APPROVALS = { agencyApprovedAt: null, agencyApprovedBy: null, clientApprovedAt: null, clientApprovedBy: null, verifiedBy: null, verifiedAt: null };

// ─── Normalise an entry body against its contract ─────────────────────────
const parseJson = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

async function normalize(a, contract, body, existing = null) {
    const kind = body.kind ?? existing?.kind;
    if (!O.KINDS.includes(kind)) throw httpError(400, 'Pilih jenis: lembur, perjalanan dinas, atau biaya operasional.');
    const rawDetail = body.detail !== undefined ? parseJson(body.detail) : existing?.detail;
    const detail = rawDetail && typeof rawDetail === 'object' ? rawDetail : {};
    // Operasional with day rows (2026-11-13) = type 'operasional'; older single-cost forms keep their type.
    const rowsExpense = kind === 'expense' && Array.isArray(detail.rows);
    const type = kind === 'overtime' ? 'lembur' : kind === 'trip' ? 'sppd' : rowsExpense ? 'operasional' : (body.type ?? existing?.type);
    if (kind === 'expense' && !rowsExpense && !O.EXPENSE_TYPES.includes(type)) throw httpError(400, 'Jenis biaya tidak dikenal.');
    const policy = O.effectivePolicy(contract.opsPolicy, await agencyPolicyDefault(contract.agencyOrgId));
    if (kind === 'overtime' && !policy.overtime.enabled) throw httpError(400, 'Kontrak ini tidak mencakup lembur.');
    if (kind === 'trip' && !policy.trip.enabled) throw httpError(400, 'Kontrak ini tidak mencakup perjalanan dinas.');

    // Period of the form: SPPD = berangkat → kembali; lembur / operasional = tanggal mulai → selesai.
    const ranged = kind === 'overtime' || rowsExpense;
    const entryDate = String((kind === 'trip' ? detail.departDate : ranged ? detail.startDate : null) ?? body.entryDate ?? existing?.entryDate ?? '').slice(0, 10);
    if (!ISO.test(entryDate)) throw httpError(400, kind === 'trip' ? 'Tanggal berangkat wajib diisi.' : ranged ? 'Tanggal mulai wajib diisi.' : 'Tanggal wajib diisi.');
    const endDate = ranged ? String(detail.endDate || entryDate).slice(0, 10) : entryDate;
    if (!ISO.test(endDate) || endDate < entryDate) throw httpError(400, 'Tanggal selesai harus ≥ tanggal mulai.');
    if (entryDate < contract.startDate || endDate > contract.endDate) throw httpError(400, 'Tanggal di luar masa kontrak.');
    if (endDate > todayWib()) throw httpError(400, 'Tanggal tidak boleh di masa depan.');

    const unitId = Number(body.contractUnitId ?? existing?.contractUnitId) || null;
    const [unit] = unitId ? await db.select().from(leaseContractUnits).where(and(eq(leaseContractUnits.id, unitId), eq(leaseContractUnits.contractId, contract.id))).limit(1) : [];
    if (!unit) throw httpError(400, 'Pilih unit dari kontrak ini.');
    if (a.kind === 'driver' && unit.driverId !== a.driver.id) throw httpError(403, 'Unit ini bukan tugas Anda.');

    const holidaysSet = await holidaySet(contract.agencyOrgId);
    let dayType = O.DAY_TYPES.includes(body.dayType) ? body.dayType : (existing?.dayType && body.entryDate === undefined && body.detail === undefined ? existing.dayType : O.dayTypeOf(entryDate, holidaysSet));
    let hours = null, amount = null, startTime = null, endTime = null, outDetail = null;
    const inRange = (d) => d >= entryDate && d <= endDate;

    if (kind === 'overtime') {
        // Detail lembur: rows [{ date, dayType, start, end, waitMinutes, location, description }];
        // each date is calculated with its own jenis hari (ops-core spklComputeDays).
        let rows = Array.isArray(detail.rows) ? detail.rows : [];
        if (!rows.length && (body.startTime || existing?.startTime)) rows = [{ start: body.startTime ?? existing?.startTime, end: body.endTime ?? existing?.endTime, waitMinutes: Number(body.waitMinutes) || 0 }];
        rows = rows.slice(0, 62).map((r) => {
            const date = ISO.test(r.date || '') ? r.date : entryDate;
            return {
                date, dayType: O.DAY_TYPES.includes(r.dayType) ? r.dayType : O.dayTypeOf(date, holidaysSet),
                start: HM.test(r.start || '') ? r.start : null, end: HM.test(r.end || '') ? r.end : null,
                waitMinutes: Math.max(0, Math.round(Number(r.waitMinutes) || 0)),
                location: txt(r.location, 120), description: txt(r.description, 200),
            };
        }).filter((r) => r.start && r.end);
        if (!rows.length) throw httpError(400, 'Isi minimal satu baris detail lembur (tanggal, jam mulai & selesai).');
        const out = rows.find((r) => !inRange(r.date));
        if (out) throw httpError(400, `Tanggal ${out.date} di luar tanggal mulai–selesai formulir.`);
        rows.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
        const calc = O.spklComputeDays({ rows, workStart: contract.workStart, workEnd: contract.workEnd, policy });
        if (!(calc.overtimeMinutes > 0)) throw httpError(400, 'Tidak ada jam di luar jam kerja kontrak.');
        hours = calc.hours;
        amount = calc.method === 'none' ? null : calc.amount;
        dayType = rows[0].dayType;
        startTime = rows[0].start; endTime = rows[rows.length - 1].end;
        outDetail = {
            startDate: entryDate, endDate, location: txt(detail.location, 120), rows,
            calc: {
                hours: calc.hours, driveHours: calc.driveHours, waitHours: calc.waitHours, byMult: calc.byMult, waitingPct: calc.waitingPct,
                hourlyRate: calc.hourlyRate, method: calc.method, amount: calc.amount, warnings: calc.warnings, missing: calc.missing,
                days: calc.days.map((d) => ({ date: d.date, dayType: d.dayType, hours: d.hours, driveHours: d.driveHours, waitHours: d.waitHours, split: d.tiers.split })),
            },
        };
    } else if (kind === 'trip') {
        const legs = (Array.isArray(detail.legs) ? detail.legs : []).slice(0, 14).map((l) => ({
            arrivedAt: txt(l.arrivedAt, 120), date: ISO.test(l.date || '') ? l.date : null,
            lodging: O.lodgingClaimed(l.lodging),   // one rate per claimed night (policy.trip.lodgingPerNight)
        })).filter((l) => l.arrivedAt || l.date);
        const calc = O.tripCompute({ departDate: detail.departDate, returnDate: detail.returnDate, legs, policy });
        if (!calc) throw httpError(400, 'Isi tanggal berangkat dan tanggal kembali (kembali ≥ berangkat).');
        if (!txt(detail.destinationCity, 120)) throw httpError(400, 'Kota tujuan wajib diisi.');
        hours = null; amount = calc.amount;
        outDetail = {
            // "Tanggal surat" removed 2026-11-13 (the invoice uses tanggal tagih / trip dates).
            ...(existing?.detail?.docDate ? { docDate: existing.detail.docDate } : {}),
            destinationCity: txt(detail.destinationCity, 120), taskLocation: txt(detail.taskLocation, 200),
            departDate: detail.departDate, returnDate: detail.returnDate, userName: txt(detail.userName, 120), sector: txt(detail.sector, 80),
            legs, calc: { days: calc.days, dailyAllowance: calc.dailyAllowance, allowance: calc.allowance, lodging: calc.lodging, legs: calc.legs.map((l) => l.amount), amount: calc.amount },
        };
    } else if (rowsExpense) {
        // Operasional: header period + day rows { date, kmStart, kmEnd, bbm, tol, parkir, makan, lainnya, note }.
        const num = (v) => (v === '' || v == null ? null : Math.round(Number(v)));
        const rows = detail.rows.slice(0, 62).map((r) => {
            const row = { date: ISO.test(r.date || '') ? r.date : null, kmStart: num(r.kmStart), kmEnd: num(r.kmEnd), note: txt(r.note, 200) };
            for (const k of OPS_COST_FIELDS) row[k] = Math.max(0, num(r[k]) || 0);
            return row;
        }).filter((r) => r.date);
        if (!rows.length) throw httpError(400, 'Isi minimal satu baris (tanggal, km, biaya).');
        rows.sort((x, y) => x.date.localeCompare(y.date));
        for (const [i, r] of rows.entries()) {
            if (!inRange(r.date)) throw httpError(400, `Tanggal ${r.date} di luar tanggal mulai–selesai formulir.`);
            if ((r.kmStart == null) !== (r.kmEnd == null)) throw httpError(400, `Baris ${r.date}: isi km sebelum dan km sesudah.`);
            if (r.kmStart != null && (r.kmStart < 0 || r.kmEnd < r.kmStart)) throw httpError(400, `Baris ${r.date}: km sesudah harus ≥ km sebelum.`);
            const prev = rows.slice(0, i).reverse().find((x) => x.kmEnd != null);
            if (prev && r.kmStart != null && r.kmStart < prev.kmEnd) throw httpError(400, `Baris ${r.date}: km sebelum (${r.kmStart}) lebih kecil dari km sesudah hari sebelumnya (${prev.kmEnd}).`);
        }
        // One operasional form per unit per date range — no overlapping forms.
        const others = await db.select({ id: opsEntries.id, code: opsEntries.code, detail: opsEntries.detail }).from(opsEntries)
            .where(and(eq(opsEntries.carId, unit.carId || -1), eq(opsEntries.kind, 'expense'), eq(opsEntries.type, 'operasional'),
                sql`${opsEntries.status} NOT IN ('rejected')`, existing ? sql`${opsEntries.id} <> ${existing.id}` : sql`true`));
        const clash = others.find((o) => o.detail?.startDate && o.detail.startDate <= endDate && (o.detail.endDate || o.detail.startDate) >= entryDate);
        if (clash) throw httpError(409, `Unit ini sudah punya formulir operasional ${clash.code || ''} di tanggal yang sama (${clash.detail.startDate} – ${clash.detail.endDate}).`.replace('  ', ' '));
        const withKm = rows.filter((r) => r.kmStart != null);
        const totals = Object.fromEntries(OPS_COST_FIELDS.map((k) => [k, rows.reduce((t, r) => t + r[k], 0)]));
        amount = OPS_COST_FIELDS.reduce((t, k) => t + totals[k], 0);
        if (!(amount > 0)) throw httpError(400, 'Isi minimal satu biaya (BBM, tol, parkir, makan atau lainnya).');
        // Odometer log consistency → warning (shown on the form; the M form cross-check uses it too).
        const warnings = [];
        if (withKm.length && unit.carId) {
            const [before] = await db.select({ km: odometerReadings.km, at: odometerReadings.readingDate }).from(odometerReadings)
                .where(and(eq(odometerReadings.carId, unit.carId), lt(odometerReadings.readingDate, new Date(`${entryDate}T00:00:00+07:00`)), sql`${odometerReadings.source} <> 'ops'`))
                .orderBy(desc(odometerReadings.readingDate)).limit(1);
            if (before && withKm[0].kmStart < before.km) warnings.push(`Km awal ${withKm[0].kmStart} lebih kecil dari catatan odometer sebelumnya (${before.km}).`);
        }
        outDetail = {
            startDate: entryDate, endDate, rows, totals,
            kmStart: withKm.length ? withKm[0].kmStart : null, kmEnd: withKm.length ? withKm[withKm.length - 1].kmEnd : null,
            totalKm: withKm.reduce((t, r) => t + (r.kmEnd - r.kmStart), 0), warnings,
        };
    } else {
        amount = Math.round(Number(body.amount ?? existing?.amount) || 0);
        if (!(amount > 0)) throw httpError(400, 'Nominal harus lebih dari 0.');
        startTime = body.startTime ?? existing?.startTime ?? null; endTime = body.endTime ?? existing?.endTime ?? null;
    }
    return {
        kind, type, entryDate, startTime: startTime || null, endTime: endTime || null, dayType,
        hours: hours == null ? null : String(hours), amount: amount == null ? null : String(amount), detail: outDetail,
        note: body.note !== undefined ? (String(body.note || '').slice(0, 500) || null) : (existing?.note ?? null),
        // A replacement car on that day (unit in maintenance / emergency) gets the form and its km.
        contractUnitId: unit.id, carId: await fleetAlertsService.carForUnitOn(unit.id, entryDate, unit.carId), driverId: unit.driverId,
    };
}

// Approved operasional forms write their km into the unit's odometer log — the
// single source the monthly M form (km awal / akhir) reads from (owner 2026-11-13).
async function recordOpsKm(e, userId) {
    if (e.kind !== 'expense' || e.type !== 'operasional' || !e.carId) return;
    for (const r of e.detail?.rows || []) {
        if (r.kmStart != null) await recordOdometer(e.carId, r.kmStart, { source: 'ops', userId, when: new Date(`${r.date}T06:00:00+07:00`) }).catch(() => {});
        if (r.kmEnd != null) await recordOdometer(e.carId, r.kmEnd, { source: 'ops', userId, when: new Date(`${r.date}T20:00:00+07:00`) }).catch(() => {});
    }
}

const toEvidence = (files) => (files || []).map((f) => ({ ref: f.ref, name: String(f.name || 'bukti').slice(0, 120), type: f.type || null, at: new Date().toISOString() }));

export const opsService = {
    // ─── Contracts available to the caller (entry form) ────────────────
    async contracts(user) {
        const a = await actorOf(user);
        const list = await db.select({ c: leaseContracts, clientName: organizations.name }).from(leaseContracts)
            .leftJoin(organizations, eq(organizations.id, leaseContracts.clientOrgId))
            .where(and(inArray(leaseContracts.status, ['active', 'ended']), ...(await contractScope(a))))
            .orderBy(desc(leaseContracts.startDate)).limit(300);
        const ids = list.map((r) => r.c.id);
        const units = ids.length ? await db.select({
            id: leaseContractUnits.id, contractId: leaseContractUnits.contractId, carId: leaseContractUnits.carId, driverId: leaseContractUnits.driverId,
            carName: cars.name, carBrand: cars.brand, plate: cars.licensePlate, driverName: drivers.name,
        }).from(leaseContractUnits).leftJoin(cars, eq(cars.id, leaseContractUnits.carId)).leftJoin(drivers, eq(drivers.id, leaseContractUnits.driverId))
            .where(inArray(leaseContractUnits.contractId, ids)) : [];
        const defaults = await agencyPolicyDefaults(list.map((r) => r.c.agencyOrgId));
        // Holiday dates per agency → the form pre-selects each row's jenis hari.
        const holidayMap = new Map();
        for (const id of [...new Set(list.map((r) => r.c.agencyOrgId))]) holidayMap.set(id, [...(await holidaySet(id))].sort());
        return {
            actor: a.kind,
            data: list.map(({ c, clientName }) => ({
                id: c.id, contractNumber: c.contractNumber, title: c.title, clientName, status: c.status,
                startDate: c.startDate, endDate: c.endDate, extrasMode: c.extrasMode, cutoffDay: c.cutoffDay,
                workStart: c.workStart, workEnd: c.workEnd, currentPeriod: O.periodOfDate(todayWib(), c.cutoffDay),
                holidays: holidayMap.get(c.agencyOrgId) || [],
                policy: (() => {
                    const p = O.effectivePolicy(c.opsPolicy, defaults.get(c.agencyOrgId));
                    // drivers get only what the hour preview needs (no salary / rates)
                    return a.kind === 'driver' ? { overtime: { enabled: p.overtime.enabled, rounding: p.overtime.rounding, breakEvery: p.overtime.breakEvery, breakHours: p.overtime.breakHours, tiers: p.overtime.tiers, waitingPct: p.overtime.waitingPct }, trip: { enabled: p.trip.enabled } } : p;
                })(),
                units: units.filter((u) => u.contractId === c.id && (a.kind !== 'driver' || u.driverId === a.driver.id)).map((u) => ({
                    id: u.id, carId: u.carId, driverId: u.driverId, driverName: u.driverName,
                    label: [u.carName ? `${u.carBrand || ''} ${u.carName}`.trim() : null, u.plate].filter(Boolean).join(' · ') || `Unit #${u.id}`,
                })),
            })),
        };
    },

    // ─── Entries ────────────────────────────────────────────────────────
    async list(user, q = {}) {
        const a = await actorOf(user);
        const conds = [...entryScope(a)];
        if (q.contractId) {
            const c = await loadContract(a, q.contractId);
            conds.push(eq(opsEntries.contractId, c.id));
            if (q.period) { const r = O.cutoffRange(q.period, c.cutoffDay); conds.push(gte(opsEntries.entryDate, r.from), lte(opsEntries.entryDate, r.to)); }
        }
        if (q.from && ISO.test(q.from)) conds.push(gte(opsEntries.entryDate, q.from));
        if (q.to && ISO.test(q.to)) conds.push(lte(opsEntries.entryDate, q.to));
        if (O.KINDS.includes(q.kind)) conds.push(eq(opsEntries.kind, q.kind));
        if (q.status === 'client_ok') conds.push(eq(opsEntries.status, 'submitted'), isNotNull(opsEntries.clientApprovedAt));
        else if (q.status === 'submitted') conds.push(eq(opsEntries.status, 'submitted'), isNull(opsEntries.clientApprovedAt));
        else if (q.status) conds.push(inArray(opsEntries.status, String(q.status).split(',').slice(0, 6)));
        if (q.recapId) conds.push(eq(opsEntries.recapId, Number(q.recapId)));
        if (q.driverId && a.kind !== 'driver') conds.push(eq(opsEntries.driverId, Number(q.driverId)));
        if (q.q) { const s = `%${String(q.q).slice(0, 60)}%`; conds.push(or(ilike(opsEntries.note, s), ilike(drivers.name, s), ilike(cars.licensePlate, s), ilike(opsEntries.code, s))); }
        if (q.code) conds.push(eq(opsEntries.code, String(q.code).trim().toUpperCase()));
        const list = await db.select({
            e: opsEntries, contractNumber: leaseContracts.contractNumber, clientName: organizations.name,
            carName: cars.name, carBrand: cars.brand, plate: cars.licensePlate, driverName: drivers.name, recapCode: opsRecaps.code,
        }).from(opsEntries)
            .leftJoin(leaseContracts, eq(leaseContracts.id, opsEntries.contractId))
            .leftJoin(organizations, eq(organizations.id, opsEntries.clientOrgId))
            .leftJoin(cars, eq(cars.id, opsEntries.carId))
            .leftJoin(drivers, eq(drivers.id, opsEntries.driverId))
            .leftJoin(opsRecaps, eq(opsRecaps.id, opsEntries.recapId))
            .where(conds.length ? and(...conds) : undefined)
            .orderBy(desc(opsEntries.entryDate), desc(opsEntries.id)).limit(1000);
        const data = list.map((r) => publicEntry(r, a.kind));
        const summary = {};
        for (const e of data) {
            const k = e.viewStatus || e.status;
            const s = summary[k] || (summary[k] = { count: 0, hours: 0, amount: 0 });
            s.count++; s.hours = Math.round((s.hours + (e.hours || 0)) * 100) / 100; s.amount += e.amount || 0;
        }
        return { data, total: data.length, summary, actor: a.kind };
    },

    async create(user, body, files = []) {
        const a = await actorOf(user);
        if (a.kind !== 'driver' && !a.has('opsrecap.create')) throw httpError(403, 'Anda tidak memiliki hak menambah data.');
        const c = await loadContract(a, body.contractId);
        if (c.status !== 'active') throw httpError(400, 'Kontrak tidak aktif.');
        const v = await normalize(a, c, body);
        const [e] = await db.insert(opsEntries).values({
            ...v, agencyOrgId: c.agencyOrgId, clientOrgId: c.clientOrgId, contractId: c.id,
            evidence: toEvidence(files).slice(0, MAX_EVIDENCE),
            source: a.kind === 'super' ? 'agency' : a.kind, status: body.status === 'draft' ? 'draft' : 'submitted', billable: c.extrasMode !== 'none',
            createdBy: user.id,
        }).returning();
        await assignCodes([e.id]);
        const [fresh] = await db.select({ code: opsEntries.code }).from(opsEntries).where(eq(opsEntries.id, e.id));
        return { id: e.id, status: e.status, code: fresh?.code || null, hours: e.hours == null ? null : Number(e.hours) };
    },

    async update(user, id, body) {
        const a = await actorOf(user);
        const e = await loadEntry(a, id);
        if (!canEdit(a, e)) throw httpError(409, 'Data ini sudah dikunci (sedang direkap / disetujui / ditagih).');
        const c = await loadContract(a, e.contractId);
        const v = await normalize(a, c, body, e);
        const patch = { ...v, updatedAt: new Date() };
        if (e.status === 'rejected') Object.assign(patch, { status: body.status === 'draft' && !e.code ? 'draft' : 'submitted', rejectReason: null });
        if (e.status === 'draft' && body.status === 'submitted') patch.status = 'submitted';
        // Changed content → approvals start over; the side that made the change
        // counts as having approved it, the other side must approve again.
        if (['submitted', 'verified', 'rejected'].includes(e.status)) {
            Object.assign(patch, CLEAR_APPROVALS, e.status === 'verified' ? { status: 'submitted' } : {});
            const side = editorSide(a);
            const st = patch.status || e.status;
            if (side && st === 'submitted') {
                if (side === 'agency') Object.assign(patch, { agencyApprovedAt: new Date(), agencyApprovedBy: user.id, verifiedBy: user.id, verifiedAt: new Date(), status: 'verified' });
                else Object.assign(patch, { clientApprovedAt: new Date(), clientApprovedBy: user.id });
            }
        }
        await db.update(opsEntries).set(patch).where(eq(opsEntries.id, e.id));
        await assignCodes([e.id]);
        return { ok: true };
    },

    /** Submit own drafts (driver "Ajukan"): draft → submitted. */
    async submit(user, ids) {
        const a = await actorOf(user);
        const list = await db.select({ id: opsEntries.id }).from(opsEntries)
            .where(and(inArray(opsEntries.id, ids.map(Number)), eq(opsEntries.status, 'draft'), eq(opsEntries.createdBy, user.id), ...entryScope(a)));
        if (list.length) await db.update(opsEntries).set({ status: 'submitted', updatedAt: new Date() }).where(inArray(opsEntries.id, list.map((x) => x.id)));
        await assignCodes(list.map((x) => x.id));
        return { submitted: list.length };
    },

    /** Feedback note on a form (agency, client or driver who can see it). */
    async addComment(user, id, text) {
        const a = await actorOf(user);
        const e = await loadEntry(a, id);
        const t = String(text || '').trim().slice(0, 1000);
        if (!t) throw httpError(400, 'Tulis catatan dulu.');
        const list = Array.isArray(e.comments) ? e.comments : [];
        const item = { at: new Date().toISOString(), by: user.name || user.email || 'Pengguna', side: a.kind, text: t };
        await db.update(opsEntries).set({ comments: [...list, item].slice(-100), updatedAt: new Date() }).where(eq(opsEntries.id, e.id));
        return { comments: [...list, item] };
    },

    async remove(user, id) {
        const a = await actorOf(user);
        const e = await loadEntry(a, id);
        if (!canEdit(a, e)) throw httpError(409, 'Data ini sudah dikunci.');
        await db.delete(opsEntries).where(eq(opsEntries.id, e.id));
        for (const f of e.evidence || []) removePrivateRef(f.ref, 'ops');
        return { ok: true };
    },

    async addEvidence(user, id, files) {
        const a = await actorOf(user);
        const e = await loadEntry(a, id);
        if (!canEdit(a, e)) { for (const f of files) removePrivateRef(f.ref, 'ops'); throw httpError(409, 'Data ini sudah dikunci.'); }
        const next = [...(e.evidence || []), ...toEvidence(files)];
        if (next.length > MAX_EVIDENCE) { for (const f of files) removePrivateRef(f.ref, 'ops'); throw httpError(400, `Maksimal ${MAX_EVIDENCE} bukti per data.`); }
        await db.update(opsEntries).set({ evidence: next, updatedAt: new Date() }).where(eq(opsEntries.id, e.id));
        return { count: next.length };
    },

    async removeEvidence(user, id, idx) {
        const a = await actorOf(user);
        const e = await loadEntry(a, id);
        if (!canEdit(a, e)) throw httpError(409, 'Data ini sudah dikunci.');
        const list = [...(e.evidence || [])];
        const [gone] = list.splice(Number(idx), 1);
        if (!gone) throw httpError(404, 'Bukti tidak ditemukan.');
        await db.update(opsEntries).set({ evidence: list, updatedAt: new Date() }).where(eq(opsEntries.id, e.id));
        removePrivateRef(gone.ref, 'ops');
        return { count: list.length };
    },

    /** Evidence file for streaming (route sends it decrypted). */
    async evidence(user, id, idx) {
        const a = await actorOf(user);
        const e = await loadEntry(a, id);
        const f = (e.evidence || [])[Number(idx)];
        if (!f) throw httpError(404, 'Bukti tidak ditemukan.');
        return f;
    },

    // ─── Two-sided approval per form (owner 2026-11-05) ─────────────────
    // Agency (opsrecap.verify) and client (opsrecap.approve) each approve every
    // form, in any order. Both approved → 'approved' → can be invoiced in Dokumen.
    _sideOf(a, asSide) {
        if (a.kind === 'super') return asSide === 'client' ? 'client' : 'agency';
        if (a.kind === 'agency' && a.has('opsrecap.verify')) return 'agency';
        if (a.kind === 'client' && a.has('opsrecap.approve')) return 'client';
        throw httpError(403, 'Anda tidak memiliki hak menyetujui formulir.');
    },

    async approve(user, ids, asSide = null) {
        const a = await actorOf(user);
        const side = this._sideOf(a, asSide);
        const list = await db.select().from(opsEntries)
            .where(and(inArray(opsEntries.id, ids.map(Number)), inArray(opsEntries.status, ['submitted', 'verified']), ...entryScope(a)));
        let approved = 0, done = 0;
        for (const e of list) {
            const agencyApproved = side === 'agency' || !!e.agencyApprovedAt;
            const clientApproved = side === 'client' || !!e.clientApprovedAt;
            const status = O.afterApproval({ agencyApproved, clientApproved });
            const patch = { status, updatedAt: new Date() };
            if (side === 'agency' && !e.agencyApprovedAt) Object.assign(patch, { agencyApprovedAt: new Date(), agencyApprovedBy: user.id, verifiedBy: user.id, verifiedAt: new Date() });
            if (side === 'client' && !e.clientApprovedAt) Object.assign(patch, { clientApprovedAt: new Date(), clientApprovedBy: user.id });
            if (status === 'approved') Object.assign(patch, { decidedBy: user.id, decidedAt: new Date() });
            await db.update(opsEntries).set(patch).where(eq(opsEntries.id, e.id));
            approved++; if (status === 'approved') { done++; await recordOpsKm(e, user.id); }
        }
        await assignCodes(list.map((e) => e.id));   // older forms without a code
        return { approved, fullyApproved: done, side };
    },

    /** Older name kept for the agency "Verifikasi" button. */
    async verify(user, ids) {
        const r = await this.approve(user, ids, 'agency');
        return { verified: r.approved, fullyApproved: r.fullyApproved };
    },

    async reject(user, ids, reason, asSide = null) {
        const a = await actorOf(user);
        this._sideOf(a, asSide);
        const why = String(reason || '').trim().slice(0, 300);
        if (!why) throw httpError(400, 'Tulis alasan penolakan.');
        const list = await db.select({ id: opsEntries.id, code: opsEntries.code, createdBy: opsEntries.createdBy }).from(opsEntries)
            .where(and(inArray(opsEntries.id, ids.map(Number)), inArray(opsEntries.status, ['submitted', 'verified']), ...entryScope(a)));
        if (list.length) await db.update(opsEntries).set({ status: 'rejected', rejectReason: why, decidedBy: user.id, decidedAt: new Date(), updatedAt: new Date(), ...CLEAR_APPROVALS })
            .where(inArray(opsEntries.id, list.map((x) => x.id)));
        // The person who filled the form hears about it (feed + e-mail).
        for (const e of list) if (e.createdBy && e.createdBy !== user.id) {
            await notificationService.notify({ targets: { userId: e.createdBy }, kind: 'form_rejected', severity: 'warning', title: `Form ${e.code || ''} ditolak`.replace('  ', ' '),
                body: `Alasan: ${why}`, link: '/admin/contracts?tab=list', ref: e.code, createdBy: user.id, email: true });
        }
        return { rejected: list.length };
    },

    // ─── Recaps (R###) ──────────────────────────────────────────────────
    async _eligible(c, period, kind) {
        const r = O.cutoffRange(period, c.cutoffDay);
        const base = [eq(opsEntries.contractId, c.id), eq(opsEntries.kind, kind), gte(opsEntries.entryDate, r.from), lte(opsEntries.entryDate, r.to)];
        const ready = await db.select().from(opsEntries).where(and(...base, eq(opsEntries.status, 'verified'), eq(opsEntries.billable, true), isNull(opsEntries.recapId))).orderBy(asc(opsEntries.entryDate));
        const [pending] = await db.select({ n: sql`COUNT(*)::int` }).from(opsEntries).where(and(...base, eq(opsEntries.status, 'submitted')));
        return { range: r, ready, pendingVerification: pending?.n || 0 };
    },

    async recapPreview(user, { contractId, period, kind }) {
        const a = await actorOf(user);
        if (!(a.kind === 'agency' || a.kind === 'super')) throw httpError(403, 'Rekap dibuat oleh agency.');
        if (!O.KINDS.includes(kind)) throw httpError(400, 'Jenis rekap tidak dikenal.');
        const c = await loadContract(a, contractId);
        const el = await this._eligible(c, period, kind);
        const [waiting] = await db.select({ id: opsRecaps.id, code: opsRecaps.code }).from(opsRecaps)
            .where(and(eq(opsRecaps.contractId, c.id), eq(opsRecaps.period, period), eq(opsRecaps.kind, kind), eq(opsRecaps.status, 'waiting'))).limit(1);
        return {
            contractId: c.id, contractNumber: c.contractNumber, extrasMode: c.extrasMode, period, kind, ...el.range,
            entries: el.ready.map((e) => ({ id: e.id, entryDate: e.entryDate, type: e.type, typeLabel: TYPE_LABEL[e.type], hours: e.hours == null ? null : Number(e.hours), amount: e.amount == null ? null : Number(e.amount), note: e.note })),
            totals: O.recapTotals(el.ready), pendingVerification: el.pendingVerification, waitingRecap: waiting || null,
        };
    },

    async _recompute(tx, recapId) {
        const list = await tx.select({ hours: opsEntries.hours, amount: opsEntries.amount }).from(opsEntries).where(eq(opsEntries.recapId, recapId));
        const t = O.recapTotals(list);
        await tx.update(opsRecaps).set({ entryCount: t.count, totalHours: String(t.hours), totalAmount: String(t.amount), updatedAt: new Date() }).where(eq(opsRecaps.id, recapId));
        return t;
    },

    async createRecap(user, { contractId, period, kind }) {
        // Replaced 2026-11-05: every form now has its own code (L### / R###) and
        // is approved by both sides; Dokumen invoices those codes directly.
        if (process.env.OPS_LEGACY_RECAPS !== 'true') throw httpError(410, 'Rekap bulanan R tidak dipakai lagi: setiap formulir punya kode sendiri (L untuk lembur, R untuk operasional). Buat invoice dari kode itu di Dokumen → Invoice.');
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && a.has('opsrecap.edit')))) throw httpError(403, 'Rekap dibuat oleh agency.');
        if (!O.KINDS.includes(kind)) throw httpError(400, 'Jenis rekap tidak dikenal.');
        const c = await loadContract(a, contractId);
        if (c.extrasMode === 'none') throw httpError(400, 'Kontrak ini tidak menagihkan lembur/operasional ke klien.');
        const recap = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ops_recap_code'))`);
            const [waiting] = await tx.select({ code: opsRecaps.code }).from(opsRecaps)
                .where(and(eq(opsRecaps.contractId, c.id), eq(opsRecaps.period, period), eq(opsRecaps.kind, kind), eq(opsRecaps.status, 'waiting'))).limit(1);
            if (waiting) throw httpError(409, `Rekap ${waiting.code} untuk periode ini masih menunggu persetujuan. Gunakan "Perbarui rekap".`);
            const el = await this._eligible(c, period, kind);
            if (!el.ready.length) throw httpError(400, 'Belum ada data terverifikasi di periode ini.');
            const codes = await tx.select({ code: opsRecaps.code }).from(opsRecaps).where(sql`${opsRecaps.code} LIKE 'R%'`);
            const code = O.nextCode('R', codes.map((x) => x.code));
            const [r] = await tx.insert(opsRecaps).values({
                code, contractId: c.id, agencyOrgId: c.agencyOrgId, clientOrgId: c.clientOrgId, period, kind,
                dateFrom: el.range.from, dateTo: el.range.to, status: 'waiting', submittedAt: new Date(), reminders: [], createdBy: user.id,
            }).returning();
            await tx.update(opsEntries).set({ status: 'in_recap', recapId: r.id, updatedAt: new Date() }).where(inArray(opsEntries.id, el.ready.map((e) => e.id)));
            const t = await this._recompute(tx, r.id);
            return { ...r, totals: t };
        });
        this._notifyClient(recap, c, 'new').catch(() => {});
        return { id: recap.id, code: recap.code, ...recap.totals };
    },

    /** Add entries verified after the recap was made (while it still waits). */
    async refreshRecap(user, id) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && a.has('opsrecap.edit')))) throw httpError(403, 'Rekap dikelola oleh agency.');
        const r = await loadRecap(a, id);
        if (r.status !== 'waiting') throw httpError(409, 'Rekap sudah diputuskan.');
        const [c] = await db.select().from(leaseContracts).where(eq(leaseContracts.id, r.contractId)).limit(1);
        const el = await this._eligible(c, r.period, r.kind);
        return db.transaction(async (tx) => {
            if (el.ready.length) await tx.update(opsEntries).set({ status: 'in_recap', recapId: r.id, updatedAt: new Date() }).where(inArray(opsEntries.id, el.ready.map((e) => e.id)));
            const t = await this._recompute(tx, r.id);
            return { added: el.ready.length, ...t };
        });
    },

    async cancelRecap(user, id) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && a.has('opsrecap.edit')))) throw httpError(403, 'Rekap dikelola oleh agency.');
        const r = await loadRecap(a, id);
        if (r.status !== 'waiting') throw httpError(409, 'Hanya rekap yang menunggu persetujuan yang bisa dibatalkan.');
        await db.transaction(async (tx) => {
            await tx.update(opsEntries).set({ status: 'verified', recapId: null, updatedAt: new Date() }).where(eq(opsEntries.recapId, r.id));
            await tx.update(opsRecaps).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(opsRecaps.id, r.id));
        });
        return { ok: true };
    },

    async listRecaps(user, q = {}) {
        const a = await actorOf(user);
        const conds = [...recapScope(a)];
        if (q.contractId) conds.push(eq(opsRecaps.contractId, Number(q.contractId)));
        if (q.status) conds.push(inArray(opsRecaps.status, String(q.status).split(',').slice(0, 5)));
        if (q.period) conds.push(eq(opsRecaps.period, String(q.period).slice(0, 7)));
        const list = await db.select({ r: opsRecaps, contractNumber: leaseContracts.contractNumber, extrasMode: leaseContracts.extrasMode, clientName: organizations.name })
            .from(opsRecaps).leftJoin(leaseContracts, eq(leaseContracts.id, opsRecaps.contractId)).leftJoin(organizations, eq(organizations.id, opsRecaps.clientOrgId))
            .where(conds.length ? and(...conds) : undefined).orderBy(desc(opsRecaps.createdAt)).limit(500);
        const today = todayWib();
        return {
            actor: a.kind,
            data: list.map(({ r, ...rest }) => ({
                ...r, ...rest, totalHours: Number(r.totalHours), totalAmount: Number(r.totalAmount),
                reminderCount: (r.reminders || []).length,
                waitingWorkdays: r.status === 'waiting' ? O.workingDaysBetween(wibDate(r.submittedAt), today) : null,
            })),
        };
    },

    async getRecap(user, id) {
        const a = await actorOf(user);
        const r = await loadRecap(a, id);
        const entries = await this.list(user, { recapId: r.id });
        const [c] = await db.select({ contractNumber: leaseContracts.contractNumber, extrasMode: leaseContracts.extrasMode }).from(leaseContracts).where(eq(leaseContracts.id, r.contractId)).limit(1);
        const [client] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, r.clientOrgId)).limit(1);
        return { ...r, ...c, clientName: client?.name, totalHours: Number(r.totalHours), totalAmount: Number(r.totalAmount), entries: entries.data, actor: a.kind };
    },

    // Client decision: approve the whole recap, or reject single lines first.
    async approveRecap(user, id) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'client' && a.has('opsrecap.approve')))) throw httpError(403, 'Persetujuan dilakukan oleh klien.');
        const r = await loadRecap(a, id);
        if (r.status !== 'waiting') throw httpError(409, 'Rekap sudah diputuskan.');
        if (!(r.entryCount > 0)) throw httpError(400, 'Rekap kosong.');
        await db.transaction(async (tx) => {
            await tx.update(opsEntries).set({ status: 'approved', decidedBy: user.id, decidedAt: new Date(), updatedAt: new Date() }).where(and(eq(opsEntries.recapId, r.id), eq(opsEntries.status, 'in_recap')));
            await this._recompute(tx, r.id);
            await tx.update(opsRecaps).set({ status: 'approved', approvedBy: user.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(opsRecaps.id, r.id));
        });
        notifyAdmin(`✅ Rekap <b>${esc(r.code)}</b> disetujui klien.`, { parseMode: 'HTML', disablePreview: true }).catch(() => {});
        return { ok: true };
    },

    async rejectRecapEntries(user, id, ids, reason) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'client' && a.has('opsrecap.approve')))) throw httpError(403, 'Persetujuan dilakukan oleh klien.');
        const r = await loadRecap(a, id);
        if (r.status !== 'waiting') throw httpError(409, 'Rekap sudah diputuskan.');
        const why = String(reason || '').trim().slice(0, 300);
        if (!why) throw httpError(400, 'Tulis alasan penolakan.');
        const res = await db.transaction(async (tx) => {
            const hit = await tx.select({ id: opsEntries.id }).from(opsEntries)
                .where(and(eq(opsEntries.recapId, r.id), eq(opsEntries.status, 'in_recap'), inArray(opsEntries.id, ids.map(Number))));
            if (hit.length) {
                await tx.update(opsEntries).set({ status: 'rejected', recapId: null, rejectReason: why, decidedBy: user.id, decidedAt: new Date(), updatedAt: new Date() })
                    .where(inArray(opsEntries.id, hit.map((x) => x.id)));
            }
            const t = await this._recompute(tx, r.id);
            if (t.count === 0) await tx.update(opsRecaps).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(opsRecaps.id, r.id));
            return { rejected: hit.length, ...t };
        });
        notifyAdmin(`⚠️ Klien menolak ${res.rejected} baris di rekap <b>${esc(r.code)}</b>: ${esc(why)}`, { parseMode: 'HTML', disablePreview: true }).catch(() => {});
        return res;
    },

    // ─── Notifications & reminders ─────────────────────────────────────
    async _people(orgId, perm) {
        const list = await db.select({ id: userTable.id, email: userTable.email, name: userTable.name, role: userTable.role }).from(userTable)
            .where(and(eq(userTable.organizationId, orgId), eq(userTable.isActive, true)));
        const out = [];
        for (const m of list.slice(0, 60)) {
            if (!m.email) continue;
            if (perm === 'admin' ? m.role === 'admin' : hasPerm(await getAccess(m.id), perm)) out.push(m);
        }
        return out;
    },

    async _notifyClient(recap, contract, why, { number = 0, escalate = false } = {}) {
        const kindLabel = recap.kind === 'overtime' ? 'lembur' : recap.kind === 'trip' ? 'SPPD (perjalanan dinas)' : 'biaya operasional';
        const subject = why === 'new'
            ? `Rekap ${kindLabel} ${recap.code} menunggu persetujuan`
            : `Pengingat ${number}: rekap ${recap.code} belum disetujui`;
        const body = `<p>Rekap ${kindLabel} <b>${esc(recap.code)}</b> untuk kontrak <b>${esc(contract.contractNumber)}</b> periode ${esc(recap.period)} (${esc(recap.dateFrom)} s/d ${esc(recap.dateTo)}) menunggu persetujuan.</p><p><a href="${appUrl()}/admin/contracts?tab=ops">Buka Rekap Operasional &amp; Lembur</a></p>`;
        const to = await this._people(recap.clientOrgId, 'opsrecap.approve');
        if (escalate) to.push(...(await this._people(recap.agencyOrgId, 'admin')));
        for (const p of to) {
            await sendEmail({ to: p.email, subject, html: `<p>Halo ${esc(p.name)},</p>${body}`, text: `${subject}. Buka ${appUrl()}/admin/contracts?tab=ops` }).catch(() => {});
        }
        if (why !== 'new') notifyAdmin(`⏰ ${esc(subject)}${escalate ? ' — diteruskan ke admin agency' : ''}`, { parseMode: 'HTML', disablePreview: true }).catch(() => {});
        return to.length;
    },

    /** Daily job: remind client approvers every 5 working days; escalate after 2. */
    async runReminders() {
        const waiting = await db.select().from(opsRecaps).where(eq(opsRecaps.status, 'waiting'));
        const today = todayWib();
        let sent = 0;
        for (const r of waiting) {
            const hol = await holidaySet(r.agencyOrgId);
            const due = O.reminderDue({ submittedOn: wibDate(r.submittedAt), reminders: r.reminders || [], today, holidays: hol });
            if (!due) continue;
            const [c] = await db.select().from(leaseContracts).where(eq(leaseContracts.id, r.contractId)).limit(1);
            await db.update(opsRecaps).set({ reminders: [...(r.reminders || []), { on: today, escalated: due.escalate }] }).where(eq(opsRecaps.id, r.id));
            await this._notifyClient(r, c || { contractNumber: '-' }, 'reminder', due);
            sent++;
        }
        return { reminders: sent };
    },

    // ─── Overview: every contract + this period's overtime / costs / recaps ─
    // Used by Kontrak & Perusahaan → Ringkasan. Scope: agency = own contracts,
    // client = their company's, superadmin = all. Each contract's period uses
    // its own cut-off day.
    async overview(user, { period } = {}) {
        const per = /^\d{4}-\d{2}$/.test(period || '') ? period : todayWib().slice(0, 7);
        const isClient = accountTypeOf(user) === 'client';
        const scope = user.role === 'superadmin' ? [] : user.organizationId
            ? [isClient ? eq(leaseContracts.clientOrgId, user.organizationId) : eq(leaseContracts.agencyOrgId, user.organizationId)]
            : [sql`false`];
        const list = await db.select({ c: leaseContracts, clientName: organizations.name }).from(leaseContracts)
            .leftJoin(organizations, eq(organizations.id, leaseContracts.clientOrgId))
            .where(scope.length ? and(...scope) : undefined).orderBy(desc(leaseContracts.startDate)).limit(500);
        const ids = list.map((r) => r.c.id);
        if (!ids.length) return { period: per, data: [], totals: { contracts: 0, active: 0, units: 0, monthly: 0, overtimeHours: 0, overtimeAmount: 0, expenseAmount: 0, needAction: 0 } };
        const units = await db.select({ contractId: leaseContractUnits.contractId, fee: leaseContractUnits.monthlyFee }).from(leaseContractUnits).where(inArray(leaseContractUnits.contractId, ids));
        const ranges = new Map(list.map(({ c }) => [c.id, O.cutoffRange(per, c.cutoffDay)]));
        const minFrom = [...ranges.values()].map((r) => r.from).sort()[0];
        const maxTo = [...ranges.values()].map((r) => r.to).sort().pop();
        const entries = await db.select({ contractId: opsEntries.contractId, kind: opsEntries.kind, status: opsEntries.status, billable: opsEntries.billable, entryDate: opsEntries.entryDate, hours: opsEntries.hours, amount: opsEntries.amount })
            .from(opsEntries).where(and(inArray(opsEntries.contractId, ids), gte(opsEntries.entryDate, minFrom), lte(opsEntries.entryDate, maxTo), sql`${opsEntries.status} <> 'draft'`));
        const recaps = await db.select({ contractId: opsRecaps.contractId, id: opsRecaps.id, code: opsRecaps.code, kind: opsRecaps.kind, status: opsRecaps.status, totalHours: opsRecaps.totalHours, totalAmount: opsRecaps.totalAmount })
            .from(opsRecaps).where(and(inArray(opsRecaps.contractId, ids), eq(opsRecaps.period, per), sql`${opsRecaps.status} <> 'cancelled'`));
        const bills = await db.select({ contractId: leaseBillings.contractId, orderNumber: leaseBillings.orderNumber, amount: leaseBillings.amount })
            .from(leaseBillings).where(and(inArray(leaseBillings.contractId, ids), eq(leaseBillings.period, per)));
        const today = todayWib();
        const blank = () => ({ count: 0, hours: 0, amount: 0, byStatus: {} });
        const totals = { contracts: list.length, active: 0, units: 0, monthly: 0, overtimeHours: 0, overtimeAmount: 0, expenseAmount: 0, needAction: 0 };
        const data = list.map(({ c, clientName }) => {
            const r = ranges.get(c.id);
            const mine = entries.filter((e) => e.contractId === c.id && e.entryDate >= r.from && e.entryDate <= r.to);
            const agg = { overtime: blank(), expense: blank(), trip: blank() };
            for (const e of mine) {
                const a = agg[e.kind]; if (!a) continue;
                const st = e.status === 'verified' && !e.billable ? 'recorded' : e.status;
                a.count++; a.hours = Math.round((a.hours + Number(e.hours || 0)) * 100) / 100; a.amount += Number(e.amount || 0);
                a.byStatus[st] = (a.byStatus[st] || 0) + 1;
            }
            const us = units.filter((u) => u.contractId === c.id);
            const monthly = us.reduce((t, u) => t + Number(u.fee || 0), 0);
            const needAction = mine.filter((e) => e.status === 'submitted' || e.status === 'in_recap').length;
            totals.tripAmount = (totals.tripAmount || 0) + agg.trip.amount;
            if (c.status === 'active') { totals.active++; totals.units += us.length; totals.monthly += monthly; }
            totals.overtimeHours = Math.round((totals.overtimeHours + agg.overtime.hours) * 100) / 100;
            totals.overtimeAmount += agg.overtime.amount; totals.expenseAmount += agg.expense.amount; totals.needAction += needAction;
            const bill = bills.find((b) => b.contractId === c.id) || null;
            return {
                id: c.id, contractNumber: c.contractNumber, title: c.title, clientName, status: c.status,
                startDate: c.startDate, endDate: c.endDate, daysLeft: Math.round((new Date(c.endDate) - new Date(today)) / 86400000),
                extrasMode: c.extrasMode, cutoffDay: c.cutoffDay, workStart: c.workStart, workEnd: c.workEnd,
                unitCount: us.length, monthlyTotal: monthly, range: r,
                monthBooking: bill ? { code: bill.orderNumber, amount: Number(bill.amount) } : null,
                overtime: agg.overtime, expense: agg.expense, trip: agg.trip, needAction,
                recaps: recaps.filter((x) => x.contractId === c.id).map((x) => ({ ...x, totalHours: Number(x.totalHours), totalAmount: Number(x.totalAmount) })),
            };
        });
        return { period: per, data, totals };
    },

    // ─── Holidays ──────────────────────────────────────────────────────
    async listHolidays(user, year) {
        const y = Number(year) || Number(todayWib().slice(0, 4));
        const own = user.organizationId || 0;
        const list = await db.select().from(holidays)
            .where(and(gte(holidays.date, `${y}-01-01`), lte(holidays.date, `${y}-12-31`), or(isNull(holidays.organizationId), eq(holidays.organizationId, own))))
            .orderBy(asc(holidays.date));
        return { data: list.map((h) => ({ ...h, national: h.organizationId == null })) };
    },

    async addHoliday(user, { date, name, national = false }) {
        if (!ISO.test(date || '')) throw httpError(400, 'Tanggal tidak valid.');
        if (!String(name || '').trim()) throw httpError(400, 'Nama hari libur wajib diisi.');
        const orgId = national && user.role === 'superadmin' ? null : user.organizationId;
        if (!national && !orgId) throw httpError(400, 'Akun belum terhubung ke organisasi.');
        if (national && user.role !== 'superadmin') throw httpError(403, 'Libur nasional diatur oleh superadmin.');
        try {
            const [h] = await db.insert(holidays).values({ date, name: String(name).trim().slice(0, 120), organizationId: orgId, createdBy: user.id }).returning();
            return h;
        } catch (e) {
            if ((e.code || e.cause?.code) === '23505') throw httpError(409, 'Tanggal ini sudah ada di daftar libur.');
            throw e;
        }
    },

    async removeHoliday(user, id) {
        const [h] = await db.select().from(holidays).where(eq(holidays.id, Number(id))).limit(1);
        if (!h) throw httpError(404, 'Data libur tidak ditemukan.');
        if (h.organizationId == null ? user.role !== 'superadmin' : h.organizationId !== user.organizationId && user.role !== 'superadmin') throw httpError(403, 'Tidak bisa menghapus libur ini.');
        await db.delete(holidays).where(eq(holidays.id, h.id));
        return { ok: true };
    },
};

export default opsService;
