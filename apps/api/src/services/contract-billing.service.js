// ─── Monthly M codes per unit (owner 2026-11-13) ────────────────────────────
// Every CONTRACT MONTH (cycle: start date → day before the same date next
// month, last one ends at the contract end — contracts-core contractCycles)
// of an ACTIVE contract gets one M code per unit — an order row (status
// completed, package "Kontrak …", tanggal pemakaian = the cycle) numbered on
// the global M sequence (M001, M002 … across all contracts). The first month
// is made when the contract becomes active; every next month on H+1 after the
// previous month's tanggal tagih (contracts-core openCycles). Earlier months
// stay. Each cycle = one month: full monthly fee and km quota.
//
// Form → Kontrak is the M DETAIL FORM: km awal / akhir, nama user, tujuan,
// keterangan, bukti, catatan; then BOTH sides approve (agency opsrecap.verify,
// client opsrecap.approve). Nominal = biaya bulanan + kelebihan km. KM must
// align with the unit's operasional (O) forms in that month — a mismatch warns
// and blocks approval (kmCheck: KM per segment must EQUAL the O-form km; filling KM is optional).
// KM segments (kmSegments): the unit's own km, a replacement car's km while one runs; maintenance
// days without a replacement are not counted. Only APPROVED M codes can be invoiced
// (invoice.service guard). Approval writes km awal / akhir to the odometer log.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import {
    leaseContracts, leaseContractUnits, leaseBillings, leaseUnitBillings, organizations, cars, drivers, orders, odometerReadings,
    invoices, fakturPajak, opsEntries, maintenance, leaseUnitReplacements,
} from '../db/schema.js';
import { and, eq, inArray, desc, lte, lt, sql, asc } from 'drizzle-orm';
import * as K from './contracts-core.js';
import { maintenanceRange } from './fleet-events-core.js';
import { customerService } from './customer.service.js';
import { orderService, generateOrderNumber } from './order.service.js';
import { getAccess, hasPerm } from './access.service.js';
import { accountTypeOf } from './access-core.js';
import { recordOdometer } from './fleetcare.service.js';
import { removePrivateRef } from './private-files.js';
import { notificationService } from './notifications.service.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const isClient = (u) => u && (u.accountType === 'client' || u.role === 'client' || u.role === 'client_admin');

function scopeCond(user) {
    if (user.role === 'superadmin') return [];
    if (isClient(user)) return user.organizationId ? [eq(leaseContracts.clientOrgId, user.organizationId)] : [sql`false`];
    return user.organizationId ? [eq(leaseContracts.agencyOrgId, user.organizationId)] : [sql`false`];
}

/** km driven between two dates: last odometer reading ≤ end − last reading before start. */
async function kmUsedBetween(carId, from, to) {
    if (!carId) return null;
    const end = new Date(`${to}T23:59:59+07:00`), start = new Date(`${from}T00:00:00+07:00`);
    const [last] = await db.select({ km: odometerReadings.km }).from(odometerReadings)
        .where(and(eq(odometerReadings.carId, carId), lte(odometerReadings.readingDate, end))).orderBy(desc(odometerReadings.readingDate)).limit(1);
    const [before] = await db.select({ km: odometerReadings.km }).from(odometerReadings)
        .where(and(eq(odometerReadings.carId, carId), lt(odometerReadings.readingDate, start))).orderBy(desc(odometerReadings.readingDate)).limit(1);
    if (!last || !before) return null;
    return Math.max(0, last.km - before.km);
}

const noteOf = (c, l, idx) => [
    `Kontrak ${c.contractNumber} · bulan ke-${idx} (${l.from} s/d ${l.to})`,
    l.kmUsed != null ? `km terpakai ${l.kmUsed} / kuota ${l.kmAllowed}${l.excessKm ? `, lebih ${l.excessKm} km = Rp${l.excessCharge.toLocaleString('id-ID')}` : ''}` : null,
].filter(Boolean).join(' · ').slice(0, 500);

/** Date from which this contract no longer bills (replaced by an active amendment). */
async function stopFromOf(c) {
    if (!c.supersededBy) return null;
    const [a] = await db.select({ startDate: leaseContracts.startDate }).from(leaseContracts).where(eq(leaseContracts.id, c.supersededBy)).limit(1);
    return a?.startDate || null;
}

/** Bill one unit for one cycle (km from the odometer unless given). */
async function lineFor(c, u, cycle, km = undefined) {
    const used = km !== undefined ? km : await kmUsedBetween(u.carId, cycle.from, cycle.to);
    const l = K.cycleLine({ contract: c, unit: u, cycle, kmUsed: used });
    if (!l) return null;
    return { ...l, cycleFrom: cycle.from, cycleTo: cycle.to, monthIndex: cycle.index, invoiceDate: K.cycleInvoiceDate(cycle.from, c.billingDay) };
}

// ─── M detail form: actor, sides, status ─────────────────────────────────
async function actorOf(user) {
    const access = await getAccess(user.id);
    const has = (p) => user.role === 'superadmin' || hasPerm(access, p);
    const kind = user.role === 'superadmin' ? 'super' : accountTypeOf(user) === 'client' ? 'client' : 'agency';
    return { kind, has, user };
}
// Fill / edit: agency admin + staff operasional; client approvers may correct too
// (their side then counts as approved, like the L/T/O forms).
const canFill = (a) => a.kind === 'super' || (a.kind === 'agency' && (a.has('opsrecap.create') || a.has('opsrecap.edit') || a.has('contracts.edit')))
    || (a.kind === 'client' && a.has('opsrecap.approve'));
const editorSide = (a) => (a.kind === 'agency' && a.has('opsrecap.verify') ? 'agency' : a.kind === 'client' && a.has('opsrecap.approve') ? 'client' : null);
function sideOf(a, asSide) {
    if (a.kind === 'super') return asSide === 'client' ? 'client' : 'agency';
    if (a.kind === 'agency' && a.has('opsrecap.verify')) return 'agency';
    if (a.kind === 'client' && a.has('opsrecap.approve')) return 'client';
    throw httpError(403, 'Anda tidak memiliki hak menyetujui form bulanan.');
}
const CLEAR = { agencyApprovedAt: null, agencyApprovedBy: null, clientApprovedAt: null, clientApprovedBy: null };
/** open | submitted | verified (agency ok) | client_ok | approved | rejected | billed */
const viewStatusOf = (b, billed) => (billed ? 'billed'
    : b.status === 'submitted' && b.agencyApprovedAt ? 'verified'
        : b.status === 'submitted' && b.clientApprovedAt ? 'client_ok' : b.status || 'open');
const nOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const ACTIVE_O = ['submitted', 'verified', 'approved', 'billed'];

/** O-form day rows (with km) per car inside [from, to]. */
async function opsKmRows(carIds, from, to) {
    if (!carIds.length) return new Map();
    const list = await db.select({ carId: opsEntries.carId, code: opsEntries.code, detail: opsEntries.detail }).from(opsEntries)
        .where(and(inArray(opsEntries.carId, carIds), eq(opsEntries.kind, 'expense'), eq(opsEntries.type, 'operasional'), inArray(opsEntries.status, ACTIVE_O),
            sql`${opsEntries.detail}->>'startDate' <= ${to}`, sql`coalesce(${opsEntries.detail}->>'endDate', ${opsEntries.detail}->>'startDate') >= ${from}`));
    const by = new Map();
    for (const e of list) for (const r of e.detail?.rows || []) {
        if (r.kmStart == null || r.kmEnd == null) continue;
        if (!by.has(e.carId)) by.set(e.carId, []);
        by.get(e.carId).push({ date: r.date, kmStart: r.kmStart, kmEnd: r.kmEnd, code: e.code });
    }
    return by;
}

async function odoAt(carId, iso, { before = false } = {}) {
    if (!carId) return null;
    const at = before ? new Date(`${iso}T00:00:00+07:00`) : new Date(`${iso}T23:59:59+07:00`);
    const [r] = await db.select({ km: odometerReadings.km }).from(odometerReadings)
        .where(and(eq(odometerReadings.carId, carId), before ? lt(odometerReadings.readingDate, at) : lte(odometerReadings.readingDate, at)))
        .orderBy(desc(odometerReadings.readingDate)).limit(1);
    return r ? r.km : null;
}

async function loadRow(user, id) {
    const [r] = await db.select({ b: leaseUnitBillings, c: leaseContracts }).from(leaseUnitBillings)
        .innerJoin(leaseContracts, eq(leaseContracts.id, leaseUnitBillings.contractId))
        .where(and(eq(leaseUnitBillings.id, Number(id)), ...scopeCond(user))).limit(1);
    if (!r) throw httpError(404, 'Form bulanan tidak ditemukan.');
    const [o] = r.b.orderId ? await db.select().from(orders).where(eq(orders.id, r.b.orderId)).limit(1) : [];
    const [u] = await db.select().from(leaseContractUnits).where(eq(leaseContractUnits.id, r.b.unitId)).limit(1);
    return { ...r, o: o || null, u: u || null, billed: !!o?.invoiceId };
}

const carName = (c) => (c ? [[c.brand, c.name].filter(Boolean).join(' '), c.licensePlate].filter(Boolean).join(' · ') : null);
/** The contract month of an M row (follows the agreement: contract start + month index). */
const contractMonthOf = (c, b) => K.contractCycles(c.startDate, c.endDate).find((x) => x.index === b.monthIndex) || null;
/** Days the unit itself serves in that month (KM rows); older rows only stored from / to. */
const cycleOf = (b, c = null) => {
    const m = c ? contractMonthOf(c, b) : null;
    const unitFrom = b.detail?.activeFrom || b.detail?.from || b.detail?.cycleFrom, unitTo = b.detail?.activeTo || b.detail?.to || b.detail?.cycleTo;
    if (!m) return { from: unitFrom, to: unitTo };
    return { from: [m.from, unitFrom].filter(Boolean).sort().pop(), to: [m.to, unitTo].filter(Boolean).sort()[0] };
};

/**
 * KM segments of one M row: layout from replacements + maintenance of the unit
 * in that month (contracts-core kmSegments), values from what was saved
 * (km_segments; older rows: km_start / km_end on a single segment).
 */
async function formSegments(row) {
    const { b, u } = row;
    const { from, to } = cycleOf(b, row.c);
    if (!from || !to) return [];
    const reps = await db.select().from(leaseUnitReplacements).where(eq(leaseUnitReplacements.contractUnitId, b.unitId));
    const maint = u?.carId ? await db.select().from(maintenance).where(and(eq(maintenance.carId, u.carId), inArray(maintenance.status, ['scheduled', 'in_progress', 'completed']))) : [];
    const layout = K.kmSegments({
        from, to, carId: u?.carId ?? null,
        replacements: reps.map((r) => ({ id: r.id, carId: r.replacementCarId, from: r.startDate, to: r.endDate })),
        maintenances: maint.map(maintenanceRange),
    });
    const saved = new Map((Array.isArray(b.kmSegments) ? b.kmSegments : []).map((x) => [x.key, x]));
    const legacy = !saved.size && layout.length === 1 && (b.kmStart != null || b.kmEnd != null);
    const carIds = [...new Set(layout.map((x) => x.carId).filter(Boolean))];
    const cars_ = carIds.length ? await db.select({ id: cars.id, name: cars.name, brand: cars.brand, licensePlate: cars.licensePlate }).from(cars).where(inArray(cars.id, carIds)) : [];
    const labelOf = new Map(cars_.map((c) => [c.id, carName(c)]));
    return layout.map((x) => ({
        ...x, label: labelOf.get(x.carId) || (x.role === 'replacement' ? 'Unit pengganti' : 'Unit'),
        kmStart: legacy ? b.kmStart : saved.get(x.key)?.kmStart ?? null,
        kmEnd: legacy ? b.kmEnd : saved.get(x.key)?.kmEnd ?? null,
    }));
}

/** KM check of one M row: every segment vs the O forms of its car, + previous month. */
async function checkOf(row, segments = null) {
    const { b } = row;
    const segs = segments || await formSegments(row);
    const { from, to } = cycleOf(b, row.c);
    const carIds = [...new Set(segs.map((x) => x.carId).filter(Boolean))];
    const oBy = from && to ? await opsKmRows(carIds, from, to) : new Map();
    const [prev] = await db.select({ kmEnd: leaseUnitBillings.kmEnd }).from(leaseUnitBillings)
        .where(and(eq(leaseUnitBillings.contractId, b.contractId), eq(leaseUnitBillings.unitId, b.unitId), eq(leaseUnitBillings.monthIndex, b.monthIndex - 1))).limit(1);
    const prevKmEnd = prev?.kmEnd ?? null;
    return { ...K.kmCheck({ segments: segs, oRowsByCar: Object.fromEntries(oBy), prevKmEnd }), segments: segs, oBy, prevKmEnd };
}

/** Recompute the M nominal with the current rules + saved km; update the order row when it changed. */
async function refreshAmount(row, kmUsed) {
    const { b, c, u, o } = row;
    if (!o || !u || o.invoiceId) return;
    const cycle = K.contractCycles(c.startDate, c.endDate).find((x) => x.index === b.monthIndex);
    const l = cycle ? await lineFor(c, u, cycle, kmUsed) : null;
    const pick = new Date(`${l?.from}T00:00:00+07:00`), ret = new Date(`${l?.to}T23:59:00+07:00`);
    const sameDates = l && o.pickupDate && o.returnDate && +new Date(o.pickupDate) === +pick && +new Date(o.returnDate) === +ret;
    if (!l || (l.total === Number(o.totalPrice) && sameDates)) return;
    await db.transaction(async (tx) => {
        await tx.update(orders).set({
            totalPrice: String(l.total), notes: noteOf(c, l, cycle.index), dailyRate: String(Math.round(l.fee / Math.max(1, l.days))),
            pickupDate: pick, returnDate: ret, updatedAt: new Date(),   // tgl pemakaian = contract month
        }).where(eq(orders.id, o.id));
        await tx.update(leaseUnitBillings).set({ amount: String(l.total), detail: { ...l, kmStart: b.kmStart, kmEnd: b.kmEnd }, updatedAt: new Date() }).where(eq(leaseUnitBillings.id, b.id));
    });
}

export const contractBillingService = {
    /** Create the missing M codes of one contract (all due months). → number created */
    async ensureContract(contractId, userId = null) {
        const [c] = await db.select().from(leaseContracts).where(eq(leaseContracts.id, Number(contractId))).limit(1);
        if (!c || c.status !== 'active') return 0;
        const cycles = K.openCycles({ startDate: c.startDate, endDate: c.endDate, billingDay: c.billingDay, todayIso: todayWib(), stopFrom: await stopFromOf(c) });
        if (!cycles.length) return 0;
        // Months billed the old way (one M for the whole contract) are left alone.
        const legacy = new Set((await db.select({ p: leaseBillings.period }).from(leaseBillings).where(eq(leaseBillings.contractId, c.id))).map((x) => x.p));
        const units = await db.select().from(leaseContractUnits).where(eq(leaseContractUnits.contractId, c.id)).orderBy(asc(leaseContractUnits.id));
        const done = new Set((await db.select({ u: leaseUnitBillings.unitId, p: leaseUnitBillings.period }).from(leaseUnitBillings)
            .where(eq(leaseUnitBillings.contractId, c.id))).map((x) => `${x.u}|${x.p}`));
        const [client] = await db.select().from(organizations).where(eq(organizations.id, c.clientOrgId)).limit(1);
        if (!client) return 0;
        let customer = null, created = 0;
        for (const cycle of cycles) {
            if (legacy.has(cycle.period)) continue;
            for (const u of units) {
                if (done.has(`${u.id}|${cycle.period}`)) continue;
                const l = await lineFor(c, u, cycle);
                if (!l || !(l.total > 0)) continue;
                // Global M numbering: one lock so two runs never take the same code.
                const made = await db.transaction(async (tx) => {
                    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('order_code_M'))`);
                    const [exists] = await tx.select({ id: leaseUnitBillings.id }).from(leaseUnitBillings)
                        .where(and(eq(leaseUnitBillings.contractId, c.id), eq(leaseUnitBillings.unitId, u.id), eq(leaseUnitBillings.period, cycle.period))).limit(1);
                    if (exists) return false;
                    customer = customer || await customerService.findOrCreate({
                        name: client.name, customerType: 'company', companyName: client.name,
                        phone: client.phone1 || null, whatsapp: client.phone1 || null, email: client.email || null,
                        organizationId: client.id, createdBy: userId,
                    });
                    const orderNumber = await generateOrderNumber(customer.id, { prefix: 'M' });
                    const o = await orderService.create({
                        orderNumber, carId: u.carId || null, driverId: u.driverId || null, customerId: customer.id, customerName: client.name,
                        pickupDate: new Date(`${l.from}T00:00:00+07:00`), returnDate: new Date(`${l.to}T23:59:00+07:00`),
                        totalDays: l.days, dailyRate: String(Math.round(l.fee / Math.max(1, l.days))), totalPrice: String(l.total),
                        status: 'completed', package: `Kontrak ${c.package || 'Bulanan'}`.slice(0, 50), notes: noteOf(c, l, cycle.index),
                        organizationId: c.clientOrgId, createdBy: userId, sourceOrigin: 'contract', contractId: c.id,
                        claimedByAgencyId: c.agencyOrgId, claimedByUserId: userId, claimStatus: 'agency_claimed', claimedAt: new Date(),
                    });
                    try {
                        await tx.insert(leaseUnitBillings).values({
                            contractId: c.id, unitId: u.id, period: cycle.period, monthIndex: cycle.index, orderId: o.id, orderNumber,
                            amount: String(l.total), detail: l, createdBy: userId,
                        });
                    } catch (e) {
                        await db.delete(orders).where(eq(orders.id, o.id)).catch(() => {});   // no orphan M row
                        throw e;
                    }
                    return true;
                });
                if (made) created++;
            }
        }
        return created;
    },

    /** Scheduler: every active contract, all due months. */
    async runMonthlyCodes() {
        const list = await db.select({ id: leaseContracts.id }).from(leaseContracts).where(eq(leaseContracts.status, 'active'));
        let created = 0;
        for (const c of list) {
            try { created += await this.ensureContract(c.id); }
            catch (e) { console.warn(`[contracts] M codes for contract ${c.id} failed:`, e.message); }
        }
        return { contracts: list.length, created };
    },

    /** M codes visible to the caller (Form → Kontrak, List Data). */
    async list(user, { contractId, period, status } = {}) {
        const conds = [...scopeCond(user)];
        if (contractId) conds.push(eq(leaseUnitBillings.contractId, Number(contractId)));
        if (period) conds.push(eq(leaseUnitBillings.period, String(period).slice(0, 7)));
        const rows = await db.select({
            b: leaseUnitBillings, contractNumber: leaseContracts.contractNumber, contractStatus: leaseContracts.status,
            cStart: leaseContracts.startDate, cEnd: leaseContracts.endDate, cBillingDay: leaseContracts.billingDay,
            clientOrgId: leaseContracts.clientOrgId, clientName: organizations.name, kmAllowanceMonth: leaseContracts.kmAllowanceMonth,
            carId: leaseContractUnits.carId, carName: cars.name, carBrand: cars.brand, plate: cars.licensePlate, driverName: drivers.name,
            invoiceId: orders.invoiceId, invoiceNumber: orders.invoiceNumber, invoiceSentDate: orders.invoiceSentDate,
            invoiceLetterNumber: orders.invoiceLetterNumber, invoicePaidDate: orders.invoicePaidDate, orderTotal: orders.totalPrice,
        }).from(leaseUnitBillings)
            .innerJoin(leaseContracts, eq(leaseContracts.id, leaseUnitBillings.contractId))
            .leftJoin(organizations, eq(organizations.id, leaseContracts.clientOrgId))
            .leftJoin(leaseContractUnits, eq(leaseContractUnits.id, leaseUnitBillings.unitId))
            .leftJoin(cars, eq(cars.id, leaseContractUnits.carId))
            .leftJoin(drivers, eq(drivers.id, leaseContractUnits.driverId))
            .leftJoin(orders, eq(orders.id, leaseUnitBillings.orderId))
            .where(conds.length ? and(...conds) : undefined)
            .orderBy(desc(leaseUnitBillings.period), asc(leaseUnitBillings.orderNumber)).limit(2000);
        const invIds = [...new Set(rows.map((r) => r.invoiceId).filter(Boolean))];
        const fk = invIds.length ? await db.select({ id: invoices.id, nsfp: fakturPajak.nsfp, fakturStatus: fakturPajak.status })
            .from(invoices).leftJoin(fakturPajak, eq(fakturPajak.id, invoices.fakturId)).where(inArray(invoices.id, invIds)) : [];
        const fkBy = new Map(fk.map((x) => [x.id, x]));
        // KM check against the operasional forms (one query for all cars shown). Uses the saved
        // segments (the form itself recomputes the layout from replacements / maintenance).
        const cyclesBy = new Map();
        const monthOf = (r) => {
            if (!cyclesBy.has(r.b.contractId)) cyclesBy.set(r.b.contractId, K.contractCycles(r.cStart, r.cEnd));
            return cyclesBy.get(r.b.contractId).find((x) => x.index === r.b.monthIndex) || null;
        };
        const fromOf = (b, r) => monthOf(r)?.from || b.detail?.from || b.detail?.cycleFrom;
        const toOf = (b, r) => monthOf(r)?.to || b.detail?.to || b.detail?.cycleTo;
        const segsOf = (r) => (Array.isArray(r.b.kmSegments) && r.b.kmSegments.length ? r.b.kmSegments
            : [{ key: 'unit', role: 'unit', carId: r.carId, from: fromOf(r.b, r), to: toOf(r.b, r), kmStart: r.b.kmStart, kmEnd: r.b.kmEnd }]);
        const open = rows.filter((r) => !r.invoiceId && fromOf(r.b, r));
        const openCars = [...new Set(open.flatMap((r) => segsOf(r).map((x) => x.carId)).filter(Boolean))];
        const oBy = openCars.length ? await opsKmRows(openCars, open.map((r) => fromOf(r.b, r)).sort()[0], open.map((r) => toOf(r.b, r)).sort().pop()) : new Map();
        const oByObj = Object.fromEntries(oBy);
        const prevEnd = new Map(rows.map((r) => [`${r.b.contractId}|${r.b.unitId}|${r.b.monthIndex}`, r.b.kmEnd]));
        let data = rows.map((r) => {
            const b = r.b, billed = !!r.invoiceId;
            const check = billed ? null : K.kmCheck({
                segments: segsOf(r), oRowsByCar: oByObj, prevKmEnd: prevEnd.get(`${b.contractId}|${b.unitId}|${b.monthIndex - 1}`) ?? null,
            });
            return {
                id: b.id, code: b.orderNumber, contractId: b.contractId, contractNumber: r.contractNumber, contractStatus: r.contractStatus,
                clientName: r.clientName, period: b.period, monthIndex: b.monthIndex,
                // Period shown = the contract month (follows the agreement), not the unit's own dates.
                from: fromOf(b, r) || null, to: toOf(b, r) || null,
                invoiceDate: monthOf(r) ? K.cycleInvoiceDate(monthOf(r).from, r.cBillingDay) : b.detail?.invoiceDate || null,
                unit: [r.carBrand, r.carName].filter(Boolean).join(' '), plate: r.plate, driverName: r.driverName,
                amount: Number(r.orderTotal ?? b.amount), detail: b.detail,
                kmStart: b.kmStart, kmEnd: b.kmEnd, kmUsed: b.detail?.kmUsed ?? null, kmSegments: Array.isArray(b.kmSegments) ? b.kmSegments.length : 1,
                picName: b.picName, destination: b.destination, note: b.note,
                status: viewStatusOf(b, billed), rawStatus: b.status, agencyApproved: !!b.agencyApprovedAt, clientApproved: !!b.clientApprovedAt,
                rejectReason: b.rejectReason, evidenceCount: (b.evidence || []).length, commentCount: (b.comments || []).length,
                kmIssues: check?.issues || [], kmWarnings: check?.warnings || [],
                invoiceNumber: r.invoiceNumber || null, invoiceSentDate: r.invoiceSentDate, letterNumber: r.invoiceLetterNumber || null,
                paid: !!r.invoicePaidDate, fakturNsfp: fkBy.get(r.invoiceId)?.nsfp || null, fakturStatus: fkBy.get(r.invoiceId)?.fakturStatus || null,
            };
        });
        if (status) data = data.filter((x) => x.status === status);
        return { data, total: data.length, page: 1 };
    },

    /** One M form: stored values + suggestions (odometer / O forms) + calc + check. */
    async get(user, id) {
        const row = await loadRow(user, id);
        const { b, c, u, o } = row;
        const month = contractMonthOf(c, b);   // period shown = the contract month (agreement)
        const from = month?.from || cycleOf(b).from, to = month?.to || cycleOf(b).to;
        const check = await checkOf(row);
        // Per segment: O-form km (must be equal) and a suggestion from the odometer / O forms.
        let firstUnit = true;
        const segments = [];
        for (const sg of check.segments) {
            const o = check.perSeg[sg.key] || null;
            const odoStart = await odoAt(sg.carId, sg.from, { before: true }), odoEnd = await odoAt(sg.carId, sg.to);
            const prev = sg.role === 'unit' && firstUnit ? check.prevKmEnd : null;
            if (sg.role === 'unit') firstUnit = false;
            segments.push({
                ...sg, o,
                suggest: {
                    kmStart: o?.oFirst ?? prev ?? odoStart ?? null,
                    kmEnd: o?.oLast ?? odoEnd ?? null,
                },
            });
        }
        // Nominal with the current rules (owner 2026-11-13: full monthly fee, no pro-rata) and the
        // saved KM — older rows may still hold a pro-rated amount until they are saved / approved.
        const cycle = K.contractCycles(c.startDate, c.endDate).find((x) => x.index === b.monthIndex);
        const fresh = cycle && u ? await lineFor(c, u, cycle, K.segmentsKmUsed(check.segments)) : null;
        const [client] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, c.clientOrgId)).limit(1);
        const [car] = u?.carId ? await db.select({ name: cars.name, brand: cars.brand, plate: cars.licensePlate }).from(cars).where(eq(cars.id, u.carId)).limit(1) : [];
        const [drv] = u?.driverId ? await db.select({ name: drivers.name }).from(drivers).where(eq(drivers.id, u.driverId)).limit(1) : [];
        const [inv] = o?.invoiceId ? await db.select({ number: invoices.invoiceNumber, letterNumber: invoices.letterNumber, sentDate: invoices.sentDate, nsfp: fakturPajak.nsfp })
            .from(invoices).leftJoin(fakturPajak, eq(fakturPajak.id, invoices.fakturId)).where(eq(invoices.id, o.invoiceId)).limit(1) : [];
        return {
            id: b.id, code: b.orderNumber, contractId: c.id, contractNumber: c.contractNumber, clientName: client?.name || null,
            monthIndex: b.monthIndex, period: b.period, from, to, invoiceDate: month ? K.cycleInvoiceDate(month.from, c.billingDay) : b.detail?.invoiceDate || null,
            unit: car ? [car.brand, car.name].filter(Boolean).join(' ') : null, plate: car?.plate || null, driverName: drv?.name || null,
            kmStart: b.kmStart, kmEnd: b.kmEnd, segments, picName: b.picName, destination: b.destination, note: b.note,
            status: viewStatusOf(b, row.billed), rawStatus: b.status, agencyApproved: !!b.agencyApprovedAt, clientApproved: !!b.clientApprovedAt,
            rejectReason: b.rejectReason, evidence: (b.evidence || []).map((f, idx) => ({ idx, name: f.name, type: f.type, at: f.at })),
            comments: Array.isArray(b.comments) ? b.comments : [],
            amount: Number(o?.totalPrice ?? b.amount), calc: !row.billed && fresh ? fresh : b.detail,
            // Saved with older rules (pro-rata amount / unit's own start date) → updated on Simpan or approval.
            amountOutdated: !row.billed && !!fresh && (fresh.total !== Number(o?.totalPrice ?? b.amount)
                || (!!o?.pickupDate && new Date(o.pickupDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) !== fresh.from)),
            contract: { kmAllowanceMonth: Number(c.kmAllowanceMonth) || 0, excessKmRate: Number(c.excessKmRate) || 0, monthlyFee: Number(u?.monthlyFee) || 0, billingDay: c.billingDay },
            check: { issues: check.issues, warnings: check.warnings, prevKmEnd: check.prevKmEnd },
            invoice: inv ? { number: inv.number, letterNumber: inv.letterNumber, sentDate: inv.sentDate, fakturNsfp: inv.nsfp } : null,
            editable: !row.billed && b.status !== 'approved',
        };
    },

    /** Fill / correct an M form (km, nama user, tujuan, keterangan); submit=true sends it for approval. */
    async save(user, id, body = {}) {
        const a = await actorOf(user);
        if (!canFill(a)) throw httpError(403, 'Anda tidak memiliki hak mengisi form bulanan.');
        const row = await loadRow(user, id);
        const { b, c, u, o } = row;
        if (row.billed) throw httpError(409, `${b.orderNumber} sudah dibuat invoice — batalkan invoicenya dulu di Dokumen untuk mengubah.`);
        if (b.status === 'approved') throw httpError(409, `${b.orderNumber} sudah disetujui kedua pihak — tolak dulu bila perlu dikoreksi.`);
        if (!o || !u) throw httpError(404, 'Baris order / unit kode ini tidak ditemukan.');
        // KM per segment (unit / replacement). Filling KM is optional (owner 2026-11-13: Dokumen
        // doesn't need it); older clients may still send a single kmStart / kmEnd.
        const layout = await formSegments(row);
        const given = Array.isArray(body.segments) ? new Map(body.segments.map((x) => [String(x.key), x]))
            : (body.kmStart !== undefined || body.kmEnd !== undefined) && layout.length ? new Map([[layout[0].key, { kmStart: body.kmStart, kmEnd: body.kmEnd }]]) : null;
        const segments = layout.map((sg) => {
            const g = given?.get(sg.key);
            const ks = g ? nOrNull(g.kmStart) : sg.kmStart, ke = g ? nOrNull(g.kmEnd) : sg.kmEnd;
            if ((ks != null && ks < 0) || (ke != null && ke < 0)) throw httpError(400, 'KM tidak boleh negatif.');
            if (ks != null && ke != null && ke < ks) throw httpError(400, `KM akhir harus ≥ KM awal (${sg.label}, ${sg.from} – ${sg.to}).`);
            return { key: sg.key, role: sg.role, carId: sg.carId, from: sg.from, to: sg.to, kmStart: ks, kmEnd: ke };
        });
        const unitSegs = segments.filter((x) => x.role === 'unit');
        const kmStart = unitSegs[0]?.kmStart ?? null, kmEnd = unitSegs[unitSegs.length - 1]?.kmEnd ?? null;
        const kmUsed = K.segmentsKmUsed(segments);
        const submit = body.submit === true || body.submit === 'true';
        const cycle = K.contractCycles(c.startDate, c.endDate).find((x) => x.index === b.monthIndex);
        if (!cycle) throw httpError(400, 'Bulan kontrak kode ini tidak ditemukan.');
        // Nominal = biaya bulanan + kelebihan km (km used = sum of the filled segments).
        const l = await lineFor(c, u, cycle, kmUsed);
        if (!l) throw httpError(400, 'Unit tidak aktif di bulan kontrak ini.');
        const picName = body.picName !== undefined ? txt(body.picName, 120) : b.picName;
        const destination = body.destination !== undefined ? txt(body.destination, 200) : b.destination;
        const note = body.note !== undefined ? txt(body.note, 1000) : b.note;
        const patch = {
            kmStart, kmEnd, kmSegments: segments, picName, destination, note, amount: String(l.total), detail: { ...l, kmStart, kmEnd }, period: cycle.period,
            updatedBy: user.id, updatedAt: new Date(),
        };
        let status = b.status || 'open';
        if (submit && ['open', 'rejected'].includes(status)) Object.assign(patch, { status: 'submitted', submittedAt: new Date(), submittedBy: user.id, rejectReason: null });
        if (status === 'rejected' && !submit) patch.rejectReason = b.rejectReason;
        status = patch.status || status;
        // Changed after submitting → approvals start over; the editor's side counts as approved.
        if (status === 'submitted') {
            Object.assign(patch, CLEAR);
            const side = editorSide(a);
            if (side === 'agency') Object.assign(patch, { agencyApprovedAt: new Date(), agencyApprovedBy: user.id });
            if (side === 'client') Object.assign(patch, { clientApprovedAt: new Date(), clientApprovedBy: user.id });
        }
        const [client] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, c.clientOrgId)).limit(1);
        await db.transaction(async (tx) => {
            await tx.update(orders).set({
                totalPrice: String(l.total), notes: noteOf(c, l, cycle.index), totalDays: l.days,
                dailyRate: String(Math.round(l.fee / Math.max(1, l.days))),
                pickupDate: new Date(`${l.from}T00:00:00+07:00`), returnDate: new Date(`${l.to}T23:59:00+07:00`),
                // Nama User / Tujuan go to the invoice line.
                customerName: picName || client?.name || o.customerName, destination,
                updatedAt: new Date(),
            }).where(eq(orders.id, o.id));
            await tx.update(leaseUnitBillings).set(patch).where(eq(leaseUnitBillings.id, b.id));
        });
        if (submit && patch.status === 'submitted') {
            // Approvers of both sides see it in their feed (and in "Perlu tindakan").
            await notificationService.notify({
                targets: [{ orgId: c.clientOrgId, perm: 'opsrecap.approve' }, { orgId: c.agencyOrgId, perm: 'opsrecap.verify' }],
                kind: 'monthly_submitted', title: `Form bulanan ${b.orderNumber} menunggu persetujuan`,
                body: `${c.contractNumber} · bulan ke-${b.monthIndex} (${l.from} s/d ${l.to}) · Nominal Rp${Number(l.total).toLocaleString('id-ID')}`,
                link: '/admin/contracts?tab=form&sub=kontrak', ref: b.orderNumber, createdBy: user.id,
            });
        }
        return { ok: true, status: patch.status || b.status, total: l.total, kmUsed: l.kmUsed, excessCharge: l.excessCharge };
    },

    /** Both sides approve (agency opsrecap.verify, client opsrecap.approve). KM mismatch blocks. */
    async approve(user, ids, asSide = null) {
        const a = await actorOf(user);
        const side = sideOf(a, asSide);
        let approved = 0, full = 0;
        const blocked = [];
        for (const id of ids) {
            const row = await loadRow(user, id);
            const { b } = row;
            if (row.billed || b.status !== 'submitted') continue;
            const check = await checkOf(row);
            if (check.issues.length) { blocked.push(`${b.orderNumber}: ${check.issues.join(' ')}`); continue; }
            await refreshAmount(row, K.segmentsKmUsed(check.segments));   // older rows: pro-rated amount → full monthly fee
            const agencyOk = side === 'agency' || !!b.agencyApprovedAt, clientOk = side === 'client' || !!b.clientApprovedAt;
            const patch = { updatedAt: new Date() };
            if (side === 'agency' && !b.agencyApprovedAt) Object.assign(patch, { agencyApprovedAt: new Date(), agencyApprovedBy: user.id });
            if (side === 'client' && !b.clientApprovedAt) Object.assign(patch, { clientApprovedAt: new Date(), clientApprovedBy: user.id });
            if (agencyOk && clientOk) patch.status = 'approved';
            await db.update(leaseUnitBillings).set(patch).where(eq(leaseUnitBillings.id, b.id));
            approved++;
            if (patch.status === 'approved') {
                full++;
                await notificationService.notify({ targets: { orgId: row.c.agencyOrgId, perm: 'documents.edit' }, kind: 'monthly_approved',
                    title: `${b.orderNumber} disetujui kedua pihak — siap dibuat invoice`, link: `/admin/documents?code=${encodeURIComponent(b.orderNumber)}`, ref: b.orderNumber, createdBy: user.id });
                // KM of every segment → odometer log of that car (unit or replacement).
                for (const sg of check.segments) {
                    if (!sg.carId) continue;
                    if (sg.kmStart != null) await recordOdometer(sg.carId, sg.kmStart, { source: 'contract', userId: user.id, when: new Date(`${sg.from}T00:05:00+07:00`) }).catch(() => {});
                    if (sg.kmEnd != null) await recordOdometer(sg.carId, sg.kmEnd, { source: 'contract', userId: user.id, when: new Date(`${sg.to}T23:55:00+07:00`) }).catch(() => {});
                }
            }
        }
        if (blocked.length && !approved) throw httpError(409, `Tidak bisa disetujui — KM tidak sesuai form operasional. ${blocked.join(' | ')}`);
        return { approved, fullyApproved: full, side, blocked };
    },

    /** Reject (either side) with a reason — back to the filler. Approved-but-not-invoiced may be reopened this way. */
    async reject(user, ids, reason, asSide = null) {
        const a = await actorOf(user);
        sideOf(a, asSide);
        const why = String(reason || '').trim().slice(0, 300);
        if (!why) throw httpError(400, 'Tulis alasan penolakan.');
        let n = 0;
        for (const id of ids) {
            const row = await loadRow(user, id);
            if (row.billed || !['submitted', 'approved'].includes(row.b.status)) continue;
            await db.update(leaseUnitBillings).set({ status: 'rejected', rejectReason: why, updatedBy: user.id, updatedAt: new Date(), ...CLEAR }).where(eq(leaseUnitBillings.id, row.b.id));
            n++;
            await notificationService.notify({
                targets: [{ orgId: row.c.agencyOrgId, perm: 'opsrecap.edit' }, ...(row.b.submittedBy && row.b.submittedBy !== user.id ? [{ userId: row.b.submittedBy }] : [])],
                kind: 'monthly_rejected', severity: 'warning', title: `Form bulanan ${row.b.orderNumber} ditolak`, body: `Alasan: ${why}`,
                link: '/admin/contracts?tab=form&sub=kontrak', ref: row.b.orderNumber, createdBy: user.id,
            });
        }
        return { rejected: n };
    },

    async addComment(user, id, text) {
        const a = await actorOf(user);
        const row = await loadRow(user, id);
        const t = String(text || '').trim().slice(0, 1000);
        if (!t) throw httpError(400, 'Tulis catatan dulu.');
        const list = Array.isArray(row.b.comments) ? row.b.comments : [];
        const item = { at: new Date().toISOString(), by: user.name || user.email || 'Pengguna', side: a.kind === 'client' ? 'client' : 'agency', text: t };
        await db.update(leaseUnitBillings).set({ comments: [...list, item].slice(-100), updatedAt: new Date() }).where(eq(leaseUnitBillings.id, row.b.id));
        return { comments: [...list, item] };
    },

    async addEvidence(user, id, files) {
        const a = await actorOf(user);
        const row = await loadRow(user, id).catch((e) => { for (const f of files) removePrivateRef(f.ref, 'ops'); throw e; });
        const locked = row.billed || row.b.status === 'approved' || !canFill(a);
        const next = [...(row.b.evidence || []), ...files.map((f) => ({ ref: f.ref, name: String(f.name || 'bukti').slice(0, 120), type: f.type || null, at: new Date().toISOString() }))];
        if (locked || next.length > 10) {
            for (const f of files) removePrivateRef(f.ref, 'ops');
            throw httpError(locked ? 409 : 400, locked ? 'Form ini sudah dikunci.' : 'Maksimal 10 bukti per form.');
        }
        await db.update(leaseUnitBillings).set({ evidence: next, updatedAt: new Date() }).where(eq(leaseUnitBillings.id, row.b.id));
        return { count: next.length };
    },

    async removeEvidence(user, id, idx) {
        const a = await actorOf(user);
        const row = await loadRow(user, id);
        if (row.billed || row.b.status === 'approved' || !canFill(a)) throw httpError(409, 'Form ini sudah dikunci.');
        const list = [...(row.b.evidence || [])];
        const [gone] = list.splice(Number(idx), 1);
        if (!gone) throw httpError(404, 'Bukti tidak ditemukan.');
        await db.update(leaseUnitBillings).set({ evidence: list, updatedAt: new Date() }).where(eq(leaseUnitBillings.id, row.b.id));
        removePrivateRef(gone.ref, 'ops');
        return { count: list.length };
    },

    async evidence(user, id, idx) {
        const row = await loadRow(user, id);
        const f = (row.b.evidence || [])[Number(idx)];
        if (!f) throw httpError(404, 'Bukti tidak ditemukan.');
        return f;
    },

    /** Older "Hitung ulang" (Penagihan tab): same as saving the km, agency only. */
    async recalc(user, billingId, { km } = {}) {
        if (isClient(user)) throw httpError(403, 'Hanya agency.');
        const row = await loadRow(user, billingId);
        if (km === undefined || km === null || km === '') return this.save(user, billingId, {});
        if (row.b.kmStart == null) throw httpError(400, 'Isi KM awal dan KM akhir di Form → Kontrak.');
        return this.save(user, billingId, { kmEnd: row.b.kmStart + Math.max(0, Number(km)) });
    },

    /** Server guard for invoicing: M rows must be approved by both sides. → list of problems */
    async invoiceBlockers(orderIds) {
        const ids = [...new Set((orderIds || []).map(Number).filter(Boolean))];
        if (!ids.length) return [];
        const rows = await db.select({ code: leaseUnitBillings.orderNumber, status: leaseUnitBillings.status })
            .from(leaseUnitBillings).where(inArray(leaseUnitBillings.orderId, ids));
        return rows.filter((r) => r.status !== 'approved').map((r) => `${r.code} belum disetujui kedua pihak (form bulanan)`);
    },
};
