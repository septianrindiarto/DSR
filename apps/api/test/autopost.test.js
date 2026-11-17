// Books auto-posting + guided entry rules (pure). Run: node --test test/autopost.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceEntry, paymentEntry, sameEntry, openDate, jakartaDate } from '../src/services/books-autopost-core.js';
import { buildQuickLines, QUICK_TYPES, DEFAULT_COA } from '../src/services/books-coa.js';
import { validateLines } from '../src/services/books-math.js';

const acc = { receivable: 13, revenue: 41, defaultCash: 12 };
const inv = { id: 1, invoiceNumber: 'INV-001', companyName: 'PT Foo', sentDate: '2026-10-05T03:00:00Z', isCancelled: false };
const rows = [
    { orderNumber: 'DSR-1', carId: 7, totalPrice: '1500000', plate: 'D 1234 AB' },
    { orderNumber: 'DSR-1', carId: 8, totalPrice: '1000000.50', plate: 'D 5678 CD' },
];

test('invoice: Dr Piutang total / Cr Pendapatan per vehicle, balanced', () => {
    const e = invoiceEntry(inv, rows, acc);
    assert.equal(e.date, '2026-10-05');
    assert.equal(e.total, 2500000.5);
    assert.equal(e.lines[0].accountId, 13);
    assert.equal(e.lines[0].debit, 2500000.5);
    assert.deepEqual(e.lines.slice(1).map((l) => [l.accountId, l.credit, l.carId]), [[41, 1500000, 7], [41, 1000000.5, 8]]);
    assert.ok(validateLines(e.lines).ok);
});

test('invoice not on the books when unsent, cancelled or zero', () => {
    assert.equal(invoiceEntry({ ...inv, sentDate: null }, rows, acc), null);
    assert.equal(invoiceEntry({ ...inv, isCancelled: true }, rows, acc), null);
    assert.equal(invoiceEntry(inv, [{ totalPrice: 0 }], acc), null);
});

test('jakarta date: late-evening UTC instant is next day in WIB', () => {
    assert.equal(jakartaDate('2026-10-05T18:30:00Z'), '2026-10-06');
});

test('payment: Dr Kas/Bank / Cr Piutang', () => {
    const e = paymentEntry({ id: 9, amount: '750000', paidDate: '2026-10-20T02:00:00Z', isFinal: false }, inv, acc, 12);
    assert.deepEqual(e.lines.map((l) => [l.accountId, l.debit, l.credit]), [[12, 750000, 0], [13, 0, 750000]]);
    assert.equal(e.date, '2026-10-20');
});

test('sameEntry detects amount and date changes', () => {
    const d = invoiceEntry(inv, rows, acc);
    const cur = { entryDate: d.date, description: d.description, lines: d.lines };
    assert.equal(sameEntry(cur, d), true);
    assert.equal(sameEntry(cur, invoiceEntry(inv, [rows[0]], acc)), false);
    assert.equal(sameEntry(cur, invoiceEntry({ ...inv, sentDate: '2026-10-09' }, rows, acc)), false);
});

test('openDate: locked month moves to today; both locked → null', () => {
    const locks = new Set(['2026-9']);
    assert.deepEqual(openDate(locks, '2026-10-02', '2026-10-14'), { date: '2026-10-02', moved: false });
    assert.deepEqual(openDate(locks, '2026-09-30', '2026-10-14'), { date: '2026-10-14', moved: true });
    assert.equal(openDate(new Set(['2026-9', '2026-10']), '2026-09-30', '2026-10-14'), null);
});

// ─── Guided entry ───────────────────────────────────────────────────────────
const idByCode = new Map(DEFAULT_COA.map((a, i) => [a.code, i + 1]));
const cashIds = new Set(DEFAULT_COA.map((a, i) => (a.isCash ? i + 1 : null)).filter(Boolean));
const sets = { idByCode, cashIds, ids: new Set(idByCode.values()) };
const KAS = idByCode.get('1-1100'), BCA = idByCode.get('1-1200');

test('every guided type uses accounts that exist in the default chart', () => {
    for (const q of QUICK_TYPES) {
        for (const c of [q.counter, q.payable, q.debit, q.credit].filter(Boolean)) assert.ok(idByCode.has(c), `${q.key}: ${c}`);
    }
});

test('every guided type builds a balanced entry', () => {
    for (const q of QUICK_TYPES) {
        const lines = buildQuickLines(q.key, { amount: 123456, cashAccountId: KAS, toCashAccountId: BCA }, sets);
        assert.ok(validateLines(lines).ok, q.key);
    }
});

test('BBM paid cash: Dr Beban BBM (tagged unit) / Cr Kas', () => {
    const l = buildQuickLines('bbm', { amount: 300000, cashAccountId: KAS, carId: 5 }, sets);
    assert.deepEqual([l[0].accountId, l[0].debit, l[0].carId, l[1].accountId, l[1].credit], [idByCode.get('5-1200'), 300000, 5, KAS, 300000]);
});

test('servis on credit: Cr Utang Usaha instead of Kas', () => {
    const l = buildQuickLines('servis', { amount: 900000, onCredit: true }, sets);
    assert.equal(l[1].accountId, idByCode.get('2-1100'));
});

test('guards: zero amount, same transfer accounts, non-cash "cash" account', () => {
    assert.throws(() => buildQuickLines('bbm', { amount: 0, cashAccountId: KAS }, sets), /lebih dari 0/);
    assert.throws(() => buildQuickLines('transfer', { amount: 10, cashAccountId: KAS, toCashAccountId: KAS }, sets), /berbeda/);
    assert.throws(() => buildQuickLines('bbm', { amount: 10, cashAccountId: idByCode.get('5-1200') }, sets), /Kas\/Bank/);
});
