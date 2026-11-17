import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { LEGACY_SENSITIVE } from './services/private-files.js';
import { pingDb, startKeepWarm } from './services/db-health.service.js';
import { isTransientDbError } from './db/index.js';
import { assertEncryptionConfigured } from './services/crypto.service.js';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { errorHandler } from './middleware/errorHandler.js';

// Route imports
import carsRoutes from './routes/cars.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import customersRoutes from './routes/customers.routes.js';
import driversRoutes from './routes/drivers.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import maintenanceRoutes from './routes/maintenance.routes.js';
import reviewsRoutes from './routes/reviews.routes.js';
import activityRoutes from './routes/activity.routes.js';
import syncRoutes from './routes/sync.routes.js';
import companiesRoutes from './routes/companies.routes.js';
import financeRoutes from './routes/finance.routes.js';
import journalRoutes from './routes/journal.routes.js';
import accountsRoutes from './routes/accounts.routes.js';
import usersRoutes from './routes/users.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Reverse Proxy ───────────────────────────────────────────────────
// Behind nginx, req.ip is 127.0.0.1 for every request unless we trust
// the X-Forwarded-For header. Without this, express-rate-limit buckets
// every client into one shared limit, letting any user lock everyone
// else out. "1" means one proxy hop (nginx). No-op in dev where there
// is no proxy in front.
app.set('trust proxy', 1);

// Request timing for the latency work (Server-Timing header, slow log, /api/health/perf).
import { perfMiddleware, perfReport } from './services/perf.service.js';
app.use(perfMiddleware);

// ─── Security ────────────────────────────────────────────────────────
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

// Auth rate limits — split by purpose.
//  • credentialLimiter: endpoints that take a password / send email
//    (sign-in, sign-up, password reset, verification, register-extended).
//    Only FAILED attempts count, so a user who logs in fine is never blocked;
//    this still stops password guessing.
//  • sessionLimiter: everything else under /api/auth (get-session runs on
//    every page load — and on every dev hot-reload). It used to share the
//    20/min credential budget AND was counted twice (two middlewares), which
//    logged users out mid-session with "Too many auth attempts".
const CREDENTIAL_PATHS = /^\/api\/auth\/(sign-in|sign-up|forget-password|request-password-reset|reset-password|send-verification-email|verify-email|change-password|register-extended|two-factor\/verify)/;
const credentialLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth attempts, please try again later.' },
});
const sessionLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
// ONE limiter per request (no double counting): pick by path.
const authLimiter = (req, res, next) =>
    (CREDENTIAL_PATHS.test(req.originalUrl) ? credentialLimiter : sessionLimiter)(req, res, next);

// ─── CORS ────────────────────────────────────────────────────────────
// Localhost entries are dev-only — in production the only allowed origin
// is whatever CORS_ORIGIN points at, so a developer machine cannot send
// cookies to the prod API. CORS_ORIGIN may itself be comma-separated to
// allow more than one prod origin (e.g. app.dsrappai.com,admin.dsrappai.com).
const corsOriginEnv = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const devOrigins = IS_PROD
    ? []
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
const allowedOrigins = [...corsOriginEnv, ...devOrigins];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Logging ─────────────────────────────────────────────────────────
if (process.env.DEBUG === 'true') {
    app.use(morgan('dev'));
}

// ─── Body Parsing ────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ─── Data-leak hardening ─────────────────────────────────────────────
// API responses carry personal data: never cache them (browser, proxy, CDN)
// and never let search engines index them.
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
});
// AES-256 key: required in production (throws → PM2 shows the reason).
assertEncryptionConfigured();
app.use(express.urlencoded({ extended: true }));

// ─── Static Files (uploads) ─────────────────────────────────────────
// Public uploads = car images only. Legacy driver SIM/KTP/photo
// (driver-*) and finance documents (finance/*) are personal/confidential and
// are only reachable through the authenticated document endpoints.
app.use('/uploads', (req, res, next) => { let p = req.path; try { p = decodeURIComponent(p); } catch { return res.status(400).end(); } return LEGACY_SENSITIVE.test(p) ? res.status(404).end() : next(); },
    express.static(path.join(__dirname, '../uploads'), { dotfiles: 'deny', index: false, setHeaders: (r) => r.setHeader('X-Content-Type-Options', 'nosniff') }));

// ─── Custom auth extensions — mounted BEFORE the Better Auth catch-all
//     so /api/auth/register-extended reaches our handler instead of being
//     intercepted by Better Auth's wildcard. ────────────────────────────
import authExtraRoutes from './routes/auth-extra.routes.js';
// Rate limit applied ONCE here for every /api/auth/* request (custom routes
// and Better Auth alike) — previously it ran on both mounts and counted twice.
app.use('/api/auth', authLimiter);
app.use('/api/auth', authExtraRoutes);

// ─── Session lock / idle timeout on the session probe (owner 2026-11-13) ─
// A page load after 15 idle minutes (or after a take-over elsewhere) must not
// look logged in: answer 401 with the reason instead of the stale session.
import { sessionService } from './services/session.service.js';
import { fromNodeHeaders } from 'better-auth/node';
app.get('/api/auth/get-session', async (req, res, next) => {
    try {
        const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (!s) {
            const end = await sessionService.endedReason(req.headers.cookie).catch(() => null);
            return end ? res.status(401).json(sessionService.endedBody(end)) : next();
        }
        const g = await sessionService.guard(req, s);
        return g.ok ? next() : res.status(401).json(sessionService.endedBody({ reason: 'expired' }));
    } catch { return next(); }
});

// ─── Better Auth ─────────────────────────────────────────────────────
app.all('/api/auth/*splat', toNodeHandler(auth));
import sessionRoutes from './routes/session.routes.js';
app.use('/api/session', apiLimiter, sessionRoutes);

// ─── API Routes ──────────────────────────────────────────────────────
app.use('/api/cars', apiLimiter, carsRoutes);
app.use('/api/orders', apiLimiter, ordersRoutes);
app.use('/api/customers', apiLimiter, customersRoutes);
app.use('/api/drivers', apiLimiter, driversRoutes);
app.use('/api/schedule', apiLimiter, scheduleRoutes);
app.use('/api/dashboard', apiLimiter, dashboardRoutes);
app.use('/api/analytics', apiLimiter, analyticsRoutes);
app.use('/api/maintenance', apiLimiter, maintenanceRoutes);
app.use('/api/reviews', apiLimiter, reviewsRoutes);
app.use('/api/activity', apiLimiter, activityRoutes);
app.use('/api/sync', apiLimiter, syncRoutes);
app.use('/api/companies', apiLimiter, companiesRoutes);
app.use('/api/finance', apiLimiter, financeRoutes);
app.use('/api/journal', apiLimiter, journalRoutes);
app.use('/api/accounts', apiLimiter, accountsRoutes);
app.use('/api/users', apiLimiter, usersRoutes);
import accessRequestsRoutes from './routes/access-requests.routes.js';
app.use('/api/access-requests', apiLimiter, accessRequestsRoutes);
import legalRoutes from './routes/legal.routes.js';
app.use('/api/orgs/legal', apiLimiter, legalRoutes); // before /api/orgs (its /:id routes)
import orgsRoutes from './routes/orgs.routes.js';
app.use('/api/orgs', apiLimiter, orgsRoutes);
import invoicesRoutes from './routes/invoices.routes.js';
import fakturRoutes from './routes/faktur.routes.js';
app.use('/api/invoices', apiLimiter, invoicesRoutes);
app.use('/api/faktur', apiLimiter, fakturRoutes);
import booksRoutes from './routes/books.routes.js';
import pricingRoutes from './routes/pricing.routes.js';
import corporateRoutes from './routes/corporate.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import driverAppRoutes from './routes/driver-app.routes.js';
import marketplaceRoutes from './routes/marketplace.routes.js';
import contractsRoutes from './routes/contracts.routes.js';
import fleetCareRoutes from './routes/fleet-care.routes.js';
import opsRoutes from './routes/ops.routes.js';
import { startJobs } from './services/jobs.service.js';
import { startClaimReminders } from './services/marketplace.service.js';
app.use('/api/books', apiLimiter, booksRoutes);
app.use('/api/pricing', apiLimiter, pricingRoutes);
app.use('/api/corporate', apiLimiter, corporateRoutes);
app.use('/api/payments', paymentsRoutes);   // webhook must not be rate-limited per IP
app.use('/api/driver-app', apiLimiter, driverAppRoutes);
app.use('/api/marketplace', apiLimiter, marketplaceRoutes);
app.use('/api/contracts', apiLimiter, contractsRoutes);
app.use('/api/fleet-care', apiLimiter, fleetCareRoutes);
app.use('/api/ops', apiLimiter, opsRoutes);
// Telegram + future channels (test ping, status). Admin-only inside the router.
import notificationsRoutes from './routes/notifications.routes.js';
app.use('/api/notifications', apiLimiter, notificationsRoutes);
// In-app notifications per user (bell + dashboard "Perlu tindakan").
import inboxRoutes from './routes/inbox.routes.js';
app.use('/api/inbox', apiLimiter, inboxRoutes);

// ─── Health Check ────────────────────────────────────────────────────
// Liveness + DB check. 200 when the DB answers, 503 otherwise — monitors
// (UptimeRobot, Better Stack) alert on the status code. No secrets exposed.
let lastHealth = { at: 0, value: null };   // public endpoint → cache 10 s
// Latency report per route (superadmin): p50 / p95 / max ms and queries per request.
import { requireAuth as perfAuth, requireSuperAdmin as perfSuper } from './middleware/auth.js';
app.get('/api/health/perf', perfAuth, perfSuper, (req, res) => res.json(perfReport({ reset: req.query.reset === '1' })));

app.get('/api/health', async (req, res) => {
    if (Date.now() - lastHealth.at > 10_000) lastHealth = { at: Date.now(), value: await pingDb() };
    const dbCheck = lastHealth.value;
    res.status(dbCheck.ok ? 200 : 503).json({
        status: dbCheck.ok ? 'ok' : 'degraded',
        db: dbCheck,
        uptimeSec: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});

// ─── Error Handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`🚗 DSR Solution API running on http://localhost:${PORT}`);
    console.log(`📋 Auth:       http://localhost:${PORT}/api/auth`);
    console.log(`🔧 Debug mode: ${process.env.DEBUG === 'true' ? 'ON' : 'OFF'}`);
    startKeepWarm();
    startClaimReminders();
    startJobs();

});

// ─── Crash safety net ────────────────────────────────────────────────
// A dropped Neon connection (ECONNRESET etc.) inside a background job or an
// idle pooled socket must not take the whole API down — log it and carry on
// (the next request/tick reconnects). Anything else is a real bug: log and
// exit so PM2 restarts a clean process.
function onFatal(kind) {
    return (err) => {
        const code = err?.code || err?.cause?.code || '';
        const msg = String(err?.message || err || '').split('\n')[0];
        if (isTransientDbError(err)) {
            console.warn(`[db] ${kind} transient connection error ignored (${code}): ${msg}`);
            return;
        }
        console.error(`[fatal] ${kind}:`, err);
        process.exit(1);
    };
}
process.on('unhandledRejection', onFatal('unhandledRejection'));
process.on('uncaughtException', onFatal('uncaughtException'));

// ─── Graceful Shutdown ───────────────────────────────────────────────
// PM2 reloads send SIGTERM. Without this, in-flight requests get killed
// mid-write. We close the server (stops accepting new connections,
// drains current ones), give it 10 seconds, then hard-exit. SIGINT
// covers Ctrl+C in local dev so the same shutdown path runs everywhere.
['SIGTERM', 'SIGINT'].forEach((sig) => {
    process.on(sig, () => {
        console.log(`[shutdown] ${sig} received, draining…`);
        server.close((err) => {
            if (err) {
                console.error('[shutdown] server.close error:', err.message);
                process.exit(1);
            }
            console.log('[shutdown] all connections closed, bye.');
            process.exit(0);
        });
        // Safety net: if a long-running request refuses to finish,
        // force-exit after 10s so PM2 can bring the new process up.
        setTimeout(() => {
            console.warn('[shutdown] drain timeout, forcing exit.');
            process.exit(1);
        }, 10_000).unref();
    });
});
