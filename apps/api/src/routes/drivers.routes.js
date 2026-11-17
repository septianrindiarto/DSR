import { Router } from 'express';
import { driverService } from '../services/driver.service.js';
import { driverAppService } from '../services/driver-app.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger, auditRead } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { privateUpload, toPrivateRef, removePrivateRef, sendPrivate, isPrivateRef, isLegacySensitive } from '../services/private-files.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { requireRowScope, requireBodyRowScope } from '../middleware/row-scope.js';
import { drivers as drivers } from '../db/schema.js';

const router = Router();

// SIM, KTP and photo are personal data → private storage
// (uploads-private/drivers/<driverId>/), streamed via GET /:id/document/:kind.
const upload = privateUpload({ area: 'drivers', subDir: (req) => req.params.id, kinds: ['image', 'pdf'], maxMb: 10 });
const DOC_FIELDS = { licenseDoc: 'licenseDocUrl', idCard: 'idCardUrl', photo: 'photoUrl' };

const driverSchema = z.object({
    name: z.string().min(1, 'Nama wajib diisi'),
    phone: z.string().min(1, 'No. HP wajib diisi'),
    licenseNumber: z.string().optional().nullable(),
    licenseExpiry: z.string().optional().nullable(),
    // Tanggal bergabung (YYYY-MM-DD). Empty on create → today (WIB).
    employmentType: z.enum(['employee', 'freelance']).nullable().optional(),
    joinDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal bergabung YYYY-MM-DD'), z.literal('')]).optional().nullable(),
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
    address: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});
// PUT whitelist: unknown keys are stripped (no organizationId, createdBy,
// isDemo or document URLs via the JSON body).
const driverUpdateSchema = driverSchema.partial();

router.get('/', requireAuth, requireAnyPerm('drivers.view', 'orders.create', 'orders.edit', 'schedule.view'), async (req, res, next) => {
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

router.get('/available', requireAuth, requireAnyPerm('drivers.view', 'orders.create', 'orders.edit'), async (req, res, next) => {
    try {
        const drivers = await driverService.findAvailable();
        res.json(drivers);
    } catch (error) { next(error); }
});

router.get('/stats', requireAuth, requirePerm('drivers', 'view'), async (req, res, next) => {
    try {
        const stats = await driverService.getStats(req.user);
        res.json(stats);
    } catch (error) { next(error); }
});

router.get('/:id', requireAuth, requireAnyPerm('drivers.view', 'orders.view'), requireRowScope(drivers), async (req, res, next) => {
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
const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
function normalizeJoinDate(data, { isCreate = false } = {}) {
    if (data.joinDate === '') data.joinDate = null;
    if (isCreate && !data.joinDate) data.joinDate = todayWib();
}

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

router.post('/', requireAuth, requirePerm('drivers', 'create'), validate(driverSchema), activityLogger('create', 'driver'), async (req, res, next) => {
    try {
        const data = {
            ...req.body,
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        };
        normalizeLicenseExpiry(data);
        normalizeJoinDate(data, { isCreate: true });
        const driver = await driverService.create(data);
        res.status(201).json(driver);
    } catch (error) { next(error); }
});

// Bulk status change for several drivers at once. Registered BEFORE `/:id`
// so the literal path isn't captured as a driver id.
const bulkStatusSchema = z.object({
    ids: z.array(z.number().int()).min(1).max(500),
    status: z.enum(['active', 'inactive', 'suspended']),
});

router.put('/bulk-status', requireAuth, requirePerm('drivers', 'edit'), requireBodyRowScope(drivers, (b) => b.ids), validate(bulkStatusSchema), activityLogger('update', 'driver'), async (req, res, next) => {
    try {
        const updated = await driverService.bulkUpdateStatus(req.body.ids, req.body.status);
        res.json({ updated: updated.length, status: req.body.status });
    } catch (error) { next(error); }
});

router.put('/:id', requireAuth, requirePerm('drivers', 'edit'), requireRowScope(drivers), validate(driverUpdateSchema), activityLogger('update', 'driver'), async (req, res, next) => {
    try {
        const data = { ...req.body };
        normalizeLicenseExpiry(data);
        normalizeJoinDate(data);
        const driver = await driverService.update(parseInt(req.params.id), data);
        if (!driver) return res.status(404).json({ error: 'Driver tidak ditemukan' });
        res.json(driver);
    } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, requirePerm('drivers', 'delete'), requireRowScope(drivers), activityLogger('delete', 'driver'), async (req, res, next) => {
    try {
        const driver = await driverService.delete(parseInt(req.params.id));
        if (!driver) return res.status(404).json({ error: 'Driver tidak ditemukan' });
        res.json({ message: 'Driver berhasil dihapus', data: driver });
    } catch (error) { next(error); }
});

// ─── Bulk export — full snapshot for backup or external editing ─────────────
router.get('/data/export', requireAuth, requirePerm('drivers', 'view'), auditRead('export', 'drivers'), async (req, res, next) => {
    try {
        // Scoped like the list — never another tenant's drivers.
        const result = await driverService.findAll({ limit: 100000, page: 1, scopeUser: req.user });
        res.json(result.data || []);
    } catch (error) { next(error); }
});

// ─── Bulk import — accepts an array of driver rows; idempotent dedupe by phone+name ──
router.post('/data/import', requireAuth, requirePerm('drivers', 'create'), activityLogger('create', 'driver'), async (req, res, next) => {
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
                    joinDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.joinDate || item.tanggalBergabung || '')) ? String(item.joinDate || item.tanggalBergabung) : todayWib(),
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
const uploadFields = upload.fields([
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'idCard', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
]);
const uploadDocs = (req, res, next) => uploadFields(req, res, (err) => (err ? res.status(err.status || 400).json({ error: err.message }) : next()));

router.post('/:id/upload', requireAuth, requireAnyPerm('drivers.create', 'drivers.edit'), requireRowScope(drivers), uploadDocs, activityLogger('update', 'driver'), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const before = await driverService.findById(id);
        const docs = {};
        for (const [field, col] of Object.entries(DOC_FIELDS)) {
            const f = req.files?.[field]?.[0];
            if (f) docs[col] = toPrivateRef(f.path);
        }
        const driver = await driverService.updateDocuments(id, docs);
        if (!driver) return res.status(404).json({ error: 'Driver tidak ditemukan' });
        // Remove replaced private files (legacy public files are left alone).
        for (const col of Object.keys(docs)) if (isPrivateRef(before?.[col])) removePrivateRef(before[col], 'drivers');
        res.json(driver);
    } catch (error) { next(error); }
});

// Stream a driver document (scope-checked). Legacy `/uploads/driver-*`
// files are streamed through here too (no longer publicly served).
router.get('/:id/document/:kind', requireAuth, requirePerm('drivers', 'view'), requireRowScope(drivers), auditRead('view', 'driver_document'), async (req, res, next) => {
    try {
        const col = DOC_FIELDS[req.params.kind];
        if (!col) return res.status(400).json({ error: 'Jenis dokumen tidak dikenal.' });
        const driver = await driverService.findById(parseInt(req.params.id));
        const ref = driver?.[col];
        if (!ref) return res.status(404).json({ error: 'Dokumen belum diunggah.' });
        if (!isPrivateRef(ref) && !isLegacySensitive(ref)) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
        sendPrivate(res, ref, 'drivers');
    } catch (error) { next(error); }
});

// ─── Driver app login (create / reset / revoke) ────────────────────────────
router.get('/:id/app-access', requireAuth, requirePerm('drivers', 'view'), requireRowScope(drivers), async (req, res, next) => {
    try { res.json(await driverAppService.accessInfo(req.params.id)); } catch (e) { next(e); }
});
router.post('/:id/app-access', requireAuth, requirePerm('drivers', 'edit'), requireRowScope(drivers),
    validate(z.object({ email: z.string().email(), password: z.string().min(8).max(128) })), activityLogger('create', 'driver_app_access'), async (req, res, next) => {
    try { res.status(201).json(await driverAppService.grantAccess(req.user, req.params.id, req.body)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
router.put('/:id/app-access/password', requireAuth, requirePerm('drivers', 'edit'), requireRowScope(drivers),
    validate(z.object({ password: z.string().min(8).max(128) })), activityLogger('update', 'driver_app_access'), async (req, res, next) => {
    try { res.json(await driverAppService.resetPassword(req.params.id, req.body.password)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});
router.delete('/:id/app-access', requireAuth, requirePerm('drivers', 'edit'), requireRowScope(drivers), activityLogger('delete', 'driver_app_access'), async (req, res, next) => {
    try { res.json(await driverAppService.revokeAccess(req.params.id)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

export default router;
