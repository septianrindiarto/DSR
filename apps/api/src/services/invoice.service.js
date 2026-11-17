// ─── Invoice service (D.2) ──────────────────────────────────────────────────
// Source of truth for invoices. Each invoice row links N order rows through
// orders.invoice_id; the orders.invoice_* columns are a denormalized copy that
// this service keeps in sync (one transaction per write) so the Rekap list and
// export never need a join.
//
// Status is DERIVED, never trusted from storage alone (see deriveInvoiceStatus):
//   Belum Dikirim  order finished, no invoice sent yet
//   Pending        sent, unpaid, today <= due date
//   Overdue        sent, unpaid, today  > due date
//   Paid           paid date filled
// orders.invoice_payment_status stores only 'Pending' | 'Paid' (legacy shape).
//
// Due date = sent date + payment term (days). Term resolution:
//   client org (company directory) term → agency default term → 30 days.
// The term is frozen on the invoice when first sent; changing a client's term
// later does not touch existing invoices — use cancel & re-issue instead.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { invoices, invoicePayments, orders, organizations, customers, cars, clientAgencyLinks, fakturPajak, leaseUnitBillings, opsEntries } from '../db/schema.js';
import { computeInvoiceTax, resolveTaxProfile, taxProfileOf, allocatePpn } from './tax-core.js';
import { dailyRatesOf, dailyLineAmount } from './ops-core.js';
import { agencyPolicyDefault } from './ops-policy.service.js';
import { buildScopeConditions } from '../middleware/scope.js';
import { eq, and, inArray, isNull, isNotNull, sql, asc, desc } from 'drizzle-orm';
import { normalizeCompanyName } from './invite-code.service.js';
import { resolveDefaultAgencyId } from './relationship.service.js';
import { booksAutoPost } from './books-autopost.service.js';
import { notificationService } from './notifications.service.js';

export const DEFAULT_TERM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date, days) {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + Number(days || 0) * DAY_MS);
}

/** Derive the display status. `orderStatus` is used only for "Belum Dikirim". */
//   Sebagian = sent, partly paid (some payment received, not settled), not overdue.
//   Overdue wins over Sebagian: a partly-paid invoice past its due date is overdue.
export function deriveInvoiceStatus({ sentDate, dueDate, paidDate, orderStatus, isCancelled, paymentStatus, paidAmount } = {}, now = new Date()) {
    if (isCancelled) return 'Dibatalkan';
    const ps = String(paymentStatus || '').toLowerCase();
    // Legacy rows synced from Rekap.xlsx may carry "Paid" without a date.
    if (paidDate || ps === 'paid') return 'Paid';
    if (sentDate) {
        if (dueDate && new Date(dueDate).getTime() < now.getTime()) return 'Overdue';
        if (Number(paidAmount || 0) > 0 || ps === 'sebagian') return 'Sebagian';
        return 'Pending';
    }
    if (orderStatus === 'completed') return 'Belum Dikirim';
    return null;
}

/** Owning agency for an invoice written by `user`. */
/**
 * Contract codes (owner 2026-11-13): monthly M rows must be approved by both
 * sides (Form → Kontrak), and a contract row already on a live invoice is not
 * moved to another one (no overwrite — cancel first).
 */
async function assertContractRowsInvoiceable(rows) {
    const contractRows = rows.filter((r) => r.contractId);
    if (!contractRows.length) return;
    const problems = [];
    const m = await db.select({ orderId: leaseUnitBillings.orderId, code: leaseUnitBillings.orderNumber, status: leaseUnitBillings.status })
        .from(leaseUnitBillings).where(inArray(leaseUnitBillings.orderId, contractRows.map((r) => r.id)));
    for (const x of m) if (x.status !== 'approved') problems.push(`${x.code} belum disetujui kedua pihak (Form → Kontrak)`);
    const invIds = [...new Set(contractRows.map((r) => r.invoiceId).filter(Boolean))];
    if (invIds.length) {
        const live = await db.select({ id: invoices.id, no: invoices.invoiceNumber }).from(invoices).where(and(inArray(invoices.id, invIds), eq(invoices.isCancelled, false)));
        for (const inv of live) problems.push(`${contractRows.filter((r) => r.invoiceId === inv.id).map((r) => r.orderNumber).join(', ')} sudah ada di invoice ${inv.no} — batalkan dulu`);
    }
    if (problems.length) { const e = new Error(`Tidak bisa dibuat invoice: ${[...new Set(problems)].join('; ')}.`); e.status = 409; throw e; }
}

async function agencyIdFor(user, sampleOrder) {
    if (user?.accountType === 'agency' && user.organizationId) return user.organizationId;
    if (sampleOrder?.claimedByAgencyId) return sampleOrder.claimedByAgencyId;
    if (user?.organizationId) return user.organizationId;
    return resolveDefaultAgencyId();
}

/**
 * Resolve the client company (company directory = client organizations) and
 * its payment term for a set of order rows. Prefers the order's own client
 * org; otherwise matches the customer's company name against the directory.
 */
async function resolveClientAndTerm(agencyId, orderRows) {
    let clientOrgId = null;
    let companyName = null;

    const first = orderRows[0] || {};
    if (first.organizationId && first.organizationId !== agencyId) {
        const [o] = await db.select({ id: organizations.id, name: organizations.name, parent: organizations.parentAgencyId })
            .from(organizations).where(eq(organizations.id, first.organizationId)).limit(1);
        if (o && o.parent != null) { clientOrgId = o.id; companyName = o.name; }
    }
    if (!clientOrgId && first.customerId) {
        const [c] = await db.select({ companyName: customers.companyName })
            .from(customers).where(eq(customers.id, first.customerId)).limit(1);
        companyName = (c?.companyName || '').trim() || null;
        const norm = normalizeCompanyName(companyName);
        if (norm && !['private', 'pribadi'].includes(norm)) {
            const [o] = await db.select({ id: organizations.id })
                .from(organizations)
                .where(and(
                    isNotNull(organizations.parentAgencyId),
                    sql`(${organizations.nameNormalized} = ${norm} OR LOWER(TRIM(${organizations.name})) = ${norm})`,
                ))
                .limit(1);
            clientOrgId = o?.id || null;
        }
    }

    let termDays = null;
    if (clientOrgId) {
        const [o] = await db.select({ t: organizations.paymentTermDays }).from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
        termDays = o?.t ?? null;
    }
    if (termDays == null && agencyId) {
        const [a] = await db.select({ t: organizations.paymentTermDays }).from(organizations).where(eq(organizations.id, agencyId)).limit(1);
        termDays = a?.t ?? null;
    }
    if (termDays == null) termDays = DEFAULT_TERM_DAYS;
    return { clientOrgId, companyName, termDays };
}

/** Copy invoice fields onto its order rows (denormalized read model). */
async function syncOrders(tx, invoiceRow, orderIds) {
    if (!orderIds.length) return;
    await tx.update(orders).set({
        invoiceId: invoiceRow.id,
        invoiceNumber: invoiceRow.invoiceNumber,
        invoiceLetterNumber: invoiceRow.letterNumber || null,
        invoiceSentDate: invoiceRow.sentDate || null,
        invoiceDueDate: invoiceRow.dueDate || null,
        invoicePaidDate: invoiceRow.paidDate || null,
        invoicePaymentStatus: invoiceRow.paidDate ? 'Paid'
            : (Number(invoiceRow.paidAmount || 0) > 0 ? 'Sebagian' : 'Pending'),
        updatedAt: new Date(),
    }).where(inArray(orders.id, orderIds));
}

/**
 * Tax profile for an agency → client pair: the pair's own setting (Pengaturan →
 * Pajak per klien) → the agency default → none. tax-core.js.
 */
export async function taxProfileFor(agencyId, clientOrgId) {
    let agency = null, pair = null;
    if (agencyId) {
        const [o] = await db.select({ p: organizations.taxProfile }).from(organizations).where(eq(organizations.id, agencyId)).limit(1);
        agency = o?.p || null;
        pair = clientOrgId ? agency?.clients?.[String(clientOrgId)] || null : null;
    }
    if (!pair && agencyId && clientOrgId) {
        const [l] = await db.select({ p: clientAgencyLinks.taxProfile }).from(clientAgencyLinks)
            .where(and(eq(clientAgencyLinks.agencyOrgId, agencyId), eq(clientAgencyLinks.clientOrgId, clientOrgId))).limit(1);
        pair = l?.p || null;
    }
    return resolveTaxProfile(pair, agency);
}

/**
 * Invoice totals from its rows: subtotal → discount → DPP → DPP nilai lain →
 * PPN → PPh (withheld or added). total_amount = what the invoice bills (equal
 * to the faktur pajak). When the invoice sits in a faktur gabungan, its PPN is
 * the faktur's allocated share (so Σ invoices = faktur).
 */
async function recomputeTotal(tx, invoiceId) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    const rows = await tx.select({ p: orders.totalPrice, contractId: orders.contractId, ot: orders.overtimeHours, nights: orders.overnightNights })
        .from(orders).where(eq(orders.invoiceId, invoiceId));
    const profile = inv.taxProfile ? taxProfileOf(inv.taxProfile) : await taxProfileFor(inv.organizationId, inv.clientOrgId);
    // Line = price + overtime hours × rate + nights × rate (agency default,
    // Pengaturan) — the same amounts the Dokumen invoice prints.
    const rates = dailyRatesOf(await agencyPolicyDefault(inv.organizationId));
    const amounts = rows.map((x) => dailyLineAmount({ price: x.p, overtimeHours: x.ot, nights: x.nights }, rates));
    const r = computeInvoiceTax({ amounts, discount: Number(inv.discountAmount || 0), profile });
    const contracts = [...new Set(rows.map((x) => x.contractId).filter(Boolean))];
    const [row] = await tx.update(invoices).set({
        subtotal: String(r.subtotal), discountAmount: String(r.discount), dpp: String(r.dpp), dppOther: String(r.dppOther),
        ppnAmount: String(r.ppn), pphMode: r.pphMode, pphRate: String(r.pphRate), pphAmount: String(r.pph),
        totalAmount: String(r.total), taxProfile: profile, contractId: contracts.length === 1 ? contracts[0] : null,
        updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId)).returning();
    if (row.fakturId) return (await reallocateFaktur(tx, row.fakturId)).find((x) => x.id === row.id) || row;
    return row;
}

/** An invoice inside an issued (terbit) faktur pajak must not change amounts. */
export async function assertFakturOpen(q, inv) {
    if (!inv?.fakturId) return;
    const [f] = await q.select({ status: fakturPajak.status, nsfp: fakturPajak.nsfp }).from(fakturPajak).where(eq(fakturPajak.id, inv.fakturId)).limit(1);
    if (f && f.status === 'terbit') {
        const e = new Error(`Invoice ${inv.invoiceNumber} sudah masuk Faktur Pajak ${f.nsfp || ''} yang terbit. Buat faktur pengganti dulu (Dokumen → Faktur Pajak).`);
        e.status = 409; throw e;
    }
}

/** Faktur gabungan: PPN on Σ DPP, spread back to its invoices exactly. */
export async function reallocateFaktur(tx, fakturId) {
    const [f] = await tx.select().from(fakturPajak).where(eq(fakturPajak.id, fakturId)).limit(1);
    if (!f) return [];
    const list = await tx.select().from(invoices).where(and(eq(invoices.fakturId, fakturId), eq(invoices.isCancelled, false)));
    const profile = taxProfileOf(f.taxProfile || list[0]?.taxProfile);
    const a = allocatePpn(list.map((i) => ({ id: i.id, dpp: Number(i.dpp || 0) })), profile);
    const out = [];
    for (const i of list) {
        const ppn = a.shares[i.id] || 0;
        const added = i.pphMode === 'added' ? Number(i.pphAmount || 0) : 0;
        const [u] = await tx.update(invoices).set({ ppnAmount: String(ppn), totalAmount: String(Number(i.dpp || 0) + ppn + added), updatedAt: new Date() })
            .where(eq(invoices.id, i.id)).returning();
        out.push(u);
    }
    await tx.update(fakturPajak).set({ dpp: String(a.dpp), dppOther: String(a.dppOther), ppnAmount: String(a.ppn), updatedAt: new Date() }).where(eq(fakturPajak.id, fakturId));
    return out;
}

export const invoiceService = {
    deriveInvoiceStatus,

    /**
     * Issue (or update) invoices for a set of order rows. `items` is
     * [{ id, invoiceNumber }]; rows sharing an invoiceNumber become ONE
     * invoice. `allowedIds` = ids the caller is allowed to touch (scope).
     */
    // discount (Rp, whole invoice) and taxProfile (override for this invoice,
    // e.g. a client that adds "Pajak 2,5 %") are optional; without them the
    // agency → client profile applies.
    async issueForOrders({ items, sentDate, letterNumber, user, allowedIds, discount = undefined, taxProfile = undefined }) {
        const allowed = new Set(allowedIds.map(Number));
        const byNumber = new Map();
        for (const it of items) {
            const id = Number(it.id);
            if (!allowed.has(id)) continue;
            const no = String(it.invoiceNumber || '').trim();
            if (!no) continue;
            if (!byNumber.has(no)) byNumber.set(no, []);
            byNumber.get(no).push(id);
        }
        const results = [];
        for (const [invoiceNumber, ids] of byNumber) {
            const rows = await db.select().from(orders).where(inArray(orders.id, ids));
            if (!rows.length) continue;
            await assertContractRowsInvoiceable(rows);
            const agencyId = await agencyIdFor(user, rows[0]);
            const { clientOrgId, companyName, termDays } = await resolveClientAndTerm(agencyId, rows);
            const sent = sentDate ? new Date(sentDate) : null;

            const row = await db.transaction(async (tx) => {
                const [existing] = await tx.select().from(invoices).where(and(
                    agencyId ? eq(invoices.organizationId, agencyId) : isNull(invoices.organizationId),
                    eq(invoices.invoiceNumber, invoiceNumber),
                    eq(invoices.isCancelled, false),
                )).limit(1);

                let inv;
                if (existing) await assertFakturOpen(tx, existing);
                // Contract codes (M/L/T/O): never overwrite (owner 2026-11-13) — cancel the invoice, fix the data, issue again.
                if (existing && rows.some((r) => r.contractId)) {
                    const e = new Error(`Invoice ${existing.invoiceNumber} sudah ada. Invoice kode kontrak tidak bisa ditimpa — batalkan invoicenya dulu (Dokumen → Batalkan), koreksi datanya, lalu buat ulang.`); e.status = 409; throw e;
                }
                // A paid invoice keeps its amounts (owner 2026-11-13: overwrite only open invoices).
                if (existing?.paidDate && ((discount !== undefined && discount !== null && Number(discount) !== Number(existing.discountAmount || 0)) || taxProfile)) {
                    const e = new Error(`Invoice ${existing.invoiceNumber} sudah lunas — nominal/pajaknya tidak bisa ditimpa.`); e.status = 409; throw e;
                }
                if (existing) {
                    // Re-marking an existing invoice: keep its frozen term; set the
                    // sent date only if given (and recompute due from the frozen term).
                    const patch = { updatedAt: new Date() };
                    if (sent) {
                        patch.sentDate = sent;
                        patch.dueDate = addDays(sent, existing.paymentTermDays ?? termDays);
                    }
                    if (letterNumber) patch.letterNumber = letterNumber;
                    if (discount !== undefined && discount !== null) patch.discountAmount = String(Math.max(0, Math.round(Number(discount) || 0)));
                    if (taxProfile) patch.taxProfile = taxProfileOf(taxProfile);
                    [inv] = await tx.update(invoices).set(patch).where(eq(invoices.id, existing.id)).returning();
                } else {
                    [inv] = await tx.insert(invoices).values({
                        invoiceNumber,
                        organizationId: agencyId || null,
                        clientOrgId,
                        companyName,
                        letterNumber: letterNumber || null,
                        sentDate: sent,
                        dueDate: sent ? addDays(sent, termDays) : null,
                        paymentTermDays: termDays,
                        discountAmount: String(Math.max(0, Math.round(Number(discount) || 0))),
                        taxProfile: taxProfile ? taxProfileOf(taxProfile) : await taxProfileFor(agencyId, clientOrgId),
                        createdBy: user?.id || null,
                    }).returning();
                }
                await syncOrders(tx, inv, ids);
                return recomputeTotal(tx, inv.id);
            });
            await booksAutoPost.afterInvoice(row.id, { userId: user?.id || null });   // Books (best-effort)
            results.push({ invoiceId: row.id, invoiceNumber, orderIds: ids });
        }
        return results;
    },

    async getById(id) {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (!inv) return null;
        const rows = await db.select({
            id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
            totalPrice: orders.totalPrice, pickupDate: orders.pickupDate,
        }).from(orders).where(eq(orders.invoiceId, inv.id)).orderBy(asc(orders.orderNumber), asc(orders.id));
        const anyCompleted = rows.some(r => r.status === 'completed');
        const payments = await db.select().from(invoicePayments)
            .where(eq(invoicePayments.invoiceId, inv.id))
            .orderBy(asc(invoicePayments.paidDate), asc(invoicePayments.id));
        const total = Number(inv.totalAmount || 0), paid = Number(inv.paidAmount || 0);
        return {
            ...inv,
            status: deriveInvoiceStatus({ ...inv, orderStatus: anyCompleted ? 'completed' : null }),
            orders: rows,
            orderNumbers: [...new Set(rows.map(r => r.orderNumber))],
            payments,
            remainingAmount: Math.max(0, total - paid),
        };
    },

    // ─── Payments (partial payments, #10) ──────────────────────────────────
    // Payments only track AMOUNTS (paid_amount = Σ payments). Tgl Realisasi
    // (paid_date) is always entered MANUALLY via update() — recording or
    // deleting a payment never sets or clears it. Status: Paid when Tgl
    // Realisasi is filled; Sebagian when some amount is recorded but no
    // Tgl Realisasi yet.
    async _recomputePaid(tx, invoiceId) {
        const pays = await tx.select({ amount: invoicePayments.amount }).from(invoicePayments)
            .where(eq(invoicePayments.invoiceId, invoiceId));
        const paid = pays.reduce((s, p) => s + Number(p.amount || 0), 0);
        const patch = { paidAmount: String(paid), updatedAt: new Date() };
        const [row] = await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId)).returning();
        const linked = await tx.select({ id: orders.id }).from(orders).where(eq(orders.invoiceId, invoiceId));
        await syncOrders(tx, row, linked.map(r => r.id));
        return row;
    },

    // kind 'pph23' = PPh 23 the client withheld (bukti potong) — settles that
    // part of the invoice; Books: Dr PPh 23 dibayar di muka / Cr Piutang.
    async addPayment(invoiceId, { amount, paidDate, isFinal = false, note, accountId = null, kind = 'cash', withholdingRef = null }, user) {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(invoiceId))).limit(1);
        if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
        if (inv.isCancelled) { const e = new Error('Invoice sudah dibatalkan.'); e.status = 400; throw e; }
        if (!inv.sentDate) { const e = new Error('Isi Tgl Kirim Invoice sebelum mencatat pembayaran.'); e.status = 400; throw e; }
        const amt = Number(amount);
        if (!(amt > 0)) { const e = new Error('Jumlah pembayaran harus lebih dari 0.'); e.status = 400; throw e; }
        const d = new Date(paidDate);
        if (isNaN(d.getTime())) { const e = new Error('Tanggal pembayaran tidak valid.'); e.status = 400; throw e; }
        let paymentId = null;
        const row = await db.transaction(async (tx) => {
            const [p] = await tx.insert(invoicePayments).values({
                invoiceId: inv.id, amount: String(amt), paidDate: d, isFinal: !!isFinal,
                note: note || null, createdBy: user?.id || null,
                accountId: kind === 'pph23' ? null : (accountId ? Number(accountId) : null),
                kind: kind === 'pph23' ? 'pph23' : 'cash', withholdingRef: withholdingRef ? String(withholdingRef).slice(0, 80) : null,
            }).returning({ id: invoicePayments.id });
            paymentId = p.id;
            return this._recomputePaid(tx, inv.id);
        });
        // Books: Dr Kas/Bank / Cr Piutang (best-effort, never blocks the save).
        await booksAutoPost.afterInvoice(inv.id, { paymentIds: [paymentId], userId: user?.id || null });
        return row;
    },

    async deletePayment(invoiceId, paymentId, user = null) {
        const row = await db.transaction(async (tx) => {
            const del = await tx.delete(invoicePayments)
                .where(and(eq(invoicePayments.id, Number(paymentId)), eq(invoicePayments.invoiceId, Number(invoiceId))))
                .returning();
            if (!del.length) { const e = new Error('Pembayaran tidak ditemukan.'); e.status = 404; throw e; }
            return this._recomputePaid(tx, Number(invoiceId));
        });
        await booksAutoPost.afterInvoice(Number(invoiceId), { deletedPaymentIds: [Number(paymentId)], userId: user?.id || null });
        return row;
    },

    /** Update timeline fields. Due date always follows sent + frozen term. */
    async update(id, { sentDate, paidDate, letterNumber, notes }) {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
        if (inv.isCancelled) { const e = new Error('Invoice sudah dibatalkan.'); e.status = 400; throw e; }
        const patch = { updatedAt: new Date() };
        if (sentDate !== undefined) await assertFakturOpen(db, inv);   // masa pajak follows the sent date
        if (sentDate !== undefined) {
            patch.sentDate = sentDate ? new Date(sentDate) : null;
            patch.dueDate = patch.sentDate ? addDays(patch.sentDate, inv.paymentTermDays ?? DEFAULT_TERM_DAYS) : null;
        }
        if (paidDate !== undefined) patch.paidDate = paidDate ? new Date(paidDate) : null;
        const effSent = patch.sentDate !== undefined ? patch.sentDate : inv.sentDate;
        const effPaid = patch.paidDate !== undefined ? patch.paidDate : inv.paidDate;
        if (effPaid && !effSent) { const e = new Error('Isi Tgl Kirim Invoice sebelum Tgl Realisasi.'); e.status = 400; throw e; }
        if (letterNumber !== undefined) patch.letterNumber = letterNumber || null;
        if (notes !== undefined) patch.notes = notes || null;

        const saved = await db.transaction(async (tx) => {
            const [row] = await tx.update(invoices).set(patch).where(eq(invoices.id, inv.id)).returning();
            const linked = await tx.select({ id: orders.id }).from(orders).where(eq(orders.invoiceId, inv.id));
            await syncOrders(tx, row, linked.map(r => r.id));
            return row;
        });
        // Sent date drives the receivable entry (posted / moved / reversed).
        if (sentDate !== undefined) await booksAutoPost.afterInvoice(inv.id);
        return saved;
    },

    /**
     * Cancel an invoice and re-issue it under the SAME number (number is tied
     * to the kode transaksi). The new invoice re-reads the client's current
     * term and starts as "Belum Dikirim" (no sent/due/paid dates).
     */
    /**
     * Cancel an invoice (owner 2026-11-13; agency admin only — checked in the route).
     * Allowed only while not realised (no payment at all, full or partial — owner
     * 2026-11-13) and not in a TERBIT faktur.
     * The invoice is kept, marked BATAL, Books entries are reversed, the number
     * is free again. Its codes go back to "approved, belum invoice": monthly M
     * rows are unlinked, rows made for L/T/O forms are removed and the forms
     * return to 'approved'; daily orders are unlinked. Client admins and the
     * agency are notified (feed + e-mail + Telegram).
     */
    async cancelInvoice(id, { reason, user } = {}) {
        const why = String(reason || '').trim().slice(0, 300);
        if (!why) { const e = new Error('Tulis alasan pembatalan.'); e.status = 400; throw e; }
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
        if (inv.isCancelled) { const e = new Error('Invoice sudah dibatalkan.'); e.status = 400; throw e; }
        if (inv.paidDate || Number(inv.paidAmount || 0) > 0) {
            const e = new Error(`Invoice ${inv.invoiceNumber} sudah ada realisasi pembayaran — hanya invoice yang belum direalisasi yang bisa dibatalkan. Hapus pembayarannya dulu bila salah catat.`); e.status = 409; throw e;
        }
        await assertFakturOpen(db, inv);
        const linked = await db.select().from(orders).where(eq(orders.invoiceId, inv.id));
        const opsCodes = (await db.select({ code: opsEntries.code }).from(opsEntries).where(eq(opsEntries.invoiceId, inv.id))).map((r) => r.code);
        const opsRowIds = linked.filter((o) => o.sourceOrigin === 'ops' || opsCodes.includes(o.orderNumber)).map((o) => o.id);
        const keepIds = linked.map((o) => o.id).filter((x) => !opsRowIds.includes(x));
        await db.transaction(async (tx) => {
            const meta = {
                codes: [...new Set(linked.map((o) => o.orderNumber).filter(Boolean))].sort(),
                contractIds: [...new Set(linked.map((o) => o.contractId).filter(Boolean))], orderIds: linked.map((o) => o.id),
            };
            await tx.update(invoices).set({ isCancelled: true, cancelledAt: new Date(), cancelReason: why, cancelledBy: user?.id || null, cancelledMeta: meta, updatedAt: new Date() })
                .where(eq(invoices.id, inv.id));
            if (keepIds.length) await tx.update(orders).set({
                invoiceId: null, invoiceNumber: null, invoiceLetterNumber: null, invoiceSentDate: null, invoiceDueDate: null,
                invoicePaidDate: null, invoicePaymentStatus: null, updatedAt: new Date(),
            }).where(inArray(orders.id, keepIds));
            // L/T/O forms: back to approved (ready to invoice again); their invoice rows go.
            await tx.update(opsEntries).set({ status: 'approved', invoiceId: null, updatedAt: new Date() }).where(eq(opsEntries.invoiceId, inv.id));
            if (opsRowIds.length) await tx.delete(orders).where(inArray(orders.id, opsRowIds));
            if (inv.fakturId) await reallocateFaktur(tx, inv.fakturId);   // draft faktur: drop this share
        });
        await booksAutoPost.afterInvoice(inv.id, { userId: user?.id || null });   // reverse the receivable
        const codes = [...new Set(linked.map((o) => o.orderNumber).filter(Boolean))];
        const text = `Invoice ${inv.invoiceNumber} (${codes.join(', ') || '-'}) dibatalkan oleh agency. Alasan: ${why}. Invoice pengganti akan dikirim setelah data dikoreksi.`;
        await notificationService.notify({
            targets: [
                ...(inv.clientOrgId ? [{ orgId: inv.clientOrgId, perm: 'admin' }, { orgId: inv.clientOrgId, perm: 'opsrecap.approve' }] : []),
                ...(inv.organizationId ? [{ orgId: inv.organizationId, perm: 'documents.view' }] : []),
            ],
            kind: 'invoice_cancelled', severity: 'warning', title: `Invoice ${inv.invoiceNumber} dibatalkan`, body: text,
            link: '/admin/contracts?tab=list', ref: inv.invoiceNumber, createdBy: user?.id || null, email: true, telegram: true,
        });
        return { ok: true, invoiceNumber: inv.invoiceNumber, codes, removedRows: opsRowIds.length };
    },

    async cancelAndReissue(id, { reason, user } = {}) {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
        if (inv.isCancelled) { const e = new Error('Invoice sudah dibatalkan.'); e.status = 400; throw e; }
        const [contractRow] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.invoiceId, inv.id), isNotNull(orders.contractId))).limit(1);
        if (contractRow) { const e = new Error('Invoice kode kontrak tidak diterbitkan ulang / ditimpa — batalkan invoicenya, koreksi datanya, lalu buat ulang.'); e.status = 409; throw e; }
        if (inv.paidDate) { const e = new Error('Invoice sudah dibayar — tidak dapat dibatalkan.'); e.status = 400; throw e; }
        await assertFakturOpen(db, inv);

        const linkedRows = await db.select().from(orders).where(eq(orders.invoiceId, inv.id));
        const { termDays } = await resolveClientAndTerm(inv.organizationId, linkedRows);

        const fresh = await db.transaction(async (tx) => {
            // Cancel first so the partial unique index frees the number.
            await tx.update(invoices).set({
                isCancelled: true, cancelledAt: new Date(), cancelReason: reason || null, updatedAt: new Date(),
            }).where(eq(invoices.id, inv.id));
            const [fresh] = await tx.insert(invoices).values({
                invoiceNumber: inv.invoiceNumber,
                organizationId: inv.organizationId,
                clientOrgId: inv.clientOrgId,
                companyName: inv.companyName,
                letterNumber: inv.letterNumber,
                paymentTermDays: termDays,
                replacesInvoiceId: inv.id,
                notes: inv.notes,
                discountAmount: inv.discountAmount ?? '0',
                taxProfile: inv.taxProfile ?? null,
                createdBy: user?.id || null,
            }).returning();
            await syncOrders(tx, fresh, linkedRows.map(r => r.id));
            // Money already received stays received: move partial payments over
            // to the re-issued invoice (the cancelled one keeps none).
            await tx.update(invoicePayments).set({ invoiceId: fresh.id }).where(eq(invoicePayments.invoiceId, inv.id));
            await tx.update(invoices).set({ paidAmount: '0' }).where(eq(invoices.id, inv.id));
            await recomputeTotal(tx, fresh.id);
            if (inv.fakturId) await reallocateFaktur(tx, inv.fakturId);   // draft faktur: drop the cancelled share
            return this._recomputePaid(tx, fresh.id);
        });
        // Books: reverse the cancelled invoice's receivable; the re-issue posts
        // again once it is sent. Moved payments keep their entries.
        await booksAutoPost.afterInvoice(inv.id, { userId: user?.id || null });
        await booksAutoPost.afterInvoice(fresh.id, { userId: user?.id || null });
        return fresh;
    },

    /** Unpaid, sent, non-cancelled invoices of a client (for term-change prompt). */
    async unpaidSentForClient(clientOrgId, agencyId) {
        const conds = [
            eq(invoices.clientOrgId, Number(clientOrgId)),
            eq(invoices.isCancelled, false),
            isNotNull(invoices.sentDate),
            isNull(invoices.paidDate),
        ];
        if (agencyId) conds.push(eq(invoices.organizationId, agencyId));
        const rows = await db.select().from(invoices).where(and(...conds)).orderBy(asc(invoices.sentDate));
        return rows.map(r => ({ ...r, status: deriveInvoiceStatus(r) }));
    },

    // ─── Payment terms (Pengaturan → Termin Pembayaran) ────────────────────
    async getTerms(user) {
        const agencyId = await agencyIdFor(user);
        const [agency] = agencyId
            ? await db.select({ t: organizations.paymentTermDays }).from(organizations).where(eq(organizations.id, agencyId)).limit(1)
            : [];
        const conds = [isNotNull(organizations.parentAgencyId)];
        if (user?.role !== 'superadmin' && agencyId) conds.push(eq(organizations.parentAgencyId, agencyId));
        const companies = await db.select({
            id: organizations.id, name: organizations.name, paymentTermDays: organizations.paymentTermDays,
        }).from(organizations).where(and(...conds)).orderBy(asc(organizations.name));
        return {
            agencyId,
            defaultTermDays: agency?.t ?? DEFAULT_TERM_DAYS,
            companies,
        };
    },

    async setDefaultTerm(user, days) {
        const agencyId = await agencyIdFor(user);
        if (!agencyId) { const e = new Error('Agency tidak ditemukan.'); e.status = 400; throw e; }
        await db.update(organizations).set({ paymentTermDays: days, updatedAt: new Date() }).where(eq(organizations.id, agencyId));
        return { agencyId, defaultTermDays: days };
    },

    // ─── Tax settings (Pengaturan → Pajak) ─────────────────────────────────
    // Stored on the agency: organizations.tax_profile = { ppn, pph, clients: { <orgId>: profile } }.
    async recomputeIn(tx, invoiceId) {
        return recomputeTotal(tx, Number(invoiceId));
    },

    async recompute(invoiceId) {
        return db.transaction((tx) => recomputeTotal(tx, Number(invoiceId)));
    },

    async getTaxSettings(user) {
        const agencyId = await agencyIdFor(user);
        const [a] = agencyId ? await db.select({ p: organizations.taxProfile }).from(organizations).where(eq(organizations.id, agencyId)).limit(1) : [];
        const raw = a?.p || {};
        const conds = [isNotNull(organizations.parentAgencyId)];
        if (user?.role !== 'superadmin' && agencyId) conds.push(eq(organizations.parentAgencyId, agencyId));
        const companies = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(...conds)).orderBy(asc(organizations.name));
        const clients = raw.clients || {};
        return {
            agencyId,
            profile: taxProfileOf(raw),
            companies: companies.map((c) => ({ ...c, profile: clients[String(c.id)] ? taxProfileOf(clients[String(c.id)]) : null })),
        };
    },

    async setTaxProfile(user, clientOrgId, profile) {
        const agencyId = await agencyIdFor(user);
        if (!agencyId) { const e = new Error('Agency tidak ditemukan.'); e.status = 400; throw e; }
        const [a] = await db.select({ p: organizations.taxProfile }).from(organizations).where(eq(organizations.id, agencyId)).limit(1);
        const raw = a?.p || {};
        const clients = { ...(raw.clients || {}) };
        let next;
        if (clientOrgId) {
            const conds = [eq(organizations.id, Number(clientOrgId)), isNotNull(organizations.parentAgencyId)];
            if (user?.role !== 'superadmin') conds.push(eq(organizations.parentAgencyId, agencyId));
            const [c] = await db.select({ id: organizations.id }).from(organizations).where(and(...conds)).limit(1);
            if (!c) { const e = new Error('Perusahaan tidak ditemukan.'); e.status = 404; throw e; }
            if (profile) clients[String(c.id)] = taxProfileOf(profile); else delete clients[String(c.id)];
            next = { ...taxProfileOf(raw), clients };
        } else {
            next = { ...taxProfileOf(profile), clients };
        }
        await db.update(organizations).set({ taxProfile: next, updatedAt: new Date() }).where(eq(organizations.id, agencyId));
        return this.getTaxSettings(user);
    },

    async resolvedTaxProfile(user, clientOrgId) {
        return taxProfileFor(await agencyIdFor(user), clientOrgId ? Number(clientOrgId) : null);
    },

    async setCompanyTerm(user, clientOrgId, days) {
        const agencyId = await agencyIdFor(user);
        const conds = [eq(organizations.id, Number(clientOrgId)), isNotNull(organizations.parentAgencyId)];
        if (user?.role !== 'superadmin' && agencyId) conds.push(eq(organizations.parentAgencyId, agencyId));
        const [row] = await db.update(organizations)
            .set({ paymentTermDays: days, updatedAt: new Date() })
            .where(and(...conds)).returning({ id: organizations.id, name: organizations.name, paymentTermDays: organizations.paymentTermDays });
        if (!row) { const e = new Error('Perusahaan tidak ditemukan.'); e.status = 404; throw e; }
        // Existing invoices keep their due dates; return the ones the user may
        // want to cancel & re-issue under the new term.
        // The term is already saved at this point — a failure in this follow-up
        // lookup must not turn a successful save into an error for the user.
        let affected = [];
        try {
            affected = await this.unpaidSentForClient(row.id, user?.role === 'superadmin' ? null : agencyId);
        } catch (e) {
            console.error('[invoices] affected-invoice lookup failed:', e?.cause?.message || e.message);
        }
        return { company: row, affected };
    },

    // ─── Monthly consolidated invoice (corporate) ─────────────────────────
    // One invoice per client company per month: all COMPLETED orders of the
    // agency for that company, returned in the month (WIB), not yet invoiced.
    async monthlyPreview(user, { clientOrgId, month }) {
        if (!/^\d{4}-\d{2}$/.test(String(month || ''))) { const e = new Error('Bulan wajib (YYYY-MM).'); e.status = 400; throw e; }
        const agencyId = await agencyIdFor(user);
        const [client] = await db.select().from(organizations).where(eq(organizations.id, Number(clientOrgId))).limit(1);
        if (!client) { const e = new Error('Perusahaan tidak ditemukan.'); e.status = 404; throw e; }
        const [y, m] = month.split('-').map(Number);
        const from = new Date(`${month}-01T00:00:00+07:00`);
        const to = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+07:00`);
        const norm = normalizeCompanyName(client.name);
        const scope = buildScopeConditions(user, {
            organizationId: orders.organizationId, isDemo: orders.isDemo, createdBy: orders.createdBy, claimedByAgencyId: orders.claimedByAgencyId,
        });
        const rows = await db.select({
            id: orders.id, orderNumber: orders.orderNumber, pickupDate: orders.pickupDate, returnDate: orders.returnDate,
            totalDays: orders.totalDays, totalPrice: orders.totalPrice, package: orders.package, destination: orders.destination,
            costCenter: orders.costCenter, customerName: orders.customerName, plate: cars.licensePlate, carName: cars.name,
        }).from(orders)
            .leftJoin(customers, eq(customers.id, orders.customerId))
            .leftJoin(cars, eq(cars.id, orders.carId))
            .where(and(
                ...scope,
                eq(orders.status, 'completed'), isNull(orders.invoiceId),
                // ISO strings: a raw Date inside sql`` is sent as Date.toString()
                // ("Tue Sep 01 2026 … GMT+0700 (Waktu Indonesia Barat)"), which Postgres rejects.
                sql`${orders.returnDate} >= ${from.toISOString()}::timestamptz AND ${orders.returnDate} < ${to.toISOString()}::timestamptz`,
                sql`(${orders.organizationId} = ${client.id} OR LOWER(TRIM(${customers.companyName})) = ${norm})`,
            ))
            .orderBy(asc(orders.returnDate), asc(orders.orderNumber), asc(orders.id));
        const [agency] = agencyId ? await db.select({ n: organizations.docNumbering }).from(organizations).where(eq(organizations.id, agencyId)).limit(1) : [];
        const num = agency?.n || {};
        const code = (client.displayId || String(client.name || 'KLIEN').replace(/^(pt|cv|ud)\.?\s+/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 6) || 'KLIEN').toUpperCase();
        const proposedNumber = `${num.yearPrefix || String(y).slice(-2)}/${num.invoicePrefix || 'DSR/INV/'}${code}-${String(m).padStart(2, '0')}`;
        const total = rows.reduce((t, r) => t + Number(r.totalPrice || 0), 0);
        return {
            client: { id: client.id, name: client.name, paymentTermDays: client.paymentTermDays }, month,
            orders: rows.map((r) => ({ ...r, totalPrice: Number(r.totalPrice || 0) })),
            bookings: new Set(rows.map((r) => r.orderNumber)).size, total, proposedNumber,
            unpriced: rows.filter((r) => !(Number(r.totalPrice) > 0)).length,
        };
    },

    async issueMonthly(user, { clientOrgId, month, orderIds, invoiceNumber, sentDate }) {
        const prev = await this.monthlyPreview(user, { clientOrgId, month });
        const allowed = new Set(prev.orders.map((o) => o.id));
        const ids = (Array.isArray(orderIds) && orderIds.length ? orderIds.map(Number) : [...allowed]).filter((id) => allowed.has(id));
        if (!ids.length) { const e = new Error('Tidak ada order yang bisa ditagihkan.'); e.status = 400; throw e; }
        const number = String(invoiceNumber || prev.proposedNumber).trim().slice(0, 50);
        const agencyId = await agencyIdFor(user);
        const [dup] = await db.select({ id: invoices.id }).from(invoices).where(and(
            agencyId ? eq(invoices.organizationId, agencyId) : isNull(invoices.organizationId),
            eq(invoices.invoiceNumber, number), eq(invoices.isCancelled, false),
        )).limit(1);
        if (dup) { const e = new Error(`No. invoice ${number} sudah dipakai. Ganti nomornya.`); e.status = 409; throw e; }
        const res = await this.issueForOrders({ items: ids.map((id) => ({ id, invoiceNumber: number })), sentDate: sentDate || null, user, allowedIds: ids });
        return this.getById(res[0].invoiceId);
    },

    agencyIdFor,
};

export default invoiceService;
