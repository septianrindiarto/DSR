import { Router } from 'express';
import { companyService } from '../services/company.service.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const router = Router();

// Accept empty strings, dashes, or null — the service layer normalizes empties
// to null before insert. Keeps the API forgiving when the form has placeholder
// values like "-" rather than throwing a 422.
const optionalText = z.preprocess(
    (v) => {
        if (v === null || v === undefined) return null;
        const t = String(v).trim();
        return (!t || t === '-' || t === '—') ? null : t;
    },
    z.string().nullable().optional()
);
const optionalEmail = z.preprocess(
    (v) => {
        if (v === null || v === undefined) return null;
        const t = String(v).trim();
        return (!t || t === '-' || t === '—') ? null : t;
    },
    z.union([z.string().email(), z.null()]).optional()
);
const companySchema = z.object({
    name: z.string().min(1, 'Nama perusahaan wajib diisi'),
    address: optionalText,
    phone: optionalText,
    email: optionalEmail,
    notes: optionalText,
});

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const { search, sortBy, sortOrder, page, limit } = req.query;
        const result = await companyService.findAll({
            search, sortBy, sortOrder,
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 1000,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

// Lookup by exact name (case-insensitive) — used by the Documents page to
// auto-fill the address when the invoice "Nama / Perusahaan" matches.
router.get('/lookup', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const name = req.query.name;
        if (!name) return res.status(400).json({ error: 'Parameter "name" wajib diisi' });
        const company = await companyService.findByName(String(name));
        res.json(company || null);
    } catch (error) { next(error); }
});

router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const company = await companyService.findById(parseInt(req.params.id));
        if (!company) return res.status(404).json({ error: 'Perusahaan tidak ditemukan' });
        res.json(company);
    } catch (error) { next(error); }
});

// Translate noisy DB errors into actionable Indonesian messages so the user
// sees what's actually wrong instead of a "Failed query: insert into..." dump.
function friendlyDbError(error) {
    const msg = (error?.message || '').toLowerCase();
    if (error?.code === 'DUPLICATE') return { status: 409, error: error.message };
    if (error?.code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint')) {
        return { status: 409, error: 'Nama perusahaan sudah terdaftar.' };
    }
    if (error?.code === '42P01' || msg.includes('does not exist') && msg.includes('companies')) {
        return { status: 500, error: 'Tabel "companies" belum dibuat di database. Jalankan: psql $DATABASE_URL -f drizzle/companies_migration.sql' };
    }
    if (error?.code === '23502' || msg.includes('not-null')) {
        return { status: 400, error: 'Ada field wajib yang kosong.' };
    }
    // Strip the verbose "Failed query: ..." prefix that postgres-js logs
    const clean = String(error?.message || 'Terjadi kesalahan').replace(/^Failed query:.*?params:[^\n]*\n?/is, '').trim();
    return { status: 500, error: clean || 'Terjadi kesalahan database' };
}

router.post('/', requireAuth, requireAdmin, validate(companySchema), activityLogger('create', 'company'), async (req, res, next) => {
    try {
        const company = await companyService.create({
            ...req.body,
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        });
        res.status(201).json(company);
    } catch (error) {
        const friendly = friendlyDbError(error);
        return res.status(friendly.status).json(friendly);
    }
});

router.put('/:id', requireAuth, requireAdmin, activityLogger('update', 'company'), async (req, res, next) => {
    try {
        const company = await companyService.update(parseInt(req.params.id), req.body);
        if (!company) return res.status(404).json({ error: 'Perusahaan tidak ditemukan' });
        res.json(company);
    } catch (error) {
        const friendly = friendlyDbError(error);
        return res.status(friendly.status).json(friendly);
    }
});

router.delete('/:id', requireAuth, requireAdmin, activityLogger('delete', 'company'), async (req, res, next) => {
    try {
        const company = await companyService.delete(parseInt(req.params.id));
        if (!company) return res.status(404).json({ error: 'Perusahaan tidak ditemukan' });
        res.json({ message: 'Perusahaan berhasil dihapus', data: company });
    } catch (error) { next(error); }
});

export default router;
