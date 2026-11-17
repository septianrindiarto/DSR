// ─── /api/driver-app — the driver's own app (/driver) ───────────────────────
// Every endpoint acts on the driver linked to the logged-in user
// (drivers.user_id) and needs driverapp.use. Photos/receipts are private
// files (uploads-private/trips/<orderId>/, …/expenses/<driverId>/).
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePerm } from '../middleware/permission.js';
import { privateUpload, toPrivateRef } from '../services/private-files.js';
import { driverAppService } from '../services/driver-app.service.js';

const router = Router();
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
const tripUpload = privateUpload({ area: 'trips', subDir: (req) => req.params.orderId, kinds: ['image'], maxMb: 8 }).array('photos', 5);
const receiptUpload = privateUpload({ area: 'expenses', subDir: (req) => `u${req.user.id}`, kinds: ['image', 'pdf'], maxMb: 8 }).single('receipt');
const run = (mw) => (req, res, next) => mw(req, res, (err) => (err ? res.status(err.status || 400).json({ error: err.message }) : next()));

router.use(requireAuth, requirePerm('driverapp', 'use'));

router.get('/me', wrap((req) => driverAppService.me(req.user)));
router.get('/assignments', wrap((req) => driverAppService.assignments(req.user)));
router.post('/trips/:orderId/start', run(tripUpload), wrap((req) => driverAppService.startTrip(req.user, req.params.orderId, req.body, (req.files || []).map((f) => toPrivateRef(f.path)))));
router.post('/trips/:orderId/finish', run(tripUpload), wrap((req) => driverAppService.finishTrip(req.user, req.params.orderId, req.body, (req.files || []).map((f) => toPrivateRef(f.path)))));
router.get('/expenses', wrap((req) => driverAppService.expenses(req.user)));
router.post('/expenses', run(receiptUpload), wrap((req) => driverAppService.addExpense(req.user, req.body, req.file ? toPrivateRef(req.file.path) : null)));

export default router;
