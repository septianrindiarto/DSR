// Books v2 — financial statement math (pure functions, no DB).
// Run: node --test test/books.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/services/books-math.js';

const A = (id, code, name, type, normalBalance, extra = {}) => ({ id, code, name, type, normalBalance, ...extra });
const accounts = [
    A(1, '1-1100', 'Kas', 'asset', 'debit', { isCash: true }),
    A(2, '1-1200', 'Bank', 'asset', 'debit', { isCash: true }),
    A(3, '1-1300', 'Piutang Usaha', 'asset', 'debit'),
    A(4, '1-2100', 'Kendaraan', 'asset', 'debit', { cashFlowClass: 'investing' }),
    A(5, '1-2110', 'Akum. Penyusutan', 'asset', 'credit', { cashFlowClass: 'investing' }),
    A(6, '2-2100', 'Utang Bank', 'liability', 'credit', { cashFlowClass: 'financing' }),
    A(7, '3-1000', 'Modal', 'equity', 'credit'),
    A(8, '3-2000', 'Prive', 'equity', 'debit'),
    A(9, '4-1000', 'Pendapatan Sewa', 'income', 'credit'),
    A(10, '4-1900', 'Diskon', 'income', 'debit'),
    A(11, '5-1200', 'BBM', 'expense', 'debit'),
    A(12, '6-1000', 'Gaji', 'expense', 'debit'),
    A(13, '5-1700', 'Penyusutan', 'expense', 'debit'),
];

// A tiny, fully balanced year of activity. Each entry is a list of lines.
const entries = [
    { date: '2026-01-02', lines: [[1, 50_000_000, 0], [7, 0, 50_000_000]] },            // setor modal
    { date: '2026-01-05', lines: [[4, 150_000_000, 0], [1, 0, 30_000_000], [6, 0, 120_000_000]] }, // beli mobil (DP + utang)
    { date: '2026-02-10', lines: [[3, 10_000_000, 0], [10, 500_000, 0], [9, 0, 10_500_000]] }, // invoice terkirim (accrual) + diskon
    { date: '2026-02-25', lines: [[2, 10_000_000, 0], [3, 0, 10_000_000]] },             // pelunasan ke bank
    { date: '2026-03-01', lines: [[11, 1_200_000, 0], [1, 0, 1_200_000]] },              // BBM
    { date: '2026-03-01', lines: [[12, 3_000_000, 0], [2, 0, 3_000_000]] },              // gaji
    { date: '2026-03-15', lines: [[2, 2_000_000, 0], [1, 0, 2_000_000]] },               // transfer kas → bank
    { date: '2026-03-31', lines: [[13, 2_500_000, 0], [5, 0, 2_500_000]] },              // penyusutan
    { date: '2026-03-31', lines: [[8, 1_000_000, 0], [1, 0, 1_000_000]] },               // prive
    { date: '2026-03-31', lines: [[6, 5_000_000, 0], [2, 0, 5_000_000]] },               // cicilan pokok
];

function sums(from, to) {
    const m = new Map();
    for (const e of entries) {
        if ((from && e.date < from) || (to && e.date > to)) continue;
        for (const [accountId, debit, credit] of e.lines) {
            const s = m.get(accountId) || { accountId, debit: 0, credit: 0 };
            s.debit += debit; s.credit += credit; m.set(accountId, s);
        }
    }
    return [...m.values()];
}

test('every fixture entry is balanced', () => {
    for (const e of entries) {
        const v = M.validateLines(e.lines.map(([accountId, debit, credit]) => ({ accountId, debit, credit })));
        assert.ok(v.ok, `${e.date}: ${v.errors.join(' ')}`);
    }
});

test('validateLines rejects unbalanced / two-sided / single lines', () => {
    assert.equal(M.validateLines([{ accountId: 1, debit: 100 }, { accountId: 2, credit: 90 }]).ok, false);
    assert.equal(M.validateLines([{ accountId: 1, debit: 100, credit: 100 }, { accountId: 2, credit: 0 }]).ok, false);
    assert.equal(M.validateLines([{ accountId: 1, debit: 100 }]).ok, false);
});

test('income statement: multi-step totals and contra-revenue', () => {
    const r = M.incomeStatement(accounts, sums('2026-01-01', '2026-03-31'));
    assert.equal(r.totals.revenue, 10_000_000);           // 10.5M − 0.5M diskon
    assert.equal(r.totals.direct, 3_700_000);             // BBM 1.2M + penyusutan 2.5M
    assert.equal(r.totals.grossProfit, 6_300_000);
    assert.equal(r.totals.operating, 3_000_000);          // gaji
    assert.equal(r.totals.netIncome, 3_300_000);
});

test('balance sheet balances and shows contra accounts negative', () => {
    const r = M.balanceSheet(accounts, { allSums: sums(null, '2026-03-31'), fySums: sums('2026-01-01', '2026-03-31') });
    assert.ok(r.balanced, `difference ${r.totals.difference}`);
    const akum = r.groups.fixedAssets.find((x) => x.code === '1-2110');
    assert.equal(akum.amount, -2_500_000);
    const prive = r.groups.equity.find((x) => x.code === '3-2000');
    assert.equal(prive.amount, -1_000_000);
    const cye = r.groups.equity.find((x) => x.code === '3-3900*');
    assert.equal(cye.amount, 3_300_000);
});

test('balance sheet next year: prior profit moves to retained earnings', () => {
    const r = M.balanceSheet(accounts, { allSums: sums(null, '2027-01-31'), fySums: sums('2027-01-01', '2027-01-31') });
    assert.ok(r.balanced);
    assert.equal(r.groups.equity.find((x) => x.code === '3-3000*').amount, 3_300_000);
    assert.equal(r.groups.equity.find((x) => x.code === '3-3900*').amount, 0);
});

test('trial balance balances with prior-year retained earnings row', () => {
    const r = M.trialBalance(accounts, { beforeAll: sums(null, '2026-12-31'), beforeFY: [], period: [] });
    // Opening of 2027 with no activity: P&L rolled into virtual retained earnings.
    assert.ok(r.balanced, JSON.stringify(r.totals));
    assert.ok(r.rows.some((x) => x.code === '3-3000*' && x.closing === 3_300_000));
    const q1 = M.trialBalance(accounts, { beforeAll: sums(null, '2026-01-31'), beforeFY: sums('2026-01-01', '2026-01-31'), period: sums('2026-02-01', '2026-03-31') });
    assert.ok(q1.balanced, JSON.stringify(q1.totals));
});

test('cash flow (direct) reconciles to the cash balance; transfers net to zero', () => {
    const cashIds = new Set([1, 2]);
    const lines = [];
    entries.forEach((e, i) => {
        if (!e.lines.some(([a]) => cashIds.has(a))) return;
        for (const [accountId, debit, credit] of e.lines) lines.push({ transactionId: i, accountId, debit, credit });
    });
    const r = M.cashFlow(accounts, lines, 0);
    const actual = sums(null, '2026-03-31').filter((s) => cashIds.has(s.accountId)).reduce((t, s) => t + s.debit - s.credit, 0);
    assert.equal(r.closingCash, actual);
    assert.equal(r.investing.total, -30_000_000);                 // DP mobil
    assert.equal(r.financing.total, 50_000_000 - 1_000_000 - 5_000_000); // modal − prive − cicilan
    assert.equal(r.operating.total, 10_000_000 - 1_200_000 - 3_000_000);
});

test('equity statement: opening + movements + net income = closing', () => {
    const r = M.equityStatement(accounts, { beforeSums: sums(null, '2025-12-31'), periodSums: sums('2026-01-01', '2026-03-31') });
    assert.equal(r.opening, 0);
    assert.equal(r.netIncome, 3_300_000);
    assert.equal(r.closing, 50_000_000 - 1_000_000 + 3_300_000);
});

test('ledger running balance follows normal balance', () => {
    const acc = accounts.find((a) => a.id === 1);
    const l = M.ledger(acc, { debit: 0, credit: 0 }, [{ debit: 50_000_000, credit: 0 }, { debit: 0, credit: 30_000_000 }]);
    assert.equal(l.closing, 20_000_000);
    assert.equal(l.rows[1].balance, 20_000_000);
});

test('cashEntryLines builds the right sides', () => {
    const inL = M.cashEntryLines({ direction: 'in', cashAccountId: 1, counterAccountId: 9, amount: 100 });
    assert.deepEqual(inL.map((l) => [l.accountId, l.debit, l.credit]), [[1, 100, 0], [9, 0, 100]]);
    const outL = M.cashEntryLines({ direction: 'out', cashAccountId: 1, counterAccountId: 11, amount: 50 });
    assert.deepEqual(outL.map((l) => [l.accountId, l.debit, l.credit]), [[11, 50, 0], [1, 0, 50]]);
});
