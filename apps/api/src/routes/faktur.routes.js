// ─── /api/faktur — Faktur Pajak (Dokumen → Faktur Pajak) ────────────────────
// Agency only. Literal paths before /:id.
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireAnyPerm, requirePerm } from '../middleware/permission.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { privateUpload, toPrivateRef, sendPrivate } from '../services/private-files.js';
import { fakturService } from '../services/faktur.service.js';

const router = Router();
router.use(requireAuth);
router.use((req, res, next) => (req.user?.role === 'superadmin' || req.user?.accountType === 'agency' ? next() : res.status(403).json({ error: 'Hanya agency.' })));

const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req)); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
const canView = requireAnyPerm('documents.view', 'documents.edit');
const canEdit = requirePerm('documents', 'edit');
const upload = privateUpload({ area: 'faktur', subDir: (req) => `f${Number(req.params.id) || 0}`, kinds: ['pdf', 'image'], maxMb: 10 }).single('file');
const run = (mw) => (req, res, next) => mw(req, res, (err) => (err ? res.status(400).json({ error: err.message }) : next()));

const createSchema = z.object({
    invoiceIds: z.array(z.number().int()).min(1).max(200),
    nsfp: z.string().max(40).nullable().optional(),
    fakturDate: z.string().max(10).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
});
const updateSchema = z.object({
    nsfp: z.string().max(40).nullable().optional(),
    fakturDate: z.string().max(10).nullable().optional(),
    buyerName: z.string().max(255).nullable().optional(),
    buyerNpwp: z.string().max(40).nullable().optional(),
    buyerAddress: z.string().max(1000).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    status: z.enum(['terbit']).optional(),
    addInvoiceIds: z.array(z.number().int()).max(200).optional(),
    removeInvoiceIds: z.array(z.number().int()).max(200).optional(),
});

router.get('/', canView, wrap((req) => fakturService.list(req.user, req.query)));
router.get('/candidates', canView, wrap((req) => fakturService.candidates(req.user, req.query)));
router.get('/export.csv', canView, async (req, res, next) => {
    try {
        const csv = await fakturService.csv(req.user, req.query);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="faktur-${String(req.query.masa || 'semua').replace(/[^\w-]/g, '')}.csv"`);
        res.send('﻿' + csv);
    } catch (e) { next(e); }
});
router.post('/', canEdit, validate(createSchema), activityLogger('create', 'faktur_pajak'), wrap((req) => fakturService.create(req.user, req.body)));
router.get('/:id', canView, wrap((req) => fakturService.get(req.user, req.params.id)));
router.get('/:id/lines', canView, wrap((req) => fakturService.lines(req.user, req.params.id)));
router.put('/:id', canEdit, validate(updateSchema), activityLogger('update', 'faktur_pajak'), wrap((req) => fakturService.update(req.user, req.params.id, req.body)));
router.post('/:id/cancel', canEdit, activityLogger('update', 'faktur_pajak'), wrap((req) => fakturService.cancel(req.user, req.params.id, req.body || {})));
router.post('/:id/replace', canEdit, activityLogger('create', 'faktur_pajak'), wrap((req) => fakturService.replace(req.user, req.params.id)));
router.post('/:id/file', canEdit, run(upload), activityLogger('update', 'faktur_pajak'),
    wrap((req) => fakturService.setFile(req.user, req.params.id, req.file ? { ref: toPrivateRef(req.file.path), name: req.file.originalname } : null)));
router.get('/:id/file', canView, async (req, res, next) => {
    try { const f = await fakturService.fileOf(req.user, req.params.id); return sendPrivate(res, f.ref, 'faktur', f.name); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

export default router;
