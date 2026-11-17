// ─── Long-term contract rules (pure, unit-tested in test/contracts.test.js) ──
// Monthly billing per contract × period (YYYY-MM):
//   unit fee   = monthly_fee × (active days in month ÷ days in month)
//                (no pro-rata: the monthly fee covers the whole month — owner 2026-11-13)
//   excess km  = max(0, km used − km allowance) × excess_km_rate   (per unit)
//   km used    = last odometer reading ≤ period end − last reading < period start
// Renewal reminders at 60 / 30 / 7 days before the end date (once each).
// ─────────────────────────────────────────────────────────────────────────────

const r0 = (n) => Math.round(Number(n) || 0);
export const pad2 = (n) => String(n).padStart(2, '0');

export function periodRange(period) {
    const [y, m] = String(period).split('-').map(Number);
    if (!(y > 2000 && m >= 1 && m <= 12)) throw new Error('Periode harus YYYY-MM.');
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(last)}`, days: last };
}

const dayNum = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);

/** Days a unit is billable in the period (intersection of contract, unit and month). */
export function activeDays({ contractStart, contractEnd, unitStart, unitEnd, period }) {
    const { from, to } = periodRange(period);
    const start = [from, contractStart, unitStart].filter(Boolean).sort().pop();
    const end = [to, contractEnd, unitEnd].filter(Boolean).sort()[0];
    const d = dayNum(end) - dayNum(start) + 1;
    return Math.max(0, d);
}

/** Periods (YYYY-MM) covered by a contract. */
export function contractPeriods(startDate, endDate) {
    const out = [];
    let y = +startDate.slice(0, 4), m = +startDate.slice(5, 7);
    const ey = +endDate.slice(0, 4), em = +endDate.slice(5, 7);
    while (y < ey || (y === ey && m <= em)) {
        out.push(`${y}-${pad2(m)}`);
        m += 1; if (m > 12) { m = 1; y += 1; }
        if (out.length > 600) break;
    }
    return out;
}

/**
 * contract: { startDate, endDate, kmAllowanceMonth, excessKmRate }
 * units:    [{ id, carId, monthlyFee, startDate, endDate, label }]
 * kmUsed:   { [unitId]: number | null }   (null = no readings → no excess)
 */
export function billingLines({ contract, units, period, kmUsed = {} }) {
    const { days } = periodRange(period);
    const allowance = Number(contract.kmAllowanceMonth) || 0;
    const rate = Number(contract.excessKmRate) || 0;
    const lines = [];
    for (const u of units) {
        const act = activeDays({ contractStart: contract.startDate, contractEnd: contract.endDate, unitStart: u.startDate, unitEnd: u.endDate, period });
        if (!act) continue;
        // Owner 2026-11-13: the monthly fee covers the whole month, however many days are used.
        const fee = r0(Number(u.monthlyFee));
        const used = kmUsed[u.id] == null ? null : Math.max(0, Number(kmUsed[u.id]));
        const allowed = allowance;
        const excessKm = used != null && allowance && rate ? Math.max(0, used - allowed) : 0;
        const excessCharge = r0(excessKm * rate);
        lines.push({ unitId: u.id, carId: u.carId, label: u.label || null, activeDays: act, daysInMonth: days, fee, kmUsed: used, kmAllowed: allowed, excessKm, excessCharge, total: fee + excessCharge });
    }
    return { lines, total: lines.reduce((t, l) => t + l.total, 0) };
}

/** Which reminder (60/30/7 days) is due today, if any not sent yet. */
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
/** YYYY-MM-DD one day earlier. */
export const dayBefore = (iso) => isoOf(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - 86400000);
/** First day of the month after `iso`. */
export const firstOfNextMonth = (iso) => isoOf(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 1));

// ─── Billing cycles (owner 2026-11-13) ──────────────────────────────────────
// A contract is billed per CONTRACT month, not per calendar month: cycle 1
// starts on the contract start date and runs to the day before the same date
// next month (5 Nov → 4 Des); the last cycle ends on the contract end date.
// Each cycle counts as one month — full monthly fee, full km quota — even
// when it is shorter (a 5 Nov → 1 Des contract is one month). A unit that
// joins or leaves inside a cycle also pays the full monthly fee — the fee
// covers the whole month however many days are used (owner 2026-11-13).
// The invoice date of a cycle = its tanggal tagih: the first billing day on or
// after the cycle start (tagih 1, cycle from 5 Nov → 1 Des).
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m 1-12
/** iso + n months, same day-of-month (clamped: 31 Jan + 1 → 28/29 Feb). */
export function addMonthsIso(iso, n) {
    const y0 = +iso.slice(0, 4), m0 = +iso.slice(5, 7), d0 = +iso.slice(8, 10);
    const t = (m0 - 1) + n, y = y0 + Math.floor(t / 12), m = ((t % 12) + 12) % 12 + 1;
    return `${y}-${pad2(m)}-${pad2(Math.min(d0, lastDay(y, m)))}`;
}
const daysBetween = (a, b) => dayNum(b) - dayNum(a) + 1;   // inclusive

/** Contract cycles: [{ index, from, to, period }] (period = YYYY-MM of the start). */
export function contractCycles(startDate, endDate) {
    const out = [];
    for (let n = 0; n < 600; n++) {
        const from = addMonthsIso(startDate, n);
        if (from > endDate) break;
        const next = addMonthsIso(startDate, n + 1);
        const to = [dayBefore(next), endDate].sort()[0];
        out.push({ index: n + 1, from, to, period: from.slice(0, 7) });
    }
    return out;
}

/** Tanggal tagih of a cycle: first date >= cycle start whose day = billingDay. */
export function cycleInvoiceDate(from, billingDay) {
    const d = Math.min(Math.max(1, Number(billingDay) || 1), 28);
    const y = +from.slice(0, 4), m = +from.slice(5, 7), day = +from.slice(8, 10);
    if (day <= d) return `${y}-${pad2(m)}-${pad2(d)}`;
    return addMonthsIso(`${y}-${pad2(m)}-${pad2(d)}`, 1);
}

/** Cycles whose start has come (codes are made at the start of each cycle). */
export function dueCycles({ startDate, endDate, todayIso, stopFrom = null }) {
    return contractCycles(startDate, endDate).filter((c) => c.from <= todayIso && (!stopFrom || c.from < stopFrom));
}

/**
 * Cycles whose M row should exist (owner 2026-11-13): the first one as soon as
 * the contract is active; each next one on H+1 after the previous cycle's
 * tanggal tagih. Rows already made are never removed.
 */
export function openCycles({ startDate, endDate, billingDay, todayIso, stopFrom = null }) {
    const all = contractCycles(startDate, endDate).filter((c) => !stopFrom || c.from < stopFrom);
    return all.filter((c, i) => i === 0 || todayIso > cycleInvoiceDate(all[i - 1].from, billingDay));
}

const shiftDay = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * KM segments of one contract unit in one contract month (owner 2026-11-13):
 * the unit's own km counts only while IT serves the contract. While a
 * replacement runs, the replacement car's km counts; maintenance days of the
 * unit without a replacement count for nobody (workshop km is not billed).
 * replacements: [{ id, carId, from, to|null }]   maintenances: [{ from, to }]
 * → [{ key, role: 'unit'|'replacement', carId, from, to, replacementId? }] by date
 */
export function kmSegments({ from, to, carId = null, replacements = [], maintenances = [] } = {}) {
    const clip = (a, b) => {
        const f = !a || a < from ? from : a, t = !b || b > to ? to : b;
        return f <= t ? { from: f, to: t } : null;
    };
    const reps = replacements.map((r) => { const c = clip(r.from, r.to); return c && { ...c, carId: r.carId, replacementId: r.id ?? null }; }).filter(Boolean);
    const off = [...reps.map((r) => ({ from: r.from, to: r.to })), ...maintenances.map((m) => clip(m.from, m.to)).filter(Boolean)]
        .sort((a, b) => a.from.localeCompare(b.from));
    const unit = [];
    let cur = from;
    for (const o of off) {
        if (o.to < cur) continue;
        if (o.from > cur) unit.push({ from: cur, to: shiftDay(o.from, -1) });
        cur = o.to >= cur ? shiftDay(o.to, 1) : cur;
        if (cur > to) break;
    }
    if (cur <= to) unit.push({ from: cur, to });
    const segs = [
        ...unit.map((u) => ({ role: 'unit', carId, ...u })),
        ...reps.map((r) => ({ role: 'replacement', carId: r.carId, from: r.from, to: r.to, replacementId: r.replacementId })),
    ].sort((a, b) => a.from.localeCompare(b.from) || (a.role === 'unit' ? -1 : 1));
    return segs.map((x) => ({ ...x, key: `${x.role}|${x.carId ?? '-'}|${x.from}|${x.to}` }));
}

/** km driven over the filled segments (null when none is complete). */
export function segmentsKmUsed(segments = []) {
    const done = segments.filter((x) => x.kmStart != null && x.kmEnd != null && x.kmEnd >= x.kmStart);
    return done.length ? done.reduce((s, x) => s + (x.kmEnd - x.kmStart), 0) : null;
}

/**
 * KM of the monthly M form vs the operasional (O) forms (owner 2026-11-13):
 * per segment, KM awal must EQUAL the first O km and KM akhir the last O km of
 * that car inside the segment. Filling KM is optional (Dokumen does not need
 * it) — empty KM only warns. A mismatch blocks approval. prevKmEnd (km akhir
 * of the previous month) only warns.
 * segments: [{ key, carId, from, to, kmStart, kmEnd, label? }]
 * oRowsByCar: { [carId]: [{ date, kmStart, kmEnd }] }
 * → { issues:[], warnings:[], perSeg: { key: { oFirst, oLast, oKm, days } } }
 */
export function kmCheck({ segments = [], oRowsByCar = {}, prevKmEnd = null } = {}) {
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const issues = [], warnings = [], perSeg = {};
    const firstUnit = segments.find((x) => x.role !== 'replacement');
    for (const sg of segments) {
        const ks = n(sg.kmStart), ke = n(sg.kmEnd);
        const name = sg.label ? `${sg.label} (${sg.from} – ${sg.to})` : `${sg.from} – ${sg.to}`;
        if (ks != null && ke != null && ke < ks) issues.push(`KM akhir lebih kecil dari KM awal: ${name}.`);
        if ((ks == null) !== (ke == null)) warnings.push(`KM awal dan akhir belum lengkap: ${name}.`);
        const rows = (oRowsByCar[sg.carId] || []).map((r) => ({ date: r.date, kmStart: n(r.kmStart), kmEnd: n(r.kmEnd) }))
            .filter((r) => r.kmStart != null && r.kmEnd != null && r.date >= sg.from && r.date <= sg.to);
        if (!rows.length) continue;
        const oFirst = Math.min(...rows.map((r) => r.kmStart)), oLast = Math.max(...rows.map((r) => r.kmEnd));
        perSeg[sg.key] = { oFirst, oLast, oKm: rows.reduce((s, r) => s + Math.max(0, r.kmEnd - r.kmStart), 0), days: rows.length };
        if (ks == null && ke == null) warnings.push(`KM belum diisi untuk ${name}; form operasional: ${oFirst} → ${oLast}.`);
        else if (ks !== oFirst || ke !== oLast) issues.push(`KM ${name} (${ks ?? '-'} → ${ke ?? '-'}) harus sama dengan form operasional (${oFirst} → ${oLast}).`);
    }
    if (prevKmEnd != null && firstUnit && n(firstUnit.kmStart) != null && n(firstUnit.kmStart) !== Number(prevKmEnd)) {
        warnings.push(`KM awal ${firstUnit.kmStart} berbeda dengan KM akhir bulan sebelumnya (${prevKmEnd}).`);
    }
    return { issues, warnings, perSeg };
}

/**
 * One unit in one cycle. kmUsed: km driven in the cycle (null = unknown → no excess).
 * Owner 2026-11-13: NO pro-rata — the agreed monthly fee (and the full km quota)
 * applies to every contract month the unit is used, even for 1 day or a short
 * last month; the only extra is kelebihan km. `days` is informational only.
 * → null when the unit isn't in the cycle, else { from, to (= contract month), activeFrom, activeTo (unit), days, full, fee, kmAllowed, kmUsed, excessKm, excessCharge, total }
 */
export function cycleLine({ contract, unit, cycle, kmUsed = null }) {
    // The billed period is ALWAYS the contract month (owner 2026-11-13: follows the agreement);
    // the unit's own dates only decide whether it is in that month and its active days (for KM).
    const activeFrom = [cycle.from, unit.startDate].filter(Boolean).sort().pop();
    const activeTo = [cycle.to, unit.endDate].filter(Boolean).sort()[0];
    if (activeTo < activeFrom) return null;
    const from = cycle.from, to = cycle.to;
    const days = daysBetween(activeFrom, activeTo);
    const full = true;
    const fee = r0(Number(unit.monthlyFee));
    const allowance = Number(contract.kmAllowanceMonth) || 0, rate = Number(contract.excessKmRate) || 0;
    const kmAllowed = allowance;
    const used = kmUsed == null || kmUsed === '' ? null : Math.max(0, Number(kmUsed));
    const excessKm = used != null && allowance && rate ? Math.max(0, used - kmAllowed) : 0;
    const excessCharge = r0(excessKm * rate);
    return { from, to, activeFrom, activeTo, days, full, fee, kmAllowed, kmUsed: used, excessKm, excessRate: rate, excessCharge, total: fee + excessCharge };
}

/** "Bulan ke-n" of a contract for a period (start month = 1). */
export function monthIndexOf(startDate, period) {
    const y0 = +startDate.slice(0, 4), m0 = +startDate.slice(5, 7);
    const y = +period.slice(0, 4), m = +period.slice(5, 7);
    return (y - y0) * 12 + (m - m0) + 1;
}

/**
 * Months that should already have their M codes (owner 2026-11-13: created at
 * the start of each running month): contract months up to the current one.
 * stopFrom: first period no longer billed here (contract replaced by an amendment).
 */
export function duePeriods({ startDate, endDate, todayIso, stopFrom = null }) {
    const now = todayIso.slice(0, 7);
    return contractPeriods(startDate, endDate).filter((p) => p <= now && (!stopFrom || p < stopFrom));
}

export function renewalReminderDue(endDate, todayIso, sent = {}) {
    const left = dayNum(endDate) - dayNum(todayIso);
    if (left < 0) return null;
    for (const t of [7, 30, 60]) if (left <= t && !sent[t]) return { threshold: t, daysLeft: left };
    return null;
}

// ─── Contract workflow (owner request 2026-11-05) ────────────────────────────
// create (agency or client) → required documents → BOTH sides approve → active.
// Both sides may edit while 'draft'; any change to the terms or to the
// document list clears both approvals (they approved something else).

/** Which side a user acts for on a contract. */
export function sideOf(user) {
    if (!user) return null;
    if (user.role === 'superadmin') return 'super';
    return user.accountType === 'client' || user.role === 'client' || user.role === 'client_admin' ? 'client' : 'agency';
}
export const otherSide = (side) => (side === 'client' ? 'agency' : 'client');

/** Commercial terms: changing them on a draft clears approvals; on an active contract they are locked. */
export const COMMERCIAL_KEYS = ['clientOrgId', 'agencyOrgId', 'startDate', 'endDate', 'billingDay', 'kmAllowanceMonth', 'excessKmRate',
    'includes', 'package', 'extrasMode', 'title', 'notes', 'cutoffDay', 'workStart', 'workEnd', 'opsPolicy'];

/**
 * Can this contract be approved? Returns the reasons it can't.
 * docs: [{ mandatory, status, requiredFrom, title }]
 */
export function approvalBlockers({ contract, units = [], docs = [] }) {
    const out = [];
    if (contract.status !== 'draft') out.push('Kontrak tidak dalam status draf.');
    if (!units.length) out.push('Tambahkan minimal satu unit.');
    if (units.some((u) => !(Number(u.monthlyFee) > 0))) out.push('Biaya bulanan setiap unit wajib diisi.');
    for (const d of docs) {
        if (d.mandatory && d.status !== 'approved') {
            out.push(`Dokumen wajib "${d.title}" dari ${d.requiredFrom === 'agency' ? 'agency' : 'klien'} belum disetujui.`);
        }
    }
    return out;
}

/** After an approval, should the contract become active? */
export const bothApproved = (c) => !!(c.agencyApprovedAt && c.clientApprovedAt);

/** Contract terms that must be filled before approval (no silent defaults). */
export function termBlockers(c, policy = null) {
    const out = [];
    if (!c.billingDay) out.push('Isi tanggal tagih.');
    if (!String(c.package || '').trim()) out.push('Isi paket.');
    if (policy?.overtime?.enabled && (!c.workStart || !c.workEnd)) out.push('Isi jam kerja mulai dan selesai (dasar perhitungan lembur).');
    return out;
}
