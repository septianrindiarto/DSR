# Server Monitoring — Assessment & Proposed Design

_Assessment only (2026-10-28) — nothing built yet. Linked from `docs/technical reference.xlsx` (T.03.2.33, T.03.5.4–T.03.5.7, T.01.14.5) and the scale-up triggers in sheet **A - Capacity Sizing**._

## 1. Why

After go-live you need to see, without opening the server:

- **Is it healthy?** — up/down, errors, database reachable.
- **Is it fast enough?** — response times against the targets (p95 ≤ 500 ms normal, ≤ 2 s reports).
- **What is using the server?** — CPU, memory, disk, database load, slow queries, busy endpoints, background jobs.
- **When to upgrade?** — the scale-up triggers in the sizing sheet need real numbers.

## 2. What exists today

| Area | Today | Gap |
|---|---|---|
| Up / down | `GET /api/health` (API + DB ping, latency) | Nobody is alerted; no history |
| Logs | PM2 log files, Telegram for business events | No search, no rotation, no error counts |
| Resources | — | No CPU / memory / disk / event-loop view |
| Database | Neon console | No slow-query list inside DSR, no connection/pool view |
| Jobs | `job_runs` table (last run + result) | Not shown anywhere |
| Backups | `backup.log` on the VPS | Not shown anywhere |

## 3. What to measure (the four "golden signals" + DSR specifics)

| Group | Metrics | Source (no new libraries) |
|---|---|---|
| **Traffic** | requests/min total and per route group (orders, ops, books …), active sessions | Express middleware counting requests; `session` table |
| **Latency** | p50 / p95 / p99 per route group, slowest 20 requests of the day | `process.hrtime` in the same middleware, kept in minute buckets |
| **Errors** | 4xx / 5xx per minute, top error messages, DB-unavailable (503) count | error handler + middleware |
| **Saturation — server** | CPU %, load average, memory (system + Node heap/RSS), event-loop lag, disk used % | Node `os`, `process.memoryUsage()`, `perf_hooks.monitorEventLoopDelay`, `fs.statfs` |
| **Saturation — database** | pool in use, active / waiting queries, longest running query, DB size, top 20 queries by total time and by mean time | `pg_stat_activity`, `pg_stat_statements` (Neon supports it), `pg_database_size` |
| **Workload drivers** | uploads per day (count + MB), exports/imports, emails sent/failed, Telegram/Xendit call failures | counters in the existing services |
| **Background work** | each scheduled job: last run, duration, result, next run; reminder loops | `job_runs` + timing in `jobs.service.js` |
| **Operations** | last backup time/size/status, TLS certificate days left, app version / uptime | backup log file, TLS check, `process.uptime()` |

## 4. Options

| Option | What it is | Cost | Effort | Fit |
|---|---|---|---|---|
| **A. Built-in "Monitoring" page** (superadmin) | Collector inside the API + one page in Administrasi with live tiles, 24 h charts, slow queries, jobs, alerts to Telegram | Free | ~3–5 days | ✅ Recommended — no new services, works on one VPS |
| **B. Standard metrics endpoint** | `/api/metrics` in Prometheus format → Grafana Cloud (free tier) or Better Stack | Free tier | +1 day on top of A | ✅ Optional later (professional dashboards, long history) |
| **C. Uptime monitor** | UptimeRobot / Better Stack ping on `/api/health` every 1–5 min, alert by email/Telegram | Free | 15 min | ✅ Do at go-live regardless |
| D. PM2 Plus / Datadog / New Relic | Hosted APM agents | Paid, per host | Low | ❌ Not proportionate yet |

**Recommendation: A + C now, B when a client asks for it.**

## 5. Proposed design (option A)

- **Collector** (`services/monitor.service.js`): request middleware records route group, status and duration into **minute buckets kept in memory for 24 h** (≈ 1 440 small objects). A 1-minute timer samples CPU, memory, event-loop lag and disk. Every 5 minutes one row of aggregates is written to a small `monitor_samples` table (kept 30 days, purged by the daily job) so charts survive restarts.
- **Database insights**: on demand (when the page is open) read `pg_stat_statements` (top queries, normalised — no customer values), `pg_stat_activity` (running queries > 1 s), pool stats and database size.
- **Page** `Administrasi → Monitoring` (superadmin only): status tiles (API, DB, email, Telegram, Xendit, backup, TLS), live charts (requests, p95, errors, CPU, memory, event-loop lag), top slow endpoints, top slow queries, running queries, jobs table, disk/upload growth vs the sizing sheet.
- **Alerts** (Telegram + email to superadmin), with a 15-minute cool-down: API p95 above target for 10 min · 5xx > 2 % for 5 min · CPU > 85 % / memory > 85 % / disk > 80 % · event-loop lag > 200 ms · DB unreachable · a job failed · no backup in 26 h · TLS < 14 days.
- **Security**: superadmin only, audited like other views; query texts come normalised from PostgreSQL; no request bodies, no personal data in metrics.
- **Overhead**: one timer + a few counters per request — well under 1 % CPU.

## 6. What it needs

- One migration: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` and the `monitor_samples` table (DDL only).
- `pm2 install pm2-logrotate` on the VPS (log rotation, T.03.3.12).
- No new npm packages for option A.

## 7. Suggested phases

1. **Core** — collector, health tiles, golden-signal charts, server resources, alerts.
2. **Database & jobs** — slow/running queries, pool, DB size, jobs and backup status.
3. **(Optional)** `/api/metrics` for Grafana, uptime-monitor status embedded.

## 8. Open questions for the owner

1. Who receives alerts — only you (Telegram) or also agency admins for their own data?
2. How long to keep history — 30 days in DSR is the proposal; longer means option B.
3. Should agencies see a small "system status" page (uptime, incidents) — useful for corporate clients?
