import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index.js';
import { syncLogs, orders, customers, cars, drivers } from '../db/schema.js';
import { desc, eq, isNull, isNotNull, and, sql, inArray } from 'drizzle-orm';
import { runRekapSync, REKAP_PATH } from '../services/sync.service.js';
import { requireAuth } from '../middleware/auth.js';
import { buildScopeConditions } from '../middleware/scope.js';

const router = express.Router();

// ─── File upload — for "Sync from uploaded Rekap.xlsx" flow ──────────────────
const uploadDir = path.join(process.cwd(), 'uploads', 'rekap');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith('.xlsx');
    cb(ok ? null : new Error('Only .xlsx files allowed'), ok);
  },
});

// ─── POST /api/sync/rekap — manual trigger using the configured local path ──
router.post('/rekap', requireAuth, async (req, res, next) => {
  try {
    const summary = await runRekapSync({
      trigger: 'manual',
      userId: req.user?.id,
    });
    res.json({ ok: summary.status !== 'failed', summary });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sync/rekap/upload — upload xlsx and run sync against it ──────
router.post('/rekap/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const summary = await runRekapSync({
      filePath: req.file.path,
      trigger: 'upload',
      userId: req.user?.id,
    });
    // Best-effort cleanup — keep the file only if sync failed (so user can retry / inspect)
    if (summary.status === 'success') {
      fs.unlink(req.file.path, () => { /* ignore */ });
    }
    res.json({ ok: summary.status !== 'failed', summary });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sync/logs — recent sync history ───────────────────────────────
router.get('/logs', requireAuth, async (_req, res, next) => {
  try {
    const rows = await db.select().from(syncLogs).orderBy(desc(syncLogs.createdAt)).limit(50);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sync/status — quick health snapshot ───────────────────────────
router.get('/status', requireAuth, async (_req, res, next) => {
  try {
    let fileExists = false;
    let fileSize = 0;
    let fileMtime = null;
    try {
      const st = fs.statSync(REKAP_PATH);
      fileExists = true;
      fileSize = st.size;
      fileMtime = st.mtime;
    } catch { /* file missing — fileExists stays false */ }

    const [last] = await db.select().from(syncLogs).orderBy(desc(syncLogs.createdAt)).limit(1);

    // Counts by source for a quick health snapshot
    const [counts] = await db.execute(sql`
      SELECT
        COUNT(*)::int                                         AS total_orders,
        COUNT(*) FILTER (WHERE source_origin = 'web')::int    AS web_orders,
        COUNT(*) FILTER (WHERE source_origin = 'rekap_xlsx')::int AS rekap_orders,
        COUNT(*) FILTER (WHERE invoice_number IS NOT NULL)::int   AS with_invoice,
        COUNT(*) FILTER (WHERE invoice_number IS NULL AND status = 'completed')::int AS pending_invoice
      FROM orders
    `).then(r => r.rows ? r.rows : r);

    res.json({
      file: { exists: fileExists, path: REKAP_PATH, size: fileSize, mtime: fileMtime },
      lastSync: last || null,
      counts,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/sync/orders/needs-invoice — list orders ready to invoice ──────
// "Ready" = status in (completed, active) AND invoice_number IS NULL.
router.get('/orders/needs-invoice', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const scopeConds = buildScopeConditions(req.user, {
      organizationId: orders.organizationId,
      isDemo:         orders.isDemo,
      createdBy:      orders.createdBy,
    });
    const rows = await db
      .select({
        order: orders,
        customer: customers,
        driver: drivers,
        car: cars,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(drivers, eq(orders.driverId, drivers.id))
      .leftJoin(cars, eq(orders.carId, cars.id))
      .where(and(
        isNull(orders.invoiceNumber),
        sql`${orders.status} IN ('completed', 'active', 'confirmed')`,
        ...scopeConds
      ))
      .orderBy(desc(orders.pickupDate))
      .limit(limit);
    res.json(rows.map(r => ({ ...r.order, customer: r.customer, driver: r.driver, car: r.car })));
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/sync/orders/:id/invoice — record that an invoice was generated ─
router.put('/orders/:id/invoice', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { invoiceNumber, invoiceLetterNumber, invoiceSentDate, invoiceDueDate, invoicePaymentStatus } = req.body || {};
    const now2 = new Date();
    const datePfx2 = `${now2.getFullYear()}${String(now2.getMonth() + 1).padStart(2, '0')}`;
    const patch = { updatedAt: now2 };
    // Always set invoiceNumber so the order exits the "needs invoice" filter
    patch.invoiceNumber = invoiceNumber || `INV-${datePfx2}-${String(id).padStart(4, '0')}`;
    if (invoiceLetterNumber) patch.invoiceLetterNumber = invoiceLetterNumber;
    if (invoiceSentDate) patch.invoiceSentDate = new Date(invoiceSentDate);
    if (invoiceDueDate) patch.invoiceDueDate = new Date(invoiceDueDate);
    if (invoicePaymentStatus) patch.invoicePaymentStatus = invoicePaymentStatus;
    const scopeConds = buildScopeConditions(req.user, {
      organizationId: orders.organizationId,
      isDemo:         orders.isDemo,
      createdBy:      orders.createdBy,
    });
    await db.update(orders).set(patch).where(and(eq(orders.id, id), ...scopeConds));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sync/orders/bulk-invoice — mark multiple orders as invoiced ───
router.post('/orders/bulk-invoice', requireAuth, async (req, res, next) => {
  try {
    const { ids, invoiceSentDate, invoicePaymentStatus } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids diperlukan.' });
    }
    const patch = { updatedAt: new Date() };
    if (invoiceSentDate) patch.invoiceSentDate = new Date(invoiceSentDate);
    patch.invoicePaymentStatus = invoicePaymentStatus || 'Pending';

    const scopeConds = buildScopeConditions(req.user, {
      organizationId: orders.organizationId,
      isDemo:         orders.isDemo,
      createdBy:      orders.createdBy,
    });

    const now = new Date();
    const datePfx = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const results = [];
    for (let i = 0; i < ids.length; i++) {
      const item = ids[i];
      const id = typeof item === 'object' ? Number(item.id) : Number(item);
      const invNo = (typeof item === 'object' ? item.invoiceNumber : null)
        || `INV-${datePfx}-${String(id).padStart(4, '0')}`;
      const rowPatch = { ...patch, invoiceNumber: invNo };
      // Scope guard: only update orders the current user owns
      await db.update(orders).set(rowPatch).where(and(eq(orders.id, id), ...scopeConds));
      results.push({ id, invoiceNumber: invNo });
    }
    res.json({ ok: true, updated: results.length, results });
  } catch (err) {
    next(err);
  }
});

export default router;
