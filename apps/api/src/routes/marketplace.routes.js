// ─── /api/marketplace — ratings & agency profiles ───────────────────────────
//   POST /reviews/:orderNumber   client rates a completed booking { rating, comment }
//   GET  /reviews/mine           orderNumbers the caller already rated
//   GET  /agencies/:id           agency profile (any signed-in user)
//   GET  /agency/me              caller's own agency profile
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { marketplaceService } from '../services/marketplace.service.js';

const router = Router();
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
router.use(requireAuth);
router.get('/reviews/mine', wrap((req) => marketplaceService.reviewedBy(req.user)));
router.post('/reviews/:orderNumber', validate(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(1000).nullable().optional() })),
    activityLogger('create', 'review'), wrap((req) => marketplaceService.rate(req.user, req.params.orderNumber, req.body)));
router.get('/agency/me', wrap((req) => {
    if (req.user.accountType !== 'agency' || !req.user.organizationId) { const e = new Error('Hanya untuk akun agency.'); e.status = 403; throw e; }
    return marketplaceService.profile(req.user.organizationId);
}));
router.get('/agencies/:id', wrap((req) => marketplaceService.profile(req.params.id)));
export default router;
