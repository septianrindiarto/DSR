import { Router } from 'express';
import { journalService } from '../services/journal.service.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';

const router = Router();

// ─── LEGACY (archive) ────────────────────────────────────────────────
// Superseded by /api/books (Books v2). Only org-scoped READS stay open to
// admins (list / stats / categories / export / single entry) so the old
// entries remain viewable as an archive. Reports, import, edits, deletes,
// clear and period locks were NOT org-scoped (cross-tenant leak), so they are
// superadmin-only now.

// ─── List entries (Jurnal Umum) ─────────────────────────────────────
router.get('/', requireAuth, requirePerm('finance', 'view'), async (req, res, next) => {
    try {
        const { year, month, quarter, semester, category, search, page, limit } = req.query;
        const result = await journalService.findAll({
            year: year ? Number(year) : undefined,
            month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined,
            semester: semester ? Number(semester) : undefined,
            category, search,
            page: Number(page) || 1,
            limit: Number(limit) || 50,
            scopeUser: req.user,
        });
        res.json(result);
    } catch (error) { next(error); }
});

// ─── Stats ──────────────────────────────────────────────────────────
router.get('/stats', requireAuth, requirePerm('finance', 'view'), async (req, res, next) => {
    try { res.json(await journalService.getStats(req.user)); } catch (error) { next(error); }
});

// ─── Categories ─────────────────────────────────────────────────────
router.get('/categories', requireAuth, requirePerm('finance', 'view'), async (req, res, next) => {
    try { res.json(await journalService.getCategories(req.user)); } catch (error) { next(error); }
});

// ─── General Ledger ─────────────────────────────────────────────────
router.get('/reports/ledger', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { year, month, quarter, semester } = req.query;
        res.json(await journalService.getGeneralLedger({
            year: year ? Number(year) : undefined, month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined, semester: semester ? Number(semester) : undefined,
        }));
    } catch (error) { next(error); }
});

// ─── Trial Balance ──────────────────────────────────────────────────
router.get('/reports/trial-balance', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { year, month, quarter, semester } = req.query;
        res.json(await journalService.getTrialBalance({
            year: year ? Number(year) : undefined, month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined, semester: semester ? Number(semester) : undefined,
        }));
    } catch (error) { next(error); }
});

// ─── Income Statement ───────────────────────────────────────────────
router.get('/reports/income-statement', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { year, month, quarter, semester } = req.query;
        res.json(await journalService.getIncomeStatement({
            year: year ? Number(year) : undefined, month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined, semester: semester ? Number(semester) : undefined,
        }));
    } catch (error) { next(error); }
});

// ─── Cash Flow ──────────────────────────────────────────────────────
router.get('/reports/cash-flow', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { year, month, quarter, semester } = req.query;
        res.json(await journalService.getCashFlow({
            year: year ? Number(year) : undefined, month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined, semester: semester ? Number(semester) : undefined,
        }));
    } catch (error) { next(error); }
});

// ─── Balance Sheet ──────────────────────────────────────────────────
router.get('/reports/balance-sheet', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { year, month, quarter, semester } = req.query;
        res.json(await journalService.getBalanceSheet({
            year: year ? Number(year) : undefined, month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined, semester: semester ? Number(semester) : undefined,
        }));
    } catch (error) { next(error); }
});

// ─── Export ─────────────────────────────────────────────────────────
router.get('/export', requireAuth, requirePerm('finance', 'view'), async (req, res, next) => {
    try {
        const { year, month, quarter, semester, format } = req.query;
        const data = await journalService.exportAll({
            year: year ? Number(year) : undefined, month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined, semester: semester ? Number(semester) : undefined,
        }, req.user);

        if (format === 'csv') {
            const header = 'Tanggal,Bulan,Deskripsi,Kategori,Debit,Kredit,Referensi,JournalRef\n';
            const rows = data.map(e =>
                `"${new Date(e.entryDate).toLocaleDateString('id-ID')}",${e.month},"${e.description}","${e.category}",${e.debit},${e.credit},"${e.reference || ''}","${e.journalRef || ''}"`
            ).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=journal-export.csv');
            return res.send(header + rows);
        }

        res.setHeader('Content-Disposition', 'attachment; filename=journal-export.json');
        res.json(data.map(e => ({
            tanggal: e.entryDate, bulan: e.month, deskripsi: e.description,
            kategori: e.category, debit: Number(e.debit), kredit: Number(e.credit),
            referensi: e.reference, journalRef: e.journalRef,
        })));
    } catch (error) { next(error); }
});

// ─── Import ─────────────────────────────────────────────────────────
router.post('/import', requireAuth, requireSuperAdmin, activityLogger('create', 'journal_entries'), async (req, res, next) => {
    try {
        const rows = req.body?.rows || req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'Data harus berupa array transaksi.' });
        }
        const batchId = `batch-${Date.now()}`;
        const scopeStamp = {
            organizationId: req.user.organizationId || null,
            createdBy: req.user.id,
            isDemo: req.user.isDemo || false,
        };
        const result = await journalService.importEntries(rows, batchId, scopeStamp);
        res.json({
            message: `Import selesai: ${result.imported} berhasil, ${result.skipped} dilewati.`,
            ...result,
        });
    } catch (error) { next(error); }
});

// ─── Clear all entries (admin action — must be before /:id routes) ──────────
router.post('/clear', requireAuth, requireSuperAdmin, activityLogger('delete', 'journal_entries'), async (req, res, next) => {
    try {
        const { year, month, quarter, semester, force } = req.body || {};
        const result = await journalService.clearAll({
            year: year ? Number(year) : undefined,
            month: month ? Number(month) : undefined,
            quarter: quarter ? Number(quarter) : undefined,
            semester: semester ? Number(semester) : undefined,
        }, !!force);
        res.json({ message: `${result.deleted} entri dihapus dari jurnal.`, ...result });
    } catch (error) { next(error); }
});

// ─── Period Locking (must be before /:id to avoid param collision) ──
// GET /api/journal/periods/locked
router.get('/periods/locked', requireAuth, requireSuperAdmin, async (_req, res, next) => {
    try {
        const rows = await journalService.listLockedPeriods();
        res.json(rows);
    } catch (error) { next(error); }
});

// POST /api/journal/periods/lock
router.post('/periods/lock', requireAuth, requireSuperAdmin, activityLogger('create', 'locked_periods'), async (req, res, next) => {
    try {
        const { year, month } = req.body || {};
        if (!year) return res.status(400).json({ error: 'Tahun wajib diisi.' });
        const row = await journalService.lockPeriod(Number(year), month ? Number(month) : null, req.user?.id);
        res.status(201).json(row);
    } catch (error) { next(error); }
});

// DELETE /api/journal/periods/lock/:id
router.delete('/periods/lock/:id', requireAuth, requireSuperAdmin, activityLogger('delete', 'locked_periods'), async (req, res, next) => {
    try {
        const row = await journalService.unlockPeriod(Number(req.params.id));
        if (!row) return res.status(404).json({ error: 'Kunci tidak ditemukan.' });
        res.json({ ok: true, deleted: row });
    } catch (error) { next(error); }
});

// ─── Get single entry ───────────────────────────────────────────────
router.get('/:id', requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const entry = await journalService.getEntry(Number(req.params.id));
        if (!entry) return res.status(404).json({ error: 'Entri tidak ditemukan' });
        res.json(entry);
    } catch (error) { next(error); }
});

// ─── Update single entry ────────────────────────────────────────────
router.put('/:id', requireAuth, requireSuperAdmin, activityLogger('update', 'journal_entries'), async (req, res, next) => {
    try {
        const entry = await journalService.updateEntry(Number(req.params.id), req.body);
        res.json(entry);
    } catch (error) { next(error); }
});

// ─── Delete single entry ────────────────────────────────────────────
router.delete('/:id', requireAuth, requireSuperAdmin, activityLogger('delete', 'journal_entries'), async (req, res, next) => {
    try {
        const force = req.query.force === 'true' || req.body?.force === true;
        const entry = await journalService.deleteEntry(Number(req.params.id), force);
        res.json({ message: 'Entri dihapus.', entry });
    } catch (error) { next(error); }
});

// ─── Reverse entry ──────────────────────────────────────────────────
router.post('/:id/reverse', requireAuth, requireSuperAdmin, activityLogger('create', 'journal_entries'), async (req, res, next) => {
    try {
        const reversed = await journalService.reverseEntry(Number(req.params.id));
        res.json({ message: 'Entri reversal dibuat.', entry: reversed });
    } catch (error) { next(error); }
});

// ─── Bulk delete ────────────────────────────────────────────────────
router.post('/bulk-delete', requireAuth, requireSuperAdmin, activityLogger('delete', 'journal_entries'), async (req, res, next) => {
    try {
        const { ids, force } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'IDs diperlukan.' });
        const result = await journalService.bulkDelete(ids.map(Number), !!force);
        res.json({ message: `${result.deleted} entri dihapus, ${result.skipped} dilewati.`, ...result });
    } catch (error) { next(error); }
});

// ─── Delete batch ───────────────────────────────────────────────────
router.delete('/batch', requireAuth, requireSuperAdmin, activityLogger('delete', 'journal_entries'), async (req, res, next) => {
    try {
        const { batchId } = req.body || {};
        if (!batchId) return res.status(400).json({ error: 'batchId diperlukan.' });
        const result = await journalService.deleteBatch(batchId);
        res.json({ message: `${result.deleted} entri dihapus.`, ...result });
    } catch (error) { next(error); }
});

export default router;
