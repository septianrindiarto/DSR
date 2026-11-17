// ─── /api/payments — online payment (Xendit) ────────────────────────────────
//   POST /xendit/webhook        PUBLIC — Xendit callback (x-callback-token)
//   GET  /status                agency/client: is online payment enabled for my agency?
//   POST /links/:id/simulate    dev only (XENDIT_MOCK=true), documents.edit
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePerm } from '../middleware/permission.js';
import { paymentService } from '../services/payment.service.js';
import { db } from '../db/index.js';
import { paymentLinks } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { invoiceService } from '../services/invoice.service.js';

const router = Router();

router.post('/xendit/webhook', async (req, res) => {
    try {
        const outcome = await paymentService.handleWebhook(req.body, req.headers['x-callback-token']);
        res.json({ ok: true, outcome });
    } catch (e) {
        if (e.status === 401) return res.status(401).json({ error: 'unauthorized' });
        console.error('[xendit] webhook failed:', e.message);
        // 5xx makes Xendit retry later — correct for transient DB errors.
        res.status(500).json({ error: 'webhook_failed' });
    }
});

router.get('/status', requireAuth, async (req, res, next) => {
    try { res.json(await paymentService.status(await invoiceService.agencyIdFor(req.user))); } catch (e) { next(e); }
});

router.post('/links/:id/simulate', requireAuth, requirePerm('documents', 'edit'), async (req, res, next) => {
    try {
        const [l] = await db.select({ organizationId: paymentLinks.organizationId }).from(paymentLinks).where(eq(paymentLinks.id, Number(req.params.id))).limit(1);
        if (!l) return res.status(404).json({ error: 'Link tidak ditemukan.' });
        if (req.user.role !== 'superadmin' && l.organizationId !== await invoiceService.agencyIdFor(req.user)) return res.status(404).json({ error: 'Link tidak ditemukan.' });
        res.json({ outcome: await paymentService.simulatePaid(req.params.id) });
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

export default router;
