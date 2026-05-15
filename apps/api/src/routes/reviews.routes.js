import { Router } from 'express';
import { reviewService } from '../services/review.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { page, limit } = req.query;
        const result = await reviewService.findAll({
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
    try {
        const review = await reviewService.create(req.body);
        res.status(201).json(review);
    } catch (error) { next(error); }
});

export default router;
