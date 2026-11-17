// ─── Maintenance schedule · replacement units · emergencies (owner 2026-11-13)
// One place for "this unit is (going) off the road":
//   • Armada → per unit: planned maintenance (start → end). Jadwal, contracts,
//     the dashboard and the daily reminders all read the same rows.
//   • Contract units whose car is in maintenance / an off-road emergency need a
//     replacement car (lease_unit_replacements, per date range). Forms filled
//     for that unit inside the range are recorded on the replacement car.
//   • Emergency report (admin or the unit's driver) → agency + the contract's
//     client are notified at once (feed + e-mail + Telegram), audit trail.
// Rules: fleet-events-core.js (pure, tested).
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import {
    cars, drivers, maintenance, leaseContracts, leaseContractUnits, leaseUnitReplacements, unitIncidents, orders, user as userTable,
} from '../db/schema.js';
import { and, eq, inArray, desc, asc, sql, or, lte, gte, ne } from 'drizzle-orm';
import * as E from './fleet-events-core.js';
import { getAccess, hasPerm } from './access.service.js';
import { accountTypeOf } from './access-core.js';
import { notificationService } from './notifications.service.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const carLabel = (c) => [c?.brand, c?.name].filter(Boolean).join(' ') + (c?.licensePlate ? ` (${c.licensePlate})` : '');
const KIND_LABEL = { breakdown: 'Mogok / rusak', accident: 'Kecelakaan', tire: 'Ban', other: 'Lainnya' };

async function actorOf(user) {
    const access = await getAccess(user.id);
    const has = (p) => user.role === 'superadmin' || hasPerm(access, p);
    if (user.role === 'superadmin') return { kind: 'super', has, user };
    if (accountTypeOf(user) === 'client' || access?.accountType === 'client') return { kind: 'client', has, user, orgId: user.organizationId };
    if (has('driverapp.use') && !has('fleet.view')) {
        const [d] = await db.select().from(drivers).where(eq(drivers.userId, user.id)).limit(1);
        if (!d) throw httpError(403, 'Akun ini belum terhubung ke data driver.');
        return { kind: 'driver', has, user, driver: d, orgId: d.organizationId };
    }
    return { kind: 'agency', has, user, orgId: user.organizationId };
}

async function ownCar(a, carId) {
    const [c] = await db.select().from(cars).where(eq(cars.id, Number(carId))).limit(1);
    if (!c) throw httpError(404, 'Unit tidak ditemukan.');
    if (a.kind === 'super') return c;
    if (a.kind === 'agency' && c.organizationId === a.orgId) return c;
    if (a.kind === 'driver') {
        const mine = await db.select({ id: leaseContractUnits.id }).from(leaseContractUnits)
            .where(and(eq(leaseContractUnits.carId, c.id), eq(leaseContractUnits.driverId, a.driver.id))).limit(1);
        const today = todayWib();
        const trip = mine.length ? [] : await db.select({ id: orders.id }).from(orders).where(and(eq(orders.carId, c.id), eq(orders.driverId, a.driver.id),
            lte(orders.pickupDate, new Date(`${today}T23:59:59+07:00`)), gte(orders.returnDate, new Date(`${today}T00:00:00+07:00`)))).limit(1);
        if (mine.length || trip.length) return c;
    }
    throw httpError(404, 'Unit tidak ditemukan.');
}

/** Active contract unit (today) for a car → { unit, contract } or null. */
async function contractOfCar(carId, dayIso = todayWib()) {
    const rows = await db.select({ u: leaseContractUnits, c: leaseContracts }).from(leaseContractUnits)
        .innerJoin(leaseContracts, eq(leaseContracts.id, leaseContractUnits.contractId))
        .where(and(eq(leaseContractUnits.carId, Number(carId)), eq(leaseContracts.status, 'active'),
            lte(leaseContracts.startDate, dayIso), gte(leaseContracts.endDate, dayIso)));
    const r = rows.find((x) => (!x.u.startDate || x.u.startDate <= dayIso) && (!x.u.endDate || x.u.endDate >= dayIso));
    return r ? { unit: r.u, contract: r.c } : null;
}

/** Notify agency fleet + (when the car is on a contract) the client. */
async function notifyStakeholders({ car, contract, kind, severity, title, body, link, ref, userId, email = true, telegram = true }) {
    const targets = [{ orgId: car.organizationId, perm: 'fleet.view' }];
    if (contract) {
        targets.push({ orgId: contract.agencyOrgId, perm: 'contracts.view' });
        targets.push({ orgId: contract.clientOrgId, perm: 'admin' }, { orgId: contract.clientOrgId, perm: 'opsrecap.approve' });
    }
    const seen = new Set();
    await notificationService.notify({
        targets: targets.filter((t) => t.orgId && !seen.has(`${t.orgId}|${t.perm}`) && seen.add(`${t.orgId}|${t.perm}`)),
        kind, severity, title, body, link, ref, createdBy: userId, email, telegram,
    });
}

export const fleetAlertsService = {
    // ─── Armada → one unit: schedule + incidents + replacements ─────────
    async unitEvents(user, carId) {
        const a = await actorOf(user);
        const c = await ownCar(a, carId);
        const since = new Date(Date.now() - 120 * 86400000);
        const maint = await db.select().from(maintenance).where(and(eq(maintenance.carId, c.id), or(ne(maintenance.status, 'completed'), gte(maintenance.scheduledDate, since))))
            .orderBy(desc(maintenance.scheduledDate)).limit(50);
        const incidents = await db.select().from(unitIncidents).where(eq(unitIncidents.carId, c.id)).orderBy(desc(unitIncidents.reportedAt)).limit(30);
        const reps = await db.select().from(leaseUnitReplacements).where(or(eq(leaseUnitReplacements.originalCarId, c.id), eq(leaseUnitReplacements.replacementCarId, c.id)))
            .orderBy(desc(leaseUnitReplacements.startDate)).limit(30);
        const ctr = await contractOfCar(c.id);
        return {
            car: { id: c.id, label: carLabel(c), status: c.status },
            contract: ctr ? { id: ctr.contract.id, number: ctr.contract.contractNumber, unitId: ctr.unit.id } : null,
            maintenance: maint.map((m) => ({ ...m, ...E.maintenanceRange(m) })),
            incidents, replacements: reps,
        };
    },

    /** Plan maintenance for a unit (start → end). Linked features read it automatically. */
    async addMaintenance(user, carId, body = {}) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && a.has('fleet.edit')))) throw httpError(403, 'Hanya agency (armada) yang mengatur jadwal perawatan.');
        const c = await ownCar(a, carId);
        const from = String(body.startDate || '').slice(0, 10), to = body.endDate ? String(body.endDate).slice(0, 10) : from;
        if (!ISO.test(from)) throw httpError(400, 'Tanggal mulai wajib diisi.');
        if (!ISO.test(to) || to < from) throw httpError(400, 'Tanggal selesai harus ≥ tanggal mulai.');
        const type = ['routine', 'repair', 'inspection'].includes(body.type) ? body.type : 'routine';
        const [m] = await db.insert(maintenance).values({
            carId: c.id, type, description: txt(body.description, 1000) || (type === 'routine' ? 'Servis berkala' : null),
            scheduledDate: new Date(`${from}T08:00:00+07:00`), endDate: new Date(`${to}T17:00:00+07:00`),
            notes: txt(body.notes, 1000), status: 'scheduled', organizationId: c.organizationId, createdBy: user.id, isDemo: !!user.isDemo,
        }).returning();
        // Contract unit affected → agency must arrange a replacement; client informed.
        const ctr = await contractOfCar(c.id, from) || await contractOfCar(c.id);
        await notifyStakeholders({
            car: c, contract: ctr?.contract, kind: 'maintenance_planned', severity: ctr ? 'warning' : 'info',
            title: `Perawatan ${carLabel(c)}: ${from}${to !== from ? ` s/d ${to}` : ''}`,
            body: `${m.description || 'Perawatan'}${ctr ? ` — unit kontrak ${ctr.contract.contractNumber}; unit pengganti perlu disiapkan.` : ''}`,
            link: ctr ? `/admin/contracts?tab=contracts&contract=${ctr.contract.id}` : '/admin/fleet', ref: `MNT-${m.id}`, userId: user.id, email: !!ctr, telegram: false,
        });
        return { ok: true, id: m.id, contract: ctr ? ctr.contract.contractNumber : null };
    },

    async updateMaintenance(user, id, body = {}) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && a.has('fleet.edit')))) throw httpError(403, 'Hanya agency (armada).');
        const [m] = await db.select().from(maintenance).where(eq(maintenance.id, Number(id))).limit(1);
        if (!m) throw httpError(404, 'Jadwal tidak ditemukan.');
        const c = await ownCar(a, m.carId);
        const patch = {};
        if (body.startDate !== undefined) { if (!ISO.test(body.startDate)) throw httpError(400, 'Tanggal mulai tidak valid.'); patch.scheduledDate = new Date(`${body.startDate}T08:00:00+07:00`); }
        if (body.endDate !== undefined) patch.endDate = body.endDate ? new Date(`${String(body.endDate).slice(0, 10)}T17:00:00+07:00`) : null;
        if (body.description !== undefined) patch.description = txt(body.description, 1000);
        if (['scheduled', 'in_progress', 'completed'].includes(body.status)) {
            patch.status = body.status;
            if (body.status === 'completed') patch.completedDate = new Date();
        }
        const [saved] = await db.update(maintenance).set(patch).where(eq(maintenance.id, m.id)).returning();
        if (patch.status === 'in_progress') await db.update(cars).set({ status: 'maintenance', updatedAt: new Date() }).where(eq(cars.id, c.id));
        if (patch.status === 'completed') {
            const [open] = await db.select({ id: unitIncidents.id }).from(unitIncidents).where(and(eq(unitIncidents.carId, c.id), eq(unitIncidents.status, 'open'), eq(unitIncidents.offRoad, true))).limit(1);
            if (!open) await db.update(cars).set({ status: 'available', updatedAt: new Date() }).where(eq(cars.id, c.id));
        }
        return { ok: true, maintenance: saved };
    },

    async removeMaintenance(user, id) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && a.has('fleet.edit')))) throw httpError(403, 'Hanya agency (armada).');
        const [m] = await db.select().from(maintenance).where(eq(maintenance.id, Number(id))).limit(1);
        if (!m) throw httpError(404, 'Jadwal tidak ditemukan.');
        await ownCar(a, m.carId);
        if (m.status !== 'scheduled') throw httpError(409, 'Hanya jadwal yang belum berjalan yang bisa dihapus.');
        await db.delete(maintenance).where(eq(maintenance.id, m.id));
        return { ok: true };
    },

    // ─── Emergency / problem report ─────────────────────────────────────
    async reportIncident(user, body = {}) {
        const a = await actorOf(user);
        if (a.kind === 'client') throw httpError(403, 'Laporan darurat dibuat oleh agency atau driver unit.');
        if (a.kind === 'agency' && !(a.has('fleet.edit') || a.has('fleet.view') || a.has('opsrecap.create'))) throw httpError(403, 'Tidak ada hak melapor.');
        const c = await ownCar(a, body.carId);
        const description = txt(body.description, 2000);
        if (!description) throw httpError(400, 'Ceritakan kejadiannya.');
        const kind = E.INCIDENT_KINDS.includes(body.kind) ? body.kind : 'other';
        const offRoad = body.offRoad === true || body.offRoad === 'true';
        const ctr = await contractOfCar(c.id);
        const [i] = await db.insert(unitIncidents).values({
            carId: c.id, organizationId: c.organizationId, contractId: ctr?.contract.id || null, contractUnitId: ctr?.unit.id || null,
            kind, severity: offRoad || kind === 'accident' ? 'urgent' : 'warning', description, location: txt(body.location, 200), offRoad,
            reportedBy: user.id,
        }).returning();
        if (offRoad) await db.update(cars).set({ status: 'maintenance', updatedAt: new Date() }).where(eq(cars.id, c.id));
        const who = a.kind === 'driver' ? `driver ${a.driver.name}` : (user.name || 'admin');
        await notifyStakeholders({
            car: c, contract: ctr?.contract, kind: 'emergency', severity: i.severity,
            title: `${i.severity === 'urgent' ? 'DARURAT' : 'Kendala'}: ${carLabel(c)} — ${KIND_LABEL[kind]}`,
            body: `${description}${i.location ? ` · Lokasi: ${i.location}` : ''}${offRoad ? ' · Unit tidak bisa jalan' : ''} · Dilaporkan oleh ${who}${ctr ? ` · Kontrak ${ctr.contract.contractNumber}` : ''}`,
            link: '/admin/fleet', ref: `INC-${i.id}`, userId: user.id, email: true, telegram: true,
        });
        return { ok: true, id: i.id, contract: ctr?.contract.contractNumber || null };
    },

    async resolveIncident(user, id, { resolution } = {}) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && a.has('fleet.edit')))) throw httpError(403, 'Hanya agency (armada).');
        const [i] = await db.select().from(unitIncidents).where(eq(unitIncidents.id, Number(id))).limit(1);
        if (!i) throw httpError(404, 'Laporan tidak ditemukan.');
        const c = await ownCar(a, i.carId);
        if (i.status !== 'open') throw httpError(409, 'Laporan sudah selesai.');
        await db.update(unitIncidents).set({ status: 'resolved', resolution: txt(resolution, 1000), resolvedBy: user.id, resolvedAt: new Date() }).where(eq(unitIncidents.id, i.id));
        if (i.offRoad) {
            const [busy] = await db.select({ id: maintenance.id }).from(maintenance).where(and(eq(maintenance.carId, c.id), eq(maintenance.status, 'in_progress'))).limit(1);
            if (!busy) await db.update(cars).set({ status: 'available', updatedAt: new Date() }).where(eq(cars.id, c.id));
        }
        const [ctr] = i.contractId ? await db.select().from(leaseContracts).where(eq(leaseContracts.id, i.contractId)).limit(1) : [];
        await notifyStakeholders({
            car: c, contract: ctr, kind: 'emergency_resolved', severity: 'info', title: `Selesai: ${carLabel(c)} — ${KIND_LABEL[i.kind] || i.kind}`,
            body: txt(resolution, 500) || 'Laporan ditutup.', link: '/admin/fleet', ref: `INC-${i.id}`, userId: user.id, email: false, telegram: true,
        });
        return { ok: true };
    },

    async incidents(user, { status = 'open' } = {}) {
        const a = await actorOf(user);
        const conds = [];
        if (status) conds.push(eq(unitIncidents.status, status));
        if (a.kind === 'agency') conds.push(eq(unitIncidents.organizationId, a.orgId || -1));
        if (a.kind === 'client') {
            const ids = (await db.select({ id: leaseContracts.id }).from(leaseContracts).where(eq(leaseContracts.clientOrgId, a.orgId || -1))).map((x) => x.id);
            conds.push(ids.length ? inArray(unitIncidents.contractId, ids) : sql`false`);
        }
        if (a.kind === 'driver') conds.push(eq(unitIncidents.reportedBy, user.id));
        const rows = await db.select({ i: unitIncidents, car: cars, reporter: userTable.name }).from(unitIncidents)
            .leftJoin(cars, eq(cars.id, unitIncidents.carId)).leftJoin(userTable, eq(userTable.id, unitIncidents.reportedBy))
            .where(conds.length ? and(...conds) : undefined).orderBy(desc(unitIncidents.reportedAt)).limit(200);
        return { data: rows.map((r) => ({ ...r.i, carLabel: carLabel(r.car), reporterName: r.reporter || null })) };
    },

    // ─── Replacement units (per contract unit, per date range) ──────────
    async replacements(user, contractId) {
        const [c] = await db.select().from(leaseContracts).where(eq(leaseContracts.id, Number(contractId))).limit(1);
        if (!c) throw httpError(404, 'Kontrak tidak ditemukan.');
        const a = await actorOf(user);
        if (a.kind === 'agency' && c.agencyOrgId !== a.orgId) throw httpError(404, 'Kontrak tidak ditemukan.');
        if (a.kind === 'client' && c.clientOrgId !== a.orgId) throw httpError(404, 'Kontrak tidak ditemukan.');
        if (a.kind === 'driver') throw httpError(403, 'Tidak ada akses.');
        const reps = await db.select({ r: leaseUnitReplacements, car: cars }).from(leaseUnitReplacements)
            .leftJoin(cars, eq(cars.id, leaseUnitReplacements.replacementCarId))
            .where(eq(leaseUnitReplacements.contractId, c.id)).orderBy(desc(leaseUnitReplacements.startDate));
        const units = await db.select({ u: leaseContractUnits, car: cars }).from(leaseContractUnits).leftJoin(cars, eq(cars.id, leaseContractUnits.carId))
            .where(eq(leaseContractUnits.contractId, c.id)).orderBy(asc(leaseContractUnits.id));
        const carIds = units.map((x) => x.u.carId).filter(Boolean);
        const maint = carIds.length ? await db.select().from(maintenance).where(and(inArray(maintenance.carId, carIds), inArray(maintenance.status, ['scheduled', 'in_progress']))) : [];
        const inc = carIds.length ? await db.select().from(unitIncidents).where(and(inArray(unitIncidents.carId, carIds), eq(unitIncidents.status, 'open'))) : [];
        const need = E.unitsNeedingReplacement({
            units: units.map((x) => ({ ...x.u, contractStart: c.startDate, contractEnd: c.endDate })), maintenances: maint, incidents: inc,
            replacements: reps.map((x) => x.r), todayIso: todayWib(), horizonDays: 14,
        });
        return {
            units: units.map((x) => ({ id: x.u.id, carId: x.u.carId, label: carLabel(x.car) })),
            data: reps.map((x) => ({ ...x.r, replacementLabel: carLabel(x.car), unitLabel: carLabel(units.find((y) => y.u.id === x.r.contractUnitId)?.car) })),
            needed: need.map((n) => ({ unitId: n.unit.id, unitLabel: carLabel(units.find((y) => y.u.id === n.unit.id)?.car), reason: n.reason, from: n.from, to: n.to, refId: n.refId })),
            maintenance: maint.map((m) => ({ id: m.id, carId: m.carId, status: m.status, description: m.description, ...E.maintenanceRange(m) })),
            incidents: inc.map((i) => ({ id: i.id, carId: i.carId, kind: i.kind, offRoad: i.offRoad, description: i.description, reportedAt: i.reportedAt })),
        };
    },

    async addReplacement(user, contractId, body = {}) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && (a.has('contracts.edit') || a.has('fleet.edit'))))) throw httpError(403, 'Hanya agency yang mengatur unit pengganti.');
        const [c] = await db.select().from(leaseContracts).where(eq(leaseContracts.id, Number(contractId))).limit(1);
        if (!c || (a.kind === 'agency' && c.agencyOrgId !== a.orgId)) throw httpError(404, 'Kontrak tidak ditemukan.');
        const [unit] = await db.select().from(leaseContractUnits).where(and(eq(leaseContractUnits.id, Number(body.contractUnitId)), eq(leaseContractUnits.contractId, c.id))).limit(1);
        const startDate = String(body.startDate || '').slice(0, 10), endDate = body.endDate ? String(body.endDate).slice(0, 10) : null;
        const [rc] = body.replacementCarId ? await db.select().from(cars).where(eq(cars.id, Number(body.replacementCarId))).limit(1) : [];
        if (rc && a.kind === 'agency' && rc.organizationId !== a.orgId) throw httpError(404, 'Mobil pengganti tidak ditemukan.');
        // Busy: other contract units, other replacements, maintenance of the replacement car.
        const busy = [];
        if (rc) {
            const asUnit = await db.select({ u: leaseContractUnits, c: leaseContracts }).from(leaseContractUnits).innerJoin(leaseContracts, eq(leaseContracts.id, leaseContractUnits.contractId))
                .where(and(eq(leaseContractUnits.carId, rc.id), eq(leaseContracts.status, 'active')));
            for (const x of asUnit) busy.push({ label: `kontrak ${x.c.contractNumber}`, from: [x.u.startDate, x.c.startDate].filter(Boolean).sort().pop(), to: [x.u.endDate, x.c.endDate].filter(Boolean).sort()[0] });
            const asRep = await db.select().from(leaseUnitReplacements).where(and(eq(leaseUnitReplacements.replacementCarId, rc.id), eq(leaseUnitReplacements.status, 'active')));
            for (const x of asRep) busy.push({ label: 'pengganti unit lain', from: x.startDate, to: x.endDate });
            const m = await db.select().from(maintenance).where(and(eq(maintenance.carId, rc.id), inArray(maintenance.status, ['scheduled', 'in_progress'])));
            for (const x of m) busy.push({ label: 'perawatan', ...E.maintenanceRange(x) });
        }
        const problems = E.replacementBlockers({ unit, replacementCarId: rc?.id, startDate, endDate, busy });
        if (problems.length) throw httpError(400, problems.join(' '));
        const [r] = await db.insert(leaseUnitReplacements).values({
            contractId: c.id, contractUnitId: unit.id, originalCarId: unit.carId, replacementCarId: rc.id, startDate, endDate,
            reason: E.REPLACEMENT_REASONS.includes(body.reason) ? body.reason : 'maintenance', note: txt(body.note, 300),
            maintenanceId: Number(body.maintenanceId) || null, incidentId: Number(body.incidentId) || null, createdBy: user.id,
        }).returning();
        const [orig] = unit.carId ? await db.select().from(cars).where(eq(cars.id, unit.carId)).limit(1) : [];
        await notificationService.notify({
            targets: [{ orgId: c.clientOrgId, perm: 'admin' }, { orgId: c.clientOrgId, perm: 'opsrecap.approve' }, { orgId: c.agencyOrgId, perm: 'contracts.view' }],
            kind: 'replacement', severity: 'info', title: `Unit pengganti ${c.contractNumber}: ${carLabel(rc)}`,
            body: `Menggantikan ${carLabel(orig)} mulai ${startDate}${endDate ? ` s/d ${endDate}` : ''}.${r.note ? ` ${r.note}` : ''}`,
            link: `/admin/contracts?tab=contracts&contract=${c.id}`, ref: c.contractNumber, createdBy: user.id, email: true,
        });
        return { ok: true, id: r.id };
    },

    async endReplacement(user, id, { endDate } = {}) {
        const a = await actorOf(user);
        if (!(a.kind === 'super' || (a.kind === 'agency' && (a.has('contracts.edit') || a.has('fleet.edit'))))) throw httpError(403, 'Hanya agency.');
        const [r] = await db.select({ r: leaseUnitReplacements, c: leaseContracts }).from(leaseUnitReplacements)
            .innerJoin(leaseContracts, eq(leaseContracts.id, leaseUnitReplacements.contractId)).where(eq(leaseUnitReplacements.id, Number(id))).limit(1);
        if (!r || (a.kind === 'agency' && r.c.agencyOrgId !== a.orgId)) throw httpError(404, 'Data tidak ditemukan.');
        const end = ISO.test(endDate || '') ? endDate : todayWib();
        if (end < r.r.startDate) throw httpError(400, 'Tanggal selesai harus ≥ tanggal mulai.');
        await db.update(leaseUnitReplacements).set({ status: 'ended', endDate: end, endedAt: new Date(), endedBy: user.id }).where(eq(leaseUnitReplacements.id, r.r.id));
        return { ok: true };
    },

    /** Car to record a contract form on: the replacement on that day, else the unit's car. */
    async carForUnitOn(contractUnitId, dayIso, fallbackCarId) {
        const reps = await db.select().from(leaseUnitReplacements).where(and(eq(leaseUnitReplacements.contractUnitId, Number(contractUnitId)), eq(leaseUnitReplacements.status, 'active')));
        return E.replacementOn(reps, contractUnitId, dayIso)?.replacementCarId || fallbackCarId;
    },

    // ─── Dashboard counters (action-items.service) ──────────────────────
    async actionItems(user, { client, sa }) {
        const items = [];
        const today = todayWib();
        const org = user.organizationId || -1;
        if (client) {
            const ids = (await db.select({ id: leaseContracts.id }).from(leaseContracts).where(and(eq(leaseContracts.clientOrgId, org), eq(leaseContracts.status, 'active')))).map((x) => x.id);
            if (!ids.length) return items;
            const [inc] = await db.select({ c: sql`count(*)::int` }).from(unitIncidents).where(and(inArray(unitIncidents.contractId, ids), eq(unitIncidents.status, 'open')));
            if (inc?.c) items.push({ key: 'incidents_open', count: inc.c, title: 'Unit kontrak Anda sedang ada kendala / darurat', link: '/admin/contracts?tab=contracts', severity: 'urgent' });
            const [rep] = await db.select({ c: sql`count(*)::int` }).from(leaseUnitReplacements).where(and(inArray(leaseUnitReplacements.contractId, ids), eq(leaseUnitReplacements.status, 'active'),
                lte(leaseUnitReplacements.startDate, today), or(sql`${leaseUnitReplacements.endDate} IS NULL`, gte(leaseUnitReplacements.endDate, today))));
            if (rep?.c) items.push({ key: 'replacements_active', count: rep.c, title: 'Unit pengganti sedang dipakai di kontrak Anda', link: '/admin/contracts?tab=contracts', severity: 'info' });
            return items;
        }
        const carConds = sa ? [eq(cars.isDemo, false)] : [eq(cars.organizationId, org)];
        const myCars = await db.select({ id: cars.id }).from(cars).where(and(...carConds));
        const carIds = myCars.map((x) => x.id);
        if (!carIds.length) return items;
        const soon = new Date(Date.parse(`${today}T00:00:00+07:00`) + 8 * 86400000);
        const [m] = await db.select({ c: sql`count(*)::int` }).from(maintenance).where(and(inArray(maintenance.carId, carIds),
            or(eq(maintenance.status, 'in_progress'), and(eq(maintenance.status, 'scheduled'), lte(maintenance.scheduledDate, soon)))));
        if (m?.c) items.push({ key: 'maintenance_soon', count: m.c, title: 'Perawatan berjalan / dalam 7 hari', link: '/admin/fleet', severity: 'info' });
        const [inc] = await db.select({ c: sql`count(*)::int` }).from(unitIncidents).where(and(inArray(unitIncidents.carId, carIds), eq(unitIncidents.status, 'open')));
        if (inc?.c) items.push({ key: 'incidents_open', count: inc.c, title: 'Laporan darurat / kendala belum selesai', link: '/admin/fleet', severity: 'urgent' });
        // Contract units off the road without a replacement.
        const units = await db.select({ u: leaseContractUnits, c: leaseContracts }).from(leaseContractUnits).innerJoin(leaseContracts, eq(leaseContracts.id, leaseContractUnits.contractId))
            .where(and(eq(leaseContracts.status, 'active'), inArray(leaseContractUnits.carId, carIds)));
        if (units.length) {
            const uCars = units.map((x) => x.u.carId);
            const maint = await db.select().from(maintenance).where(and(inArray(maintenance.carId, uCars), inArray(maintenance.status, ['scheduled', 'in_progress'])));
            const incs = await db.select().from(unitIncidents).where(and(inArray(unitIncidents.carId, uCars), eq(unitIncidents.status, 'open')));
            const reps = await db.select().from(leaseUnitReplacements).where(and(inArray(leaseUnitReplacements.contractUnitId, units.map((x) => x.u.id)), eq(leaseUnitReplacements.status, 'active')));
            const need = E.unitsNeedingReplacement({ units: units.map((x) => ({ ...x.u, contractStart: x.c.startDate, contractEnd: x.c.endDate })), maintenances: maint, incidents: incs, replacements: reps, todayIso: today });
            if (need.length) items.push({ key: 'replacement_needed', count: need.length, title: 'Unit kontrak perlu unit pengganti (perawatan / darurat)', link: `/admin/contracts?tab=contracts&contract=${need[0].unit.contractId}`, severity: 'warning' });
        }
        return items;
    },

    /** Daily job: maintenance starting tomorrow → feed for agency (+ client when on a contract). */
    async runDailyReminders() {
        const today = todayWib();
        const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
        const list = await db.select({ m: maintenance, car: cars }).from(maintenance).innerJoin(cars, eq(cars.id, maintenance.carId))
            .where(and(eq(maintenance.status, 'scheduled'), gte(maintenance.scheduledDate, new Date(`${tomorrow}T00:00:00+07:00`)), lte(maintenance.scheduledDate, new Date(`${tomorrow}T23:59:59+07:00`))));
        for (const { m, car } of list) {
            const r = E.maintenanceRange(m);
            const ctr = await contractOfCar(car.id, tomorrow);
            await notifyStakeholders({
                car, contract: ctr?.contract, kind: 'maintenance_tomorrow', severity: 'warning',
                title: `Besok perawatan: ${carLabel(car)} (${r.from}${r.to !== r.from ? ` s/d ${r.to}` : ''})`,
                body: `${m.description || 'Perawatan'}${ctr ? ` — unit kontrak ${ctr.contract.contractNumber}, pastikan unit pengganti siap.` : ''}`,
                link: ctr ? `/admin/contracts?tab=contracts&contract=${ctr.contract.id}` : '/admin/fleet', ref: `MNT-${m.id}`, userId: null, email: !!ctr, telegram: false,
            });
        }
        return { reminded: list.length };
    },
};

export default fleetAlertsService;
