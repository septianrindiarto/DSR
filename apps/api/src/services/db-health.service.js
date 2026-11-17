// ─── Database health + optional keep-warm (Neon reliability) ────────────────
// Neon scales compute to zero after a few idle minutes; the first query after
// that pays a cold start (usually < 1–3 s, sometimes a timeout on a slow
// network). Two small tools:
//   • pingDb()      — `SELECT 1` with a latency figure, used by /api/health
//                     (point UptimeRobot / Better Stack at it for alerts).
//   • startKeepWarm — when DB_KEEP_WARM=true, ping every DB_KEEP_WARM_MINUTES
//                     (default 4) between DB_KEEP_WARM_HOURS (default 6-23,
//                     Asia/Jakarta). Keeps the compute awake during working
//                     hours only, so users don't hit cold starts. NOTE: this
//                     uses compute hours on your Neon plan — check the limit.
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

export async function pingDb(timeoutMs = 8000) {
    const t0 = Date.now();
    try {
        await Promise.race([
            db.execute(sql`SELECT 1`),
            new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'PING_TIMEOUT' })), timeoutMs)),
        ]);
        return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
        return { ok: false, latencyMs: Date.now() - t0, code: e.code || e.cause?.code || 'ERROR' };
    }
}

function jakartaHour() {
    return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false })) % 24;
}

export function startKeepWarm() {
    if (process.env.DB_KEEP_WARM !== 'true') return null;
    const minutes = Math.max(1, Number(process.env.DB_KEEP_WARM_MINUTES) || 4);
    const [from, to] = String(process.env.DB_KEEP_WARM_HOURS || '6-23').split('-').map(Number);
    const timer = setInterval(async () => {
        const h = jakartaHour();
        if (h < from || h > to) return;
        const r = await pingDb();
        if (!r.ok) console.warn(`[db] keep-warm ping failed (${r.code}) after ${r.latencyMs} ms`);
    }, minutes * 60 * 1000);
    timer.unref?.();
    console.log(`[db] keep-warm on: every ${minutes} min, ${from}:00–${to}:59 WIB`);
    return timer;
}
