// ─── Books v2 service — accounts, journal entries, import, period locks ─────
// Every query is scoped to ONE organization (the caller's agency). Report math
// lives in books-math.js (pure, unit-tested); this file only loads data.
//
// Lifecycle:  draft ──post──▶ posted ──reverse──▶ reversed (+ a new posted
// reversal entry with swapped lines). Posted entries are immutable; drafts can
// be edited or deleted. Locked months refuse create / post / reverse / edit.
// Reports read posted + reversed entries only (a reversal cancels the original).
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { chartOfAccounts, bookTransactions, bookLines, bookImportMappings, bookPeriodLocks } from '../db/schema.js';
import { and, eq, inArray, sql, asc, desc, ilike, or, gte, lte } from 'drizzle-orm';
import { resolveDefaultAgencyId } from './relationship.service.js';
import { DEFAULT_COA, suggestAccountCode, QUICK_TYPES, QUICK_TYPE_BY_KEY, buildQuickLines } from './books-coa.js';
import * as M from './books-math.js';

const POSTED = ['posted', 'reversed'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, message, extra = {}) {
    const e = new Error(message); e.status = status; Object.assign(e, extra); return e;
}

export async function bookOrgId(user) {
    if (user?.organizationId) return user.organizationId;
    const id = await resolveDefaultAgencyId();
    if (!id) throw httpError(400, 'Organisasi tidak ditemukan.');
    return id;
}

export const toIso = (v) => {
    if (!v) return null;
    if (ISO.test(String(v))) return String(v);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// ─── Accounts ────────────────────────────────────────────────────────────────
async function accountsOf(orgId, { activeOnly = false } = {}) {
    const conds = [eq(chartOfAccounts.organizationId, orgId)];
    if (activeOnly) conds.push(eq(chartOfAccounts.isActive, true));
    return db.select().from(chartOfAccounts).where(and(...conds)).orderBy(asc(chartOfAccounts.code));
}

// ─── Period locks ────────────────────────────────────────────────────────────
export async function lockedSet(orgId) {
    const rows = await db.select().from(bookPeriodLocks).where(eq(bookPeriodLocks.organizationId, orgId));
    return new Set(rows.map((r) => `${r.year}-${r.month}`));
}
export const ymKey = (iso) => `${Number(iso.slice(0, 4))}-${Number(iso.slice(5, 7))}`;
function assertOpen(locks, iso) {
    if (locks.has(ymKey(iso))) throw httpError(400, `Periode ${iso.slice(0, 7)} sudah dikunci.`);
}

// ─── Journal numbers: JU-YYYYMM-NNNN per organization ───────────────────────
export async function nextNumbers(tx, orgId, isoDates) {
    const months = [...new Set(isoDates.map((d) => d.slice(0, 7).replace('-', '')))];
    const counters = {};
    for (const ym of months) {
        const prefix = `JU-${ym}-`;
        const [r] = await tx.select({
            n: sql`COALESCE(MAX(CAST(SUBSTRING(${bookTransactions.journalNo} FROM ${prefix.length + 1}) AS INTEGER)), 0)`,
        }).from(bookTransactions).where(and(
            eq(bookTransactions.organizationId, orgId),
            sql`${bookTransactions.journalNo} LIKE ${prefix + '%'}`,
        ));
        counters[ym] = Number(r?.n || 0);
    }
    return (iso) => {
        const ym = iso.slice(0, 7).replace('-', '');
        counters[ym] += 1;
        return `JU-${ym}-${String(counters[ym]).padStart(4, '0')}`;
    };
}

function cleanLines(lines) {
    return (lines || []).map((l, i) => ({
        lineNo: i + 1,
        accountId: Number(l.accountId) || null,
        debit: M.round2(l.debit),
        credit: M.round2(l.credit),
        memo: l.memo ? String(l.memo).slice(0, 300) : null,
        orderNumber: l.orderNumber ? String(l.orderNumber).slice(0, 20) : null,
        carId: l.carId ? Number(l.carId) : null,
    }));
}

async function assertAccounts(orgId, lines) {
    const ids = [...new Set(lines.map((l) => l.accountId).filter(Boolean))];
    if (!ids.length) throw httpError(400, 'Akun wajib dipilih.');
    const rows = await db.select({ id: chartOfAccounts.id, isActive: chartOfAccounts.isActive })
        .from(chartOfAccounts).where(and(eq(chartOfAccounts.organizationId, orgId), inArray(chartOfAccounts.id, ids)));
    if (rows.length !== ids.length) throw httpError(400, 'Ada akun yang tidak ditemukan.');
    if (rows.some((r) => r.isActive === false)) throw httpError(400, 'Ada akun yang sudah dinonaktifkan.');
}

// ─── Aggregation helpers for reports ────────────────────────────────────────
async function sumsBy(orgId, { from = null, to = null } = {}) {
    const conds = [eq(bookTransactions.organizationId, orgId), inArray(bookTransactions.status, POSTED)];
    if (from) conds.push(gte(bookTransactions.entryDate, from));
    if (to) conds.push(lte(bookTransactions.entryDate, to));
    const rows = await db.select({
        accountId: bookLines.accountId,
        debit: sql`COALESCE(SUM(${bookLines.debit}), 0)`,
        credit: sql`COALESCE(SUM(${bookLines.credit}), 0)`,
    }).from(bookLines)
        .innerJoin(bookTransactions, eq(bookTransactions.id, bookLines.transactionId))
        .where(and(...conds))
        .groupBy(bookLines.accountId);
    return rows.map((r) => ({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) }));
}

function checkRange(from, to) {
    if (!ISO.test(from || '') || !ISO.test(to || '')) throw httpError(400, 'Parameter from/to wajib (YYYY-MM-DD).');
    if (from > to) throw httpError(400, 'Tanggal awal tidak boleh setelah tanggal akhir.');
}

export const booksService = {
    // ─── Accounts ────────────────────────────────────────────────────────────
    async listAccounts(user) {
        const orgId = await bookOrgId(user);
        const accs = await accountsOf(orgId);
        // Usage count so the UI knows which accounts can still be edited freely.
        const used = await db.select({ accountId: bookLines.accountId, n: sql`COUNT(*)::int` })
            .from(bookLines).innerJoin(bookTransactions, eq(bookTransactions.id, bookLines.transactionId))
            .where(eq(bookTransactions.organizationId, orgId)).groupBy(bookLines.accountId);
        const u = new Map(used.map((r) => [r.accountId, r.n]));
        return accs.map((a) => ({ ...a, usageCount: u.get(a.id) || 0 }));
    },

    async seedDefaultAccounts(user) {
        const orgId = await bookOrgId(user);
        const existing = new Set((await accountsOf(orgId)).map((a) => a.code));
        const toAdd = DEFAULT_COA.filter((a) => !existing.has(a.code)).map((a) => ({
            code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance,
            description: a.description || null, isCash: !!a.isCash, cashFlowClass: a.cashFlowClass || null,
            isActive: true, organizationId: orgId, createdBy: user?.id || null,
        }));
        if (toAdd.length) await db.insert(chartOfAccounts).values(toAdd);
        return { added: toAdd.length, skipped: DEFAULT_COA.length - toAdd.length };
    },

    async createAccount(user, a) {
        const orgId = await bookOrgId(user);
        const [dup] = await db.select({ id: chartOfAccounts.id }).from(chartOfAccounts)
            .where(and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.code, a.code))).limit(1);
        if (dup) throw httpError(409, `Kode akun ${a.code} sudah dipakai.`);
        const [row] = await db.insert(chartOfAccounts).values({
            code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance,
            description: a.description || null, isCash: !!a.isCash, cashFlowClass: a.cashFlowClass || null,
            isActive: true, organizationId: orgId, createdBy: user?.id || null,
        }).returning();
        return row;
    },

    async updateAccount(user, id, a) {
        const orgId = await bookOrgId(user);
        const [cur] = await db.select().from(chartOfAccounts)
            .where(and(eq(chartOfAccounts.id, Number(id)), eq(chartOfAccounts.organizationId, orgId))).limit(1);
        if (!cur) throw httpError(404, 'Akun tidak ditemukan.');
        const [{ n }] = await db.select({ n: sql`COUNT(*)::int` }).from(bookLines).where(eq(bookLines.accountId, cur.id));
        // Once used, type / normal balance are frozen (changing them would
        // silently rewrite every historical report).
        if (n > 0 && ((a.type && a.type !== cur.type) || (a.normalBalance && a.normalBalance !== cur.normalBalance))) {
            throw httpError(400, 'Tipe / saldo normal akun yang sudah dipakai tidak dapat diubah.');
        }
        if (a.code && a.code !== cur.code) {
            const [dup] = await db.select({ id: chartOfAccounts.id }).from(chartOfAccounts)
                .where(and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.code, a.code))).limit(1);
            if (dup) throw httpError(409, `Kode akun ${a.code} sudah dipakai.`);
        }
        const patch = { updatedAt: new Date() };
        for (const k of ['code', 'name', 'type', 'normalBalance', 'description', 'isActive', 'isCash', 'cashFlowClass']) {
            if (a[k] !== undefined) patch[k] = a[k];
        }
        const [row] = await db.update(chartOfAccounts).set(patch).where(eq(chartOfAccounts.id, cur.id)).returning();
        return row;
    },

    async deleteAccount(user, id) {
        const orgId = await bookOrgId(user);
        const [{ n }] = await db.select({ n: sql`COUNT(*)::int` }).from(bookLines).where(eq(bookLines.accountId, Number(id)));
        if (n > 0) throw httpError(400, 'Akun sudah dipakai di jurnal — nonaktifkan saja.');
        const del = await db.delete(chartOfAccounts)
            .where(and(eq(chartOfAccounts.id, Number(id)), eq(chartOfAccounts.organizationId, orgId))).returning();
        if (!del.length) throw httpError(404, 'Akun tidak ditemukan.');
        return { deleted: 1 };
    },

    // ─── Transactions ────────────────────────────────────────────────────────
    async listTransactions(user, { from, to, status, accountId, search, source, batchId, page = 1, limit = 50 }) {
        const orgId = await bookOrgId(user);
        const conds = [eq(bookTransactions.organizationId, orgId)];
        if (from) conds.push(gte(bookTransactions.entryDate, from));
        if (to) conds.push(lte(bookTransactions.entryDate, to));
        if (status) conds.push(eq(bookTransactions.status, status));
        if (source) conds.push(eq(bookTransactions.source, source));
        if (batchId) conds.push(eq(bookTransactions.batchId, batchId));
        if (search) conds.push(or(ilike(bookTransactions.description, `%${search}%`), ilike(bookTransactions.journalNo, `%${search}%`), ilike(bookTransactions.reference, `%${search}%`)));
        if (accountId) conds.push(sql`EXISTS (SELECT 1 FROM book_lines bl WHERE bl.transaction_id = ${bookTransactions.id} AND bl.account_id = ${Number(accountId)})`);
        const lim = Math.min(Number(limit) || 50, 500), pg = Math.max(Number(page) || 1, 1);
        const data = await db.select().from(bookTransactions).where(and(...conds))
            .orderBy(desc(bookTransactions.entryDate), desc(bookTransactions.id)).limit(lim).offset((pg - 1) * lim);
        const [{ n }] = await db.select({ n: sql`COUNT(*)::int` }).from(bookTransactions).where(and(...conds));
        const [{ drafts }] = await db.select({ drafts: sql`COUNT(*)::int` }).from(bookTransactions)
            .where(and(eq(bookTransactions.organizationId, orgId), eq(bookTransactions.status, 'draft')));
        // Attach lines (with account code/name) for the visible page only.
        const ids = data.map((t) => t.id);
        const lines = ids.length ? await db.select({
            transactionId: bookLines.transactionId, lineNo: bookLines.lineNo, accountId: bookLines.accountId,
            debit: bookLines.debit, credit: bookLines.credit, memo: bookLines.memo, orderNumber: bookLines.orderNumber,
            code: chartOfAccounts.code, name: chartOfAccounts.name,
        }).from(bookLines).innerJoin(chartOfAccounts, eq(chartOfAccounts.id, bookLines.accountId))
            .where(inArray(bookLines.transactionId, ids)).orderBy(asc(bookLines.lineNo)) : [];
        const byTx = new Map();
        for (const l of lines) {
            if (!byTx.has(l.transactionId)) byTx.set(l.transactionId, []);
            byTx.get(l.transactionId).push({ ...l, debit: Number(l.debit), credit: Number(l.credit) });
        }
        return { data: data.map((t) => ({ ...t, lines: byTx.get(t.id) || [] })), total: n, page: pg, limit: lim, draftCount: drafts };
    },

    async getTransaction(user, id) {
        const orgId = await bookOrgId(user);
        const [t] = await db.select().from(bookTransactions)
            .where(and(eq(bookTransactions.id, Number(id)), eq(bookTransactions.organizationId, orgId))).limit(1);
        if (!t) throw httpError(404, 'Jurnal tidak ditemukan.');
        const lines = await db.select({
            id: bookLines.id, lineNo: bookLines.lineNo, accountId: bookLines.accountId, debit: bookLines.debit, credit: bookLines.credit,
            memo: bookLines.memo, orderNumber: bookLines.orderNumber, carId: bookLines.carId,
            code: chartOfAccounts.code, name: chartOfAccounts.name,
        }).from(bookLines).innerJoin(chartOfAccounts, eq(chartOfAccounts.id, bookLines.accountId))
            .where(eq(bookLines.transactionId, t.id)).orderBy(asc(bookLines.lineNo));
        return { ...t, lines: lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })) };
    },

    /** Create one entry. `post: true` posts it immediately. */
    async createTransaction(user, { date, description, reference, lines, source = 'manual', post = false }) {
        const orgId = await bookOrgId(user);
        const iso = toIso(date);
        if (!iso) throw httpError(400, 'Tanggal tidak valid.');
        if (!String(description || '').trim()) throw httpError(400, 'Keterangan wajib diisi.');
        const cl = cleanLines(lines);
        const v = M.validateLines(cl);
        if (!v.ok) throw httpError(400, v.errors.join(' '), { details: v.errors });
        await assertAccounts(orgId, cl);
        assertOpen(await lockedSet(orgId), iso);
        return db.transaction(async (tx) => {
            const nextNo = await nextNumbers(tx, orgId, [iso]);
            const [t] = await tx.insert(bookTransactions).values({
                organizationId: orgId, journalNo: nextNo(iso), entryDate: iso,
                description: String(description).trim().slice(0, 500), reference: reference ? String(reference).slice(0, 100) : null,
                source, status: post ? 'posted' : 'draft', totalAmount: String(v.total),
                createdBy: user?.id || null, ...(post ? { postedBy: user?.id || null, postedAt: new Date() } : {}),
            }).returning();
            await tx.insert(bookLines).values(cl.map((l) => ({ ...l, transactionId: t.id, debit: String(l.debit), credit: String(l.credit) })));
            return t;
        });
    },

    async updateDraft(user, id, { date, description, reference, lines }) {
        const orgId = await bookOrgId(user);
        const [t] = await db.select().from(bookTransactions)
            .where(and(eq(bookTransactions.id, Number(id)), eq(bookTransactions.organizationId, orgId))).limit(1);
        if (!t) throw httpError(404, 'Jurnal tidak ditemukan.');
        if (t.status !== 'draft') throw httpError(400, 'Hanya jurnal draft yang dapat diubah. Gunakan Balik Jurnal untuk koreksi.');
        const iso = toIso(date) || t.entryDate;
        const locks = await lockedSet(orgId);
        assertOpen(locks, t.entryDate); assertOpen(locks, iso);
        const cl = cleanLines(lines);
        const v = M.validateLines(cl);
        if (!v.ok) throw httpError(400, v.errors.join(' '), { details: v.errors });
        await assertAccounts(orgId, cl);
        return db.transaction(async (tx) => {
            const [row] = await tx.update(bookTransactions).set({
                entryDate: iso, description: String(description || t.description).trim().slice(0, 500),
                reference: reference !== undefined ? (reference || null) : t.reference,
                totalAmount: String(v.total), updatedAt: new Date(),
            }).where(eq(bookTransactions.id, t.id)).returning();
            await tx.delete(bookLines).where(eq(bookLines.transactionId, t.id));
            await tx.insert(bookLines).values(cl.map((l) => ({ ...l, transactionId: t.id, debit: String(l.debit), credit: String(l.credit) })));
            return row;
        });
    },

    async deleteDraft(user, id) {
        const orgId = await bookOrgId(user);
        const [t] = await db.select().from(bookTransactions)
            .where(and(eq(bookTransactions.id, Number(id)), eq(bookTransactions.organizationId, orgId))).limit(1);
        if (!t) throw httpError(404, 'Jurnal tidak ditemukan.');
        if (t.status !== 'draft') throw httpError(400, 'Jurnal yang sudah diposting tidak dapat dihapus — gunakan Balik Jurnal.');
        await db.delete(bookTransactions).where(eq(bookTransactions.id, t.id));
        return { deleted: 1 };
    },

    /** Post drafts by ids OR by batch. Locked months are skipped and reported. */
    async post(user, { ids, batchId }) {
        const orgId = await bookOrgId(user);
        const conds = [eq(bookTransactions.organizationId, orgId), eq(bookTransactions.status, 'draft')];
        if (batchId) conds.push(eq(bookTransactions.batchId, batchId));
        else if (Array.isArray(ids) && ids.length) conds.push(inArray(bookTransactions.id, ids.map(Number)));
        else throw httpError(400, 'ids atau batchId wajib.');
        const drafts = await db.select({ id: bookTransactions.id, entryDate: bookTransactions.entryDate }).from(bookTransactions).where(and(...conds));
        const locks = await lockedSet(orgId);
        const ok = drafts.filter((d) => !locks.has(ymKey(d.entryDate))).map((d) => d.id);
        if (ok.length) {
            await db.update(bookTransactions).set({ status: 'posted', postedBy: user?.id || null, postedAt: new Date(), updatedAt: new Date() })
                .where(inArray(bookTransactions.id, ok));
        }
        return { posted: ok.length, skippedLocked: drafts.length - ok.length };
    },

    async deleteBatchDrafts(user, batchId) {
        const orgId = await bookOrgId(user);
        const del = await db.delete(bookTransactions).where(and(
            eq(bookTransactions.organizationId, orgId), eq(bookTransactions.batchId, String(batchId)), eq(bookTransactions.status, 'draft'),
        )).returning({ id: bookTransactions.id });
        return { deleted: del.length };
    },

    /** Reverse a posted entry: new posted entry with debit/credit swapped. */
    async reverse(user, id, { date, reason } = {}) {
        const orgId = await bookOrgId(user);
        const t = await this.getTransaction(user, id);
        if (t.status !== 'posted') throw httpError(400, 'Hanya jurnal berstatus posted yang dapat dibalik.');
        // Auto entries follow their invoice/payment — correct the source instead.
        if (t.source === 'auto') throw httpError(400, 'Jurnal otomatis mengikuti invoice/pembayaran. Ubah atau hapus sumbernya di Rekap Order, jurnal akan menyesuaikan.');
        const iso = toIso(date) || new Date().toISOString().slice(0, 10);
        assertOpen(await lockedSet(orgId), iso);
        return db.transaction(async (tx) => {
            const nextNo = await nextNumbers(tx, orgId, [iso]);
            const [r] = await tx.insert(bookTransactions).values({
                organizationId: orgId, journalNo: nextNo(iso), entryDate: iso,
                description: `[PEMBALIK ${t.journalNo}] ${reason ? `${reason} — ` : ''}${t.description}`.slice(0, 500),
                reference: t.journalNo, source: 'reversal', status: 'posted', reversalOf: t.id,
                totalAmount: t.totalAmount, createdBy: user?.id || null, postedBy: user?.id || null, postedAt: new Date(),
            }).returning();
            await tx.insert(bookLines).values(t.lines.map((l, i) => ({
                transactionId: r.id, lineNo: i + 1, accountId: l.accountId,
                debit: String(l.credit), credit: String(l.debit), memo: l.memo, orderNumber: l.orderNumber, carId: l.carId,
            })));
            await tx.update(bookTransactions).set({ status: 'reversed', updatedAt: new Date() }).where(eq(bookTransactions.id, t.id));
            return r;
        });
    },

    // ─── Catat Transaksi (guided entry) ─────────────────────────────────────
    quickTypes() {
        return QUICK_TYPES.map(({ key, group, label, hint, unit, other, payable }) => ({ key, group, label, hint: hint || null, unit: !!unit, other: !!other, canOwe: !!payable }));
    },

    /** One guided entry → one balanced journal entry (posted when allowed). */
    async quickEntry(user, input, { post = true } = {}) {
        const orgId = await bookOrgId(user);
        const accs = await accountsOf(orgId, { activeOnly: true });
        const sets = {
            idByCode: new Map(accs.map((a) => [a.code, a.id])),
            cashIds: new Set(accs.filter((a) => a.isCash).map((a) => a.id)),
            ids: new Set(accs.map((a) => a.id)),
        };
        let lines;
        try { lines = buildQuickLines(input.type, input, sets); }
        catch (e) { throw httpError(400, e.message); }
        const q = QUICK_TYPE_BY_KEY.get(input.type);
        const desc = String(input.description || '').trim() || q.label;
        return this.createTransaction(user, {
            date: input.date, description: desc, reference: input.reference || null,
            lines, source: 'quick', post,
        });
    },

    // ─── Cash-book import (manual Kas Masuk/Keluar records → drafts) ────────
    /**
     * Account suggestions for import labels: a saved mapping (from a previous
     * import) wins; otherwise the keyword dictionary in books-coa.js.
     * labels: [{ label, direction }] → [{ label, direction, accountId, source }]
     */
    async suggestMappings(user, labels) {
        const orgId = await bookOrgId(user);
        const accs = await accountsOf(orgId, { activeOnly: true });
        const idByCode = new Map(accs.map((a) => [a.code, a.id]));
        const saved = await db.select().from(bookImportMappings).where(eq(bookImportMappings.organizationId, orgId));
        const savedMap = new Map(saved.map((m) => [`${m.direction}|${m.label}`, m.accountId]));
        const activeIds = new Set(accs.map((a) => a.id));
        return (labels || []).slice(0, 2000).map(({ label, direction }) => {
            const key = `${direction}|${String(label || '').trim().toLowerCase()}`;
            const s = savedMap.get(key);
            if (s && activeIds.has(s)) return { label, direction, accountId: s, source: 'saved' };
            const code = suggestAccountCode(label, direction);
            return { label, direction, accountId: idByCode.get(code) || null, source: 'keyword' };
        });
    },

    /**
     * rows: [{ date, description, reference, amountIn, amountOut, label }]
     * mappings: [{ label, direction, accountId }]  (label = category or description)
     * opening: { date, amount } optional — Dr Kas / Cr Ekuitas Saldo Awal
     * Creates DRAFT entries in one batch; nothing affects reports until posted.
     */
    async importCashbook(user, { cashAccountId, rows, mappings, opening }) {
        const orgId = await bookOrgId(user);
        const accs = await accountsOf(orgId, { activeOnly: true });
        const accById = new Map(accs.map((a) => [a.id, a]));
        const cash = accById.get(Number(cashAccountId));
        if (!cash) throw httpError(400, 'Pilih akun Kas/Bank tujuan.');
        if (!Array.isArray(rows) || !rows.length) throw httpError(400, 'Tidak ada baris untuk diimpor.');
        if (rows.length > 5000) throw httpError(400, 'Maksimal 5000 baris per impor.');
        const map = new Map();
        for (const m of mappings || []) {
            if (!accById.has(Number(m.accountId))) throw httpError(400, `Akun untuk "${m.label}" tidak valid.`);
            map.set(`${m.direction}|${String(m.label).trim().toLowerCase()}`, Number(m.accountId));
        }
        const locks = await lockedSet(orgId);
        const errors = [];
        const entries = [];

        if (opening && Number(opening.amount)) {
            const equity = accs.find((a) => a.code === '3-9000') || accs.find((a) => a.type === 'equity');
            const iso = toIso(opening.date);
            if (!equity) errors.push({ row: 0, reason: 'Akun ekuitas untuk saldo awal tidak ditemukan.' });
            else if (!iso) errors.push({ row: 0, reason: 'Tanggal saldo awal tidak valid.' });
            else if (locks.has(ymKey(iso))) errors.push({ row: 0, reason: `Periode ${iso.slice(0, 7)} dikunci.` });
            else {
                const amt = M.round2(Math.abs(opening.amount));
                const lines = Number(opening.amount) > 0
                    ? [{ accountId: cash.id, debit: amt, credit: 0 }, { accountId: equity.id, debit: 0, credit: amt }]
                    : [{ accountId: equity.id, debit: amt, credit: 0 }, { accountId: cash.id, debit: 0, credit: amt }];
                entries.push({ iso, description: `Saldo awal ${cash.name}`, reference: null, source: 'opening', lines, total: amt });
            }
        }

        rows.forEach((r, i) => {
            const iso = toIso(r.date);
            const inAmt = M.round2(r.amountIn), outAmt = M.round2(r.amountOut);
            if (!iso) { errors.push({ row: i + 1, reason: 'Tanggal tidak valid' }); return; }
            if (locks.has(ymKey(iso))) { errors.push({ row: i + 1, reason: `Periode ${iso.slice(0, 7)} dikunci` }); return; }
            if (!(inAmt > 0) && !(outAmt > 0)) { errors.push({ row: i + 1, reason: 'Masuk/Keluar kosong' }); return; }
            const desc = String(r.description || '').trim() || '(tanpa keterangan)';
            const label = String(r.label || desc).trim().toLowerCase();
            for (const [direction, amt] of [['in', inAmt], ['out', outAmt]]) {
                if (!(amt > 0)) continue;
                const counter = map.get(`${direction}|${label}`);
                if (!counter) { errors.push({ row: i + 1, reason: `Akun belum dipetakan untuk "${r.label || desc}" (${direction === 'in' ? 'masuk' : 'keluar'})` }); continue; }
                entries.push({
                    iso, description: desc.slice(0, 500), reference: r.reference ? String(r.reference).slice(0, 100) : null,
                    source: 'import', total: amt,
                    lines: M.cashEntryLines({ direction, cashAccountId: cash.id, counterAccountId: counter, amount: amt }),
                });
            }
        });
        if (!entries.length) return { batchId: null, created: 0, errors };

        const batchId = `imp-${randomUUID().slice(0, 8)}`;
        await db.transaction(async (tx) => {
            // Remember label → account choices for the next import.
            for (const m of mappings || []) {
                const label = String(m.label).trim().toLowerCase().slice(0, 200);
                await tx.insert(bookImportMappings).values({ organizationId: orgId, label, direction: m.direction, accountId: Number(m.accountId) })
                    .onConflictDoUpdate({
                        target: [bookImportMappings.organizationId, bookImportMappings.direction, bookImportMappings.label],
                        set: { accountId: Number(m.accountId), updatedAt: new Date() },
                    });
            }
            entries.sort((a, b) => a.iso.localeCompare(b.iso));
            const nextNo = await nextNumbers(tx, orgId, entries.map((e) => e.iso));
            const CHUNK = 250;
            for (let i = 0; i < entries.length; i += CHUNK) {
                const chunk = entries.slice(i, i + CHUNK);
                const headers = await tx.insert(bookTransactions).values(chunk.map((e) => ({
                    organizationId: orgId, journalNo: nextNo(e.iso), entryDate: e.iso, description: e.description,
                    reference: e.reference, source: e.source, status: 'draft', batchId, totalAmount: String(e.total),
                    createdBy: user?.id || null,
                }))).returning({ id: bookTransactions.id });
                const lines = [];
                headers.forEach((h, k) => chunk[k].lines.forEach((l, n) => lines.push({
                    transactionId: h.id, lineNo: n + 1, accountId: l.accountId,
                    debit: String(M.round2(l.debit)), credit: String(M.round2(l.credit)),
                })));
                await tx.insert(bookLines).values(lines);
            }
        });
        return { batchId, created: entries.length, errors };
    },

    // ─── Period locks ────────────────────────────────────────────────────────
    async listLocks(user) {
        const orgId = await bookOrgId(user);
        return db.select().from(bookPeriodLocks).where(eq(bookPeriodLocks.organizationId, orgId))
            .orderBy(desc(bookPeriodLocks.year), desc(bookPeriodLocks.month));
    },
    async lock(user, { year, month }) {
        const orgId = await bookOrgId(user);
        const y = Number(year), m = Number(month);
        if (!(y > 2000 && m >= 1 && m <= 12)) throw httpError(400, 'Tahun/bulan tidak valid.');
        const [{ drafts }] = await db.select({ drafts: sql`COUNT(*)::int` }).from(bookTransactions).where(and(
            eq(bookTransactions.organizationId, orgId), eq(bookTransactions.status, 'draft'),
            sql`EXTRACT(YEAR FROM ${bookTransactions.entryDate}) = ${y}`, sql`EXTRACT(MONTH FROM ${bookTransactions.entryDate}) = ${m}`,
        ));
        if (drafts > 0) throw httpError(400, `Masih ada ${drafts} jurnal draft di periode ini. Posting atau hapus dulu.`);
        const [row] = await db.insert(bookPeriodLocks).values({ organizationId: orgId, year: y, month: m, lockedBy: user?.id || null })
            .onConflictDoNothing().returning();
        return row || { year: y, month: m, already: true };
    },
    async unlock(user, id) {
        const orgId = await bookOrgId(user);
        const del = await db.delete(bookPeriodLocks).where(and(eq(bookPeriodLocks.id, Number(id)), eq(bookPeriodLocks.organizationId, orgId))).returning();
        if (!del.length) throw httpError(404, 'Kunci periode tidak ditemukan.');
        return { unlocked: 1 };
    },

    // ─── Reports ─────────────────────────────────────────────────────────────
    async trialBalance(user, { from, to }) {
        checkRange(from, to);
        const orgId = await bookOrgId(user);
        const accounts = await accountsOf(orgId);
        const fy = M.fyStartOf(from), prev = M.dayBefore(from);
        const [beforeAll, beforeFY, period] = await Promise.all([
            sumsBy(orgId, { to: prev }),
            fy <= prev ? sumsBy(orgId, { from: fy, to: prev }) : Promise.resolve([]),
            sumsBy(orgId, { from, to }),
        ]);
        return { from, to, ...M.trialBalance(accounts, { beforeAll, beforeFY, period }) };
    },

    async incomeStatement(user, { from, to, cmpFrom, cmpTo }) {
        checkRange(from, to);
        const orgId = await bookOrgId(user);
        const accounts = await accountsOf(orgId);
        const cur = M.incomeStatement(accounts, await sumsBy(orgId, { from, to }));
        let compare = null;
        if (cmpFrom && cmpTo) { checkRange(cmpFrom, cmpTo); compare = M.incomeStatement(accounts, await sumsBy(orgId, { from: cmpFrom, to: cmpTo })); }
        return { from, to, ...cur, compare: compare ? { from: cmpFrom, to: cmpTo, ...compare } : null };
    },

    async balanceSheet(user, { asOf, cmpAsOf }) {
        if (!ISO.test(asOf || '')) throw httpError(400, 'Parameter asOf wajib (YYYY-MM-DD).');
        const orgId = await bookOrgId(user);
        const accounts = await accountsOf(orgId);
        const build = async (d) => M.balanceSheet(accounts, {
            allSums: await sumsBy(orgId, { to: d }), fySums: await sumsBy(orgId, { from: M.fyStartOf(d), to: d }),
        });
        const cur = await build(asOf);
        const compare = cmpAsOf && ISO.test(cmpAsOf) ? { asOf: cmpAsOf, ...(await build(cmpAsOf)) } : null;
        return { asOf, ...cur, compare };
    },

    async cashFlow(user, { from, to }) {
        checkRange(from, to);
        const orgId = await bookOrgId(user);
        const accounts = await accountsOf(orgId);
        const cashIds = accounts.filter((a) => a.isCash).map((a) => a.id);
        if (!cashIds.length) return { from, to, ...M.cashFlow(accounts, [], 0), warning: 'Belum ada akun bertanda Kas/Bank.' };
        const lines = await db.select({
            transactionId: bookLines.transactionId, accountId: bookLines.accountId, debit: bookLines.debit, credit: bookLines.credit,
        }).from(bookLines).innerJoin(bookTransactions, eq(bookTransactions.id, bookLines.transactionId)).where(and(
            eq(bookTransactions.organizationId, orgId), inArray(bookTransactions.status, POSTED),
            gte(bookTransactions.entryDate, from), lte(bookTransactions.entryDate, to),
            sql`EXISTS (SELECT 1 FROM book_lines c WHERE c.transaction_id = ${bookLines.transactionId} AND c.account_id IN (${sql.join(cashIds, sql`, `)}))`,
        ));
        const before = await sumsBy(orgId, { to: M.dayBefore(from) });
        const accById = new Map(accounts.map((a) => [a.id, a]));
        const openingCash = before.filter((s) => accById.get(s.accountId)?.isCash)
            .reduce((t, s) => t + M.signed(accById.get(s.accountId), s.debit, s.credit), 0);
        const result = M.cashFlow(accounts, lines, openingCash);
        // Cross-check against the actual closing cash balance.
        const upTo = await sumsBy(orgId, { to });
        const actual = M.round2(upTo.filter((s) => accById.get(s.accountId)?.isCash)
            .reduce((t, s) => t + M.signed(accById.get(s.accountId), s.debit, s.credit), 0));
        return { from, to, ...result, actualClosingCash: actual, reconciled: Math.abs(actual - result.closingCash) < 0.01 };
    },

    async equityStatement(user, { from, to }) {
        checkRange(from, to);
        const orgId = await bookOrgId(user);
        const accounts = await accountsOf(orgId);
        const [beforeSums, periodSums] = await Promise.all([sumsBy(orgId, { to: M.dayBefore(from) }), sumsBy(orgId, { from, to })]);
        return { from, to, ...M.equityStatement(accounts, { beforeSums, periodSums }) };
    },

    async ledger(user, { accountId, from, to }) {
        checkRange(from, to);
        const orgId = await bookOrgId(user);
        const [acc] = await db.select().from(chartOfAccounts)
            .where(and(eq(chartOfAccounts.id, Number(accountId)), eq(chartOfAccounts.organizationId, orgId))).limit(1);
        if (!acc) throw httpError(404, 'Akun tidak ditemukan.');
        const openFrom = M.isPL(acc) ? M.fyStartOf(from) : null;
        const prev = M.dayBefore(from);
        const opening = (openFrom && openFrom > prev) ? [] : await sumsBy(orgId, { from: openFrom, to: prev });
        const os = opening.find((s) => s.accountId === acc.id) || { debit: 0, credit: 0 };
        const lines = await db.select({
            transactionId: bookTransactions.id, journalNo: bookTransactions.journalNo, entryDate: bookTransactions.entryDate,
            description: bookTransactions.description, reference: bookTransactions.reference, status: bookTransactions.status,
            debit: bookLines.debit, credit: bookLines.credit, memo: bookLines.memo,
        }).from(bookLines).innerJoin(bookTransactions, eq(bookTransactions.id, bookLines.transactionId)).where(and(
            eq(bookTransactions.organizationId, orgId), inArray(bookTransactions.status, POSTED), eq(bookLines.accountId, acc.id),
            gte(bookTransactions.entryDate, from), lte(bookTransactions.entryDate, to),
        )).orderBy(asc(bookTransactions.entryDate), asc(bookTransactions.id), asc(bookLines.lineNo));
        return { account: acc, from, to, ...M.ledger(acc, os, lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) }))) };
    },

    /** Monthly revenue / expense / profit / cash for one year + top accounts. */
    async insights(user, { year }) {
        const y = Number(year) || new Date().getFullYear();
        const orgId = await bookOrgId(user);
        const accounts = await accountsOf(orgId);
        const accById = new Map(accounts.map((a) => [a.id, a]));
        const rows = await db.select({
            month: sql`EXTRACT(MONTH FROM ${bookTransactions.entryDate})::int`,
            accountId: bookLines.accountId,
            debit: sql`COALESCE(SUM(${bookLines.debit}), 0)`, credit: sql`COALESCE(SUM(${bookLines.credit}), 0)`,
        }).from(bookLines).innerJoin(bookTransactions, eq(bookTransactions.id, bookLines.transactionId)).where(and(
            eq(bookTransactions.organizationId, orgId), inArray(bookTransactions.status, POSTED),
            gte(bookTransactions.entryDate, `${y}-01-01`), lte(bookTransactions.entryDate, `${y}-12-31`),
        )).groupBy(sql`1`, bookLines.accountId);
        const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, revenue: 0, expense: 0, netIncome: 0, cashIn: 0, cashOut: 0 }));
        const byAccount = new Map();
        for (const r of rows) {
            const acc = accById.get(r.accountId); if (!acc) continue;
            const m = months[r.month - 1], d = Number(r.debit), c = Number(r.credit);
            if (acc.type === 'income') m.revenue += c - d;
            if (acc.type === 'expense') m.expense += d - c;
            if (acc.isCash) { m.cashIn += d; m.cashOut += c; }
            if (M.isPL(acc)) {
                const cur = byAccount.get(acc.id) || { accountId: acc.id, code: acc.code, name: acc.name, type: acc.type, amount: 0 };
                cur.amount += acc.type === 'income' ? c - d : d - c;
                byAccount.set(acc.id, cur);
            }
        }
        for (const m of months) { for (const k of ['revenue', 'expense', 'cashIn', 'cashOut']) m[k] = M.round2(m[k]); m.netIncome = M.round2(m.revenue - m.expense); }
        const list = [...byAccount.values()].map((a) => ({ ...a, amount: M.round2(a.amount) }));
        const totals = months.reduce((t, m) => ({ revenue: t.revenue + m.revenue, expense: t.expense + m.expense, netIncome: t.netIncome + m.netIncome }), { revenue: 0, expense: 0, netIncome: 0 });
        const [{ drafts }] = await db.select({ drafts: sql`COUNT(*)::int` }).from(bookTransactions)
            .where(and(eq(bookTransactions.organizationId, orgId), eq(bookTransactions.status, 'draft')));
        return {
            year: y, months,
            totals: { revenue: M.round2(totals.revenue), expense: M.round2(totals.expense), netIncome: M.round2(totals.netIncome) },
            topExpenses: list.filter((a) => a.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 6),
            topRevenues: list.filter((a) => a.type === 'income').sort((a, b) => b.amount - a.amount).slice(0, 4),
            draftCount: drafts, accountCount: accounts.length,
        };
    },
};

export default booksService;
