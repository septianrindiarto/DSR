import express from 'express';
import { db } from '../db/index.js';
import { orders, customers, cars, drivers } from '../db/schema.js';
import { desc, eq, and, sql, inArray } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { buildScopeConditions } from '../middleware/scope.js';
import { invoiceService } from '../services/invoice.service.js';
import { requirePerm } from '../middleware/permission.js';
import { decryptDriver } from '../services/driver.service.js';

const router = express.Router();

// Rekap.xlsx → DB sync (POST /rekap, /rekap/upload, GET /logs, /status) was
// removed. Only the invoice-queue endpoints below remain.

// ─── GET /api/sync/orders/needs-invoice — list orders ready to invoice ──────
// "Ready" = status in (completed, active) AND invoice_number IS NULL.
router.get('/orders/needs-invoice', requireAuth, requirePerm('documents', 'view'), async (req, res, next) => {
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
    res.json(rows.map(r => ({ ...r.order, customer: r.customer, driver: decryptDriver(r.driver), car: r.car })));
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
router.put('/orders/:id/invoice', requireAuth, requirePerm('documents', 'edit'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { invoiceNumber, invoiceLetterNumber, invoiceSentDate, discount, taxProfile } = req.body || {};
    const allowedIds = await scopedOrderIds(req.user, [id]);
    if (!allowedIds.length) return res.status(404).json({ error: 'Order tidak ditemukan.' });
    const results = await invoiceService.issueForOrders({
      items: [{ id, invoiceNumber: invoiceNumber || fallbackInvoiceNo(id) }],
      sentDate: invoiceSentDate || null,
      letterNumber: invoiceLetterNumber || null,
      user: req.user,
      allowedIds,
      discount: discount ?? undefined,          // Rp, whole invoice (Dokumen)
      taxProfile: taxProfile || undefined,      // override for this invoice (tax-core.js)
    });
    res.json({ ok: true, results });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/sync/orders/bulk-invoice — mark multiple orders as invoiced ───
// Rows sharing an invoiceNumber become ONE invoice (group invoice).
router.post('/orders/bulk-invoice', requireAuth, requirePerm('documents', 'edit'), async (req, res, next) => {
  try {
    const { ids, invoiceSentDate, invoiceLetterNumber, discount, taxProfile } = req.body || {};
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
      discount: discount ?? undefined,          // Rp, whole invoice (Dokumen)
      taxProfile: taxProfile || undefined,      // override for this invoice (tax-core.js)
    });
    const updated = results.reduce((n, r) => n + r.orderIds.length, 0);
    res.json({ ok: true, updated, results });
  } catch (err) {
    next(err);
  }
});

export default router;
