// ─── Scheduled jobs (in-process, single PM2 instance) ───────────────────────
// A 10-minute tick runs each job once per day/month after its hour (WIB).
// job_runs makes it restart-safe and prevents double runs: a job is "taken"
// with one atomic upsert before it executes.
//   fleet-alerts       daily 08:00   documents / service / SIM reminders
//   contract-monthly-codes daily 01:00  M rows: month 1 on activation, next month H+1 after tanggal tagih
//   maintenance-reminders daily 07:00  maintenance starting tomorrow → feed (+ client when on a contract)
//   contract-renewals  daily 08:00   60/30/7-day renewal reminders, auto-end
//   monthly-reports    1st, 07:00    client monthly report emails
//   ops-recap-reminders daily 09:00  R recaps waiting > 5 working days (escalate after 2)
// Disable all with JOBS_DISABLED=true.
// ─────────────────────────────────────────────────────────────────────────────
import { db, withDbRetry, isTransientDbError } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { fleetCareService } from './fleetcare.service.js';
import { contractsService } from './contracts.service.js';
import { contractBillingService } from './contract-billing.service.js';
import { runMonthlyReports } from './report.service.js';
import { opsService } from './ops.service.js';
import { fleetAlertsService } from './fleet-alerts.service.js';
import { sessionService } from './session.service.js';

const wibNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));

/** Atomically claim a run key (true = we run it now). */
async function claim(key) {
    const rows = await withDbRetry(() => db.execute(sql`INSERT INTO job_runs (job_key, last_run_at) VALUES (${key}, NOW())
        ON CONFLICT (job_key) DO NOTHING RETURNING job_key`));
    const list = Array.isArray(rows) ? rows : rows?.rows || [];
    return list.length > 0;
}

const JOBS = [
    { name: 'fleet-alerts', hour: 8, period: 'day', run: () => fleetCareService.runDailyAlerts() },
    // M codes per unit for each running contract month (owner 2026-11-13). Daily so a
    // missed 1st (server down) is caught up; ensureContract is idempotent.
    { name: 'contract-monthly-codes', hour: 1, period: 'day', run: () => contractBillingService.runMonthlyCodes() },
    { name: 'contract-renewals', hour: 8, period: 'day', run: () => contractsService.runRenewalReminders() },
    { name: 'monthly-reports', hour: 7, period: 'month', run: () => runMonthlyReports() },
    { name: 'ops-recap-reminders', hour: 9, period: 'day', run: () => opsService.runReminders() },
    { name: 'maintenance-reminders', hour: 7, period: 'day', run: () => fleetAlertsService.runDailyReminders() },
    { name: 'session-prune', hour: 3, period: 'day', run: () => sessionService.prune() },
];

export async function tick() {
    const now = wibNow();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    for (const j of JOBS) {
        if (now.getHours() < j.hour) continue;
        if (j.period === 'month' && now.getDate() !== 1) continue;
        const key = `${j.name}:${j.period === 'month' ? day.slice(0, 7) : day}`;
        let claimed = false;
        try {
            if (!(await claim(key))) continue;
            claimed = true;
            const r = await withDbRetry(() => j.run(), { tries: 2, delayMs: 5000 });
            await withDbRetry(() => db.execute(sql`UPDATE job_runs SET detail = ${JSON.stringify(r || {})}::jsonb WHERE job_key = ${key}`));
            console.log(`[jobs] ${key} done`, r || '');
        } catch (e) {
            const code = e.code || e.cause?.code || '';
            console.warn(`[jobs] ${key} failed${code ? ` (${code})` : ''}:`, String(e.message || '').split('\n')[0]);
            // Database blip: release the claim so the next 10-minute tick retries today.
            if (claimed && isTransientDbError(e)) {
                await db.execute(sql`DELETE FROM job_runs WHERE job_key = ${key}`).catch(() => {});
            }
            if (isTransientDbError(e)) break; // DB unreachable — don't hammer it with the other jobs
        }
    }
}

export function startJobs() {
    if (process.env.JOBS_DISABLED === 'true') return null;
    const timer = setInterval(() => tick().catch(() => {}), 10 * 60000);
    timer.unref?.();
    setTimeout(() => tick().catch(() => {}), 60000).unref?.();
    console.log('[jobs] scheduler on (fleet alerts, contract renewals, monthly reports)');
    return timer;
}
