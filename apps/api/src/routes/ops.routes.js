// ─── /api/ops — Rekap Operasional & Lembur (monthly contracts) ──────────────
//   GET    /overview?period=YYYY-MM      contracts + this period's overtime/costs/recaps (Ringkasan)
//   GET    /contracts                    contracts + units the caller can record for
//   GET    /entries                      list (?contractId&period&kind&status&driverId&recapId&q&from&to)
//   POST   /entries                      multipart: fields + files[] (evidence, ≤10 per call)
//   PUT    /entries/:id                  edit (submitted / rejected; agency also verified)
//   DELETE /entries/:id
//   POST   /entries/:id/evidence         multipart files[]
//   GET    /entries/:id/evidence/:idx    stream one evidence file (decrypted)
//   DELETE /entries/:id/evidence/:idx
//   POST   /entries/submit               { ids }            submit own drafts (draft → submitted)
//   POST   /entries/verify               { ids }            agency (opsrecap.verify)
//   POST   /entries/reject               { ids, reason }    agency (opsrecap.verify)
//   GET    /recaps                       list R codes
//   POST   /recaps/preview               { contractId, period, kind }
//   POST   /recaps                       create R### (agency, opsrecap.edit)
//   GET    /recaps/:id                   recap + lines
//   POST   /recaps/:id/refresh           add newly verified lines (agency)
//   POST   /recaps/:id/cancel            agency
//   POST   /recaps/:id/approve           client (opsrecap.approve)
//   POST   /recaps/:id/reject-entries    { ids, reason } client
//   GET/POST/DELETE /holidays            national (superadmin) / agency holidays
// Drivers use the same endpoints with driverapp.use (own units only).
// Literal paths are registered before /:id.
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireAnyPerm, requirePerm } from '../middleware/permission.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { privateUpload, toPrivateRef, sendPrivate } from '../services/private-files.js';
import { opsService } from '../services/ops.service.js';
import { opsBillingService } from '../services/ops-billing.service.js';
import { getOpsDefault, setOpsDefault } from '../services/ops-policy.service.js';
import { invoiceService } from '../services/invoice.service.js';

const router = Router();
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
const upload = privateUpload({ area: 'ops', subDir: (req) => `u${req.user.id}`, kinds: ['image', 'pdf'], maxMb: 10 }).array('files', 10);
const run = (mw) => (req, res, next) => mw(req, res, (err) => (err ? res.status(err.status || 400).json({ error: err.message }) : next()));
const filesOf = (req) => (req.files || []).map((f) => ({ ref: toPrivateRef(f.path), name: f.originalname, type: f.mimetype }));

const canUse = requireAnyPerm('opsrecap.view', 'driverapp.use');
const canCreate = requireAnyPerm('opsrecap.create', 'driverapp.use');
const ids = z.object({ ids: z.array(z.union([z.number().int(), z.string()])).min(1).max(500) });
const recapKey = z.object({ contractId: z.union([z.number().int(), z.string()]), period: z.string().regex(/^\d{4}-\d{2}$/), kind: z.enum(['overtime', 'expense', 'trip']) });

router.use(requireAuth);

// ─── Invoice approved forms by code (Dokumen → Invoice) — literal paths first ───
router.get('/billing/pending', requireAnyPerm('documents.view', 'documents.edit'), wrap((req) => opsBillingService.pending(req.user)));
router.get('/billing/lines', requireAnyPerm('documents.view', 'documents.edit'), wrap((req) => opsBillingService.lines(req.user, req.query.codes)));
router.post('/billing/issue', requirePerm('documents', 'edit'),
    validate(z.object({ codes: z.union([z.string(), z.array(z.string())]), invoiceNumber: z.string().min(1).max(60), sentDate: z.string().nullable().optional(), letterNumber: z.string().max(80).nullable().optional(), discount: z.number().min(0).optional(), taxProfile: z.any().optional() })),
    activityLogger('create', 'invoices'), wrap((req) => opsBillingService.issue(req.user, req.body)));

// Agency default lembur & perjalanan dinas (Pengaturan). Agency users only.
const agencyOnly = (req, res, next) => (req.user?.role === 'superadmin' || req.user?.accountType === 'agency' ? next() : res.status(403).json({ error: 'Hanya agency.' }));
router.get('/policy-default', agencyOnly, requireAnyPerm('settings.view', 'documents.view', 'contracts.view'), wrap(async (req) => getOpsDefault(await invoiceService.agencyIdFor(req.user))));
router.put('/policy-default', agencyOnly, requirePerm('settings', 'edit'), activityLogger('update', 'ops_policy_default'),
    wrap(async (req) => setOpsDefault(await invoiceService.agencyIdFor(req.user), req.body?.policy || {})));
router.get('/overview', requireAnyPerm('opsrecap.view', 'contracts.view'), wrap((req) => opsService.overview(req.user, req.query)));
router.get('/contracts', canUse, wrap((req) => opsService.contracts(req.user)));

// ─── entries (literal paths first) ───
router.get('/entries', canUse, wrap((req) => opsService.list(req.user, req.query)));
router.post('/entries/verify', requirePerm('opsrecap', 'verify'), validate(ids), activityLogger('update', 'ops_entries'),
    wrap((req) => opsService.verify(req.user, req.body.ids)));
// Both sides approve each form (agency: opsrecap.verify, client: opsrecap.approve).
router.post('/entries/approve', requireAnyPerm('opsrecap.verify', 'opsrecap.approve'), validate(ids.extend({ side: z.enum(['agency', 'client']).optional() })),
    activityLogger('update', 'ops_entries'), wrap((req) => opsService.approve(req.user, req.body.ids, req.body.side)));
router.post('/entries/reject', requireAnyPerm('opsrecap.verify', 'opsrecap.approve'), validate(ids.extend({ reason: z.string().min(1).max(300), side: z.enum(['agency', 'client']).optional() })),
    activityLogger('update', 'ops_entries'), wrap((req) => opsService.reject(req.user, req.body.ids, req.body.reason, req.body.side)));
router.post('/entries/submit', canUse, validate(ids), activityLogger('update', 'ops_entries'), wrap((req) => opsService.submit(req.user, req.body.ids)));
router.post('/entries', canCreate, run(upload), activityLogger('create', 'ops_entries'), wrap((req) => opsService.create(req.user, req.body, filesOf(req))));
router.put('/entries/:id', canUse, activityLogger('update', 'ops_entries'), wrap((req) => opsService.update(req.user, req.params.id, req.body)));
router.delete('/entries/:id', canUse, activityLogger('delete', 'ops_entries'), wrap((req) => opsService.remove(req.user, req.params.id)));
router.post('/entries/:id/comments', canUse, validate(z.object({ text: z.string().min(1).max(1000) })), wrap((req) => opsService.addComment(req.user, req.params.id, req.body.text)));
router.post('/entries/:id/evidence', canUse, run(upload), wrap((req) => opsService.addEvidence(req.user, req.params.id, filesOf(req))));
router.get('/entries/:id/evidence/:idx', canUse, async (req, res, next) => {
    try {
        const f = await opsService.evidence(req.user, req.params.id, req.params.idx);
        return sendPrivate(res, f.ref, 'ops', f.name);
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
router.delete('/entries/:id/evidence/:idx', canUse, wrap((req) => opsService.removeEvidence(req.user, req.params.id, req.params.idx)));

// ─── recaps ───
router.get('/recaps', requirePerm('opsrecap', 'view'), wrap((req) => opsService.listRecaps(req.user, req.query)));
router.post('/recaps/preview', requirePerm('opsrecap', 'view'), validate(recapKey), wrap((req) => opsService.recapPreview(req.user, req.body)));
router.post('/recaps', requirePerm('opsrecap', 'edit'), validate(recapKey), activityLogger('create', 'ops_recaps'), wrap((req) => opsService.createRecap(req.user, req.body)));
router.get('/recaps/:id', requirePerm('opsrecap', 'view'), wrap((req) => opsService.getRecap(req.user, req.params.id)));
router.post('/recaps/:id/refresh', requirePerm('opsrecap', 'edit'), activityLogger('update', 'ops_recaps'), wrap((req) => opsService.refreshRecap(req.user, req.params.id)));
router.post('/recaps/:id/cancel', requirePerm('opsrecap', 'edit'), activityLogger('update', 'ops_recaps'), wrap((req) => opsService.cancelRecap(req.user, req.params.id)));
router.post('/recaps/:id/approve', requirePerm('opsrecap', 'approve'), activityLogger('update', 'ops_recaps'), wrap((req) => opsService.approveRecap(req.user, req.params.id)));
router.post('/recaps/:id/reject-entries', requirePerm('opsrecap', 'approve'), validate(ids.extend({ reason: z.string().min(1).max(300) })), activityLogger('update', 'ops_recaps'),
    wrap((req) => opsService.rejectRecapEntries(req.user, req.params.id, req.body.ids, req.body.reason)));

// ─── holidays ───
router.get('/holidays', canUse, wrap((req) => opsService.listHolidays(req.user, req.query.year)));
router.post('/holidays', requirePerm('settings', 'edit'), validate(z.object({ date: z.string(), name: z.string().min(1).max(120), national: z.boolean().optional() })),
    activityLogger('create', 'holidays'), wrap((req) => opsService.addHoliday(req.user, req.body)));
router.delete('/holidays/:id', requirePerm('settings', 'edit'), activityLogger('delete', 'holidays'), wrap((req) => opsService.removeHoliday(req.user, req.params.id)));

export default router;
