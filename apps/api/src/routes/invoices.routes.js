// ─── /api/invoices — invoice timeline + payment terms (D.2) ──────────────────
// Agency admins (and superadmin) only. Literal paths are registered before
// /:id so they are not captured as ids.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { orders } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { invoiceService } from '../services/invoice.service.js';

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
router.get('/terms', requireAuth, requireAgencyAdmin, async (req, res, next) => {
    try { res.json(await invoiceService.getTerms(req.user)); } catch (e) { next(e); }
});

router.put('/terms/default', requireAuth, requireAgencyAdmin, validate(termSchema), activityLogger('update', 'payment_terms'), async (req, res, next) => {
    try { res.json(await invoiceService.setDefaultTerm(req.user, req.body.days)); } catch (e) { next(e); }
});

router.put('/terms/company/:orgId', requireAuth, requireAgencyAdmin, validate(termSchema), activityLogger('update', 'payment_terms'), async (req, res, next) => {
    try { res.json(await invoiceService.setCompanyTerm(req.user, req.params.orgId, req.body.days)); } catch (e) { next(e); }
});

// ─── Invoice by order (used by the Rekap edit modal) ─────────────────────────
router.get('/by-order/:orderId', requireAuth, requireAgencyAdmin, async (req, res, next) => {
    try {
        const [o] = await db.select({ invoiceId: orders.invoiceId }).from(orders)
            .where(eq(orders.id, Number(req.params.orderId))).limit(1);
        if (!o?.invoiceId) return res.json(null);
        const inv = await loadOwned(req, res, o.invoiceId);
        if (inv) res.json(inv);
    } catch (e) { next(e); }
});

// ─── Single invoice ────────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireAgencyAdmin, async (req, res, next) => {
    try { const inv = await loadOwned(req, res); if (inv) res.json(inv); } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requireAgencyAdmin, validate(updateSchema), activityLogger('update', 'invoices'), async (req, res, next) => {
    try {
        const inv = await loadOwned(req, res); if (!inv) return;
        await invoiceService.update(inv.id, req.body);
        res.json(await invoiceService.getById(inv.id));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.post('/:id/reissue', requireAuth, requireAgencyAdmin, validate(reissueSchema), activityLogger('create', 'invoices'), async (req, res, next) => {
    try {
        const inv = await loadOwned(req, res); if (!inv) return;
        const fresh = await invoiceService.cancelAndReissue(inv.id, { reason: req.body.reason, user: req.user });
        res.json(await invoiceService.getById(fresh.id));
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

export default router;
