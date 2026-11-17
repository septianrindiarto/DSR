// ─── /api/inbox — in-app notifications per user (owner 2026-11-13) ─────────
//   GET  /            ?limit&unread=1   → { data:[{ id, kind, severity, title, body, link, ref, at, read }], unread }
//   POST /read        { ids? }          → mark given (or all visible) as read
//   GET  /actions                       → "Perlu tindakan" counters for the dashboard (privilege based)
// Every signed-in user; visibility rules live in notifications.service visibleTo().
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { notificationService } from '../services/notifications.service.js';
import { actionItemsService } from '../services/action-items.service.js';

const router = Router();
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
router.use(requireAuth);
router.get('/', wrap((req) => notificationService.feed(req.user, { limit: req.query.limit, unreadOnly: req.query.unread === '1' })));
router.post('/read', validate(z.object({ ids: z.array(z.union([z.number().int(), z.string()])).max(200).optional() })),
    wrap((req) => notificationService.markRead(req.user, req.body?.ids || null)));
router.get('/actions', wrap((req) => actionItemsService.forUser(req.user)));

export default router;
