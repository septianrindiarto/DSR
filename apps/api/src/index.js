import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import { runRekapSync, REKAP_PATH } from './services/sync.service.js';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

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

const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: { error: 'Too many auth attempts, please try again later.' },
});

// ─── CORS ────────────────────────────────────────────────────────────
const allowedOrigins = [
    process.env.CORS_ORIGIN || 'http://localhost:5173',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
].filter(Boolean);

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
app.use(express.urlencoded({ extended: true }));

// ─── Static Files (uploads) ─────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Better Auth ─────────────────────────────────────────────────────
app.all('/api/auth/*splat', authLimiter, toNodeHandler(auth));

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

// ─── Health Check ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error Handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚗 DSR Solution API running on http://localhost:${PORT}`);
    console.log(`📋 Auth:       http://localhost:${PORT}/api/auth`);
    console.log(`🔧 Debug mode: ${process.env.DEBUG === 'true' ? 'ON' : 'OFF'}`);

    // ─── Periodic Rekap → DB sync ────────────────────────────────────
    // Watches the local "Rekap 2026.xlsx" (refreshed by the python script
    // in DSR Invoice Automation/) and re-runs the upsert whenever the
    // file's mtime changes. Default interval is every 10 minutes — override
    // with REKAP_SYNC_INTERVAL_MS in .env. Set REKAP_SYNC_DISABLED=true to skip.
    if (process.env.REKAP_SYNC_DISABLED !== 'true') {
        const intervalMs = Number(process.env.REKAP_SYNC_INTERVAL_MS) || 10 * 60 * 1000;
        let lastMtime = null;
        const tick = async () => {
            try {
                if (!fs.existsSync(REKAP_PATH)) return;
                const stat = fs.statSync(REKAP_PATH);
                if (lastMtime && stat.mtime.getTime() === lastMtime) return; // no change
                lastMtime = stat.mtime.getTime();
                console.log(`[scheduler] Rekap mtime changed → running sync (${REKAP_PATH})`);
                const summary = await runRekapSync({ trigger: 'scheduled' });
                console.log(`[scheduler] sync ${summary.status} — orders +${summary.ordersInserted}/~${summary.ordersUpdated}, customers +${summary.customersInserted}/~${summary.customersUpdated}, ${summary.durationMs}ms`);
            } catch (err) {
                console.error('[scheduler] sync error:', err.message);
            }
        };
        // Kick off shortly after boot so the server doesn't start blocked on a sync
        setTimeout(tick, 5_000);
        setInterval(tick, intervalMs);
        console.log(`⏱️  Rekap auto-sync: every ${Math.round(intervalMs / 60000)}m (file=${REKAP_PATH})`);
    } else {
        console.log('⏱️  Rekap auto-sync: DISABLED via REKAP_SYNC_DISABLED');
    }
});