// Invoice tax rules (pure). Run: node --test test/tax.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInvoiceTax, allocatePpn, taxProfileOf, resolveTaxProfile, fakturBlockers } from '../src/services/tax-core.js';

const PKP_PPH23 = { ppn: { enabled: true, rate: 12, base: 'nilai_lain' }, pph: { mode: 'withheld', rate: 2 } };

test('owner example: Rp10.000.000, PPN 12% × 11/12, PPh 23 2% withheld', () => {
    const r = computeInvoiceTax({ amounts: [10_000_000], profile: PKP_PPH23 });
    assert.equal(r.dpp, 10_000_000);
    assert.equal(r.dppOther, 9_166_667);
    assert.equal(r.ppn, 1_100_000);
    assert.equal(r.total, 11_100_000);
    assert.equal(r.withheld, 200_000);
    assert.equal(r.net, 10_900_000);
});

test('discount comes before tax; PPh on DPP (before PPN)', () => {
    const r = computeInvoiceTax({ amounts: [6_000_000, 4_000_000], discount: 500_000, profile: PKP_PPH23 });
    assert.equal(r.subtotal, 10_000_000);
    assert.equal(r.dpp, 9_500_000);
    assert.equal(r.withheld, 190_000);
    assert.equal(r.total, 9_500_000 + r.ppn);
});

test('clients that add a tax line (2,5% / 2%) and non-PKP agencies', () => {
    const added = computeInvoiceTax({ amounts: [10_000_000], profile: { pph: { mode: 'added', rate: 2.5 } } });
    assert.equal(added.added, 250_000);
    assert.equal(added.total, 10_250_000);
    assert.equal(added.ppn, 0);
    assert.equal(added.pphLabel, 'Pajak');
    const none = computeInvoiceTax({ amounts: [1_000_000] });
    assert.equal(none.total, 1_000_000);
    const full = computeInvoiceTax({ amounts: [1_000_000], profile: { ppn: { enabled: true, base: 'full' } } });
    assert.equal(full.ppn, 120_000);
});

test('faktur gabungan: PPN on the sum, allocated back exactly', () => {
    const inv = [{ id: 1, dpp: 3_333_333 }, { id: 2, dpp: 3_333_333 }, { id: 3, dpp: 3_333_334 }];
    const a = allocatePpn(inv, PKP_PPH23);
    assert.equal(a.dpp, 10_000_000);
    assert.equal(a.ppn, 1_100_000);
    assert.equal(Object.values(a.shares).reduce((s, v) => s + v, 0), 1_100_000);
});

test('profile resolution and faktur rules', () => {
    assert.equal(resolveTaxProfile(null, PKP_PPH23).ppn.enabled, true);
    assert.equal(resolveTaxProfile({ pph: { mode: 'added', rate: 2 } }, PKP_PPH23).ppn.enabled, false);
    assert.equal(taxProfileOf({}).pph.mode, 'none');
    const ok = { clientOrgId: 5, masa: '2026-11', sentDate: '2026-11-10', ppnEnabled: true };
    assert.deepEqual(fakturBlockers([ok, { ...ok }]), []);
    assert.equal(fakturBlockers([ok, { ...ok, clientOrgId: 6 }]).length, 1);
    assert.equal(fakturBlockers([ok, { ...ok, masa: '2026-12' }]).length, 1);
    assert.equal(fakturBlockers([{ ...ok, fakturId: 3 }]).length, 1);
});

// ─── Books posting with tax (books-autopost-core) ───────────────────────────
import { invoiceEntry, paymentEntry } from '../src/services/books-autopost-core.js';

const ACC = { receivable: 1, revenue: 2, discount: 3, ppnOut: 4, addedTax: 5, pph23: 6 };
const bal = (e) => e.lines.reduce((s, l) => s + l.debit - l.credit, 0);

test('invoice entry: discount, PPN, added tax; receivable = invoice total, balanced', () => {
    const inv = { invoiceNumber: 'INV-1', sentDate: '2026-11-09', discountAmount: '500000', ppnAmount: '1045000', pphMode: 'added', pphAmount: '237500' };
    const e = invoiceEntry(inv, [{ orderNumber: 'C1', totalPrice: '6000000' }, { orderNumber: 'C1', totalPrice: '4000000' }], ACC);
    const r = e.lines.find((l) => l.accountId === 1);
    assert.equal(r.debit, 10000000 - 500000 + 1045000 + 237500);
    assert.equal(bal(e), 0);
});

test('PPh 23 withheld payment goes to the prepaid account, not cash', () => {
    const e = paymentEntry({ amount: '200000', paidDate: '2026-11-20', kind: 'pph23', withholdingRef: 'BP-01' }, { invoiceNumber: 'INV-1' }, ACC, 99);
    assert.equal(e.lines[0].accountId, 6);
    assert.equal(e.lines[1].accountId, 1);
    assert.match(e.description, /PPh 23/);
});
