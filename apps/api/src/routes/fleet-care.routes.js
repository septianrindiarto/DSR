// ─── /api/fleet-care — documents, service plan, odometer (fleet perms) ──────
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { fleetCareService } from '../services/fleetcare.service.js';
import { fleetAlertsService } from '../services/fleet-alerts.service.js';

const router = Router();
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const n = z.union([z.number(), z.string()]).nullable().optional();

router.use(requireAuth);
router.get('/', requirePerm('fleet', 'view'), wrap((req) => fleetCareService.list(req.user)));
// ─── Maintenance schedule + emergency reports (owner 2026-11-13) — literal paths first ───
//   GET  /incidents?status=open|resolved     agency / client (own contracts) / driver (own reports)
//   POST /incidents                          { carId, kind, description, location, offRoad } — agency or the unit's driver
//   POST /incidents/:id/resolve              { resolution } — agency fleet.edit
//   PUT  /maintenance/:id  DELETE /maintenance/:id
//   GET  /:carId/events                      maintenance + incidents + replacements of one unit
//   POST /:carId/maintenance                 { startDate, endDate, type, description, notes }
router.get('/incidents', requireAnyPerm('fleet.view', 'driverapp.use', 'contracts.view'), wrap((req) => fleetAlertsService.incidents(req.user, { status: req.query.status ?? 'open' })));
router.post('/incidents', requireAnyPerm('fleet.view', 'fleet.edit', 'driverapp.use'),
    validate(z.object({ carId: z.union([z.number().int(), z.string()]), kind: z.enum(['breakdown', 'accident', 'tire', 'other']), description: z.string().min(1).max(2000), location: z.string().max(200).nullable().optional(), offRoad: z.boolean().optional() })),
    activityLogger('create', 'unit_incidents'), wrap((req) => fleetAlertsService.reportIncident(req.user, req.body)));
router.post('/incidents/:id/resolve', requirePerm('fleet', 'edit'), validate(z.object({ resolution: z.string().max(1000).nullable().optional() })),
    activityLogger('update', 'unit_incidents'), wrap((req) => fleetAlertsService.resolveIncident(req.user, req.params.id, req.body)));
router.put('/maintenance/:id', requirePerm('fleet', 'edit'),
    validate(z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: d, description: z.string().max(1000).nullable().optional(), status: z.enum(['scheduled', 'in_progress', 'completed']).optional() })),
    activityLogger('update', 'maintenance'), wrap((req) => fleetAlertsService.updateMaintenance(req.user, req.params.id, req.body)));
router.delete('/maintenance/:id', requirePerm('fleet', 'edit'), activityLogger('delete', 'maintenance'), wrap((req) => fleetAlertsService.removeMaintenance(req.user, req.params.id)));
router.get('/:carId/events', requireAnyPerm('fleet.view', 'driverapp.use'), wrap((req) => fleetAlertsService.unitEvents(req.user, req.params.carId)));
router.post('/:carId/maintenance', requirePerm('fleet', 'edit'),
    validate(z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: d, type: z.enum(['routine', 'repair', 'inspection']).optional(), description: z.string().max(1000).nullable().optional(), notes: z.string().max(1000).nullable().optional() })),
    activityLogger('create', 'maintenance'), wrap((req) => fleetAlertsService.addMaintenance(req.user, req.params.carId, req.body)));
router.put('/:carId', requirePerm('fleet', 'edit'),
    validate(z.object({ stnkExpiry: d, taxExpiry: d, kirExpiry: d, insuranceExpiry: d, lastServiceDate: d, serviceIntervalKm: n, serviceIntervalMonths: n, lastServiceKm: n, currentOdometer: n })),
    activityLogger('update', 'fleet_care'), wrap((req) => fleetCareService.update(req.user, req.params.carId, req.body)));
router.get('/:carId/odometer', requirePerm('fleet', 'view'), wrap((req) => fleetCareService.readings(req.user, req.params.carId)));
router.post('/:carId/odometer', requirePerm('fleet', 'edit'), validate(z.object({ km: z.union([z.number(), z.string()]), readingDate: z.string().nullable().optional() })),
    activityLogger('create', 'odometer_readings'), wrap((req) => fleetCareService.addReading(req.user, req.params.carId, req.body)));
router.post('/:carId/service', requirePerm('fleet', 'edit'),
    validate(z.object({ date: d, odometer: n, cost: n, description: z.string().max(1000).nullable().optional(), type: z.enum(['routine', 'repair', 'inspection']).optional() })),
    activityLogger('create', 'maintenance'), wrap((req) => fleetCareService.recordService(req.user, req.params.carId, req.body)));
export default router;
