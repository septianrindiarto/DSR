import { Router } from 'express';
import { scheduleService } from '../services/schedule.service.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLE_GROUPS } from '../services/permissions.service.js';

const router = Router();

// Schedule is part of the client feature set (SCHEDULE is in
// CLIENT_ADMIN_FEATURES + CLIENT_USER_FEATURES). Previously this route was
// admin-only which meant logged-in clients hit a 403 the moment they tapped
// the Jadwal nav item. The service already accepts scopeUser and applies
// buildScopeConditions, so opening the guard to ANY_AUTHENTICATED is safe:
// agency users still see all rows; clients see only org/own rows.
router.get('/', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            // Default to current week
            const now = new Date();
            const dayOfWeek = now.getDay();
            const start = new Date(now);
            start.setDate(now.getDate() - dayOfWeek + 1); // Monday
            const end = new Date(start);
            end.setDate(start.getDate() + 6); // Sunday

            const schedule = await scheduleService.getSchedule({
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                scopeUser: req.user,
            });
            return res.json({ data: schedule, startDate: start, endDate: end });
        }
        const schedule = await scheduleService.getSchedule({ startDate, endDate, scopeUser: req.user });
        res.json({ data: schedule, startDate, endDate });
    } catch (error) { next(error); }
});

router.get('/:carId', requireAuth, requireRole(ROLE_GROUPS.ANY_AUTHENTICATED), async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const now = new Date();
        const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

        const schedule = await scheduleService.getCarSchedule(parseInt(req.params.carId), { startDate: start, endDate: end });
        res.json(schedule);
    } catch (error) { next(error); }
});

export default router;
