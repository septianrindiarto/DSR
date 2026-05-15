import { Router } from 'express';
import { maintenanceService } from '../services/maintenance.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const router = Router();

const maintenanceSchema = z.object({
    carId: z.number().int(),
    type: z.enum(['routine', 'repair', 'inspection']),
    description: z.string().optional().nullable(),
    scheduledDate: z.string().min(1),
    cost: z.string().or(z.number()).optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.enum(['scheduled', 'in_progress', 'completed']).optional(),
});

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { status, page, limit } = req.query;
        const result = await maintenanceService.findAll({
            status,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

router.post('/', requireAuth, requireAdmin, validate(maintenanceSchema), activityLogger('create', 'maintenance'), async (req, res, next) => {
    try {
        const data = {
            ...req.body,
            scheduledDate: new Date(req.body.scheduledDate),
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        };
        const record = await maintenanceService.create(data);
        res.status(201).json(record);
    } catch (error) { next(error); }
});

router.put('/:id', requireAuth, requireAdmin, activityLogger('update', 'maintenance'), async (req, res, next) => {
    try {
        const data = { ...req.body };
        if (data.scheduledDate) data.scheduledDate = new Date(data.scheduledDate);
        if (data.completedDate) data.completedDate = new Date(data.completedDate);
        const record = await maintenanceService.update(parseInt(req.params.id), data);
        if (!record) return res.status(404).json({ error: 'Record tidak ditemukan' });
        res.json(record);
    } catch (error) { next(error); }
});

export default router;
