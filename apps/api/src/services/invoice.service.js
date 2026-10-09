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
import { invoices, orders, organizations, customers } from '../db/schema.js';
import { eq, and, inArray, isNull, isNotNull, sql, asc } from 'drizzle-orm';
import { normalizeCompanyName } from './invite-code.service.js';
import { resolveDefaultAgencyId } from './relationship.service.js';

export const DEFAULT_TERM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date, days) {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + Number(days || 0) * DAY_MS);
}

/** Derive the display status. `orderStatus` is used only for "Belum Dikirim". */
export function deriveInvoiceStatus({ sentDate, dueDate, paidDate, orderStatus, isCancelled, paymentStatus } = {}, now = new Date()) {
    if (isCancelled) return 'Dibatalkan';
    // Legacy rows synced from Rekap.xlsx may carry "Paid" without a date.
    if (paidDate || String(paymentStatus || '').toLowerCase() === 'paid') return 'Paid';
    if (sentDate) {
        if (dueDate && new Date(dueDate).getTime() < now.getTime()) return 'Overdue';
        return 'Pending';
    }
    if (orderStatus === 'completed') return 'Belum Dikirim';
    return null;
}

/** Owning agency for an invoice written by `user`. */
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
        invoicePaymentStatus: invoiceRow.paidDate ? 'Paid' : 'Pending',
        updatedAt: new Date(),
    }).where(inArray(orders.id, orderIds));
}

async function recomputeTotal(tx, invoiceId) {
    const [s] = await tx.select({ total: sql`COALESCE(SUM(CAST(${orders.totalPrice} AS DECIMAL)), 0)` })
        .from(orders).where(eq(orders.invoiceId, invoiceId));
    const [row] = await tx.update(invoices)
        .set({ totalAmount: String(Number(s?.total || 0)), updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId)).returning();
    return row;
}

export const invoiceService = {
    deriveInvoiceStatus,

    /**
     * Issue (or update) invoices for a set of order rows. `items` is
     * [{ id, invoiceNumber }]; rows sharing an invoiceNumber become ONE
     * invoice. `allowedIds` = ids the caller is allowed to touch (scope).
     */
    async issueForOrders({ items, sentDate, letterNumber, user, allowedIds }) {
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
                if (existing) {
                    // Re-marking an existing invoice: keep its frozen term; set the
                    // sent date only if given (and recompute due from the frozen term).
                    const patch = { updatedAt: new Date() };
                    if (sent) {
                        patch.sentDate = sent;
                        patch.dueDate = addDays(sent, existing.paymentTermDays ?? termDays);
                    }
                    if (letterNumber) patch.letterNumber = letterNumber;
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
                        createdBy: user?.id || null,
                    }).returning();
                }
                await syncOrders(tx, inv, ids);
                return recomputeTotal(tx, inv.id);
            });
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
        return {
            ...inv,
            status: deriveInvoiceStatus({ ...inv, orderStatus: anyCompleted ? 'completed' : null }),
            orders: rows,
            orderNumbers: [...new Set(rows.map(r => r.orderNumber))],
        };
    },

    /** Update timeline fields. Due date always follows sent + frozen term. */
    async update(id, { sentDate, paidDate, letterNumber, notes }) {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
        if (inv.isCancelled) { const e = new Error('Invoice sudah dibatalkan.'); e.status = 400; throw e; }
        const patch = { updatedAt: new Date() };
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

        return db.transaction(async (tx) => {
            const [row] = await tx.update(invoices).set(patch).where(eq(invoices.id, inv.id)).returning();
            const linked = await tx.select({ id: orders.id }).from(orders).where(eq(orders.invoiceId, inv.id));
            await syncOrders(tx, row, linked.map(r => r.id));
            return row;
        });
    },

    /**
     * Cancel an invoice and re-issue it under the SAME number (number is tied
     * to the kode transaksi). The new invoice re-reads the client's current
     * term and starts as "Belum Dikirim" (no sent/due/paid dates).
     */
    async cancelAndReissue(id, { reason, user } = {}) {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
        if (inv.isCancelled) { const e = new Error('Invoice sudah dibatalkan.'); e.status = 400; throw e; }
        if (inv.paidDate) { const e = new Error('Invoice sudah dibayar — tidak dapat dibatalkan.'); e.status = 400; throw e; }

        const linkedRows = await db.select().from(orders).where(eq(orders.invoiceId, inv.id));
        const { termDays } = await resolveClientAndTerm(inv.organizationId, linkedRows);

        return db.transaction(async (tx) => {
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
                createdBy: user?.id || null,
            }).returning();
            await syncOrders(tx, fresh, linkedRows.map(r => r.id));
            return recomputeTotal(tx, fresh.id);
        });
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
        const affected = await this.unpaidSentForClient(row.id, user?.role === 'superadmin' ? null : agencyId);
        return { company: row, affected };
    },

    agencyIdFor,
};

export default invoiceService;
