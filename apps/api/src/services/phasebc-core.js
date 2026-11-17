// ─── Phase B/C pure rules (unit-tested in test/phasebc.test.js) ─────────────
const WITH_DRIVER = /all ?in|driver|sopir|supir/i;

/** Suggested lembur hours for a finished trip: hours beyond `hoursPerDay`
 *  per rental day, only for with-driver packages. Staff decide on billing. */
export function suggestOvertime({ startedAt, endedAt, totalDays, pkg, hoursPerDay = 12 }) {
    if (!startedAt || !endedAt || !WITH_DRIVER.test(String(pkg || ''))) return 0;
    const worked = (new Date(endedAt) - new Date(startedAt)) / 3600000;
    const allowed = Math.max(1, Number(totalDays) || 1) * hoursPerDay;
    return Math.max(0, Math.ceil(worked - allowed));
}

/** Is a claim reminder due for this unclaimed booking now? */
export function reminderDue({ createdAt, lastReminderAt, now = new Date(), every = 30 }) {
    const ms = every * 60000;
    if (now - new Date(createdAt) < ms) return false;
    return !lastReminderAt || now - new Date(lastReminderAt) >= ms;
}
