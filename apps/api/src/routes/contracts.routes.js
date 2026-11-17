// ─── /api/contracts — long-term corporate contracts ─────────────────────────
// Both sides (agency & client company) create/edit drafts, define required
// documents for each other, upload/review them and approve. Active when both
// approve (contracts-core.js approvalBlockers / bothApproved).
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { contractsService } from '../services/contracts.service.js';
import { contractBillingService } from '../services/contract-billing.service.js';
import { contractReportsService } from '../services/contract-reports.service.js';
import { fleetAlertsService } from '../services/fleet-alerts.service.js';
import { privateUpload, toPrivateRef, sendPrivate } from '../services/private-files.js';

const router = Router();
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
const money = z.union([z.number(), z.string()]).nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const unit = z.object({
    id: z.number().int().nullable().optional(),
    carId: z.number().int().nullable().optional(), driverId: z.number().int().nullable().optional(),
    monthlyFee: z.union([z.number(), z.string()]), startDate: date.nullable().optional(), endDate: date.nullable().optional(),
    notes: z.string().max(300).nullable().optional(),
});
const contractSchema = z.object({
    clientOrgId: z.number().int().nullable().optional(), agencyOrgId: z.number().int().nullable().optional(), contractNumber: z.string().max(40).nullable().optional(), title: z.string().max(200).nullable().optional(),
    startDate: date, endDate: date, billingDay: z.number().int().min(1).max(28).nullable().optional(),
    kmAllowanceMonth: money, excessKmRate: money, package: z.string().max(40).nullable().optional(),
    includes: z.record(z.string(), z.boolean()).optional(), notes: z.string().max(2000).nullable().optional(),
    units: z.array(unit).max(200).optional(),
    extrasMode: z.enum(['included', 'separate', 'none']).optional(),
    opsPolicy: z.record(z.string(), z.any()).nullable().optional(),
    cutoffDay: z.number().int().min(1).max(28).nullable().optional(),
    workStart: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(''), z.null()]).optional(),
    workEnd: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(''), z.null()]).optional(),
});

router.use(requireAuth);
router.get('/', requirePerm('contracts', 'view'), wrap((req) => contractsService.list(req.user, req.query)));
router.post('/', requirePerm('contracts', 'create'), validate(contractSchema), activityLogger('create', 'lease_contracts'), wrap((req) => contractsService.create(req.user, req.body)));
// List Data (all M/L/T/O/R codes with invoice info) and Audit trail.
router.get('/codes', requirePerm('contracts', 'view'), wrap((req) => contractReportsService.codes(req.user, req.query)));
router.get('/audit', requireAnyPerm('contracts.view', 'corporate.view'), wrap((req) => contractReportsService.audit(req.user, req.query)));
// Monthly M codes (one per unit per month) — literal paths before /:id.
// Form → Kontrak = M detail form (owner 2026-11-13): fill (agency admin / staff operasional; client approvers may
// correct) → both sides approve (agency opsrecap.verify, client opsrecap.approve) → only then invoiceable.
const canSeeMonthly = requireAnyPerm('contracts.view', 'opsrecap.view');
const canFillMonthly = requireAnyPerm('opsrecap.create', 'opsrecap.edit', 'contracts.edit', 'opsrecap.approve');
const canApproveMonthly = requireAnyPerm('opsrecap.verify', 'opsrecap.approve');
const monthlyIds = z.object({ ids: z.array(z.union([z.number().int(), z.string()])).min(1).max(500), side: z.enum(['agency', 'client']).optional() });
const monthlyUpload = privateUpload({ area: 'ops', subDir: (req) => `m${Number(req.params.billingId) || 0}`, kinds: ['image', 'pdf'], maxMb: 10 }).array('files', 10);
const runUp = (mw) => (req, res, next) => mw(req, res, (err) => (err ? res.status(err.status || 400).json({ error: err.message }) : next()));
router.get('/monthly', canSeeMonthly, wrap((req) => contractBillingService.list(req.user, req.query)));
router.post('/monthly/approve', canApproveMonthly, validate(monthlyIds), activityLogger('update', 'lease_unit_billings'),
    wrap((req) => contractBillingService.approve(req.user, req.body.ids, req.body.side)));
router.post('/monthly/reject', canApproveMonthly, validate(monthlyIds.extend({ reason: z.string().min(1).max(300) })), activityLogger('update', 'lease_unit_billings'),
    wrap((req) => contractBillingService.reject(req.user, req.body.ids, req.body.reason, req.body.side)));
router.post('/monthly/generate', requirePerm('contracts', 'edit'), activityLogger('create', 'lease_unit_billings'),
    wrap(async (req) => ({ created: await contractBillingService.ensureContract(req.body?.contractId, req.user.id) })));
router.post('/monthly/:billingId/recalc', requirePerm('contracts', 'edit'), validate(z.object({ km: z.union([z.number(), z.string(), z.null()]).optional() })),
    activityLogger('update', 'lease_unit_billings'), wrap((req) => contractBillingService.recalc(req.user, req.params.billingId, req.body || {})));
router.get('/monthly/:billingId', canSeeMonthly, wrap((req) => contractBillingService.get(req.user, req.params.billingId)));
router.put('/monthly/:billingId', canFillMonthly, validate(z.object({
    kmStart: z.union([z.number(), z.string(), z.null()]).optional(), kmEnd: z.union([z.number(), z.string(), z.null()]).optional(),
    picName: z.string().max(120).nullable().optional(), destination: z.string().max(200).nullable().optional(), note: z.string().max(1000).nullable().optional(),
    submit: z.boolean().optional(),
})), activityLogger('update', 'lease_unit_billings'), wrap((req) => contractBillingService.save(req.user, req.params.billingId, req.body)));
router.post('/monthly/:billingId/comments', canSeeMonthly, validate(z.object({ text: z.string().min(1).max(1000) })),
    wrap((req) => contractBillingService.addComment(req.user, req.params.billingId, req.body.text)));
router.post('/monthly/:billingId/evidence', canFillMonthly, runUp(monthlyUpload),
    wrap((req) => contractBillingService.addEvidence(req.user, req.params.billingId, (req.files || []).map((f) => ({ ref: toPrivateRef(f.path), name: f.originalname, type: f.mimetype })))));
router.get('/monthly/:billingId/evidence/:idx', canSeeMonthly, async (req, res, next) => {
    try {
        const f = await contractBillingService.evidence(req.user, req.params.billingId, req.params.idx);
        return sendPrivate(res, f.ref, 'ops', f.name);
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
router.delete('/monthly/:billingId/evidence/:idx', canFillMonthly, wrap((req) => contractBillingService.removeEvidence(req.user, req.params.billingId, req.params.idx)));
// Replacement units per contract unit (owner 2026-11-13): agency sets them; client sees them.
router.post('/replacements/:rid/end', requireAnyPerm('contracts.edit', 'fleet.edit'), validate(z.object({ endDate: date.nullable().optional() })),
    activityLogger('update', 'lease_unit_replacements'), wrap((req) => fleetAlertsService.endReplacement(req.user, req.params.rid, req.body || {})));
router.get('/:id/replacements', requirePerm('contracts', 'view'), wrap((req) => fleetAlertsService.replacements(req.user, req.params.id)));
router.post('/:id/replacements', requireAnyPerm('contracts.edit', 'fleet.edit'),
    validate(z.object({ contractUnitId: z.union([z.number().int(), z.string()]), replacementCarId: z.union([z.number().int(), z.string()]), startDate: date, endDate: date.nullable().optional(),
        reason: z.enum(['maintenance', 'emergency', 'other']).optional(), note: z.string().max(300).nullable().optional(), maintenanceId: z.union([z.number(), z.string(), z.null()]).optional(), incidentId: z.union([z.number(), z.string(), z.null()]).optional() })),
    activityLogger('create', 'lease_unit_replacements'), wrap((req) => fleetAlertsService.addReplacement(req.user, req.params.id, req.body)));
// Amendment: a new draft of an active contract; when approved the old one must be stopped.
router.post('/:id/amend', requirePerm('contracts', 'edit'), activityLogger('create', 'lease_contracts'), wrap((req) => contractsService.amend(req.user, req.params.id, req.body || {})));
router.post('/:id/supersede', requirePerm('contracts', 'edit'), validate(z.object({ endDate: date })), activityLogger('update', 'lease_contracts'),
    wrap((req) => contractsService.supersede(req.user, req.params.id, req.body)));
router.get('/:id/invoices', requirePerm('contracts', 'view'), wrap((req) => contractsService.invoices(req.user, req.params.id)));
router.get('/:id', requirePerm('contracts', 'view'), wrap((req) => contractsService.get(req.user, req.params.id)));
router.put('/:id', requirePerm('contracts', 'edit'), validate(contractSchema.partial()), activityLogger('update', 'lease_contracts'), wrap((req) => contractsService.update(req.user, req.params.id, req.body)));
router.put('/:id/status', requirePerm('contracts', 'edit'), validate(z.object({ status: z.enum(['active', 'ended', 'terminated']) })),
    activityLogger('update', 'lease_contracts'), wrap((req) => contractsService.setStatus(req.user, req.params.id, req.body.status)));
// ─── workflow: approval + required documents ───
const docSchema = z.object({
    title: z.string().trim().min(1).max(150), note: z.string().max(1000).nullable().optional(),
    mandatory: z.boolean().optional(), dueDate: date.nullable().optional(), requiredFrom: z.enum(['agency', 'client']).optional(),
});
const upload = privateUpload({ area: 'contracts', subDir: (req) => `c${Number(req.params.id) || 0}`, kinds: ['image', 'pdf', 'office'], maxMb: 15 }).single('file');
const run = (mw) => (req, res, next) => mw(req, res, (err) => (err ? res.status(err.status || 400).json({ error: err.message }) : next()));

router.post('/:id/approve', requirePerm('contracts', 'edit'), validate(z.object({ side: z.enum(['agency', 'client']).optional() })),
    activityLogger('update', 'lease_contracts'), wrap((req) => contractsService.approve(req.user, req.params.id, req.body)));
router.post('/:id/documents', requirePerm('contracts', 'edit'), validate(docSchema), activityLogger('create', 'contract_documents'),
    wrap((req) => contractsService.addDocument(req.user, req.params.id, req.body)));
router.put('/:id/documents/:docId', requirePerm('contracts', 'edit'), validate(docSchema.partial()), activityLogger('update', 'contract_documents'),
    wrap((req) => contractsService.updateDocument(req.user, req.params.id, req.params.docId, req.body)));
router.delete('/:id/documents/:docId', requirePerm('contracts', 'edit'), activityLogger('delete', 'contract_documents'),
    wrap((req) => contractsService.removeDocument(req.user, req.params.id, req.params.docId)));
router.post('/:id/documents/:docId/file', requirePerm('contracts', 'edit'), run(upload), activityLogger('update', 'contract_documents'),
    wrap((req) => contractsService.uploadDocument(req.user, req.params.id, req.params.docId, req.file ? { ref: toPrivateRef(req.file.path), name: req.file.originalname } : null)));
router.delete('/:id/documents/:docId/file', requirePerm('contracts', 'edit'), activityLogger('update', 'contract_documents'),
    wrap((req) => contractsService.removeDocumentFile(req.user, req.params.id, req.params.docId)));
router.get('/:id/documents/:docId/file', requirePerm('contracts', 'view'), async (req, res, next) => {
    try {
        const f = await contractsService.documentFile(req.user, req.params.id, req.params.docId);
        return sendPrivate(res, f.ref, 'contracts', f.name);
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
router.post('/:id/documents/:docId/review', requirePerm('contracts', 'edit'),
    validate(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).nullable().optional() })),
    activityLogger('update', 'contract_documents'), wrap((req) => contractsService.reviewDocument(req.user, req.params.id, req.params.docId, req.body)));

router.post('/:id/billing/preview', requirePerm('contracts', 'view'),
    validate(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), kmOverrides: z.record(z.string(), z.union([z.number(), z.string()])).optional() })),
    wrap((req) => contractsService.billingPreview(req.user, req.params.id, req.body.period, req.body.kmOverrides || {})));
router.post('/:id/billing', requirePerm('contracts', 'edit'),
    validate(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), kmOverrides: z.record(z.string(), z.union([z.number(), z.string()])).optional() })),
    activityLogger('create', 'lease_billings'), wrap((req) => contractsService.issueBilling(req.user, req.params.id, req.body)));

export default router;
