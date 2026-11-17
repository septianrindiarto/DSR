// ─── Maintenance schedule / replacement units / emergencies — pure rules ────
// (owner 2026-11-13) No DB here; fleet-alerts.service.js loads the rows.
// Dates are 'YYYY-MM-DD' (WIB days).

export const INCIDENT_KINDS = ['breakdown', 'accident', 'tire', 'other'];
export const REPLACEMENT_REASONS = ['maintenance', 'emergency', 'other'];

const day = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Do [aFrom, aTo] and [bFrom, bTo] share a day? (open end = same day / forever when null and openEnd) */
export function overlaps(aFrom, aTo, bFrom, bTo) {
    const a1 = aFrom, a2 = aTo || '9999-12-31', b1 = bFrom, b2 = bTo || '9999-12-31';
    return !!a1 && !!b1 && a1 <= b2 && b1 <= a2;
}

/** A maintenance row as a day range (end = planned finish, else the start day). */
export function maintenanceRange(m) {
    const from = day(m.scheduledDate);
    const to = day(m.endDate) || from;
    return { from, to: to < from ? from : to };
}

/** Active replacement car of a contract unit on a day (or null). */
export function replacementOn(replacements = [], contractUnitId, dayIso) {
    const r = replacements.find((x) => x.status !== 'ended' && Number(x.contractUnitId) === Number(contractUnitId)
        && overlaps(x.startDate, x.endDate, dayIso, dayIso));
    return r || null;
}

/**
 * Contract units whose car is (or will soon be) off the road — scheduled /
 * running maintenance or an open emergency — inside the unit's contract period
 * and NOT covered by a replacement for that whole time.
 * units: [{ id, contractId, contractNumber, carId, startDate, endDate, contractStart, contractEnd }]
 * → [{ unit, reason: 'maintenance'|'emergency', from, to, refId }]
 */
export function unitsNeedingReplacement({ units = [], maintenances = [], incidents = [], replacements = [], todayIso, horizonDays = 7 } = {}) {
    const horizon = addDays(todayIso, horizonDays);
    const out = [];
    for (const u of units) {
        if (!u.carId) continue;
        const uFrom = [u.startDate, u.contractStart].filter(Boolean).sort().pop();
        const uTo = [u.endDate, u.contractEnd].filter(Boolean).sort()[0] || null;
        const covered = (from, to) => replacements.some((r) => r.status !== 'ended' && Number(r.contractUnitId) === Number(u.id)
            && r.startDate <= from && (!r.endDate || (to && r.endDate >= to)));
        for (const m of maintenances) {
            if (Number(m.carId) !== Number(u.carId) || !['scheduled', 'in_progress'].includes(m.status)) continue;
            const { from, to } = maintenanceRange(m);
            if (to < todayIso || from > horizon) continue;                  // only now / soon
            if (!overlaps(from, to, uFrom, uTo)) continue;
            if (!covered(from, to)) out.push({ unit: u, reason: 'maintenance', from, to, refId: m.id });
        }
        for (const i of incidents) {
            if (Number(i.carId) !== Number(u.carId) || i.status !== 'open' || !i.offRoad) continue;
            const from = day(i.reportedAt) || todayIso;
            if (!overlaps(from, null, uFrom, uTo)) continue;
            if (!covered(todayIso, null)) out.push({ unit: u, reason: 'emergency', from, to: null, refId: i.id });
        }
    }
    return out;
}

/** Validate a replacement request → list of problems (empty = ok). */
export function replacementBlockers({ unit, replacementCarId, startDate, endDate, busy = [] } = {}) {
    const out = [];
    if (!unit) out.push('Unit kontrak tidak ditemukan.');
    if (!replacementCarId) out.push('Pilih mobil pengganti.');
    if (unit && Number(replacementCarId) === Number(unit.carId)) out.push('Mobil pengganti sama dengan unit aslinya.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) out.push('Tanggal mulai wajib diisi.');
    if (endDate && endDate < startDate) out.push('Tanggal selesai harus ≥ tanggal mulai.');
    for (const b of busy) if (overlaps(startDate, endDate, b.from, b.to)) out.push(`Mobil pengganti sedang dipakai: ${b.label} (${b.from}${b.to ? ` – ${b.to}` : ''}).`);
    return out;
}
