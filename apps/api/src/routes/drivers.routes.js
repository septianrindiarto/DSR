import { Router } from 'express';
import { driverService } from '../services/driver.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

// File upload config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `driver-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|pdf/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) return cb(null, true);
        cb(new Error('Only images and PDF files are allowed'));
    },
});

const driverSchema = z.object({
    name: z.string().min(1, 'Nama wajib diisi'),
    phone: z.string().min(1, 'No. HP wajib diisi'),
    licenseNumber: z.string().optional().nullable(),
    licenseExpiry: z.string().optional().nullable(),
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
    address: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { search, status, sortBy, sortOrder, page, limit } = req.query;
        const result = await driverService.findAll({
            search, status, sortBy, sortOrder,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

router.get('/available', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const drivers = await driverService.findAvailable();
        res.json(drivers);
    } catch (error) { next(error); }
});

router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const stats = await driverService.getStats(req.user);
        res.json(stats);
    } catch (error) { next(error); }
});

router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const driver = await driverService.findById(parseInt(req.params.id));
        if (!driver) return res.status(404).json({ error: 'Driver tidak ditemukan' });
        res.json(driver);
    } catch (error) { next(error); }
});

// Drizzle timestamp columns call `.toISOString()` on the value during INSERT/UPDATE,
// so empty strings (which the date <input> sends when the user leaves the field
// blank) blow up with "value.toISOString is not a function". Normalize to a real
// Date or explicit null.
function normalizeLicenseExpiry(data) {
    if (!('licenseExpiry' in data)) return;
    const v = data.licenseExpiry;
    if (v === '' || v === null || v === undefined) {
        data.licenseExpiry = null;
        return;
    }
    const d = v instanceof Date ? v : new Date(v);
    data.licenseExpiry = isNaN(d.getTime()) ? null : d;
}

router.post('/', requireAuth, requireAdmin, validate(driverSchema), activityLogger('create', 'driver'), async (req, res, next) => {
    try {
        const data = {
            ...req.body,
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        };
        normalizeLicenseExpiry(data);
        const driver = await driverService.create(data);
        res.status(201).json(driver);
    } catch (error) { next(error); }
});

router.put('/:id', requireAuth, requireAdmin, activityLogger('update', 'driver'), async (req, res, next) => {
    try {
        const data = { ...req.body };
        normalizeLicenseExpiry(data);
        const driver = await driverService.update(parseInt(req.params.id), data);
        if (!driver) return res.status(404).json({ error: 'Driver tidak ditemukan' });
        res.json(driver);
    } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, requireAdmin, activityLogger('delete', 'driver'), async (req, res, next) => {
    try {
        const driver = await driverService.delete(parseInt(req.params.id));
        if (!driver) return res.status(404).json({ error: 'Driver tidak ditemukan' });
        res.json({ message: 'Driver berhasil dihapus', data: driver });
    } catch (error) { next(error); }
});

// ─── Bulk export — full snapshot for backup or external editing ─────────────
router.get('/data/export', requireAuth, requireAdmin, async (_req, res, next) => {
    try {
        const result = await driverService.findAll({ limit: 100000, page: 1 });
        res.json(result.data || []);
    } catch (error) { next(error); }
});

// ─── Bulk import — accepts an array of driver rows; idempotent dedupe by phone+name ──
router.post('/data/import', requireAuth, requireAdmin, activityLogger('create', 'driver'), async (req, res, next) => {
    try {
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Data import harus berupa array dan tidak boleh kosong.' });
        }
        let imported = 0, skipped = 0;
        const errors = [];
        for (const item of items) {
            try {
                const name = item.name || item.nama;
                if (!name) { skipped++; errors.push('Baris tanpa nama dilewati'); continue; }
                const phone = item.phone || item.telepon || '0000000000';
                const data = {
                    name,
                    phone,
                    licenseNumber: item.licenseNumber || item.sim || null,
                    licenseExpiry: (() => {
                        if (!item.licenseExpiry) return null;
                        const d = new Date(item.licenseExpiry);
                        return isNaN(d.getTime()) ? null : d;
                    })(),
                    status: item.status || 'active',
                    address: item.address || item.alamat || null,
                    notes: item.notes || item.catatan || null,
                    organizationId: req.user.organizationId || null,
                    createdBy: req.user.id,
                    isDemo: req.user.isDemo || false,
                };
                await driverService.create(data);
                imported++;
            } catch (err) {
                skipped++;
                errors.push(err.message);
            }
        }
        res.json({
            message: `Import selesai: ${imported} berhasil, ${skipped} dilewati.`,
            imported, skipped, errors: errors.slice(0, 20),
        });
    } catch (error) { next(error); }
});

// Upload documents
router.post('/:id/upload', requireAuth, requireAdmin, upload.fields([
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'idCard', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
]), activityLogger('update', 'driver'), async (req, res, next) => {
    try {
        const docs = {};
        if (req.files?.licenseDoc?.[0]) docs.licenseDocUrl = `/uploads/${req.files.licenseDoc[0].filename}`;
        if (req.files?.idCard?.[0]) docs.idCardUrl = `/uploads/${req.files.idCard[0].filename}`;
        if (req.files?.photo?.[0]) docs.photoUrl = `/uploads/${req.files.photo[0].filename}`;

        const driver = await driverService.updateDocuments(parseInt(req.params.id), docs);
        if (!driver) return res.status(404).json({ error: 'Driver tidak ditemukan' });
        res.json(driver);
    } catch (error) { next(error); }
});

export default router;
