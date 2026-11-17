import { Router } from 'express';
import { carService } from '../services/car.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger, auditRead } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { requireRowScope, requireBodyRowScope } from '../middleware/row-scope.js';
import { cars as cars } from '../db/schema.js';
import { fleetTypesService } from '../services/fleet-types.service.js';
import { cleanType } from '../services/fleet-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

// ─── File Upload Config ──────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `car-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        // Anchored: extension AND mime must be real image types (no .svg/.html).
        const ext = /^\.(jpe?g|png|gif|webp)$/.test(path.extname(file.originalname).toLowerCase());
        const mime = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
        if (ext && mime) return cb(null, true);
        cb(new Error('Hanya file gambar (JPG, PNG, GIF, WebP) yang diizinkan'));
    },
});

// ─── Validation ──────────────────────────────────────────────────────
const carSchema = z.object({
    name: z.string().min(1, 'Nama mobil wajib diisi'),
    brand: z.string().min(1, 'Merek wajib diisi'),
    type: z.string().trim().min(1, 'Tipe wajib diisi').max(40),   // agency list (Kelola tipe), checked in the handler
    category: z.enum(['economy', 'standard', 'premium', 'luxury']).optional(),
    year: z.number().int().optional().nullable(),
    licensePlate: z.string().optional().nullable(),
    isOwned: z.boolean().optional(),
    color: z.string().optional().nullable(),
    image: z.string().min(1, 'Gambar wajib diisi'),
    gallery: z.array(z.string()).optional().nullable(),
    price: z.string().or(z.number()),
    capacity: z.number().int().min(1),
    transmission: z.enum(['Automatic', 'Manual']),
    fuel: z.enum(['Bensin', 'Diesel', 'Pertamax', 'Electric']).optional(),
    description: z.string().optional().nullable(),
    features: z.array(z.string()).optional().nullable(),
    status: z.enum(['available', 'rented', 'maintenance']).optional(),
    availableCount: z.number().int().optional(),
});

// ─── Public Routes ───────────────────────────────────────────────────
router.get('/public', async (req, res, next) => {
    try {
        const data = await carService.findPublic();
        res.json(data);
    } catch (error) { next(error); }
});

router.get('/public/availability', async (req, res, next) => {
    try {
        res.set('Cache-Control', 'public, max-age=300');
        res.json(await carService.publicAvailability(req.query.days));
    } catch (error) { next(error); }
});

router.get('/public/summary', async (req, res, next) => {
    try {
        res.set('Cache-Control', 'public, max-age=600');
        res.json(await carService.publicSummary());
    } catch (error) { next(error); }
});

router.get('/stats', requireAuth, requirePerm('fleet', 'view'), async (req, res, next) => {
    try {
        const stats = await carService.getStats();
        res.json(stats);
    } catch (error) { next(error); }
});

// ─── Vehicle types per agency (Armada → Kelola tipe) — before /:id ──────
router.get('/types', requireAuth, requireAnyPerm('fleet.view', 'orders.create', 'orders.edit', 'settings.view'), async (req, res, next) => {
    try { res.json(await fleetTypesService.get(req.user)); } catch (e) { next(e); }
});
const typesSchema = z.object({
    types: z.array(z.string().max(60)).min(1).max(50),
    renames: z.array(z.object({ from: z.string().max(60), to: z.string().max(60) })).max(50).optional(),
});
router.put('/types', requireAuth, requirePerm('fleet', 'edit'), validate(typesSchema), activityLogger('update', 'fleet_types'), async (req, res, next) => {
    try { res.json(await fleetTypesService.save(req.user, req.body)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.get('/:id', async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        if (!Number.isInteger(id)) return res.status(404).json({ error: 'Mobil tidak ditemukan' });
        const car = await carService.findPublicById(id);
        if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan' });
        res.json(car);
    } catch (error) { next(error); }
});

// ─── Admin Routes ────────────────────────────────────────────────────
router.get('/', requireAuth, requireAnyPerm('fleet.view', 'orders.create', 'orders.edit', 'schedule.view', 'analytics.view'), async (req, res, next) => {
    try {
        const { search, status, type, category, sortBy, sortOrder, page, limit } = req.query;
        const result = await carService.findAll({
            search, status, type, category, sortBy, sortOrder,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

// Upload car images (3 images: front, side, back)
router.post('/upload', requireAuth, requireAnyPerm('fleet.create', 'fleet.edit'), upload.array('images', 5), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Minimal 1 gambar harus diunggah' });
    }
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ urls });
});

router.post('/', requireAuth, requirePerm('fleet', 'create'), validate(carSchema), activityLogger('create', 'car'), async (req, res, next) => {
    try {
        const type = await fleetTypesService.assertType(req.user, req.body.type);
        const car = await carService.create({
            ...req.body,
            type,
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        });
        res.status(201).json(car);
    } catch (error) { next(error); }
});

// Bulk status change for several units at once. Registered BEFORE `/:id`
// so the literal path isn't captured as a car id.
const bulkStatusSchema = z.object({
    ids: z.array(z.number().int()).min(1).max(500),
    status: z.enum(['available', 'rented', 'maintenance']),
});

router.put('/bulk-status', requireAuth, requirePerm('fleet', 'edit'), requireBodyRowScope(cars, (b) => b.ids), validate(bulkStatusSchema), activityLogger('update', 'car'), async (req, res, next) => {
    try {
        const updated = await carService.bulkUpdateStatus(req.body.ids, req.body.status);
        res.json({ updated: updated.length, status: req.body.status });
    } catch (error) { next(error); }
});

// Bulk delete units. Literal path — registered before /:id.
const bulkDeleteSchema = z.object({ ids: z.array(z.number().int()).min(1).max(500) });
router.post('/bulk-delete', requireAuth, requirePerm('fleet', 'delete'), requireBodyRowScope(cars, (b) => b.ids), validate(bulkDeleteSchema), activityLogger('delete', 'car'), async (req, res, next) => {
    try {
        const result = await carService.bulkDelete(req.body.ids);
        res.json(result);
    } catch (error) { next(error); }
});

// Partial updates (edit modal + inline ✏️). Zod strips unknown keys so a
// client can't mass-assign columns like organization_id.
router.put('/:id', requireAuth, requirePerm('fleet', 'edit'), requireRowScope(cars), validate(carSchema.partial()), activityLogger('update', 'car'), async (req, res, next) => {
    try {
        const body = req.body.type !== undefined ? { ...req.body, type: await fleetTypesService.assertType(req.user, req.body.type) } : req.body;
        const car = await carService.update(parseInt(req.params.id), body);
        if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan' });
        res.json(car);
    } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, requirePerm('fleet', 'delete'), requireRowScope(cars), activityLogger('delete', 'car'), async (req, res, next) => {
    try {
        const carId = parseInt(req.params.id);
        // Only block if there are ACTIVE orders (pending/confirmed/active)
        const hasActive = await carService.hasActiveOrders(carId);
        if (hasActive) {
            return res.status(409).json({
                error: 'Tidak dapat menghapus mobil ini karena masih memiliki pesanan aktif (pending/confirmed/active).'
            });
        }
        const car = await carService.delete(carId);
        if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan' });
        res.json({ message: 'Mobil berhasil dihapus', data: car });
    } catch (error) { next(error); }
});

// ─── Export fleet data as JSON ───────────────────────────────────────
router.get('/data/export', requireAuth, requirePerm('fleet', 'view'), auditRead('export', 'cars'), async (req, res, next) => {
    try {
        const allCars = await carService.findAllRaw(req.user);   // tenant-scoped
        // Strip internal IDs / timestamps for clean export
        const exportData = allCars.map(c => ({
            name: c.name, brand: c.brand, type: c.type,
            category: c.category, year: c.year,
            licensePlate: c.licensePlate, color: c.color,
            image: c.image, gallery: c.gallery,
            price: c.price, capacity: c.capacity,
            transmission: c.transmission, fuel: c.fuel,
            description: c.description, features: c.features,
            status: c.status, availableCount: c.availableCount,
        }));
        res.setHeader('Content-Disposition', `attachment; filename=fleet-export-${Date.now()}.json`);
        res.json(exportData);
    } catch (error) { next(error); }
});

// ─── Import fleet data from JSON ────────────────────────────────────
router.post('/data/import', requireAuth, requirePerm('fleet', 'create'), activityLogger('create', 'car'), async (req, res, next) => {
    try {
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Data import harus berupa array dan tidak boleh kosong.' });
        }

        // ── Value normalizers ────────────────────────────────────────────────
        const STATUS_MAP = {
            tersedia: 'available', available: 'available',
            disewa: 'rented',     rented: 'rented', sewa: 'rented',
            perawatan: 'maintenance', maintenance: 'maintenance', servis: 'maintenance',
        };
        const CATEGORY_MAP = {
            economy: 'economy', ekonomi: 'economy',
            standard: 'standard', standar: 'standard',
            premium: 'premium',
            luxury: 'luxury', mewah: 'luxury',
        };
        const normalizeStatus   = (v) => STATUS_MAP[String(v || '').toLowerCase().trim()] || 'available';
        const normalizeCategory = (v) => CATEGORY_MAP[String(v || '').toLowerCase().trim()] || 'standard';
        // Extract leading integer from strings like "7 Kursi" or "7"
        const normalizeCapacity = (v) => {
            const n = parseInt(String(v ?? ''), 10);
            return Number.isFinite(n) ? n : 7;
        };

        let imported = 0, skipped = 0;
        const errors = [];
        // New type names in the file join the agency's list (Kelola tipe).
        await fleetTypesService.mergeTypes(req.user, items.map((i) => i?.type).filter(Boolean));

        for (const item of items) {
            try {
                if (!item.name) { skipped++; errors.push('Baris tanpa nama kendaraan dilewati'); continue; }
                await carService.create({
                    name:          item.name,
                    brand:         item.brand         || null,
                    type:          cleanType(item.type) || 'MPV',
                    category:      normalizeCategory(item.category),
                    year:          item.year          ? Number(item.year) : null,
                    licensePlate:  item.licensePlate  || null,
                    color:         item.color         || null,
                    image:         item.image         || '',
                    gallery:       item.gallery       || null,
                    price:         String(Number(item.price) || 0),
                    capacity:      normalizeCapacity(item.capacity),
                    transmission:  item.transmission  || 'Automatic',
                    fuel:          item.fuel          || 'Bensin',
                    description:   item.description   || null,
                    features:      item.features      || null,
                    status:        normalizeStatus(item.status),
                    availableCount: Number(item.availableCount) || 1,
                    organizationId: req.user.organizationId || null,
                    createdBy:     req.user.id,
                    isDemo:        req.user.isDemo || false,
                });
                imported++;
            } catch (err) {
                skipped++;
                errors.push(item.licensePlate
                    ? `[${item.licensePlate}] ${err.message}`
                    : err.message);
            }
        }
        res.json({
            message: `Import selesai: ${imported} berhasil, ${skipped} dilewati.`,
            imported, skipped, errors: errors.slice(0, 20),
        });
    } catch (error) { next(error); }
});

export default router;
