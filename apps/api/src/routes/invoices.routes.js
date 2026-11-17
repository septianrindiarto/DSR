// ─── /api/invoices — invoice timeline + payment terms (D.2) ──────────────────
// Agency admins (and superadmin) only. Literal paths are registered before
// /:id so they are not captured as ids.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { orders, organizations } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { companyScope } from '../services/company.service.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { invoiceService } from '../services/invoice.service.js';
import { booksAutoPost } from '../services/books-autopost.service.js';
import { paymentService } from '../services/payment.service.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { getAccess } from '../services/access.service.js';
import { isOrgAdmin } from '../services/notifications.service.js';

const router = Router();

function requireAgencyAdmin(req, res, next) {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (u.role === 'superadmin') return next();
    if (u.role === 'admin' && u.accountType === 'agency') return next();
    return res.status(403).json({ error: 'Hanya admin agency yang dapat mengelola invoice.' });
}

// Load an invoice and confirm it belongs to the caller's agency.
async function loadOwned(req, res, id = req.params.id) {
    const inv = await invoiceService.getById(id);
    if (!inv) { res.status(404).json({ error: 'Invoice tidak ditemukan.' }); return null; }
    if (req.user.role !== 'superadmin') {
        const agencyId = await invoiceService.agencyIdFor(req.user);
        if (inv.organizationId !== agencyId) { res.status(404).json({ error: 'Invoice tidak ditemukan.' }); return null; }
    }
    return inv;
}

const dateOrNull = z.union([z.string(), z.null()]).optional();
const updateSchema = z.object({
    sentDate: dateOrNull,
    paidDate: dateOrNull,
    letterNumber: z.string().max(50).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
});
const termSchema = z.object({ days: z.number().int().min(0).max(365).nullable() });
const reissueSchema = z.object({ reason: z.string().max(500).optional().nullable() });

// ─── Payment terms ─────────────────────────────────────────────────────────
router.get('/terms', requireAuth, requireAnyPerm('settings.view', 'documents.view'), async (req, res, next) => {
    try { res.json(await invoiceService.getTerms(req.user)); } catch (e) { next(e); }
});

router.put('/terms/default', requireAuth, requirePerm('settings', 'edit'), validate(termSchema), activityLogger('update', 'payment_terms'), async (req, res, next) => {
    try { res.json(await invoiceService.setDefaultTerm(req.user, req.body.days)); } catch (e) { next(e); }
});

// ─── Tax profile (agency default + per client) ─────────────────────────────
const taxSchema = z.object({
    profile: z.object({
        ppn: z.object({ enabled: z.boolean(), rate: z.number().min(0).max(100).optional(), base: z.enum(['nilai_lain', 'full']).optional() }).optional(),
        pph: z.object({ mode: z.enum(['none', 'withheld', 'added']), rate: z.number().min(0).max(100).optional(), label: z.string().max(40).optional() }).optional(),
    }).nullable(),
});
router.get('/tax', requireAuth, requireAnyPerm('settings.view', 'documents.view'), async (req, res, next) => {
    try { res.json(await invoiceService.getTaxSettings(req.user)); } catch (e) { next(e); }
});
router.get('/tax/resolve', requireAuth, requireAnyPerm('settings.view', 'documents.view'), async (req, res, next) => {
    try { res.json(await invoiceService.resolvedTaxProfile(req.user, req.query.clientOrgId)); } catch (e) { next(e); }
});
router.put('/tax/default', requireAuth, requirePerm('settings', 'edit'), validate(taxSchema), activityLogger('update', 'tax_profile'), async (req, res, next) => {
    try { res.json(await invoiceService.setTaxProfile(req.user, null, req.body.profile || {})); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
router.put('/tax/company/:orgId', requireAuth, requirePerm('settings', 'edit'), validate(taxSchema), activityLogger('update', 'tax_profile'), async (req, res, next) => {
    try { res.json(await invoiceService.setTaxProfile(req.user, req.params.orgId, req.body.profile)); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.put('/terms/company/:orgId', requireAuth, requirePerm('settings', 'edit'), validate(termSchema), activityLogger('update', 'payment_terms'), async (req, res, next) => {
    try { res.json(await invoiceService.setCompanyTerm(req.user, req.params.orgId, req.body.days)); } catch (e) { next(e); }
});

// ─── Monthly consolidated invoice per client company ──────────────────────
async function monthlyClientInScope(req, res, next) {
    try {
        const id = Number(req.query.clientOrgId || req.body?.clientOrgId);
        if (!id) return res.status(400).json({ error: 'clientOrgId wajib.' });
        const [row] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, id), ...companyScope(req.user))).limit(1);
        if (!row) return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        next();
    } catch (e) { next(e); }
}
const monthlySchema = z.object({
    clientOrgId: z.number().int(), month: z.string().regex(/^\d{4}-\d{2}$/),
    orderIds: z.array(z.number().int()).max(2000).optional(),
    invoiceNumber: z.string().max(50).nullable().optional(), sentDate: z.string().nullable().optional(),
});
router.get('/monthly/preview', requireAuth, requirePerm('documents', 'edit'), monthlyClientInScope, async (req, res, next) => {
    try { res.json(await invoiceService.monthlyPreview(req.user, { clientOrgId: req.query.clientOrgId, month: req.query.month })); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
router.post('/monthly', requireAuth, requirePerm('documents', 'edit'), validate(monthlySchema), monthlyClientInScope, activityLogger('create', 'invoices'), async (req, res, next) => {
    try { res.status(201).json(await invoiceService.issueMonthly(req.user, req.body)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// ─── Kas/Bank accounts a payment can be received into (Books auto-posting) ──
router.get('/cash-accounts', requireAuth, requireAnyPerm('documents.edit', 'orders.edit'), async (req, res, next) => {
    try {
        const agencyId = await invoiceService.agencyIdFor(req.user);
        if (!agencyId) return res.json({ accounts: [], defaultId: null });
        const acc = await booksAutoPost.autoAccounts(agencyId);
        res.json({ accounts: acc.cashAccounts, defaultId: acc.defaultCash, booksReady: acc.ok });
    } catch (e) { next(e); }
});

// ─── Invoice by order (used by the Rekap edit modal) ─────────────────────────
router.get('/by-order/:orderId', requireAuth, requireAnyPerm('documents.view', 'orders.edit'), async (req, res, next) => {
    try {
        const [o] = await db.select({ invoiceId: orders.invoiceId }).from(orders)
            .where(eq(orders.id, Number(req.params.orderId))).limit(1);
        if (!o?.invoiceId) return res.json(null);
        const inv = await loadOwned(req, res, o.invoiceId);
        if (inv) res.json(inv);
    } catch (e) { next(e); }
});

// ─── Single invoice ────────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireAnyPerm('documents.view', 'orders.edit'), async (req, res, next) => {
    try { const inv = await loadOwned(req, res); if (inv) res.json(inv); } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requirePerm('documents', 'edit'), validate(updateSchema), activityLogger('update', 'invoices'), async (req, res, next) => {
    try {
        const inv = await loadOwned(req, res); if (!inv) return;
        await invoiceService.update(inv.id, req.body);
        res.json(await invoiceService.getById(inv.id));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// ─── Payments (partial payments) ───────────────────────────────────────────
const paymentSchema = z.object({
    amount: z.union([z.number(), z.string()]),
    paidDate: z.string(),
    isFinal: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
    accountId: z.number().int().nullable().optional(),   // Kas/Bank receiving it (Books)
    kind: z.enum(['cash', 'pph23']).optional(),            // pph23 = bukti potong from the client
    withholdingRef: z.string().max(80).nullable().optional(),
});

router.post('/:id/payments', requireAuth, requirePerm('documents', 'edit'), validate(paymentSchema), activityLogger('create', 'invoice_payments'), async (req, res, next) => {
    try {
        const inv = await loadOwned(req, res); if (!inv) return;
        await invoiceService.addPayment(inv.id, req.body, req.user);
        res.json(await invoiceService.getById(inv.id));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.delete('/:id/payments/:paymentId', requireAuth, requirePerm('documents', 'edit'), activityLogger('delete', 'invoice_payments'), async (req, res, next) => {
    try {
        const inv = await loadOwned(req, res); if (!inv) return;
        await invoiceService.deletePayment(inv.id, req.params.paymentId, req.user);
        res.json(await invoiceService.getById(inv.id));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// Cancel (owner 2026-11-13): agency admin only; unpaid and not in a TERBIT faktur.
router.post('/:id/cancel', requireAuth, requirePerm('documents', 'edit'), validate(z.object({ reason: z.string().min(1).max(300) })), activityLogger('update', 'invoices'), async (req, res, next) => {
    try {
        const access = await getAccess(req.user.id);
        if (req.user.role !== 'superadmin' && !(access?.accountType === 'agency' && isOrgAdmin(req.user, access))) {
            return res.status(403).json({ error: 'Hanya admin agency yang bisa membatalkan invoice.' });
        }
        const inv = await loadOwned(req, res); if (!inv) return;
        res.json(await invoiceService.cancelInvoice(inv.id, { reason: req.body.reason, user: req.user }));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.post('/:id/reissue', requireAuth, requirePerm('documents', 'edit'), validate(reissueSchema), activityLogger('create', 'invoices'), async (req, res, next) => {
    try {
        const inv = await loadOwned(req, res); if (!inv) return;
        const fresh = await invoiceService.cancelAndReissue(inv.id, { reason: req.body.reason, user: req.user });
        res.json(await invoiceService.getById(fresh.id));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// ─── Online payment links (Xendit) ─────────────────────────────────────────
router.get('/:id/payment-links', requireAuth, requireAnyPerm('documents.view', 'orders.edit'), async (req, res, next) => {
    try { const inv = await loadOwned(req, res); if (!inv) return; res.json(await paymentService.listForInvoice(inv.id)); } catch (e) { next(e); }
});
router.post('/:id/payment-link', requireAuth, requirePerm('documents', 'edit'), activityLogger('create', 'payment_links'), async (req, res, next) => {
    try {
        const inv = await loadOwned(req, res); if (!inv) return;
        res.status(201).json(await paymentService.createLink(inv.id, { user: req.user, payerEmail: req.body?.payerEmail || null }));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

export default router;
