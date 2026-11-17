// ─── "Perlu tindakan" — per-user action counters (owner 2026-11-13) ─────────
// Computed live from the records (no stored state), filtered by what the user
// may do: approvers see forms waiting for THEIR side, fillers see monthly forms
// to fill and rejected forms, finance/admin see codes ready to invoice, fleet
// sees maintenance due and open emergencies. Each item links to where it is
// handled. Shown on the dashboard and next to the header bell.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { opsEntries, leaseUnitBillings, leaseContracts, orders } from '../db/schema.js';
import { and, eq, inArray, isNull, isNotNull, sql, gt } from 'drizzle-orm';
import { getAccess, hasPerm } from './access.service.js';
import { accountTypeOf } from './access-core.js';
import { fleetAlertsService } from './fleet-alerts.service.js';

const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const n = (rows) => Number(rows?.[0]?.c || 0);

export const actionItemsService = {
    async forUser(user) {
        const access = await getAccess(user.id);
        const has = (p) => user.role === 'superadmin' || hasPerm(access, p);
        const sa = user.role === 'superadmin';
        const client = !sa && (access?.accountType || accountTypeOf(user)) === 'client';
        const org = user.organizationId || -1;
        const items = [];
        const add = (key, count, title, link, severity = 'info') => { if (count > 0) items.push({ key, count, title, link, severity }); };
        const count = sql`count(*)::int`.as('c');

        // Forms (L / T / O) waiting for my side.
        const agencySide = sa || (!client && has('opsrecap.verify'));
        const clientSide = client && has('opsrecap.approve');
        if (agencySide || clientSide) {
            const side = clientSide
                ? [eq(opsEntries.clientOrgId, org), isNull(opsEntries.clientApprovedAt)]
                : [...(sa ? [] : [eq(opsEntries.agencyOrgId, org)]), isNull(opsEntries.agencyApprovedAt)];
            add('forms_approve', n(await db.select({ c: count }).from(opsEntries).where(and(inArray(opsEntries.status, ['submitted', 'verified']), ...side))),
                'Form lembur / perjalanan dinas / operasional menunggu persetujuan Anda', '/admin/contracts?tab=list', 'warning');
            const mSide = clientSide
                ? [eq(leaseContracts.clientOrgId, org), isNull(leaseUnitBillings.clientApprovedAt)]
                : [...(sa ? [] : [eq(leaseContracts.agencyOrgId, org)]), isNull(leaseUnitBillings.agencyApprovedAt)];
            add('monthly_approve', n(await db.select({ c: count }).from(leaseUnitBillings).innerJoin(leaseContracts, eq(leaseContracts.id, leaseUnitBillings.contractId))
                .where(and(eq(leaseUnitBillings.status, 'submitted'), ...mSide))),
                'Form bulanan (M) menunggu persetujuan Anda', '/admin/contracts?tab=form&sub=kontrak', 'warning');
        }

        // Monthly forms to fill (agency fillers): open / rejected, month already started, not invoiced.
        if (sa || (!client && (has('opsrecap.create') || has('opsrecap.edit') || has('contracts.edit')))) {
            add('monthly_fill', n(await db.select({ c: count }).from(leaseUnitBillings)
                .innerJoin(leaseContracts, eq(leaseContracts.id, leaseUnitBillings.contractId))
                .leftJoin(orders, eq(orders.id, leaseUnitBillings.orderId))
                .where(and(inArray(leaseUnitBillings.status, ['open', 'rejected']), isNull(orders.invoiceId), ...(sa ? [] : [eq(leaseContracts.agencyOrgId, org)]),
                    sql`coalesce(${leaseUnitBillings.detail}->>'from', ${leaseUnitBillings.detail}->>'cycleFrom') <= ${todayWib()}`))),
                'Form bulanan (M) perlu diisi / dikoreksi', '/admin/contracts?tab=form&sub=kontrak');
        }

        // My rejected forms (driver, staff, client user) — fix and resubmit.
        add('forms_rejected', n(await db.select({ c: count }).from(opsEntries).where(and(eq(opsEntries.status, 'rejected'), eq(opsEntries.createdBy, user.id)))),
            'Form Anda ditolak — perlu dikoreksi', '/admin/contracts?tab=list', 'warning');

        // Ready to invoice (agency documents.edit).
        if (sa || (!client && has('documents.edit'))) {
            const opsReady = n(await db.select({ c: count }).from(opsEntries).where(and(eq(opsEntries.status, 'approved'), eq(opsEntries.billable, true),
                isNull(opsEntries.invoiceId), isNotNull(opsEntries.code), gt(opsEntries.amount, '0'), ...(sa ? [] : [eq(opsEntries.agencyOrgId, org)]))));
            const mReady = n(await db.select({ c: count }).from(leaseUnitBillings).innerJoin(leaseContracts, eq(leaseContracts.id, leaseUnitBillings.contractId))
                .leftJoin(orders, eq(orders.id, leaseUnitBillings.orderId))
                .where(and(eq(leaseUnitBillings.status, 'approved'), isNull(orders.invoiceId), ...(sa ? [] : [eq(leaseContracts.agencyOrgId, org)]))));
            add('invoice_ready', opsReady + mReady, 'Kode kontrak disetujui, siap dibuat invoice', '/admin/documents', 'info');
        }

        // Contracts: drafts waiting for my side's approval.
        if (sa || has('contracts.edit')) {
            const cSide = client ? [eq(leaseContracts.clientOrgId, org), isNull(leaseContracts.clientApprovedAt)]
                : [...(sa ? [] : [eq(leaseContracts.agencyOrgId, org)]), isNull(leaseContracts.agencyApprovedAt)];
            add('contracts_approve', n(await db.select({ c: count }).from(leaseContracts).where(and(eq(leaseContracts.status, 'draft'), ...cSide))),
                'Kontrak menunggu persetujuan pihak Anda', '/admin/contracts?tab=contracts');
        }

        // Fleet: maintenance due / overdue and open emergencies (agency fleet.view; client: own contract units).
        if (sa || has('fleet.view') || (client && has('contracts.view'))) {
            for (const it of await fleetAlertsService.actionItems(user, { client, sa })) add(it.key, it.count, it.title, it.link, it.severity);
        }

        return { data: items, total: items.reduce((s, x) => s + x.count, 0) };
    },
};

export default actionItemsService;
