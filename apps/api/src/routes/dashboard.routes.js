import { Router } from 'express';
import { dashboardService } from '../services/dashboard.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const stats = await dashboardService.getStats(req.user);
        res.json(stats);
    } catch (error) { next(error); }
});

router.get('/recent-orders', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : 5;
        const orders = await dashboardService.getRecentOrders(limit, req.user);
        res.json(orders);
    } catch (error) { next(error); }
});

router.get('/preferences', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const prefs = await dashboardService.getPreferences(req.user.id);
        res.json(prefs);
    } catch (error) { next(error); }
});

router.put('/preferences', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { widgetConfig } = req.body;
        const result = await dashboardService.savePreferences(req.user.id, widgetConfig);
        res.json(result);
    } catch (error) { next(error); }
});

export default router;
