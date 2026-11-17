import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { privateUpload, toPrivateRef, isPrivateRef, resolvePrivateRef, sendPrivate, isLegacySensitive } from '../services/private-files.js';
import { financeService } from '../services/finance.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger, auditRead } from '../middleware/logger.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';

const router = Router();

// Financial documents are confidential → private storage
// (uploads-private/finance/<org|user>/), downloaded via GET /:id/file.
const ownerDir = (user) => (user?.organizationId ? `org${user.organizationId}` : `user${user?.id || 'x'}`);
const upload = privateUpload({ area: 'finance', subDir: (req) => ownerDir(req.user), kinds: ['image', 'pdf', 'office'], maxMb: 20 });

// A fileUrl in the body must be one of the caller's own private uploads (or a
// legacy public /uploads/finance path) — never another tenant's file ref.
const fileUrlOk = (user, v) => {
    if (v === null || v === undefined || v === '') return true;
    if (isPrivateRef(v)) return user?.role === 'superadmin' || !!resolvePrivateRef(v, `finance/${ownerDir(user)}`);
    return /^\/uploads\/finance\/[\w.-]+$/.test(v);
};
const reportSchema = z.object({
    name: z.string().trim().min(1, 'Nama wajib diisi').max(255),
    category: z.enum(['keuangan_inti', 'perpajakan', 'aset_armada', 'kepatuhan', 'operasional', 'payroll']).default('keuangan_inti'),
    period: z.string().max(100).optional().nullable(),
    status: z.enum(['draft', 'submitted', 'final', 'archived']).optional(),
    fileUrl: z.string().max(500).optional().nullable(),
    fileType: z.string().max(20).optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
});
const checkFile = (req, res, next) => (fileUrlOk(req.user, req.body?.fileUrl) ? next() : res.status(400).json({ error: 'Referensi file tidak valid.' }));

// ─── List all reports ───────────────────────────────────────────────
router.get('/', requireAuth, requirePerm('finance', 'view'), async (req, res, next) => {
    try {
        const { search, category, status, sortBy, sortOrder, page, limit } = req.query;
        const result = await financeService.findAll({
            search, category, status, sortBy, sortOrder,
            page: Number(page) || 1, limit: Number(limit) || 50, user: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

// ─── Stats ──────────────────────────────────────────────────────────
router.get('/stats', requireAuth, requirePerm('finance', 'view'), async (req, res, next) => {
    try {
        const stats = await financeService.getStats(req.user);
        res.json(stats);
    } catch (error) { next(error); }
});

// ─── Export all as JSON ─────────────────────────────────────────────
router.get('/data/export', requireAuth, requirePerm('finance', 'view'), auditRead('export', 'financial_reports'), async (req, res, next) => {
    try {
        const all = await financeService.findAllRaw(req.user);
        const data = all.map(r => ({
            name: r.name, category: r.category, period: r.period,
            status: r.status, fileType: r.fileType, notes: r.notes,
        }));
        res.setHeader('Content-Disposition', `attachment; filename=finance-export-${Date.now()}.json`);
        res.json(data);
    } catch (error) { next(error); }
});

// ─── Import from JSON ───────────────────────────────────────────────
router.post('/data/import', requireAuth, requirePerm('finance', 'create'), activityLogger('create', 'financial_report'), async (req, res, next) => {
    try {
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Data import harus berupa array.' });
        }
        let imported = 0, skipped = 0;
        for (const item of items) {
            try {
                await financeService.create({
                    ...reportSchema.omit({ fileUrl: true }).parse({
                        name: item.name, category: item.category || 'keuangan_inti',
                        period: item.period || null, status: item.status || 'draft',
                        fileType: item.fileType || null, notes: item.notes || null,
                    }),
                    createdBy: req.user.id,
                });
                imported++;
            } catch { skipped++; }
        }
        res.json({ message: `Import selesai: ${imported} berhasil, ${skipped} dilewati.`, imported, skipped });
    } catch (error) { next(error); }
});

// ─── Upload file ────────────────────────────────────────────────────
router.post('/upload', requireAuth, requireAnyPerm('finance.create', 'finance.edit'), (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(err.status || 400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'File wajib diunggah.' });
        res.json({ url: toPrivateRef(req.file.path), originalName: req.file.originalname });
    });
});

// ─── Download a report's file (scoped to the caller's organization) ───
router.get('/:id/file', requireAuth, requirePerm('finance', 'view'), auditRead('view', 'financial_report_file'), async (req, res, next) => {
    try {
        const report = await financeService.findById(parseInt(req.params.id), req.user);
        if (!report?.fileUrl) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
        if (!isPrivateRef(report.fileUrl) && !isLegacySensitive(report.fileUrl)) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
        sendPrivate(res, report.fileUrl, 'finance', report.name ? `${report.name.replace(/[^\w .-]/g, '_').slice(0, 80)}${(report.fileUrl.match(/\.\w+$/) || [''])[0]}` : undefined);
    } catch (error) { next(error); }
});

// ─── Create report ──────────────────────────────────────────────────
router.post('/', requireAuth, requirePerm('finance', 'create'), validate(reportSchema), checkFile, activityLogger('create', 'financial_report'), async (req, res, next) => {
    try {
        const report = await financeService.create({ ...req.body, createdBy: req.user?.id });
        res.status(201).json(report);
    } catch (error) { next(error); }
});

// ─── Update report ──────────────────────────────────────────────────
router.put('/:id', requireAuth, requirePerm('finance', 'edit'), validate(reportSchema.partial()), checkFile, activityLogger('update', 'financial_report'), async (req, res, next) => {
    try {
        const report = await financeService.update(parseInt(req.params.id), req.body, req.user);
        if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        res.json(report);
    } catch (error) { next(error); }
});

// ─── Delete report ──────────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePerm('finance', 'edit'), activityLogger('delete', 'financial_report'), async (req, res, next) => {
    try {
        const report = await financeService.delete(parseInt(req.params.id), req.user);
        if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        res.json({ message: 'Laporan berhasil dihapus' });
    } catch (error) { next(error); }
});

export default router;
