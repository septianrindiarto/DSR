// ─── Books auto-posting service ─────────────────────────────────────────────
// Keeps the journal in step with invoices and payments (rules in
// books-autopost-core.js). Each business record has at most ONE active
// (posted) auto entry, linked by source_type/source_id. On every change we
// compute the desired entry and compare:
//   same            → nothing to do
//   different       → reverse the old entry, post the new one
//   no longer valid → reverse the old entry
// Locked periods: the entry goes on its own date if that month is open,
// otherwise on today's date (noted in the description). If today is locked
// too, the sync is skipped and reported (fix by unlocking, then "Sinkronkan").
//
// Auto-posting never blocks the business action: invoice / payment saves
// succeed even if the books can't be updated (e.g. chart of accounts not set
// up yet). Use resyncOrg() ("Sinkronkan" in Keuangan) to catch up.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db/index.js';
import { chartOfAccounts, bookTransactions, bookLines, invoices, invoicePayments, orders, cars } from '../db/schema.js';
import { and, eq, inArray, sql, asc, desc, isNotNull } from 'drizzle-orm';
import { lockedSet, nextNumbers } from './books.service.js';
import * as C from './books-autopost-core.js';
import { dailyRatesOf, dailyLineAmount } from './ops-core.js';
import { agencyPolicyDefault } from './ops-policy.service.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function autoAccounts(orgId) {
    const rows = await db.select().from(chartOfAccounts)
        .where(and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.isActive, true)));
    const byCode = new Map(rows.map((a) => [a.code, a]));
    const cash = rows.filter((a) => a.isCash);
    const preferred = C.AUTO_CODES.cashPreferred.map((c) => byCode.get(c)).find((a) => a?.isCash);
    return {
        receivable: byCode.get(C.AUTO_CODES.receivable)?.id || null,
        revenue: byCode.get(C.AUTO_CODES.revenue)?.id || null,
        discount: byCode.get(C.AUTO_CODES.discount)?.id || null,
        ppnOut: (byCode.get(C.AUTO_CODES.ppnOut) || byCode.get(C.AUTO_CODES.ppnOutFallback))?.id || null,
        addedTax: (byCode.get(C.AUTO_CODES.addedTax) || byCode.get(C.AUTO_CODES.ppnOutFallback))?.id || null,
        pph23: (byCode.get(C.AUTO_CODES.pph23) || byCode.get(C.AUTO_CODES.pph23Fallback))?.id || null,
        cashIds: new Set(cash.map((a) => a.id)),
        cashAccounts: cash.map((a) => ({ id: a.id, code: a.code, name: a.name })),
        defaultCash: preferred?.id || cash[0]?.id || null,
        get ok() { return !!(this.receivable && this.revenue && this.defaultCash); },
    };
}

async function currentEntry(tx, orgId, type, id) {
    const [t] = await tx.select().from(bookTransactions).where(and(
        eq(bookTransactions.organizationId, orgId), eq(bookTransactions.source, 'auto'),
        eq(bookTransactions.sourceType, type), eq(bookTransactions.sourceId, id), eq(bookTransactions.status, 'posted'),
    )).orderBy(desc(bookTransactions.id)).limit(1);
    if (!t) return null;
    const lines = await tx.select().from(bookLines).where(eq(bookLines.transactionId, t.id)).orderBy(asc(bookLines.lineNo));
    return { ...t, lines: lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })) };
}

function lockedError() {
    const e = new Error('Periode terkunci — jurnal otomatis tidak dapat dicatat. Buka kunci periode lalu klik Sinkronkan.');
    e.code = 'PERIOD_LOCKED';
    return e;
}

/** Make the books match `desired` for one source record. Returns an outcome string. */
async function syncSource(orgId, type, id, desired, userId = null) {
    const locks = await lockedSet(orgId);
    const today = C.jakartaDate(new Date());
    return db.transaction(async (tx) => {
        // Serialize concurrent syncs of the same record.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`books:${orgId}:${type}:${id}`}))`);
        const cur = await currentEntry(tx, orgId, type, id);
        if (!cur && !desired) return 'none';
        if (cur && desired && C.sameEntry(cur, desired)) return 'unchanged';

        const rev = cur ? C.openDate(locks, cur.entryDate, today) : null;
        const add = desired ? C.openDate(locks, desired.date, today) : null;
        if ((cur && !rev) || (desired && !add)) throw lockedError();
        const nextNo = await nextNumbers(tx, orgId, [rev?.date, add?.date].filter(Boolean));
        const now = new Date();

        if (cur) {
            const [r] = await tx.insert(bookTransactions).values({
                organizationId: orgId, journalNo: nextNo(rev.date), entryDate: rev.date,
                description: `[PEMBALIK ${cur.journalNo}] ${cur.description}`.slice(0, 500),
                reference: cur.journalNo, source: 'reversal', status: 'posted', reversalOf: cur.id,
                sourceType: type, sourceId: id, totalAmount: cur.totalAmount,
                createdBy: userId, postedBy: userId, postedAt: now,
            }).returning();
            await tx.insert(bookLines).values(cur.lines.map((l, i) => ({
                transactionId: r.id, lineNo: i + 1, accountId: l.accountId,
                debit: String(l.credit), credit: String(l.debit), memo: l.memo, orderNumber: l.orderNumber, carId: l.carId,
            })));
            await tx.update(bookTransactions).set({ status: 'reversed', updatedAt: now }).where(eq(bookTransactions.id, cur.id));
        }
        if (desired) {
            const [t] = await tx.insert(bookTransactions).values({
                organizationId: orgId, journalNo: nextNo(add.date), entryDate: add.date,
                description: (add.moved ? `${desired.description} [tgl asli ${desired.date}, periode terkunci]` : desired.description).slice(0, 500),
                reference: desired.reference || null, source: 'auto', status: 'posted',
                sourceType: type, sourceId: id, totalAmount: String(r2(desired.total)),
                createdBy: userId, postedBy: userId, postedAt: now,
            }).returning();
            await tx.insert(bookLines).values(desired.lines.map((l, i) => ({
                transactionId: t.id, lineNo: i + 1, accountId: l.accountId,
                debit: String(r2(l.debit)), credit: String(r2(l.credit)),
                memo: l.memo || null, orderNumber: l.orderNumber || null, carId: l.carId || null,
            })));
        }
        return cur ? (desired ? 'replaced' : 'reversed') : 'posted';
    });
}

// Revenue per row = the invoiced line (price + overtime/nights at the agency
// default rates), so Σ revenue − discount + taxes = invoice total.
async function invoiceRows(invoiceId, agencyId) {
    const rates = dailyRatesOf(await agencyPolicyDefault(agencyId));
    const rows = await db.select({
        orderNumber: orders.orderNumber, carId: orders.carId, totalPrice: orders.totalPrice, plate: cars.licensePlate,
        ot: orders.overtimeHours, nights: orders.overnightNights,
    }).from(orders).leftJoin(cars, eq(cars.id, orders.carId))
        .where(eq(orders.invoiceId, invoiceId)).orderBy(asc(orders.id));
    return rows.map(({ ot, nights, ...r }) => ({ ...r, totalPrice: dailyLineAmount({ price: r.totalPrice, overtimeHours: ot, nights }, rates) }));
}

async function syncInvoiceRow(inv, acc, userId) {
    // A cancelled invoice keeps no order rows (they moved to the re-issue), so
    // it simply resolves to "no entry" → reversed.
    const rows = inv.isCancelled ? [] : await invoiceRows(inv.id, inv.organizationId);
    return syncSource(inv.organizationId, 'invoice', inv.id, C.invoiceEntry(inv, rows, acc), userId);
}

async function syncPaymentRow(pay, inv, acc, userId) {
    const cashId = pay && acc.cashIds.has(Number(pay.accountId)) ? Number(pay.accountId) : acc.defaultCash;
    return syncSource(inv.organizationId, 'payment', pay.id, C.paymentEntry(pay, inv, acc, cashId), userId);
}

export const booksAutoPost = {
    /**
     * Best-effort hook after any invoice change. Never throws.
     * opts.paymentIds: payments added/changed · opts.deletedPaymentIds: removed.
     */
    async afterInvoice(invoiceId, { paymentIds = [], deletedPaymentIds = [], userId = null } = {}) {
        try {
            const [inv] = await db.select().from(invoices).where(eq(invoices.id, Number(invoiceId))).limit(1);
            if (!inv?.organizationId) return { skipped: 'no_invoice' };
            const acc = await autoAccounts(inv.organizationId);
            if (!acc.ok) return { skipped: 'no_accounts' };
            const out = { invoice: await syncInvoiceRow(inv, acc, userId), payments: [] };
            if (paymentIds.length) {
                const pays = await db.select().from(invoicePayments).where(inArray(invoicePayments.id, paymentIds.map(Number)));
                for (const p of pays) out.payments.push(await syncPaymentRow(p, inv, acc, userId));
            }
            for (const pid of deletedPaymentIds) out.payments.push(await syncSource(inv.organizationId, 'payment', Number(pid), null, userId));
            return out;
        } catch (e) {
            console.error('[books:auto] sync failed for invoice', invoiceId, '-', e.code || '', e.message);
            return { error: e.message, code: e.code || null };
        }
    },

    async afterInvoices(ids, opts = {}) {
        for (const id of [...new Set((ids || []).filter(Boolean))]) await this.afterInvoice(id, opts);
    },

    /** Full catch-up for one organization (Keuangan → Otomatis → Sinkronkan). */
    async resyncOrg(orgId, userId = null) {
        const acc = await autoAccounts(orgId);
        if (!acc.ok) {
            const e = new Error('Daftar akun belum lengkap: perlu akun 1-1300 Piutang Usaha, 4-1000 Pendapatan Sewa, dan minimal satu akun Kas/Bank. Gunakan "Pakai Daftar Akun Standar".');
            e.status = 400; throw e;
        }
        const tally = { posted: 0, replaced: 0, reversed: 0, unchanged: 0, none: 0, errors: [] };
        const count = (r) => { tally[r] = (tally[r] || 0) + 1; };
        const invs = await db.select().from(invoices).where(eq(invoices.organizationId, orgId)).orderBy(asc(invoices.id));
        const invById = new Map(invs.map((i) => [i.id, i]));
        for (const inv of invs) {
            try { count(await syncInvoiceRow(inv, acc, userId)); }
            catch (e) { tally.errors.push(`Invoice ${inv.invoiceNumber}: ${e.message}`); }
        }
        const invIds = invs.map((i) => i.id);
        const pays = invIds.length ? await db.select().from(invoicePayments).where(inArray(invoicePayments.invoiceId, invIds)) : [];
        const payIds = new Set(pays.map((p) => p.id));
        for (const p of pays) {
            try { count(await syncPaymentRow(p, invById.get(p.invoiceId), acc, userId)); }
            catch (e) { tally.errors.push(`Pembayaran #${p.id}: ${e.message}`); }
        }
        // Auto entries whose payment no longer exists → reverse.
        const orphans = await db.select({ sourceId: bookTransactions.sourceId }).from(bookTransactions).where(and(
            eq(bookTransactions.organizationId, orgId), eq(bookTransactions.source, 'auto'),
            eq(bookTransactions.sourceType, 'payment'), eq(bookTransactions.status, 'posted'),
        ));
        for (const o of orphans) {
            if (payIds.has(o.sourceId)) continue;
            try { count(await syncSource(orgId, 'payment', o.sourceId, null, userId)); }
            catch (e) { tally.errors.push(`Pembayaran #${o.sourceId}: ${e.message}`); }
        }
        return tally;
    },

    /** What's on the books vs what should be (for the Otomatis panel). */
    async status(orgId) {
        const acc = await autoAccounts(orgId);
        const [{ sent }] = await db.select({ sent: sql`COUNT(*)::int` }).from(invoices).where(and(
            eq(invoices.organizationId, orgId), eq(invoices.isCancelled, false), isNotNull(invoices.sentDate),
        ));
        const [{ pays }] = await db.select({ pays: sql`COUNT(*)::int` }).from(invoicePayments)
            .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId)).where(eq(invoices.organizationId, orgId));
        const posted = await db.select({ type: bookTransactions.sourceType, n: sql`COUNT(*)::int` }).from(bookTransactions).where(and(
            eq(bookTransactions.organizationId, orgId), eq(bookTransactions.source, 'auto'), eq(bookTransactions.status, 'posted'),
        )).groupBy(bookTransactions.sourceType);
        const n = Object.fromEntries(posted.map((p) => [p.type, p.n]));
        return {
            accountsReady: acc.ok,
            cashAccounts: acc.cashAccounts,
            defaultCashAccountId: acc.defaultCash,
            invoicesSent: sent, invoicesPosted: n.invoice || 0,
            payments: pays, paymentsPosted: n.payment || 0,
            inSync: acc.ok && sent === (n.invoice || 0) && pays === (n.payment || 0),
        };
    },

    autoAccounts,
};

export default booksAutoPost;
