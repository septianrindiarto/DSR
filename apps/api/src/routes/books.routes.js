// ─── /api/books — Books v2 (double-entry journal + financial statements) ─────
// Agency admins + superadmin only. Every handler is org-scoped inside
// booksService (caller's agency). Literal paths are registered before /:id.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { activityLogger } from '../middleware/logger.js';
import { booksService, bookOrgId } from '../services/books.service.js';
import { booksAutoPost } from '../services/books-autopost.service.js';
import { requirePerm } from '../middleware/permission.js';
import { getAccess, hasPerm } from '../services/access.service.js';

const router = Router();

// "Simpan & Posting" in one call also needs finance.post.
async function requirePostIfRequested(req, res, next) {
    try {
        if (req.body?.post === true && !hasPerm(await getAccess(req.user.id), 'finance.post')) {
            return res.status(403).json({ error: 'Anda tidak memiliki hak posting jurnal.', code: 'PERMISSION_DENIED', permission: 'finance.post' });
        }
        next();
    } catch (e) { next(e); }
}
router.use(requireAuth);

// Uniform error mapping (service throws errors carrying .status).
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) {
        if (e.status) return res.status(e.status).json({ error: e.message, ...(e.details ? { details: e.details } : {}) });
        next(e);
    }
};

const money = z.union([z.number(), z.string()]).optional();
const lineSchema = z.object({
    accountId: z.number().int(),
    debit: money, credit: money,
    memo: z.string().max(300).nullable().optional(),
    orderNumber: z.string().max(20).nullable().optional(),
    carId: z.number().int().nullable().optional(),
});
const txSchema = z.object({
    date: z.string(),
    description: z.string().min(1).max(500),
    reference: z.string().max(100).nullable().optional(),
    lines: z.array(lineSchema).min(2).max(200),
    source: z.enum(['manual', 'cashbook', 'template', 'opening']).optional(),
    post: z.boolean().optional(),
});
const accountSchema = z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(255),
    type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
    normalBalance: z.enum(['debit', 'credit']),
    description: z.string().nullable().optional(),
    isCash: z.boolean().optional(),
    cashFlowClass: z.enum(['operating', 'investing', 'financing']).nullable().optional(),
    isActive: z.boolean().optional(),
});
const importSchema = z.object({
    cashAccountId: z.number().int(),
    rows: z.array(z.object({
        date: z.string(), description: z.string().nullable().optional(), reference: z.string().nullable().optional(),
        amountIn: money, amountOut: money, label: z.string().nullable().optional(),
    })).min(1).max(5000),
    mappings: z.array(z.object({ label: z.string(), direction: z.enum(['in', 'out']), accountId: z.number().int() })).max(2000),
    opening: z.object({ date: z.string(), amount: z.union([z.number(), z.string()]) }).nullable().optional(),
});

// ─── Accounts ────────────────────────────────────────────────────────────────
router.get('/accounts', requirePerm('finance', 'view'), wrap((req) => booksService.listAccounts(req.user)));
router.post('/accounts/seed', requirePerm('finance', 'edit'), activityLogger('create', 'chart_of_accounts'), wrap((req) => booksService.seedDefaultAccounts(req.user)));
router.post('/accounts', requirePerm('finance', 'edit'), validate(accountSchema), activityLogger('create', 'chart_of_accounts'), wrap((req) => booksService.createAccount(req.user, req.body)));
router.put('/accounts/:id', requirePerm('finance', 'edit'), validate(accountSchema.partial()), activityLogger('update', 'chart_of_accounts'), wrap((req) => booksService.updateAccount(req.user, req.params.id, req.body)));
router.delete('/accounts/:id', requirePerm('finance', 'edit'), activityLogger('delete', 'chart_of_accounts'), wrap((req) => booksService.deleteAccount(req.user, req.params.id)));

// ─── Import (cash book) ─────────────────────────────────────────────────────
router.post('/import/suggest', requirePerm('finance', 'create'), validate(z.object({ labels: z.array(z.object({ label: z.string(), direction: z.enum(['in', 'out']) })).max(2000) })),
    wrap((req) => booksService.suggestMappings(req.user, req.body.labels)));
router.post('/import/cashbook', requirePerm('finance', 'create'), validate(importSchema), activityLogger('create', 'book_transactions'), wrap((req) => booksService.importCashbook(req.user, req.body)));

// ─── Period locks ───────────────────────────────────────────────────────────
router.get('/locks', requirePerm('finance', 'view'), wrap((req) => booksService.listLocks(req.user)));
router.post('/locks', requirePerm('finance', 'lock'), validate(z.object({ year: z.number().int(), month: z.number().int() })), activityLogger('create', 'book_period_locks'), wrap((req) => booksService.lock(req.user, req.body)));
router.delete('/locks/:id', requirePerm('finance', 'lock'), activityLogger('delete', 'book_period_locks'), wrap((req) => booksService.unlock(req.user, req.params.id)));

// ─── Reports ────────────────────────────────────────────────────────────────
router.get('/reports/trial-balance', requirePerm('finance', 'view'), wrap((req) => booksService.trialBalance(req.user, req.query)));
router.get('/reports/income-statement', requirePerm('finance', 'view'), wrap((req) => booksService.incomeStatement(req.user, req.query)));
router.get('/reports/balance-sheet', requirePerm('finance', 'view'), wrap((req) => booksService.balanceSheet(req.user, req.query)));
router.get('/reports/cash-flow', requirePerm('finance', 'view'), wrap((req) => booksService.cashFlow(req.user, req.query)));
router.get('/reports/equity', requirePerm('finance', 'view'), wrap((req) => booksService.equityStatement(req.user, req.query)));
router.get('/reports/ledger', requirePerm('finance', 'view'), wrap((req) => booksService.ledger(req.user, req.query)));
router.get('/reports/insights', requirePerm('finance', 'view'), wrap((req) => booksService.insights(req.user, req.query)));

// ─── Catat Transaksi (guided entry) ─────────────────────────────────────────
const quickSchema = z.object({
    type: z.string().min(1).max(40),
    date: z.string(),
    amount: z.union([z.number(), z.string()]),
    cashAccountId: z.number().int().nullable().optional(),
    toCashAccountId: z.number().int().nullable().optional(),
    counterAccountId: z.number().int().nullable().optional(),
    onCredit: z.boolean().optional(),
    carId: z.number().int().nullable().optional(),
    orderNumber: z.string().max(20).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    reference: z.string().max(100).nullable().optional(),
    memo: z.string().max(300).nullable().optional(),
});
router.get('/quick/types', requirePerm('finance', 'view'), wrap(() => booksService.quickTypes()));
// Posted immediately when the user may post; otherwise saved as draft for review.
router.post('/quick', requirePerm('finance', 'create'), validate(quickSchema), activityLogger('create', 'book_transactions'),
    wrap(async (req) => booksService.quickEntry(req.user, req.body, { post: hasPerm(await getAccess(req.user.id), 'finance.post') })));

// ─── Auto-posting (invoices & payments) ─────────────────────────────────────
router.get('/auto/status', requirePerm('finance', 'view'), wrap(async (req) => booksAutoPost.status(await bookOrgId(req.user))));
router.post('/auto/resync', requirePerm('finance', 'post'), activityLogger('update', 'book_transactions'),
    wrap(async (req) => booksAutoPost.resyncOrg(await bookOrgId(req.user), req.user.id)));

// ─── Transactions ───────────────────────────────────────────────────────────
router.get('/transactions', requirePerm('finance', 'view'), wrap((req) => booksService.listTransactions(req.user, req.query)));
router.post('/transactions', requirePerm('finance', 'create'), requirePostIfRequested, validate(txSchema), activityLogger('create', 'book_transactions'), wrap((req) => booksService.createTransaction(req.user, req.body)));
router.post('/transactions/post', requirePerm('finance', 'post'), validate(z.object({ ids: z.array(z.number().int()).optional(), batchId: z.string().optional() })),
    activityLogger('update', 'book_transactions'), wrap((req) => booksService.post(req.user, req.body)));
router.delete('/batches/:batchId', requirePerm('finance', 'edit'), activityLogger('delete', 'book_transactions'), wrap((req) => booksService.deleteBatchDrafts(req.user, req.params.batchId)));
router.get('/transactions/:id', requirePerm('finance', 'view'), wrap((req) => booksService.getTransaction(req.user, req.params.id)));
router.put('/transactions/:id', requirePerm('finance', 'edit'), validate(txSchema.omit({ post: true, source: true })), activityLogger('update', 'book_transactions'), wrap((req) => booksService.updateDraft(req.user, req.params.id, req.body)));
router.delete('/transactions/:id', requirePerm('finance', 'edit'), activityLogger('delete', 'book_transactions'), wrap((req) => booksService.deleteDraft(req.user, req.params.id)));
router.post('/transactions/:id/reverse', requirePerm('finance', 'post'), validate(z.object({ date: z.string().optional(), reason: z.string().max(200).optional() })),
    activityLogger('create', 'book_transactions'), wrap((req) => booksService.reverse(req.user, req.params.id, req.body)));

export default router;
