import { Router } from 'express';
import { carService } from '../services/car.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

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
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) return cb(null, true);
        cb(new Error('Hanya file gambar (JPG, PNG, GIF, WebP) yang diizinkan'));
    },
});

// ─── Validation ──────────────────────────────────────────────────────
const carSchema = z.object({
    name: z.string().min(1, 'Nama mobil wajib diisi'),
    brand: z.string().min(1, 'Merek wajib diisi'),
    type: z.enum(['MPV', 'SUV', 'Sedan', 'City Car', 'Sport']),
    category: z.enum(['economy', 'standard', 'premium', 'luxury']).optional(),
    year: z.number().int().optional().nullable(),
    licensePlate: z.string().optional().nullable(),
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

router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const stats = await carService.getStats();
        res.json(stats);
    } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
    try {
        const car = await carService.findById(parseInt(req.params.id));
        if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan' });
        res.json(car);
    } catch (error) { next(error); }
});

// ─── Admin Routes ────────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
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
router.post('/upload', requireAuth, requireAdmin, upload.array('images', 5), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Minimal 1 gambar harus diunggah' });
    }
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ urls });
});

router.post('/', requireAuth, requireAdmin, validate(carSchema), activityLogger('create', 'car'), async (req, res, next) => {
    try {
        const car = await carService.create({
            ...req.body,
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        });
        res.status(201).json(car);
    } catch (error) { next(error); }
});

router.put('/:id', requireAuth, requireAdmin, activityLogger('update', 'car'), async (req, res, next) => {
    try {
        const car = await carService.update(parseInt(req.params.id), req.body);
        if (!car) return res.status(404).json({ error: 'Mobil tidak ditemukan' });
        res.json(car);
    } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, requireAdmin, activityLogger('delete', 'car'), async (req, res, next) => {
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
router.get('/data/export', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const allCars = await carService.findAllRaw();
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
router.post('/data/import', requireAuth, requireAdmin, activityLogger('create', 'car'), async (req, res, next) => {
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

        for (const item of items) {
            try {
                if (!item.name) { skipped++; errors.push('Baris tanpa nama kendaraan dilewati'); continue; }
                await carService.create({
                    name:          item.name,
                    brand:         item.brand         || null,
                    type:          item.type          || 'MPV',
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
