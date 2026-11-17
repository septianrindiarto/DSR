// ─── Fleet care rules (pure, unit-tested in test/contracts.test.js) ──────────
// Documents: expired | soon (≤ warnDays) | ok.
// Service: due by km (last service km + interval) or by date (last service +
// months), whichever comes first. "soon" = within 500 km or 14 days.
// Defaults when a unit has no plan: every 10.000 km / 6 months.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_SERVICE_KM = 10000;
export const DEFAULT_SERVICE_MONTHS = 6;
export const DOCS = ['stnkExpiry', 'taxExpiry', 'kirExpiry', 'insuranceExpiry'];

const dayNum = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const addMonths = (iso, n) => {
    const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + Number(n), +iso.slice(8, 10)));
    return d.toISOString().slice(0, 10);
};

export function docStatus(expiry, todayIso, warnDays = 30) {
    if (!expiry) return null;
    const left = dayNum(String(expiry).slice(0, 10)) - dayNum(todayIso);
    return { status: left < 0 ? 'expired' : left <= warnDays ? 'soon' : 'ok', daysLeft: left };
}

export function serviceStatus(car, todayIso) {
    const intKm = Number(car.serviceIntervalKm) || DEFAULT_SERVICE_KM;
    const intMo = Number(car.serviceIntervalMonths) || DEFAULT_SERVICE_MONTHS;
    const cur = car.currentOdometer == null ? null : Number(car.currentOdometer);
    const out = { dueKm: null, kmLeft: null, dueDate: null, daysLeft: null, status: null, reasons: [] };
    if (car.lastServiceKm != null) {
        out.dueKm = Number(car.lastServiceKm) + intKm;
        if (cur != null) out.kmLeft = out.dueKm - cur;
    }
    if (car.lastServiceDate) {
        out.dueDate = addMonths(String(car.lastServiceDate).slice(0, 10), intMo);
        out.daysLeft = dayNum(out.dueDate) - dayNum(todayIso);
    }
    if (out.kmLeft == null && out.daysLeft == null) return { ...out, status: 'unknown' };
    const over = (out.kmLeft != null && out.kmLeft <= 0) || (out.daysLeft != null && out.daysLeft < 0);
    const soon = (out.kmLeft != null && out.kmLeft <= 500) || (out.daysLeft != null && out.daysLeft <= 14);
    if (out.kmLeft != null && out.kmLeft <= 500) out.reasons.push('km');
    if (out.daysLeft != null && out.daysLeft <= 14) out.reasons.push('date');
    out.status = over ? 'overdue' : soon ? 'soon' : 'ok';
    return out;
}

/** All alerts of one unit. */
export function unitAlerts(car, todayIso, warnDays = 30) {
    const alerts = [];
    for (const k of DOCS) {
        const s = docStatus(car[k], todayIso, warnDays);
        if (s && s.status !== 'ok') alerts.push({ kind: k, ...s });
    }
    const sv = serviceStatus(car, todayIso);
    if (sv.status === 'overdue' || sv.status === 'soon') alerts.push({ kind: 'service', status: sv.status === 'overdue' ? 'expired' : 'soon', kmLeft: sv.kmLeft, daysLeft: sv.daysLeft });
    return alerts;
}
