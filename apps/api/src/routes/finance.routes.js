import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { financeService } from '../services/finance.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// File upload config for financial documents
const storage = multer.diskStorage({
    destination: path.join(__dirname, '../../uploads/finance'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `fin-${Date.now()}${ext}`);
    },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

// ─── List all reports ───────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { search, category, status, sortBy, sortOrder, page, limit } = req.query;
        const result = await financeService.findAll({
            search, category, status, sortBy, sortOrder,
            page: Number(page) || 1, limit: Number(limit) || 50,
        });
        res.json(result);
    } catch (error) { next(error); }
});

// ─── Stats ──────────────────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const stats = await financeService.getStats();
        res.json(stats);
    } catch (error) { next(error); }
});

// ─── Export all as JSON ─────────────────────────────────────────────
router.get('/data/export', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const all = await financeService.findAllRaw();
        const data = all.map(r => ({
            name: r.name, category: r.category, period: r.period,
            status: r.status, fileType: r.fileType, notes: r.notes,
        }));
        res.setHeader('Content-Disposition', `attachment; filename=finance-export-${Date.now()}.json`);
        res.json(data);
    } catch (error) { next(error); }
});

// ─── Import from JSON ───────────────────────────────────────────────
router.post('/data/import', requireAuth, requireAdmin, activityLogger('create', 'financial_report'), async (req, res, next) => {
    try {
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Data import harus berupa array.' });
        }
        let imported = 0, skipped = 0;
        for (const item of items) {
            try {
                await financeService.create({
                    name: item.name, category: item.category || 'keuangan_inti',
                    period: item.period || null, status: item.status || 'draft',
                    fileType: item.fileType || null, notes: item.notes || null,
                });
                imported++;
            } catch { skipped++; }
        }
        res.json({ message: `Import selesai: ${imported} berhasil, ${skipped} dilewati.`, imported, skipped });
    } catch (error) { next(error); }
});

// ─── Upload file ────────────────────────────────────────────────────
router.post('/upload', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File wajib diunggah.' });
    res.json({ url: `/uploads/finance/${req.file.filename}`, originalName: req.file.originalname });
});

// ─── Create report ──────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, activityLogger('create', 'financial_report'), async (req, res, next) => {
    try {
        const report = await financeService.create({ ...req.body, createdBy: req.user?.id });
        res.status(201).json(report);
    } catch (error) { next(error); }
});

// ─── Update report ──────────────────────────────────────────────────
router.put('/:id', requireAuth, requireAdmin, activityLogger('update', 'financial_report'), async (req, res, next) => {
    try {
        const report = await financeService.update(parseInt(req.params.id), req.body);
        if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        res.json(report);
    } catch (error) { next(error); }
});

// ─── Delete report ──────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, activityLogger('delete', 'financial_report'), async (req, res, next) => {
    try {
        const report = await financeService.delete(parseInt(req.params.id));
        if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        res.json({ message: 'Laporan berhasil dihapus' });
    } catch (error) { next(error); }
});

export default router;
