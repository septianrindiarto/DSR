// ─── /api/session — login session rules for the browser (owner 2026-11-13) ──
//   GET  /policy   → { exempt, idleMinutes, warnMinutes, kickAfterMinutes }  (UI idle warning)
//   POST /ping     → keeps the session alive after real use without other API calls
//                    (typing a long form). requireAuth records the activity.
// Idle timeout / lock rules: services/session-core.js.
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { KICK_AFTER_IDLE_MINUTES } from '../services/session-core.js';

const router = Router();
router.use(requireAuth);
router.get('/policy', (req, res) => res.json({
    exempt: !!req.sessionPolicy?.exempt, idleMinutes: req.sessionPolicy?.idleMinutes ?? null,
    warnMinutes: 2, kickAfterMinutes: KICK_AFTER_IDLE_MINUTES,
}));
router.post('/ping', (req, res) => res.json({ ok: true }));
export default router;
