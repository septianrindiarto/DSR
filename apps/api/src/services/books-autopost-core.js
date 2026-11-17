// ─── Auto-posting rules (pure, unit-tested) ─────────────────────────────────
// Accrual basis. Business events → journal entries:
//
//   Invoice sent (Tgl Kirim filled)   Dr 1-1300 Piutang Usaha       total
//                                      Cr 4-1000 Pendapatan Sewa     per vehicle row
//   Payment recorded                   Dr Kas/Bank (chosen account)  amount
//                                      Cr 1-1300 Piutang Usaha       amount
//   Tax (2026-11-09, tax-core.js): the invoice stores its breakdown —
//                                      Dr 4-1900 Diskon Penjualan    discount
//                                      Cr 2-1500 PPN Keluaran        ppn
//                                      Cr 2-1510 Pajak ditagihkan    added tax
//                                      Dr 1-1300 Piutang             = invoice total
//   PPh 23 withheld (kind 'pph23')     Dr 1-1600 PPh 23 dibayar di muka / Cr Piutang
//   Missing tax accounts fall back to 2-1400 / 1-1400 (Books → seed adds them).
//   Payment deleted                    → its entry is reversed
//   Invoice amount / date changed      → old entry reversed, new one posted
//   Invoice cancelled                  → its entry is reversed (payments stay;
//                                        they move to the re-issued invoice)
//
// Tgl Realisasi (paid date) is NOT an accounting event — cash is driven by the
// recorded payments, so a payment always has an amount and a date.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTO_CODES = {
    receivable: '1-1300',
    revenue: '4-1000',
    discount: '4-1900',
    ppnOut: '2-1500', ppnOutFallback: '2-1400',
    addedTax: '2-1510',
    pph23: '1-1600', pph23Fallback: '1-1400',
    cashPreferred: ['1-1200', '1-1100'], // Bank BCA, then Kas
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Calendar date in Asia/Jakarta (timestamps are stored as instants). */
export function jakartaDate(v) {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/**
 * Desired journal entry for an invoice, or null when nothing should be on
 * the books (not sent yet, cancelled, zero amount).
 * rows: order rows [{ orderNumber, carId, totalPrice, plate }]
 */
export function invoiceEntry(inv, rows, acc) {
    if (!inv || inv.isCancelled || !inv.sentDate) return null;
    const lines = [];
    let total = 0;
    for (const r of rows || []) {
        const amt = r2(r.totalPrice);
        if (!(amt > 0)) continue;
        total = r2(total + amt);
        lines.push({
            accountId: acc.revenue, debit: 0, credit: amt,
            memo: [r.orderNumber, r.plate].filter(Boolean).join(' · ').slice(0, 300) || null,
            orderNumber: r.orderNumber || null, carId: r.carId || null,
        });
    }
    if (!(total > 0)) return null;
    const blank = { orderNumber: null, carId: null };
    const disc = Math.min(r2(inv.discountAmount), total);
    if (disc > 0 && acc.discount) { lines.push({ accountId: acc.discount, debit: disc, credit: 0, memo: 'Diskon', ...blank }); total = r2(total - disc); }
    const ppn = r2(inv.ppnAmount);
    if (ppn > 0 && acc.ppnOut) { lines.push({ accountId: acc.ppnOut, debit: 0, credit: ppn, memo: 'PPN Keluaran', ...blank }); total = r2(total + ppn); }
    const added = inv.pphMode === 'added' ? r2(inv.pphAmount) : 0;
    if (added > 0 && acc.addedTax) { lines.push({ accountId: acc.addedTax, debit: 0, credit: added, memo: 'Pajak ditagihkan', ...blank }); total = r2(total + added); }
    lines.unshift({ accountId: acc.receivable, debit: total, credit: 0, memo: `Piutang ${inv.invoiceNumber}`, ...blank });
    return {
        date: jakartaDate(inv.sentDate),
        description: `Invoice ${inv.invoiceNumber}${inv.companyName ? ` — ${inv.companyName}` : ''}`.slice(0, 500),
        reference: String(inv.invoiceNumber || '').slice(0, 100),
        lines, total,
    };
}

/** Desired journal entry for one payment, or null. */
export function paymentEntry(pay, inv, acc, cashAccountId) {
    if (pay?.kind === 'pph23') cashAccountId = acc.pph23;
    if (!pay || !inv || !cashAccountId) return null;
    const amt = r2(pay.amount);
    if (!(amt > 0)) return null;
    return {
        date: jakartaDate(pay.paidDate),
        description: `${pay.kind === 'pph23' ? `PPh 23 dipotong klien${pay.withholdingRef ? ` (${pay.withholdingRef})` : ''} — invoice` : 'Penerimaan pembayaran invoice'} ${inv.invoiceNumber}${inv.companyName ? ` — ${inv.companyName}` : ''}${pay.isFinal ? ' (pelunasan)' : ''}`.slice(0, 500),
        reference: String(inv.invoiceNumber || '').slice(0, 100),
        lines: [
            { accountId: cashAccountId, debit: amt, credit: 0, memo: pay.note ? String(pay.note).slice(0, 300) : null, orderNumber: null, carId: null },
            { accountId: acc.receivable, debit: 0, credit: amt, memo: null, orderNumber: null, carId: null },
        ],
        total: amt,
    };
}

/** Same date + same set of (account, debit, credit, orderNumber) lines? */
export function sameEntry(current, desired) {
    if (!current || !desired) return false;
    if (current.entryDate !== desired.date) return false;
    if (String(current.description) !== String(desired.description)) return false;
    const key = (l) => `${l.accountId}|${r2(l.debit)}|${r2(l.credit)}|${l.orderNumber || ''}`;
    const a = (current.lines || []).map(key).sort();
    const b = desired.lines.map(key).sort();
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Entry date honoring period locks: original if open, else today; null if both locked. */
export function openDate(locks, wanted, today) {
    const k = (iso) => `${Number(iso.slice(0, 4))}-${Number(iso.slice(5, 7))}`;
    if (wanted && !locks.has(k(wanted))) return { date: wanted, moved: false };
    if (!locks.has(k(today))) return { date: today, moved: !!wanted };
    return null;
}
