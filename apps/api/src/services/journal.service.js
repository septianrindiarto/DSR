import { db } from '../db/index.js';
import { journalEntries, lockedPeriods } from '../db/schema.js';
import { eq, and, gte, lte, ilike, desc, asc, sql, isNull, or } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

// ─── Helpers ────────────────────────────────────────────────────────
function periodFilter(year, month, quarter, semester) {
    const conditions = [];
    if (year) {
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31, 23, 59, 59, 999);
        conditions.push(gte(journalEntries.entryDate, start));
        conditions.push(lte(journalEntries.entryDate, end));
    }
    if (month && year) {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59, 999);
        conditions.push(gte(journalEntries.entryDate, start));
        conditions.push(lte(journalEntries.entryDate, end));
    }
    if (quarter && year) {
        const qm = (quarter - 1) * 3;
        const start = new Date(year, qm, 1);
        const end = new Date(year, qm + 3, 0, 23, 59, 59, 999);
        conditions.push(gte(journalEntries.entryDate, start));
        conditions.push(lte(journalEntries.entryDate, end));
    }
    if (semester && year) {
        const sm = (semester - 1) * 6;
        const start = new Date(year, sm, 1);
        const end = new Date(year, sm + 6, 0, 23, 59, 59, 999);
        conditions.push(gte(journalEntries.entryDate, start));
        conditions.push(lte(journalEntries.entryDate, end));
    }
    return conditions;
}

/** Generate journal reference like JU-2026-0001 */
async function generateJournalRef(year) {
    const prefix = `JU-${year}-`;
    const result = await db.select({
        maxNum: sql`COALESCE(MAX(CAST(SUBSTRING(journal_ref FROM ${prefix.length + 1}) AS INTEGER)), 0)`,
    }).from(journalEntries)
        .where(ilike(journalEntries.journalRef, `${prefix}%`));
    const next = (Number(result[0]?.maxNum) || 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
}

/** Check whether a given date falls in a locked period */
async function isPeriodLocked(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const rows = await db.select().from(lockedPeriods).where(
        and(
            eq(lockedPeriods.year, year),
            or(isNull(lockedPeriods.month), eq(lockedPeriods.month, month))
        )
    );
    return rows.length > 0;
}

export const journalService = {

    // ─── Stats ──────────────────────────────────────────────────────
    async getStats(scopeUser = null) {
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: journalEntries.organizationId,
            isDemo: journalEntries.isDemo,
            createdBy: journalEntries.createdBy,
        });
        const whereClause = scopeConds.length ? and(...scopeConds) : undefined;
        const [totalRow] = await db.select({ count: sql`count(*)` }).from(journalEntries).where(whereClause);
        const [sums] = await db.select({
            totalDebit: sql`COALESCE(SUM(CAST(debit AS DECIMAL)), 0)`,
            totalCredit: sql`COALESCE(SUM(CAST(credit AS DECIMAL)), 0)`,
        }).from(journalEntries).where(whereClause);
        return {
            total: Number(totalRow?.count || 0),
            totalDebit: Number(sums?.totalDebit || 0),
            totalCredit: Number(sums?.totalCredit || 0),
        };
    },

    // ─── Categories ─────────────────────────────────────────────────
    async getCategories(scopeUser = null) {
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: journalEntries.organizationId,
            isDemo: journalEntries.isDemo,
            createdBy: journalEntries.createdBy,
        });
        let query = db.selectDistinct({ category: journalEntries.category }).from(journalEntries);
        if (scopeConds.length) query = query.where(and(...scopeConds));
        const rows = await query.orderBy(journalEntries.category);
        return rows.map(r => r.category).filter(Boolean);
    },

    // ─── Export all entries ──────────────────────────────────────────
    async exportAll({ year, month, quarter, semester } = {}, scopeUser = null) {
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: journalEntries.organizationId,
            isDemo: journalEntries.isDemo,
            createdBy: journalEntries.createdBy,
        });
        const conditions = [...periodFilter(year, month, quarter, semester), ...scopeConds];
        let query = db.select().from(journalEntries);
        if (conditions.length) query = query.where(and(...conditions));
        return query.orderBy(asc(journalEntries.entryDate));
    },

    // ─── Delete batch ────────────────────────────────────────────────
    async deleteBatch(batchId) {
        const rows = await db.delete(journalEntries)
            .where(eq(journalEntries.batchId, batchId))
            .returning();
        return { deleted: rows.length };
    },

    // ─── List locked periods ─────────────────────────────────────────
    async listLockedPeriods() {
        return db.select().from(lockedPeriods)
            .orderBy(desc(lockedPeriods.year), desc(lockedPeriods.month));
    },

    // ─── Lock period ─────────────────────────────────────────────────
    async lockPeriod(year, month, userId) {
        const rows = await db.insert(lockedPeriods).values({
            year,
            month: month || null,
            lockedBy: userId || null,
        }).returning();
        return rows[0];
    },

    // ─── Unlock period ───────────────────────────────────────────────
    async unlockPeriod(id) {
        const rows = await db.delete(lockedPeriods)
            .where(eq(lockedPeriods.id, id))
            .returning();
        return rows[0];
    },

    // ─── Clear all entries ──────────────────────────────────────────
    async clearAll({ year, month, quarter, semester } = {}, force = false) {
        // When force=false we still delete but skip lock check (admin action);
        // When force=true we explicitly bypass any guard (same behaviour, kept for clarity).
        const conditions = periodFilter(year, month, quarter, semester);
        let query = db.delete(journalEntries);
        if (conditions.length) query = query.where(and(...conditions));
        const rows = await query.returning();
        return { deleted: rows.length };
    },

    // ─── Import entries ─────────────────────────────────────────────
    async importEntries(rows, batchId, scopeStamp = {}) {
        let skipped = 0, errors = [];
        let totalDebit = 0, totalCredit = 0;

        // ── 1. Pre-fetch ALL locked periods once (in-memory lookup) ──────────
        const lockedRows = await db.select().from(lockedPeriods);
        const lockedSet = new Set(
            lockedRows.map(r => r.month ? `${r.year}-${r.month}` : `${r.year}`)
        );
        function isLocked(date) {
            const y = date.getFullYear(), m = date.getMonth() + 1;
            return lockedSet.has(`${y}-${m}`) || lockedSet.has(`${y}`);
        }

        // ── 2. Pre-compute starting ref counters per year (one SELECT each) ──
        const refCounters = {}; // year → next integer
        const years = new Set();
        for (const row of rows) {
            const d = row.entryDate || row.tanggal || row.date;
            const parsed = d ? new Date(typeof d === 'string' && /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(d)
                ? (() => { const [dd, mm, yyyy] = d.split(/[\/\-]/); return `${yyyy}-${mm}-${dd}`; })()
                : d) : null;
            if (parsed && !isNaN(parsed)) years.add(parsed.getFullYear());
        }
        for (const year of years) {
            const prefix = `JU-${year}-`;
            const res = await db.select({
                maxNum: sql`COALESCE(MAX(CAST(SUBSTRING(journal_ref FROM ${prefix.length + 1}) AS INTEGER)), 0)`,
            }).from(journalEntries).where(ilike(journalEntries.journalRef, `${prefix}%`));
            refCounters[year] = (Number(res[0]?.maxNum) || 0) + 1;
        }
        function nextRef(year) {
            if (!refCounters[year]) refCounters[year] = 1;
            const ref = `JU-${year}-${String(refCounters[year]).padStart(4, '0')}`;
            refCounters[year]++;
            return ref;
        }

        // ── 3. Parse & validate all rows into a batch array ──────────────────
        const batch = [];
        for (const row of rows) {
            try {
                const entryDate = row.entryDate || row.tanggal || row.date;
                const desc = row.description || row.deskripsi || '';
                const cat = row.category || row.kategori || 'Uncategorized';
                let debit = row.debit || 0;
                let credit = row.credit || row.kredit || 0;

                if (typeof debit === 'string') debit = Number(debit.replace(/[^0-9.-]/g, '')) || 0;
                if (typeof credit === 'string') credit = Number(credit.replace(/[^0-9.-]/g, '')) || 0;

                let parsedDate;
                if (typeof entryDate === 'string') {
                    const ddmm = entryDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                    parsedDate = ddmm
                        ? new Date(ddmm[3], ddmm[2] - 1, ddmm[1])
                        : new Date(entryDate);
                } else {
                    parsedDate = new Date(entryDate);
                }

                if (isNaN(parsedDate.getTime())) { skipped++; errors.push({ row, reason: 'Invalid date' }); continue; }
                if (!desc) { skipped++; errors.push({ row, reason: 'Missing description' }); continue; }
                if (isLocked(parsedDate)) {
                    skipped++;
                    errors.push({ row, reason: `Periode ${parsedDate.getFullYear()}-${parsedDate.getMonth() + 1} dikunci.` });
                    continue;
                }

                const year = parsedDate.getFullYear();
                batch.push({
                    entryDate: parsedDate,
                    month: Number(row.bulan || row.month || (parsedDate.getMonth() + 1)),
                    description: desc.toString().substring(0, 500),
                    category: cat.toString().substring(0, 100),
                    debit: String(debit),
                    credit: String(credit),
                    reference: ((row.reference || row.ref || '').toString().substring(0, 100)) || null,
                    batchId,
                    journalRef: nextRef(year),
                    isReversal: false,
                    ...scopeStamp,
                });
                totalDebit += debit;
                totalCredit += credit;
            } catch (e) {
                skipped++;
                errors.push({ row, reason: e.message });
            }
        }

        // ── 4. Bulk insert in chunks of 500 ──────────────────────────────────
        const CHUNK = 500;
        for (let i = 0; i < batch.length; i += CHUNK) {
            await db.insert(journalEntries).values(batch.slice(i, i + CHUNK));
        }
        const imported = batch.length;

        const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
        const balanceWarning = isBalanced ? null
            : `Jurnal tidak seimbang: Total Debit Rp${totalDebit.toLocaleString('id-ID')} != Total Kredit Rp${totalCredit.toLocaleString('id-ID')}. Periksa kembali data Anda.`;

        return { imported, skipped, errors, batchId, totalDebit, totalCredit, isBalanced, balanceWarning };
    },

    // ─── List entries (Jurnal Umum) ─────────────────────────────────
    async findAll({ year, month, quarter, semester, category, search, page = 1, limit = 50, scopeUser = null }) {
        const conditions = periodFilter(year, month, quarter, semester);
        if (category) conditions.push(eq(journalEntries.category, category));
        if (search) conditions.push(ilike(journalEntries.description, `%${search}%`));

        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: journalEntries.organizationId,
            isDemo: journalEntries.isDemo,
            createdBy: journalEntries.createdBy,
        });
        conditions.push(...scopeConds);

        let query = db.select().from(journalEntries);
        if (conditions.length) query = query.where(and(...conditions));
        const data = await query.orderBy(asc(journalEntries.entryDate), asc(journalEntries.id)).limit(limit).offset((page - 1) * limit);

        let countQ = db.select({ count: sql`count(*)` }).from(journalEntries);
        if (conditions.length) countQ = countQ.where(and(...conditions));
        const cr = await countQ;

        // Balance check for banner
        const sumQ = db.select({
            totalDebit: sql`COALESCE(SUM(CAST(debit AS DECIMAL)), 0)`,
            totalCredit: sql`COALESCE(SUM(CAST(credit AS DECIMAL)), 0)`,
        }).from(journalEntries);
        const sumFiltered = conditions.length
            ? await sumQ.where(and(...conditions))
            : await sumQ;
        const td = Number(sumFiltered[0]?.totalDebit || 0);
        const tc = Number(sumFiltered[0]?.totalCredit || 0);

        return {
            data, total: Number(cr[0].count), page, limit,
            totalDebit: td, totalCredit: tc,
            isBalanced: Math.abs(td - tc) < 0.01,
        };
    },

    // ─── Get single entry ───────────────────────────────────────────
    async getEntry(id) {
        const rows = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
        return rows[0] || null;
    },

    // ─── Update single entry ────────────────────────────────────────
    async updateEntry(id, { entryDate, description, category, debit, credit, reference }) {
        const existing = await this.getEntry(id);
        if (!existing) throw new Error('Entri tidak ditemukan');

        let parsedDate = existing.entryDate;
        if (entryDate) {
            parsedDate = new Date(entryDate);
            if (isNaN(parsedDate.getTime())) throw new Error('Tanggal tidak valid');
            if (await isPeriodLocked(parsedDate)) throw new Error('Periode dikunci, tidak dapat mengedit.');
        }
        // Also check original date lock
        if (await isPeriodLocked(existing.entryDate)) throw new Error('Periode dikunci, tidak dapat mengedit.');

        const rows = await db.update(journalEntries)
            .set({
                entryDate: parsedDate,
                month: parsedDate.getMonth() + 1,
                description: description?.toString().substring(0, 500) ?? existing.description,
                category: category?.toString().substring(0, 100) ?? existing.category,
                debit: debit !== undefined ? String(Number(debit)) : existing.debit,
                credit: credit !== undefined ? String(Number(credit)) : existing.credit,
                reference: reference !== undefined ? reference : existing.reference,
            })
            .where(eq(journalEntries.id, id))
            .returning();
        return rows[0];
    },

    // ─── Delete single entry ────────────────────────────────────────
    async deleteEntry(id, force = false) {
        const existing = await this.getEntry(id);
        if (!existing) throw new Error('Entri tidak ditemukan');
        if (!force && await isPeriodLocked(existing.entryDate)) {
            const err = new Error('Periode dikunci, tidak dapat menghapus.');
            err.code = 'PERIOD_LOCKED';
            throw err;
        }
        const rows = await db.delete(journalEntries).where(eq(journalEntries.id, id)).returning();
        return rows[0];
    },

    // ─── Bulk delete by IDs ─────────────────────────────────────────
    async bulkDelete(ids, force = false) {
        let deleted = 0, skipped = 0, errors = [];
        for (const id of ids) {
            try {
                await this.deleteEntry(id, force);
                deleted++;
            } catch (e) {
                skipped++;
                errors.push({ id, reason: e.message });
            }
        }
        return { deleted, skipped, errors };
    },

    // ─── Reverse entry ──────────────────────────────────────────────
    async reverseEntry(id) {
        const original = await this.getEntry(id);
        if (!original) throw new Error('Entri tidak ditemukan');

        const reversalDate = new Date();
        if (await isPeriodLocked(reversalDate)) throw new Error('Periode saat ini dikunci.');

        const year = reversalDate.getFullYear();
        const journalRef = await generateJournalRef(year);

        const rows = await db.insert(journalEntries).values({
            entryDate: reversalDate,
            month: reversalDate.getMonth() + 1,
            description: `[REVERSAL] ${original.description}`,
            category: original.category,
            debit: original.credit,
            credit: original.debit,
            reference: original.journalRef || original.reference || null,
            batchId: `reversal-${Date.now()}`,
            journalRef,
            isReversal: true,
            reversalOf: original.id,
        }).returning();
        return rows[0];
    },

    // ─── General Ledger (Buku Besar) ────────────────────────────────
    async getGeneralLedger({ year, month, quarter, semester }) {
        const conditions = periodFilter(year, month, quarter, semester);
        let query = db.select().from(journalEntries);
        if (conditions.length) query = query.where(and(...conditions));
        const entries = await query.orderBy(asc(journalEntries.category), asc(journalEntries.entryDate));

        const ledger = {};
        for (const e of entries) {
            if (!ledger[e.category]) ledger[e.category] = { entries: [], totalDebit: 0, totalCredit: 0, balance: 0 };
            const d = Number(e.debit || 0), c = Number(e.credit || 0);
            ledger[e.category].totalDebit += d;
            ledger[e.category].totalCredit += c;
            ledger[e.category].balance += d - c;
            ledger[e.category].entries.push({ ...e, runningBalance: ledger[e.category].balance });
        }
        return ledger;
    },

    // ─── Trial Balance (Neraca Saldo) ───────────────────────────────
    async getTrialBalance({ year, month, quarter, semester }) {
        const conditions = periodFilter(year, month, quarter, semester);

        let query = db.select({
            category: journalEntries.category,
            totalDebit: sql`COALESCE(SUM(CAST(${journalEntries.debit} AS DECIMAL)), 0)`.as('total_debit'),
            totalCredit: sql`COALESCE(SUM(CAST(${journalEntries.credit} AS DECIMAL)), 0)`.as('total_credit'),
        }).from(journalEntries);

        if (conditions.length) query = query.where(and(...conditions));
        const rows = await query.groupBy(journalEntries.category).orderBy(journalEntries.category);

        let grandDebit = 0, grandCredit = 0;
        const accounts = rows.map(r => {
            const d = Number(r.totalDebit), c = Number(r.totalCredit);
            grandDebit += d; grandCredit += c;
            return { category: r.category, debit: d, credit: c, balance: d - c };
        });

        return { accounts, grandDebit, grandCredit, balanced: Math.abs(grandDebit - grandCredit) < 0.01 };
    },

    // ─── Income Statement (Laba Rugi) ───────────────────────────────
    async getIncomeStatement({ year, month, quarter, semester }) {
        const conditions = periodFilter(year, month, quarter, semester);

        let query = db.select({
            category: journalEntries.category,
            totalDebit: sql`COALESCE(SUM(CAST(${journalEntries.debit} AS DECIMAL)), 0)`.as('total_debit'),
            totalCredit: sql`COALESCE(SUM(CAST(${journalEntries.credit} AS DECIMAL)), 0)`.as('total_credit'),
        }).from(journalEntries);
        if (conditions.length) query = query.where(and(...conditions));
        const rows = await query.groupBy(journalEntries.category);

        const income = [], expenses = [];
        let totalIncome = 0, totalExpense = 0;

        for (const r of rows) {
            const d = Number(r.totalDebit), c = Number(r.totalCredit);
            const cat = r.category.toLowerCase();
            if (cat.startsWith('income') || cat.startsWith('pendapatan')) {
                const amount = d + c;
                income.push({ category: r.category, amount });
                totalIncome += amount;
            } else if (cat.startsWith('expense') || cat.startsWith('beban')) {
                const amount = d + c;
                expenses.push({ category: r.category, amount });
                totalExpense += amount;
            }
        }

        return { revenues: income, income, expenses, totalRevenue: totalIncome, totalIncome, totalExpense, netIncome: totalIncome - totalExpense, netProfit: totalIncome - totalExpense };
    },

    // ─── Cash Flow (Arus Kas) ────────────────────────────────────────
    async getCashFlow({ startDate, endDate, year, month, quarter, semester } = {}) {
        const all = await this._buildQuery({ startDate, endDate, year, month, quarter, semester });

        const operating = { items: [], total: 0 };
        const investing = { items: [], total: 0 };
        const financing = { items: [], total: 0 };

        for (const r of all) {
            const cat = (r.category || '').toLowerCase();
            const net = Number(r.debit) - Number(r.credit);
            const item = { category: r.category, amount: net };

            if (cat.includes('invest') || cat.includes('aset')) {
                investing.items.push(item);
                investing.total += net;
            } else if (cat.includes('modal') || cat.includes('hutang') || cat.includes('pinjam') || cat.includes('financing')) {
                financing.items.push(item);
                financing.total += net;
            } else {
                operating.items.push(item);
                operating.total += net;
            }
        }

        return {
            operating,
            investing,
            financing,
            netCashFlow: operating.total + investing.total + financing.total,
        };
    },

    // ─── Balance Sheet (Neraca) ──────────────────────────────────────
    // Formula: Assets (debit-normal) = debit − credit
    //          Liabilities & Equity (credit-normal) = credit − debit
    // This guarantees Assets = Liabilities + Equity when the journal is balanced.
    async getBalanceSheet({ startDate, endDate, year, month, quarter, semester } = {}) {
        const all = await this._buildQuery({ startDate, endDate, year, month, quarter, semester });

        const assets = [], liabilities = [], equity = [];
        let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;

        for (const r of all) {
            const cat = (r.category || '').toLowerCase();
            const d = Number(r.debit), c = Number(r.credit);

            const isAsset = cat.includes('aset') || cat.includes('asset') ||
                cat.includes('kas') || cat.includes('bank') || cat.includes('cash') ||
                cat.includes('piutang') || cat.includes('rekening');
            const isLiability = cat.includes('hutang') || cat.includes('liabilit') || cat.includes('kewajiban');

            if (isAsset) {
                const amount = d - c;
                assets.push({ category: r.category, amount });
                totalAssets += amount;
            } else if (isLiability) {
                const amount = c - d;
                liabilities.push({ category: r.category, amount });
                totalLiabilities += amount;
            } else {
                const amount = c - d;
                equity.push({ category: r.category, amount });
                totalEquity += amount;
            }
        }

        return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity };
    },

    // ─── Helper: build filtered query (used by cashFlow & balanceSheet) ─
    async _buildQuery({ startDate, endDate, year, month, quarter, semester } = {}) {
        const conditions = periodFilter(year, month, quarter, semester);
        if (startDate) conditions.push(gte(journalEntries.entryDate, new Date(startDate)));
        if (endDate) conditions.push(lte(journalEntries.entryDate, new Date(endDate)));

        let query = db.select({
            category: journalEntries.category,
            totalDebit: sql`COALESCE(SUM(CAST(${journalEntries.debit} AS DECIMAL)), 0)`,
            totalCredit: sql`COALESCE(SUM(CAST(${journalEntries.credit} AS DECIMAL)), 0)`,
        }).from(journalEntries);
        if (conditions.length) query = query.where(and(...conditions));
        const rows = await query.groupBy(journalEntries.category);

        return rows.map(r => ({ ...r, debit: Number(r.totalDebit) || 0, credit: Number(r.totalCredit) || 0 }));
    },
};

export default journalService;
