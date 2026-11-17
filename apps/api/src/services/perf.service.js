// ─── Request timing (owner 2026-11-13: every screen under 1 second) ─────────
// Measures every API request: total time and how many DB queries it ran.
//   • Server-Timing header → visible in the browser DevTools (Network → Timing)
//   • requests slower than PERF_LOG_MS (default 300 ms) are logged:
//       [slow] 842ms 7q GET /api/orders
//   • per-route stats (count, p50, p95, max, avg queries) for superadmin:
//       GET /api/health/perf          (?reset=1 clears)
// Off with PERF_DISABLED=true. In-process (single PM2 instance).
// ─────────────────────────────────────────────────────────────────────────────
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const SLOW_MS = Number(process.env.PERF_LOG_MS || 300);
const DISABLED = process.env.PERF_DISABLED === 'true';
const KEEP = 200;                      // samples kept per route for percentiles
const stats = new Map();               // 'GET /api/orders' → { count, samples:[ms], max, queries, slow, bg }

/** Called by the Drizzle logger for every query. */
export function countQuery() {
    const s = als.getStore();
    if (s) s.queries++;
}

const pattern = (req) => {
    const p = req.route?.path ? `${req.baseUrl || ''}${req.route.path === '/' ? '' : req.route.path}` : (req.originalUrl || req.url || '').split('?')[0];
    return p.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid') || '/';
};

const pct = (arr, q) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

/** Express middleware — mount first. */
export function perfMiddleware(req, res, next) {
    if (DISABLED || !req.path.startsWith('/api')) return next();
    const store = { queries: 0, start: process.hrtime.bigint() };
    const ms = () => Number(process.hrtime.bigint() - store.start) / 1e6;
    const writeHead = res.writeHead;
    res.writeHead = function patched(...args) {
        try { if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${ms().toFixed(1)}, db;desc="${store.queries} queries"`); } catch { /* ignore */ }
        return writeHead.apply(this, args);
    };
    res.on('finish', () => {
        const dur = ms();
        const bg = req.get('x-background') === '1';
        const key = `${req.method} ${pattern(req)}`;
        let st = stats.get(key);
        if (!st) { st = { count: 0, samples: [], max: 0, queries: 0, slow: 0, bg: 0 }; stats.set(key, st); }
        st.count++; st.queries += store.queries; st.max = Math.max(st.max, dur);
        st.samples.push(dur); if (st.samples.length > KEEP) st.samples.shift();
        if (bg) st.bg++;
        if (dur >= SLOW_MS) {
            st.slow++;
            console.warn(`[slow] ${Math.round(dur)}ms ${store.queries}q ${key}${bg ? ' (background)' : ''} → ${res.statusCode}`);
        }
    });
    als.run(store, next);
}

/** Per-route summary, slowest p95 first. */
export function perfReport({ reset = false } = {}) {
    const data = [...stats.entries()].map(([route, s]) => ({
        route, count: s.count, p50: Math.round(pct(s.samples, 0.5)), p95: Math.round(pct(s.samples, 0.95)), max: Math.round(s.max),
        avgQueries: s.count ? +(s.queries / s.count).toFixed(1) : 0, slow: s.slow, background: s.bg,
    })).sort((a, b) => b.p95 - a.p95);
    if (reset) stats.clear();
    return { slowMs: SLOW_MS, since: startedAt, data };
}
const startedAt = new Date().toISOString();
