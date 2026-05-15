import { Router } from 'express';
import { customerService } from '../services/customer.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const router = Router();

const customerSchema = z.object({
    name: z.string().min(1, 'Nama wajib diisi'),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    whatsapp: z.string().optional().nullable(),
    customerType: z.enum(['private', 'company']).optional(),
    job: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    status: z.enum(['active', 'vip', 'inactive', 'pending']).optional(),
    notes: z.string().optional().nullable(),
});

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { search, status, customerType, sortBy, sortOrder, page, limit } = req.query;
        const result = await customerService.findAll({
            search, status, customerType, sortBy, sortOrder,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 20,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const stats = await customerService.getStats(req.user);
        res.json(stats);
    } catch (error) { next(error); }
});

router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const customer = await customerService.findById(parseInt(req.params.id));
        if (!customer) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
        const orderHistory = await customerService.getOrderHistory(customer.id);
        res.json({ ...customer, orderHistory });
    } catch (error) { next(error); }
});

router.post('/', requireAuth, requireAdmin, validate(customerSchema), activityLogger('create', 'customer'), async (req, res, next) => {
    try {
        const customer = await customerService.create({
            ...req.body,
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        });
        res.status(201).json(customer);
    } catch (error) { next(error); }
});

router.put('/:id', requireAuth, requireAdmin, activityLogger('update', 'customer'), async (req, res, next) => {
    try {
        const customer = await customerService.update(parseInt(req.params.id), req.body);
        if (!customer) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
        res.json(customer);
    } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, requireAdmin, activityLogger('delete', 'customer'), async (req, res, next) => {
    try {
        const customer = await customerService.delete(parseInt(req.params.id));
        if (!customer) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
        res.json({ message: 'Pelanggan berhasil dihapus', data: customer });
    } catch (error) { next(error); }
});

// ─── Bulk delete ──────────────────────────────────────────────────────────
router.post('/bulk-delete', requireAuth, requireAdmin, activityLogger('delete', 'customer'), async (req, res, next) => {
    try {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0)
            return res.status(400).json({ error: 'ids diperlukan.' });
        const result = await customerService.bulkDelete(ids.map(Number));
        res.json({
            message: `${result.deleted} pelanggan dihapus, ${result.skipped} dilewati (memiliki pesanan).`,
            ...result,
        });
    } catch (error) { next(error); }
});

// ─── Deduplicate by name ──────────────────────────────────────────────────
router.post('/deduplicate', requireAuth, requireAdmin, activityLogger('update', 'customer'), async (req, res, next) => {
    try {
        const result = await customerService.deduplicateByName();
        res.json({
            message: `Deduplikasi selesai: ${result.mergedGroups} grup digabung, ${result.removed} data dihapus.`,
            ...result,
        });
    } catch (error) { next(error); }
});

// ─── Bulk export — full snapshot for backup or external editing ─────────────
router.get('/data/export', requireAuth, requireAdmin, async (_req, res, next) => {
    try {
        const result = await customerService.findAll({ limit: 100000, page: 1 });
        res.json(result.data || []);
    } catch (error) { next(error); }
});

// ─── Bulk import — accepts an array of customer rows; dedupe by phone, email, or name ───
router.post('/data/import', requireAuth, requireAdmin, activityLogger('create', 'customer'), async (req, res, next) => {
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
                const companyName = item.companyName || item.company_name || null;
                const customerType = (item.customerType || (companyName ? 'company' : 'private')).toLowerCase();
                const phone = item.phone || item.whatsapp || null;
                const email = item.email || null;
                // Reuse findOrCreate (matches by phone) and patch name/company afterwards
                let customer = await customerService.findOrCreate({
                    name, companyName, customerType,
                    phone, whatsapp: phone, email,
                    job: item.job || null, address: item.address || null,
                    status: item.status || 'active',
                    notes: item.notes || null,
                    organizationId: req.user.organizationId || null,
                    createdBy: req.user.id,
                    isDemo: req.user.isDemo || false,
                });
                if (customer && (
                    (companyName && customer.companyName !== companyName) ||
                    (customer.customerType !== customerType)
                )) {
                    customer = await customerService.update(customer.id, {
                        companyName: companyName || customer.companyName,
                        customerType,
                    });
                }
                imported++;
            } catch (err) { skipped++; errors.push(err.message); }
        }
        res.json({
            message: `Import selesai: ${imported} berhasil, ${skipped} dilewati.`,
            imported, skipped, errors: errors.slice(0, 20),
        });
    } catch (error) { next(error); }
});

export default router;
