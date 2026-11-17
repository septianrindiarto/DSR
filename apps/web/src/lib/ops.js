// Frontend copy of apps/api/src/services/ops-core.js (live previews only; the
// server recomputes and stores the real values). Keep in sync — copy the file.
// ─── Rekap Operasional & Lembur — pure rules (test/ops.test.js) ─────────────
// Overtime hours  = time outside the contract's working window (default
//                   08:00–17:00) on workdays; the whole span on rest days and
//                   holidays. A span ending before it starts crosses midnight.
// Cut-off         = per contract: cutoff_day 1–28, null = end of month.
//                   Period 2026-10 with cut-off 25 = 2026-09-26 … 2026-10-25.
// Working days    = Mon–Fri excluding holidays (national + agency).
// Reminders       = every 5 working days while a recap waits for the client;
//                   from the 3rd reminder on, the agency admins are included.
// ─────────────────────────────────────────────────────────────────────────────

export const KINDS = ['overtime', 'expense', 'trip']; // trip = SPPD (perjalanan dinas)
export const EXPENSE_TYPES = ['bbm', 'tol', 'parkir', 'penginapan', 'makan', 'lainnya'];
export const DAY_TYPES = ['workday', 'restday', 'holiday'];
export const EXTRAS_MODES = ['included', 'separate', 'none'];
export const REMINDER_WORKDAYS = 5;
export const ESCALATE_AFTER = 2;

const pad2 = (n) => String(n).padStart(2, '0');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 'HH:MM' → minutes after midnight, or null. */
export function parseHM(v) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * Overtime hours for one activity span.
 * { startTime, endTime, workStart='08:00', workEnd='17:00', dayType='workday' }
 */
export function overtimeHours({ startTime, endTime, workStart = '08:00', workEnd = '17:00', dayType = 'workday' }) {
    const s = parseHM(startTime);
    let e = parseHM(endTime);
    if (s == null || e == null) return null;
    if (e <= s) e += 1440; // crosses midnight
    const span = e - s;
    if (dayType !== 'workday') return r2(span / 60);
    const ws = parseHM(workStart) ?? 480, we = parseHM(workEnd) ?? 1020;
    let inside = overlap(s, e, ws, we);
    if (e > 1440) inside += overlap(s, e, ws + 1440, we + 1440); // next day's window
    return r2(Math.max(0, span - inside) / 60);
}

const dayNum = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const isoOf = (n) => { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Date range of a period for a contract cut-off day (null = end of month). */
export function cutoffRange(period, cutoffDay = null) {
    const [y, m] = String(period).split('-').map(Number);
    if (!(y > 2000 && m >= 1 && m <= 12)) throw new Error('Periode harus YYYY-MM.');
    const c = Number(cutoffDay) || 0;
    if (!c) return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDay(y, m))}` };
    const to = `${y}-${pad2(m)}-${pad2(Math.min(c, lastDay(y, m)))}`;
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const prevTo = `${py}-${pad2(pm)}-${pad2(Math.min(c, lastDay(py, pm)))}`;
    return { from: isoOf(dayNum(prevTo) + 1), to };
}

/** Period (YYYY-MM) an entry date falls in, given the cut-off day. */
export function periodOfDate(iso, cutoffDay = null) {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    const c = Number(cutoffDay) || 0;
    if (!c || d <= Math.min(c, lastDay(y, m))) return `${y}-${pad2(m)}`;
    return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

/** Working days strictly after `fromIso` up to and including `toIso`. */
export function workingDaysBetween(fromIso, toIso, holidays = new Set()) {
    let n = 0;
    for (let d = dayNum(fromIso) + 1; d <= dayNum(toIso); d++) {
        const dow = new Date(d * 86400000).getUTCDay();
        if (dow === 0 || dow === 6) continue;
        if (holidays.has(isoOf(d))) continue;
        n++;
    }
    return n;
}

/** Day type of a date: weekend → restday, holiday list → holiday, else workday. */
export function dayTypeOf(iso, holidays = new Set()) {
    if (holidays.has(iso)) return 'holiday';
    const dow = new Date(dayNum(iso) * 86400000).getUTCDay();
    return dow === 0 || dow === 6 ? 'restday' : 'workday';
}

/**
 * Is a reminder due for a waiting recap?
 * { submittedOn: 'YYYY-MM-DD', reminders: [{ on, escalated }], today, holidays }
 * → null | { number, escalate }
 */
export function reminderDue({ submittedOn, reminders = [], today, holidays = new Set() }) {
    const last = reminders.length ? reminders[reminders.length - 1].on : submittedOn;
    if (!last || !today || last >= today) return null;
    if (workingDaysBetween(last, today, holidays) < REMINDER_WORKDAYS) return null;
    return { number: reminders.length + 1, escalate: reminders.length >= ESCALATE_AFTER };
}

/** Next sequential code for a prefix ('R' → R001…), given existing codes. */
export function nextCode(prefix, codes = []) {
    const re = new RegExp(`^${prefix}(\\d+)$`);
    let max = 0;
    for (const c of codes) { const m = re.exec(c || ''); if (m) max = Math.max(max, Number(m[1])); }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/**
 * Transaction-code prefix per form (owner 2026-11-13): L = lembur,
 * T = perjalanan dinas, O = operasional (BBM, tol, parkir …).
 * R = older operasional forms (2026-11-05 … 11-13); those keep their R code.
 */
export const codePrefixOf = (kind) => (kind === 'overtime' ? 'L' : kind === 'trip' ? 'T' : 'O');
export const OPS_CODE_RE = /^[LRTO]\d{3,}$/;

/**
 * Status after an approval by one side. Both sides must approve each form;
 * 'verified' = agency approved, client not yet (kept for older data);
 * 'approved' = both approved → can be invoiced.
 */
export function afterApproval({ agencyApproved, clientApproved }) {
    if (agencyApproved && clientApproved) return 'approved';
    return agencyApproved ? 'verified' : 'submitted';
}

/** Totals of a set of entries (approved/pending lines of a recap). */
export function recapTotals(entries) {
    return entries.reduce((t, e) => ({
        count: t.count + 1,
        hours: r2(t.hours + (Number(e.hours) || 0)),
        amount: Math.round(t.amount + (Number(e.amount) || 0)),
    }), { count: 0, hours: 0, amount: 0 });
}

// ═════════════════════════════════════════════════════════════════════════════
// Forms: Form Lembur & Perjalanan Dinas — PARAMETERISED per contract
// (owner 2026-11-06: no built-in formula; each contract sets its own matrix).
//   overtime = time outside working hours (whole span on rest days/holidays);
//   per row the driver splits it into driving and waiting.
//   • break: every `breakEvery` overtime hours → `breakHours` deducted (waiting first)
//   • rounding: bands on the leftover minutes, e.g. 0–29 → 0, 30–45 → 0.5, 46–59 → 1
//     (no bands = exact minutes/60)
//   • driving hours are paid by TIERS per day type: [{ from, to, mult }] in hours
//     (to = null → no upper limit); rate = hourlyRate, else baseSalary ÷ divisor
//   • waiting hours: waitingPct % × waitingRate (default = the hourly rate)
//   • Perjalanan dinas = days × daily allowance + lodging per night claimed
// Nothing has a business default: an empty value stays null and the contract
// cannot be approved until the parts that are switched on are filled in.
// ═════════════════════════════════════════════════════════════════════════════
export const LODGING_OPTIONS = ['disediakan', 'reimburse', 'bersama_user', 'tidak_bersama_user']; // legacy leg values

export const DEFAULT_POLICY = {
    overtime: {
        enabled: false,
        hourlyRate: null, baseSalary: null, divisor: null,
        tiers: { workday: [], restday: [], holiday: [] },
        rounding: [],                 // [{ from, to, hours }] on leftover minutes
        waitingPct: null, waitingRate: null,
        breakEvery: null, breakHours: null,
        maxWorkday: null, maxHoliday: null,
    },
    trip: { enabled: false, dailyAllowance: null, lodgingPerNight: null },
    sign: { approverTitle: '', knowerTitle: '', executorTitle: '', approverName: '', approverPosition: '', city: '' },
};

/** Sample values offered by the "Pakai contoh" button (never applied silently). */
export const SAMPLE_POLICY = {
    overtime: {
        enabled: true, hourlyRate: null, baseSalary: null, divisor: 173,
        tiers: {
            workday: [{ from: 0, to: 1, mult: 1.5 }, { from: 1, to: null, mult: 2 }],
            restday: [{ from: 0, to: 8, mult: 2 }, { from: 8, to: 9, mult: 3 }, { from: 9, to: null, mult: 4 }],
            holiday: [{ from: 0, to: 8, mult: 2 }, { from: 8, to: 9, mult: 3 }, { from: 9, to: null, mult: 4 }],
        },
        rounding: [{ from: 0, to: 29, hours: 0 }, { from: 30, to: 45, hours: 0.5 }, { from: 46, to: 59, hours: 1 }],
        waitingPct: 30, waitingRate: null, breakEvery: 5, breakHours: 1, maxWorkday: 4, maxHoliday: 12,
    },
    trip: { enabled: true, dailyAllowance: null, lodgingPerNight: null },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const cleanTiers = (list) => (Array.isArray(list) ? list : []).map((t) => ({ from: numOrNull(t.from) ?? 0, to: numOrNull(t.to), mult: numOrNull(t.mult) }))
    .filter((t) => t.mult != null).sort((a, b) => a.from - b.from).slice(0, 12);
const cleanBands = (list) => (Array.isArray(list) ? list : []).map((b) => ({ from: numOrNull(b.from) ?? 0, to: numOrNull(b.to) ?? 59, hours: numOrNull(b.hours) ?? 0 }))
    .sort((a, b) => a.from - b.from).slice(0, 12);

/**
 * Older (v1) policies: method pp35/flat/none + rounding 'sucofindo' + lodging per option.
 * v1 always stored built-in defaults (pp35, ÷173, 30 %, break 5, Fungsi Umum …)
 * even when nobody filled anything. Only a v1 policy with a real salary / flat
 * rate counts as reviewed; otherwise it converts to EMPTY (owner 2026-11-06:
 * no value may appear that nobody entered).
 */
const V1_SIGN_DEFAULTS = { approverTitle: 'Fungsi Umum', knowerTitle: 'User', executorTitle: 'Pengemudi', city: 'Bandung' };
function fromV1(raw) {
    const o = raw.overtime || {}, t = raw.trip || {};
    const S = SAMPLE_POLICY.overtime;
    const sign = { ...(raw.sign || {}) };
    if (o.method !== undefined && Object.entries(V1_SIGN_DEFAULTS).every(([k, v]) => (sign[k] || '') === v)) {
        for (const k of Object.keys(V1_SIGN_DEFAULTS)) sign[k] = '';
    }
    const out = { overtime: {}, trip: {}, sign };
    const reviewed = (o.method === 'pp35' && Number(o.baseSalary) > 0) || (o.method === 'flat' && Number(o.flatRate) > 0);
    if (o.method !== undefined && !reviewed) {
        out.overtime = { enabled: false };
    } else if (o.method !== undefined) {
        out.overtime = {
            enabled: o.method !== 'none',
            hourlyRate: o.method === 'flat' ? o.flatRate : null,
            baseSalary: o.method === 'pp35' ? o.baseSalary : null, divisor: o.method === 'pp35' ? o.divisor : null,
            tiers: o.method === 'flat' ? { workday: [{ from: 0, to: null, mult: 1 }], restday: [{ from: 0, to: null, mult: 1 }], holiday: [{ from: 0, to: null, mult: 1 }] } : S.tiers,
            rounding: o.rounding === 'sucofindo' ? S.rounding : [],
            waitingPct: o.waitingPct, waitingRate: o.waitingRate, breakEvery: o.breakEvery, breakHours: o.breakEvery ? 1 : null,
            maxWorkday: o.maxWorkday ?? null, maxHoliday: o.maxHoliday ?? null,
        };
    } else out.overtime = o;
    if (isObj(t.lodging)) {
        const vals = Object.values(t.lodging).map(Number).filter((n) => n > 0);
        const used = Number(t.dailyAllowance) > 0 || vals.length > 0;
        out.trip = used
            ? { enabled: true, dailyAllowance: t.dailyAllowance, lodgingPerNight: vals.length ? Math.max(...vals) : null }
            : { enabled: false, dailyAllowance: null, lodgingPerNight: null };
    } else out.trip = t;
    return out;
}

/** Contract policy normalised (unknown keys dropped; empty stays null). */
export function policyOf(raw) {
    const src = fromV1(isObj(raw) ? raw : {});
    const o = isObj(src.overtime) ? src.overtime : {}, t = isObj(src.trip) ? src.trip : {}, sg = isObj(src.sign) ? src.sign : {};
    const tiers = isObj(o.tiers) ? o.tiers : {};
    return {
        overtime: {
            enabled: !!o.enabled,
            hourlyRate: numOrNull(o.hourlyRate), baseSalary: numOrNull(o.baseSalary), divisor: numOrNull(o.divisor),
            tiers: { workday: cleanTiers(tiers.workday), restday: cleanTiers(tiers.restday), holiday: cleanTiers(tiers.holiday) },
            rounding: cleanBands(o.rounding),
            waitingPct: numOrNull(o.waitingPct), waitingRate: numOrNull(o.waitingRate),
            breakEvery: numOrNull(o.breakEvery), breakHours: numOrNull(o.breakHours),
            maxWorkday: numOrNull(o.maxWorkday), maxHoliday: numOrNull(o.maxHoliday),
        },
        trip: { enabled: !!t.enabled, dailyAllowance: numOrNull(t.dailyAllowance), lodgingPerNight: numOrNull(t.lodgingPerNight) },
        sign: Object.fromEntries(Object.keys(DEFAULT_POLICY.sign).map((k) => [k, String(sg[k] ?? '').slice(0, 120)])),
        source: src.source === 'default' || (isObj(raw) && raw.source === 'default') ? 'default' : 'own',
    };
}

// ─── Agency default (Pengaturan → Lembur & Perjalanan Dinas, owner 2026-11-09)
// organizations.ops_policy_default has the same shape as a contract policy.
// A contract uses it when it says so (source 'default') or when it carries no
// lembur / perjalanan dinas terms at all. Daily (non-contract) orders price
// their overtime hours and nights with it.
const hasOwnTerms = (p) => p.overtime.enabled || p.trip.enabled
    || p.overtime.hourlyRate != null || p.overtime.baseSalary != null || p.trip.dailyAllowance != null || p.trip.lodgingPerNight != null;

/** Policy that actually applies to a contract. */
export function effectivePolicy(contractRaw, agencyDefaultRaw) {
    const own = policyOf(contractRaw);
    if (own.source !== 'default' && hasOwnTerms(own)) return own;
    const d = policyOf(agencyDefaultRaw);
    return { ...d, sign: hasOwnTerms(own) || Object.values(own.sign).some(Boolean) ? own.sign : d.sign, source: 'default' };
}

/** Rates the Dokumen invoice used before Pengaturan existed (owner to confirm,
 *  Review Register X-24). Only used while the agency default is not filled in. */
export const LEGACY_DAILY_RATES = { overtime: 50000, lodging: 150000 };

/** Rates for daily orders (Rp per overtime hour, Rp per night); null = not set. */
export function dailyRatesOf(agencyDefaultRaw) {
    const p = policyOf(agencyDefaultRaw);
    const overtime = p.overtime.enabled ? hourlyRateOf(p) : null;
    const lodging = p.trip.enabled ? p.trip.lodgingPerNight : null;
    const configured = overtime != null || lodging != null;
    return {
        overtime: overtime != null ? Math.round(overtime) : (configured ? 0 : LEGACY_DAILY_RATES.overtime),
        lodging: lodging != null ? lodging : (configured ? 0 : LEGACY_DAILY_RATES.lodging),
        configured,
    };
}

/** Amount of one daily order line: price + overtime hours × rate + nights × rate. */
export function dailyLineAmount({ price = 0, overtimeHours = 0, nights = 0 }, rates = {}) {
    return Math.round((Number(price) || 0) + (Number(overtimeHours) || 0) * (Number(rates.overtime) || 0) + (Number(nights) || 0) * (Number(rates.lodging) || 0));
}

/** Hourly base rate of a policy (direct rate, else salary ÷ divisor), or null. */
export function hourlyRateOf(p) {
    const o = policyOf(p).overtime;
    if (o.hourlyRate != null) return o.hourlyRate;
    if (o.baseSalary != null && o.divisor > 0) return o.baseSalary / o.divisor;
    return null;
}

/** What is still missing before a contract with this policy can be approved. */
export function policyBlockers(raw) {
    const p = policyOf(raw), o = p.overtime, t = p.trip, out = [];
    if (o.enabled) {
        if (hourlyRateOf(p) == null) out.push('Lembur: isi tarif per jam, atau gaji pokok dan pembagi.');
        if (!o.tiers.workday.length) out.push('Lembur: isi pengali untuk hari kerja.');
        if (!o.tiers.restday.length) out.push('Lembur: isi pengali untuk libur mingguan.');
        if (!o.tiers.holiday.length) out.push('Lembur: isi pengali untuk libur nasional.');
        if (o.waitingPct == null) out.push('Lembur: isi kompensasi waktu menunggu (%).');
    }
    if (t.enabled) {
        if (t.dailyAllowance == null) out.push('Perjalanan dinas: isi uang harian.');
        if (t.lodgingPerNight == null) out.push('Perjalanan dinas: isi penggantian penginapan per malam.');
    }
    return out;
}

/** Minutes → hours with rounding bands on the leftover minutes (none = exact). */
export function roundMinutes(min, bands = []) {
    const m = Math.max(0, Math.round(Number(min) || 0));
    const list = Array.isArray(bands) ? bands : bands === 'sucofindo' ? SAMPLE_POLICY.overtime.rounding : [];
    if (!list.length) return r2(m / 60);
    const h = Math.floor(m / 60), rem = m - h * 60;
    const b = list.find((x) => rem >= x.from && rem <= x.to);
    return r2(h + (b ? b.hours : rem / 60));
}

/** Split hours over tiers [{ from, to, mult }] → [{ ...tier, hours }]. */
export function splitTiers(hours, tiers = []) {
    const h = Math.max(0, Number(hours) || 0);
    return tiers.map((t) => ({ ...t, hours: r2(Math.max(0, Math.min(h, t.to ?? Infinity) - t.from)) }));
}

const minutesOutside = (row, workStart, workEnd, dayType) => Math.round((overtimeHours({ startTime: row.start, endTime: row.end, workStart, workEnd, dayType }) || 0) * 60);

/**
 * One overtime form (one day): rows [{ start, end, waitMinutes, location, description }]
 * → hours, tier split, pay, using the contract's matrix.
 */
export function spklCompute({ rows = [], dayType = 'workday', workStart = '08:00', workEnd = '17:00', policy: rawPolicy } = {}) {
    const pol = policyOf(rawPolicy), p = pol.overtime;
    let otMin = 0, waitMin = 0;
    const lines = rows.filter((r) => parseHM(r.start) != null && parseHM(r.end) != null).map((r) => {
        const ot = minutesOutside(r, workStart, workEnd, dayType);
        const wait = Math.min(ot, Math.max(0, Math.round(Number(r.waitMinutes) || 0)));
        otMin += ot; waitMin += wait;
        return { ...r, overtimeMinutes: ot, waitMinutes: wait, driveMinutes: ot - wait };
    });
    const breakMin = p.breakEvery > 0 ? Math.floor(otMin / 60 / p.breakEvery) * (p.breakHours ?? 1) * 60 : 0;
    let driveMin = otMin - waitMin;
    const waitNet = waitMin - Math.min(waitMin, breakMin);
    driveMin = Math.max(0, driveMin - Math.max(0, breakMin - waitMin));
    const driveH = roundMinutes(driveMin, p.rounding);
    const waitH = roundMinutes(waitNet, p.rounding);
    const split = splitTiers(driveH, p.tiers[dayType] || []);
    const hourly = hourlyRateOf(pol) ?? 0;
    const waitingRate = p.waitingRate != null ? p.waitingRate : hourly;
    const amount = p.enabled
        ? hourly * split.reduce((s, t) => s + t.hours * t.mult, 0) + waitH * (p.waitingPct || 0) / 100 * waitingRate
        : 0;
    // legacy columns for printed recaps (hours at ×1.5 / ×2 / ×3 / ×4)
    const byMult = (m) => r2(split.filter((t) => t.mult === m).reduce((s, t) => s + t.hours, 0));
    const tiers = { h15: byMult(1.5), h2: byMult(2), h3: byMult(3), h4: byMult(4), split };
    const hours = r2(driveH + waitH);
    const warnings = [];
    // Why the pay would be 0 (owner 2026-11-13: "2 jam lembur but nominal Rp0").
    const missing = [];
    if (p.enabled && !(hourly > 0)) missing.push('rate');
    if (p.enabled && !(p.tiers[dayType] || []).length) missing.push('tiers');
    if (missing.includes('rate')) warnings.push('Tarif lembur per jam belum diatur (isi tarif per jam, atau gaji pokok + pembagi) — nominal Rp0.');
    if (missing.includes('tiers')) warnings.push(`Pengali lembur untuk ${dayType === 'workday' ? 'hari kerja' : dayType === 'restday' ? 'libur mingguan' : 'libur nasional'} belum diatur — nominal Rp0.`);
    if (dayType === 'workday' && p.maxWorkday != null && hours > p.maxWorkday) warnings.push(`Lebih dari ${p.maxWorkday} jam lembur di hari kerja.`);
    if (dayType !== 'workday' && p.maxHoliday != null && hours > p.maxHoliday) warnings.push(`Lebih dari ${p.maxHoliday} jam lembur di hari libur.`);
    return {
        lines, overtimeMinutes: otMin, waitMinutes: waitNet, driveMinutes: driveMin, breakMinutes: breakMin,
        driveHours: driveH, waitHours: waitH, hours, tiers,
        hourlyRate: Math.round(hourly), waitingRate: Math.round(waitingRate), method: p.enabled ? 'matrix' : 'none',
        amount: Math.round(amount), warnings, missing,
    };
}

/**
 * Lembur over several days (owner 2026-11-13): rows [{ date, dayType, start,
 * end, waitMinutes, location, description }]. Each DATE is calculated on its
 * own (its jenis hari, tiers, rounding and break apply per day), then summed.
 * → { days:[{ date, dayType, …day calc }], lines, hours, driveHours, waitHours,
 *     overtimeMinutes, byMult:[{ mult, hours }], waitingPct, amount, warnings, missing }
 */
export function spklComputeDays({ rows = [], workStart = '08:00', workEnd = '17:00', policy: rawPolicy } = {}) {
    const pol = policyOf(rawPolicy);
    const groups = new Map();
    for (const r of rows) {
        if (!r || !r.date) continue;
        if (!groups.has(r.date)) groups.set(r.date, []);
        groups.get(r.date).push(r);
    }
    const days = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
        const dayType = DAY_TYPES.includes(list[0].dayType) ? list[0].dayType : 'workday';
        const c = spklCompute({ rows: list, dayType, workStart, workEnd, policy: pol });
        return { date, dayType, ...c, lines: c.lines.map((l) => ({ ...l, date })) };
    });
    const byMultMap = new Map();
    for (const d of days) for (const t of d.tiers.split || []) if (t.hours > 0) byMultMap.set(t.mult, r2((byMultMap.get(t.mult) || 0) + t.hours));
    const sum = (k) => r2(days.reduce((s, d) => s + (Number(d[k]) || 0), 0));
    return {
        days, lines: days.flatMap((d) => d.lines),
        hours: sum('hours'), driveHours: sum('driveHours'), waitHours: sum('waitHours'),
        overtimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
        byMult: [...byMultMap.entries()].sort(([a], [b]) => a - b).map(([mult, hours]) => ({ mult, hours })),
        waitingPct: pol.overtime.waitingPct, hourlyRate: Math.round(hourlyRateOf(pol) ?? 0),
        method: pol.overtime.enabled ? 'matrix' : 'none',
        amount: days.reduce((s, d) => s + d.amount, 0),
        warnings: days.flatMap((d) => d.warnings.map((w) => `${d.date}: ${w}`)).filter((w, i, a) => a.indexOf(w) === i),
        missing: [...new Set(days.flatMap((d) => d.missing || []))],
    };
}

/** Hours (decimal) → "hh:mm". */
export const hhmm = (h) => {
    const m = Math.round((Number(h) || 0) * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Lodging is claimed for a night unless the leg says it was provided. */
export const lodgingClaimed = (v) => v === true || (typeof v === 'string' && v !== '' && v !== 'disediakan' && v !== 'no');

/** Perjalanan dinas: { departDate, returnDate, legs:[{ arrivedAt, date, lodging:true|false }] } → allowance. */
export function tripCompute({ departDate, returnDate, legs = [], policy: rawPolicy } = {}) {
    const p = policyOf(rawPolicy).trip;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate || '') || returnDate < departDate) return null;
    const days = dayNum(returnDate) - dayNum(departDate) + 1;
    const daily = Number(p.dailyAllowance || 0);
    const rate = p.lodgingPerNight || 0;
    const lodgingLines = legs.map((l) => ({ ...l, amount: lodgingClaimed(l.lodging) ? rate : 0 }));
    const lodging = lodgingLines.reduce((t, l) => t + l.amount, 0);
    return { days, dailyAllowance: daily, allowance: days * daily, lodging, legs: lodgingLines, amount: Math.round(days * daily + lodging) };
}
