import { Router } from 'express';
import { reviewService } from '../services/review.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { validate } from '../middleware/validate.js';
import { requireBodyRowScope } from '../middleware/row-scope.js';
import { customers } from '../db/schema.js';
import { z } from 'zod';

// Was an anonymous endpoint accepting any column (incl. organizationId).
// Now: signed-in users only, whitelisted fields, tenant columns from session,
// and the customer must be visible to the caller.
const reviewSchema = z.object({
    customerId: z.number().int().positive(),
    orderId: z.number().int().positive().optional().nullable(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).optional().nullable(),
});

const router = Router();

router.get('/', requireAuth, requirePerm('dashboard', 'view'), async (req, res, next) => {
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

router.post('/', requireAuth, validate(reviewSchema), requireBodyRowScope(customers, (b) => [b.customerId]), async (req, res, next) => {
    try {
        const review = await reviewService.create({
            ...req.body,
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        });
        res.status(201).json(review);
    } catch (error) { next(error); }
});

export default router;
