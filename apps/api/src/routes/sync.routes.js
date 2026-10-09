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
import { invoiceService } from '../services/invoice.service.js';

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
      organizationId:    orders.organizationId,
      isDemo:            orders.isDemo,
      createdBy:         orders.createdBy,
      claimedByAgencyId: orders.claimedByAgencyId,
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
        // Needs an invoice = never invoiced, OR linked to an invoice that was
        // re-issued and not sent yet (number kept, status Belum Dikirim).
        sql`(${orders.invoiceNumber} IS NULL OR (${orders.invoiceId} IS NOT NULL AND ${orders.invoiceSentDate} IS NULL))`,
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

// Order ids (from `ids`) the caller may invoice — own + claimed orders, same
// visibility as Rekap Order.
async function scopedOrderIds(user, ids) {
  if (!ids.length) return [];
  const scopeConds = buildScopeConditions(user, {
    organizationId:    orders.organizationId,
    isDemo:            orders.isDemo,
    createdBy:         orders.createdBy,
    claimedByAgencyId: orders.claimedByAgencyId,
  });
  const rows = await db.select({ id: orders.id }).from(orders)
    .where(and(inArray(orders.id, ids), ...scopeConds));
  return rows.map(r => r.id);
}

// Fallback number when the caller sends none (kept from the legacy flow).
function fallbackInvoiceNo(id) {
  const now = new Date();
  return `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(id).padStart(4, '0')}`;
}

// ─── PUT /api/sync/orders/:id/invoice — record that an invoice was generated ─
// Creates/updates the invoice record (invoices table) and links the order.
// Due date is computed from the client's payment term — any due date sent by
// the client is ignored.
router.put('/orders/:id/invoice', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { invoiceNumber, invoiceLetterNumber, invoiceSentDate } = req.body || {};
    const allowedIds = await scopedOrderIds(req.user, [id]);
    if (!allowedIds.length) return res.status(404).json({ error: 'Order tidak ditemukan.' });
    const results = await invoiceService.issueForOrders({
      items: [{ id, invoiceNumber: invoiceNumber || fallbackInvoiceNo(id) }],
      sentDate: invoiceSentDate || null,
      letterNumber: invoiceLetterNumber || null,
      user: req.user,
      allowedIds,
    });
    res.json({ ok: true, results });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sync/orders/bulk-invoice — mark multiple orders as invoiced ───
// Rows sharing an invoiceNumber become ONE invoice (group invoice).
router.post('/orders/bulk-invoice', requireAuth, async (req, res, next) => {
  try {
    const { ids, invoiceSentDate, invoiceLetterNumber } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids diperlukan.' });
    }
    const items = ids.map((item) => {
      const id = typeof item === 'object' ? Number(item.id) : Number(item);
      const invoiceNumber = (typeof item === 'object' ? item.invoiceNumber : null) || fallbackInvoiceNo(id);
      return { id, invoiceNumber };
    });
    const allowedIds = await scopedOrderIds(req.user, items.map(i => i.id));
    const results = await invoiceService.issueForOrders({
      items,
      sentDate: invoiceSentDate || null,
      letterNumber: invoiceLetterNumber || null,
      user: req.user,
      allowedIds,
    });
    const updated = results.reduce((n, r) => n + r.orderIds.length, 0);
    res.json({ ok: true, updated, results });
  } catch (err) {
    next(err);
  }
});

export default router;
