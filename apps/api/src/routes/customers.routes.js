import { Router } from 'express';
import { customerService } from '../services/customer.service.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { activityLogger, auditRead } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { requireRowScope, requireBodyRowScope } from '../middleware/row-scope.js';
import { customers as customers } from '../db/schema.js';

const router = Router();

const customerSchema = z.object({
    name: z.string().min(1, 'Nama wajib diisi'),
    // '' from an empty form field → null (was rejected as invalid email).
    email: z.preprocess((v) => (typeof v === 'string' && !v.trim() ? null : v), z.string().email().optional().nullable()),
    phone: z.string().optional().nullable(),
    whatsapp: z.string().optional().nullable(),
    customerType: z.enum(['private', 'company']).optional(),
    job: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    status: z.enum(['active', 'vip', 'inactive', 'pending']).optional(),
    notes: z.string().optional().nullable(),
    companyName: z.string().optional().nullable(),
});
// PUT whitelist — unknown keys are stripped, so tenant/owner columns
// (organizationId, createdBy, isDemo, userId) can't be rewritten via the body.
const customerUpdateSchema = customerSchema.partial();

router.get('/', requireAuth, requireAnyPerm('customers.view', 'orders.create', 'orders.edit'), async (req, res, next) => {
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

router.get('/stats', requireAuth, requirePerm('customers', 'view'), async (req, res, next) => {
    try {
        const stats = await customerService.getStats(req.user);
        res.json(stats);
    } catch (error) { next(error); }
});

router.get('/:id', requireAuth, requireAnyPerm('customers.view', 'orders.view'), requireRowScope(customers), async (req, res, next) => {
    try {
        const customer = await customerService.findById(parseInt(req.params.id));
        if (!customer) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
        const orderHistory = await customerService.getOrderHistory(customer.id);
        res.json({ ...customer, orderHistory });
    } catch (error) { next(error); }
});

router.post('/', requireAuth, requirePerm('customers', 'create'), validate(customerSchema), activityLogger('create', 'customer'), async (req, res, next) => {
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

router.put('/:id', requireAuth, requirePerm('customers', 'edit'), requireRowScope(customers), validate(customerUpdateSchema), activityLogger('update', 'customer'), async (req, res, next) => {
    try {
        const customer = await customerService.update(parseInt(req.params.id), req.body);
        if (!customer) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
        res.json(customer);
    } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, requirePerm('customers', 'delete'), requireRowScope(customers), activityLogger('delete', 'customer'), async (req, res, next) => {
    try {
        const customer = await customerService.delete(parseInt(req.params.id));
        if (!customer) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
        res.json({ message: 'Pelanggan berhasil dihapus', data: customer });
    } catch (error) { next(error); }
});

// ─── Anonymize (UU PDP "hak penghapusan") ──────────────────────────────────
// Removes the person's identifying data but keeps the customer row and its
// orders/invoices, because financial records must be retained. Irreversible.
router.post('/:id/anonymize', requireAuth, requirePerm('customers', 'delete'), requireRowScope(customers), activityLogger('delete', 'customer_personal_data'), async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const label = `Pelanggan dihapus #${id}`;
        const { orders } = await import('../db/schema.js');
        const { eq } = await import('drizzle-orm');
        const { db } = await import('../db/index.js');
        const result = await db.transaction(async (tx) => {
            const [c] = await tx.update(customers).set({
                name: label, email: null, phone: null, whatsapp: null, address: null, job: null, notes: null,
                userId: null, status: 'inactive', updatedAt: new Date(),
            }).where(eq(customers.id, id)).returning({ id: customers.id });
            if (!c) return null;
            await tx.update(orders).set({ customerName: label, updatedAt: new Date() }).where(eq(orders.customerId, id));
            return c;
        });
        if (!result) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
        res.json({ id, anonymized: true });
    } catch (error) { next(error); }
});

// ─── Bulk delete ──────────────────────────────────────────────────────────
router.post('/bulk-delete', requireAuth, requirePerm('customers', 'delete'), requireBodyRowScope(customers, (b) => b.ids), activityLogger('delete', 'customer'), async (req, res, next) => {
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
router.post('/deduplicate', requireAuth, requireSuperAdmin, activityLogger('update', 'customer'), async (req, res, next) => {
    try {
        const result = await customerService.deduplicateByName();
        res.json({
            message: `Deduplikasi selesai: ${result.mergedGroups} grup digabung, ${result.removed} data dihapus.`,
            ...result,
        });
    } catch (error) { next(error); }
});

// ─── Bulk export — full snapshot for backup or external editing ─────────────
router.get('/data/export', requireAuth, requirePerm('customers', 'view'), auditRead('export', 'customers'), async (req, res, next) => {
    try {
        // Scoped like the list — never another tenant's customers.
        const result = await customerService.findAll({ limit: 100000, page: 1, scopeUser: req.user });
        res.json(result.data || []);
    } catch (error) { next(error); }
});

// ─── Bulk import — accepts an array of customer rows; dedupe by phone, email, or name ───
router.post('/data/import', requireAuth, requirePerm('customers', 'create'), activityLogger('create', 'customer'), async (req, res, next) => {
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
