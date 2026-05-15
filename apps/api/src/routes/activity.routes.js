import { Router } from 'express';
import { activityService } from '../services/activity.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { page, limit } = req.query;
        const result = await activityService.findAll({
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 50,
        });
        res.json(result);
    } catch (error) { next(error); }
});

export default router;
