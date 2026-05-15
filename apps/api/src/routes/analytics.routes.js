import { Router } from 'express';
import { analyticsService } from '../services/analytics.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/trends', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const trends = await analyticsService.getBookingTrends(req.user);
        res.json(trends);
    } catch (error) { next(error); }
});

router.get('/revenue', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const revenue = await analyticsService.getRevenueAnalytics(req.user);
        res.json(revenue);
    } catch (error) { next(error); }
});

router.get('/categories', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const categories = await analyticsService.getCategoryBreakdown(req.user);
        res.json(categories);
    } catch (error) { next(error); }
});

router.get('/top-cars', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : 10;
        const topCars = await analyticsService.getTopCars(limit, req.user);
        res.json(topCars);
    } catch (error) { next(error); }
});

router.get('/customers', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const analytics = await analyticsService.getCustomerAnalytics(req.user);
        res.json(analytics);
    } catch (error) { next(error); }
});

router.get('/kpis', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const kpis = await analyticsService.getKPIs(req.user);
        res.json(kpis);
    } catch (error) { next(error); }
});

export default router;
