// ─── List Data + Audit trail for contracts (owner 2026-11-13) ───────────────
// List Data: every contract code — M (monthly, per unit), L (lembur),
//   T (perjalanan dinas), O (operasional), R (older operasional) — with its
//   invoice, surat pengantar and faktur pajak.
// Audit: a timeline of who did what on contracts and their forms: created,
//   documents, approvals, amendments, stops, form approvals / rejections /
//   notes, M codes, invoices. Built from the records' own timestamps plus the
//   activity log (changes), always scoped to the caller's contracts.
import { db } from '../db/index.js';
import {
    leaseContracts, contractDocuments, opsEntries, leaseUnitBillings, organizations, invoices, fakturPajak,
    activityLogs, user as userTable, cars, drivers,
} from '../db/schema.js';
import { and, eq, inArray, sql, desc, or } from 'drizzle-orm';
import { contractBillingService } from './contract-billing.service.js';

const isClient = (u) => u && (u.accountType === 'client' || u.role === 'client' || u.role === 'client_admin');
function scopeCond(user) {
    if (user.role === 'superadmin') return [];
    if (isClient(user)) return user.organizationId ? [eq(leaseContracts.clientOrgId, user.organizationId)] : [sql`false`];
    return user.organizationId ? [eq(leaseContracts.agencyOrgId, user.organizationId)] : [sql`false`];
}
const KIND_PREFIX = { overtime: 'L', trip: 'T', expense: 'O' };
const KIND_LABEL = { overtime: 'Lembur', trip: 'Perjalanan Dinas', expense: 'Operasional' };

async function visibleContracts(user, contractId) {
    const conds = [...scopeCond(user)];
    if (contractId) conds.push(eq(leaseContracts.id, Number(contractId)));
    return db.select({ c: leaseContracts, clientName: organizations.name }).from(leaseContracts)
        .leftJoin(organizations, eq(organizations.id, leaseContracts.clientOrgId))
        .where(conds.length ? and(...conds) : undefined).limit(2000);
}

export const contractReportsService = {
    /** List Data. */
    async codes(user, { contractId } = {}) {
        const contracts = await visibleContracts(user, contractId);
        const ids = contracts.map((r) => r.c.id);
        if (!ids.length) return { data: [], total: 0, page: 1 };
        const byId = new Map(contracts.map((r) => [r.c.id, r]));
        const monthly = (await contractBillingService.list(user, { contractId })).data.map((m) => ({
            key: `M-${m.id}`, code: m.code, type: 'M', typeLabel: 'Bulanan', contractId: m.contractId, contractNumber: m.contractNumber, clientName: m.clientName,
            date: `${m.period}-01`, period: m.period, description: `Bulan ke-${m.monthIndex} · ${[m.unit, m.plate].filter(Boolean).join(' ') || '-'}${m.driverName ? ` · ${m.driverName}` : ''}`,
            amount: m.amount, formStatus: m.status, billingId: m.id, agencyApproved: m.agencyApproved, clientApproved: m.clientApproved,
            rawStatus: m.rawStatus, kmIssues: m.kmIssues, from: m.from, to: m.to, invoiceDate: m.invoiceDate,
            invoiceNumber: m.invoiceNumber, invoiceSentDate: m.invoiceSentDate,
            letterNumber: m.letterNumber, fakturNsfp: m.fakturNsfp, paid: m.paid,
        }));
        const ops = await db.select({
            e: opsEntries, carName: cars.name, plate: cars.licensePlate, driverName: drivers.name,
            invoiceNumber: invoices.invoiceNumber, invoiceSentDate: invoices.sentDate, letterNumber: invoices.letterNumber, paidDate: invoices.paidDate,
            nsfp: fakturPajak.nsfp,
        }).from(opsEntries)
            .leftJoin(cars, eq(cars.id, opsEntries.carId)).leftJoin(drivers, eq(drivers.id, opsEntries.driverId))
            .leftJoin(invoices, eq(invoices.id, opsEntries.invoiceId)).leftJoin(fakturPajak, eq(fakturPajak.id, invoices.fakturId))
            .where(and(inArray(opsEntries.contractId, ids), sql`${opsEntries.code} IS NOT NULL`))
            .orderBy(desc(opsEntries.entryDate)).limit(3000);
        const forms = ops.map((r) => {
            const c = byId.get(r.e.contractId);
            const type = /^R/.test(r.e.code) ? 'R' : KIND_PREFIX[r.e.kind] || 'O';
            const status = r.e.status === 'submitted' && r.e.clientApprovedAt ? 'client_ok' : r.e.status;
            return {
                key: `F-${r.e.id}`, code: r.e.code, type, typeLabel: type === 'R' ? 'Operasional (lama)' : KIND_LABEL[r.e.kind],
                contractId: r.e.contractId, contractNumber: c?.c.contractNumber, clientName: c?.clientName,
                date: r.e.entryDate, period: String(r.e.entryDate || '').slice(0, 7),
                description: [r.e.kind === 'overtime' ? `${Number(r.e.hours || 0)} jam` : null, [r.carName, r.plate].filter(Boolean).join(' '), r.driverName, r.e.note].filter(Boolean).join(' · '),
                amount: r.e.amount == null ? null : Number(r.e.amount), formStatus: status, billable: r.e.billable,
                invoiceNumber: r.invoiceNumber || null, invoiceSentDate: r.invoiceSentDate, letterNumber: r.letterNumber || null,
                fakturNsfp: r.nsfp || null, paid: !!r.paidDate,
            };
        });
        const data = [...monthly, ...forms].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.code).localeCompare(String(a.code)));
        return { data, total: data.length, page: 1 };
    },

    /** Audit trail (newest first). */
    async audit(user, { contractId, limit = 400 } = {}) {
        const contracts = await visibleContracts(user, contractId);
        const ids = contracts.map((r) => r.c.id);
        if (!ids.length) return { data: [] };
        const ev = [];
        const push = (at, by, ref, contractNumber, text, kind) => { if (at) ev.push({ at: new Date(at).toISOString(), by, ref, contractNumber, text, kind }); };
        for (const { c } of contracts) {
            push(c.createdAt, c.createdBy, c.contractNumber, c.contractNumber, c.amendsContractId ? `Draf amandemen dibuat (pihak ${c.createdSide})` : `Draf kontrak dibuat (pihak ${c.createdSide})`, 'contract');
            push(c.agencyApprovedAt, c.agencyApprovedBy, c.contractNumber, c.contractNumber, 'Disetujui agency', 'approval');
            push(c.clientApprovedAt, c.clientApprovedBy, c.contractNumber, c.contractNumber, 'Disetujui klien', 'approval');
            if (c.supersededBy) {
                const nw = contracts.find((x) => x.c.id === c.supersededBy);
                push(c.updatedAt, null, c.contractNumber, c.contractNumber, `Dihentikan per ${c.endDate}, diganti amandemen ${nw?.c.contractNumber || ''}`.trim(), 'contract');
            }
        }
        const num = new Map(contracts.map((r) => [r.c.id, r.c.contractNumber]));
        const docs = await db.select().from(contractDocuments).where(inArray(contractDocuments.contractId, ids));
        for (const d of docs) {
            const n = num.get(d.contractId);
            push(d.createdAt, d.createdBy, n, n, `Dokumen diminta: ${d.title}`, 'document');
            push(d.uploadedAt, d.uploadedBy, n, n, `Dokumen diunggah: ${d.title}`, 'document');
            if (d.reviewedAt) push(d.reviewedAt, d.reviewedBy, n, n, `Dokumen ${d.status === 'approved' ? 'disetujui' : 'ditolak'}: ${d.title}`, 'document');
        }
        const forms = await db.select().from(opsEntries).where(and(inArray(opsEntries.contractId, ids), sql`${opsEntries.status} <> 'draft'`)).limit(3000);
        for (const e of forms) {
            const n = num.get(e.contractId), ref = e.code || `#${e.id}`;
            push(e.createdAt, e.createdBy, ref, n, `Formulir ${KIND_LABEL[e.kind] || e.kind} diajukan`, 'form');
            push(e.agencyApprovedAt, e.agencyApprovedBy, ref, n, 'Disetujui agency', 'approval');
            push(e.clientApprovedAt, e.clientApprovedBy, ref, n, 'Disetujui klien', 'approval');
            if (e.status === 'rejected') push(e.decidedAt || e.updatedAt, e.decidedBy, ref, n, `Ditolak: ${e.rejectReason || '-'}`, 'approval');
            for (const cm of Array.isArray(e.comments) ? e.comments : []) push(cm.at, null, ref, n, `Catatan dari ${cm.by} (${cm.side}): ${cm.text}`, 'note');
        }
        const ms = await db.select().from(leaseUnitBillings).where(inArray(leaseUnitBillings.contractId, ids));
        for (const m of ms) {
            push(m.createdAt, m.createdBy, m.orderNumber, num.get(m.contractId), `Kode bulanan dibuat (bulan ke-${m.monthIndex}, ${m.period})`, 'monthly');
            push(m.submittedAt, m.submittedBy, m.orderNumber, num.get(m.contractId), `Form bulanan diajukan (KM ${m.kmStart ?? '-'} → ${m.kmEnd ?? '-'})`, 'form');
            push(m.agencyApprovedAt, m.agencyApprovedBy, m.orderNumber, num.get(m.contractId), 'Form bulanan disetujui agency', 'approval');
            push(m.clientApprovedAt, m.clientApprovedBy, m.orderNumber, num.get(m.contractId), 'Form bulanan disetujui klien', 'approval');
            if (m.status === 'rejected') push(m.updatedAt, m.updatedBy, m.orderNumber, num.get(m.contractId), `Form bulanan ditolak: ${m.rejectReason || '-'}`, 'form');
            for (const c of Array.isArray(m.comments) ? m.comments : []) ev.push({ at: c.at, byName: c.by, ref: m.orderNumber, contractNumber: num.get(m.contractId), text: `Catatan: ${c.text}`, kind: 'note' });
        }
        // Changes recorded by the activity log (edits, status changes …).
        const formIds = forms.map((f) => String(f.id));
        const logs = await db.select({ l: activityLogs, name: userTable.name }).from(activityLogs).leftJoin(userTable, eq(userTable.id, activityLogs.userId))
            .where(or(
                and(inArray(activityLogs.entity, ['lease_contracts', 'contract_documents']), inArray(activityLogs.entityId, ids.map(String))),
                formIds.length ? and(eq(activityLogs.entity, 'ops_entries'), inArray(activityLogs.entityId, formIds)) : sql`false`,
            )).orderBy(desc(activityLogs.createdAt)).limit(500);
        for (const { l, name } of logs) {
            if (l.action !== 'update') continue;     // creations/approvals already come from the records
            const path = String(l.details?.path || '');
            const isForm = l.entity === 'ops_entries';
            const f = isForm ? forms.find((x) => String(x.id) === l.entityId) : null;
            const n = isForm ? num.get(f?.contractId) : num.get(Number(l.entityId));
            const what = /status/.test(path) ? 'Status kontrak diubah' : /documents/.test(path) ? 'Dokumen diubah' : isForm ? 'Isi formulir diubah' : 'Ketentuan kontrak diubah';
            ev.push({ at: new Date(l.createdAt).toISOString(), byName: name || null, ref: isForm ? (f?.code || `#${l.entityId}`) : n, contractNumber: n, text: what, kind: 'change' });
        }
        // Names for user ids.
        const userIds = [...new Set(ev.map((e) => e.by).filter(Boolean))];
        const names = userIds.length ? new Map((await db.select({ id: userTable.id, name: userTable.name }).from(userTable).where(inArray(userTable.id, userIds))).map((u) => [u.id, u.name])) : new Map();
        const data = ev.map(({ by, byName, ...e }) => ({ ...e, actor: byName || (by ? names.get(by) || null : null) }))
            .sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.min(1000, Number(limit) || 400));
        return { data };
    },
};
