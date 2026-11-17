// ─── /api/corporate — client company portal ─────────────────────────────────
// All endpoints act on the caller's own client company (clientOrgOf).
//   GET  /booking-rules       any member: approval/cost-centre rules for the booking form
//   GET  /settings            corporate.view | corporate.manage
//   PUT  /settings            corporate.manage
//   POST /cost-centers        corporate.manage     PUT /cost-centers/:id
//   GET  /approvals           orders.approve       (?status=waiting|approved|rejected)
//   GET  /approvals/count     orders.approve
//   POST /approvals/:orderNumber  orders.approve   { decision: approve|reject, note }
//   GET  /spend?year=         any member (company-wide with corporate.view, else own)
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { activityLogger } from '../middleware/logger.js';
import { requirePerm, requireAnyPerm } from '../middleware/permission.js';
import { corporateService, clientOrgOf } from '../services/corporate.service.js';
import { buildClientReport, reportHtml, reportCsv } from '../services/report.service.js';
import { sendEmail } from '../services/email.service.js';

const router = Router();
const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};

router.use(requireAuth, (req, res, next) => {
    try { clientOrgOf(req.user); next(); }
    catch (e) { res.status(e.status || 403).json({ error: e.message }); }
});

router.get('/booking-rules', wrap((req) => corporateService.bookingRules(req.user)));
router.get('/settings', requireAnyPerm('corporate.view', 'corporate.manage', 'orders.approve'), wrap((req) => corporateService.getSettings(req.user)));
router.put('/settings', requirePerm('corporate', 'manage'), validate(z.object({ requireApproval: z.boolean().optional(), costCenterRequired: z.boolean().optional(), monthlyReport: z.boolean().optional() })),
    activityLogger('update', 'corporate_settings'), wrap((req) => corporateService.saveSettings(req.user, req.body)));

router.post('/cost-centers', requirePerm('corporate', 'manage'), validate(z.object({ name: z.string().min(1).max(100), code: z.string().max(30).nullable().optional() })),
    activityLogger('create', 'cost_centers'), wrap((req) => corporateService.addCostCenter(req.user, req.body)));
router.put('/cost-centers/:id', requirePerm('corporate', 'manage'), validate(z.object({ name: z.string().max(100).optional(), code: z.string().max(30).nullable().optional(), isActive: z.boolean().optional() })),
    activityLogger('update', 'cost_centers'), wrap((req) => corporateService.updateCostCenter(req.user, req.params.id, req.body)));

router.get('/approvals/count', requirePerm('orders', 'approve'), wrap((req) => corporateService.countWaiting(req.user)));
router.get('/approvals', requirePerm('orders', 'approve'), wrap((req) => corporateService.listApprovals(req.user, req.query)));
router.post('/approvals/:orderNumber', requirePerm('orders', 'approve'),
    validate(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).nullable().optional() })),
    activityLogger('approve', 'order_client_approval'), wrap((req) => corporateService.decide(req.user, req.params.orderNumber, req.body)));

router.get('/spend', wrap((req) => corporateService.spend(req.user, req.query)));
// Monthly report (printable page / PDF) + send a copy to myself.
router.get('/report', requireAnyPerm('corporate.view', 'corporate.manage', 'orders.approve'), wrap(async (req) => {
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? req.query.period : null;
    if (!period) { const e = new Error('Parameter period (YYYY-MM) wajib.'); e.status = 400; throw e; }
    return buildClientReport(clientOrgOf(req.user), period);
}));
router.post('/report/send', requirePerm('corporate', 'manage'), validate(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) })), wrap(async (req) => {
    const rep = await buildClientReport(clientOrgOf(req.user), req.body.period);
    await sendEmail({ to: req.user.email, subject: `Laporan Bulanan ${rep.label} — ${rep.company}`, html: reportHtml(rep), text: `Laporan ${rep.label}`,
        attachments: [{ filename: `laporan-${req.body.period}.csv`, content: reportCsv(rep), contentType: 'text/csv; charset=utf-8' }] });
    return { sentTo: req.user.email };
}));
router.get('/invoices', requireAnyPerm('corporate.view', 'corporate.manage', 'orders.approve'), wrap((req) => corporateService.listInvoices(req.user)));
router.post('/invoices/:id/pay', requireAnyPerm('corporate.view', 'corporate.manage', 'orders.approve'), activityLogger('create', 'payment_links'),
    wrap((req) => corporateService.payLink(req.user, req.params.id)));

export default router;
