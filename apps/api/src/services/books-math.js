// ─── Books v2 — pure report math (no DB; unit-tested in test/books.test.js) ──
// Inputs are plain arrays so every financial statement can be verified
// without a database. Amounts are numbers in rupiah; everything is rounded to
// cents at the edges (round2).
//
// Sign rules (the single source of truth for every report):
//   balance(account) = debit − credit   when normalBalance = 'debit'
//                    = credit − debit   when normalBalance = 'credit'
//   P&L contribution: income  = credit − debit   (contra-revenue e.g. Diskon
//                     expense = debit − credit    simply comes out negative)

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function signed(acc, debit, credit) {
    const d = Number(debit) || 0, c = Number(credit) || 0;
    return acc.normalBalance === 'credit' ? c - d : d - c;
}

export const isPL = (acc) => acc.type === 'income' || acc.type === 'expense';

/** Net income contribution of one account's sums (income positive, expense negative). */
export function plEffect(acc, debit, credit) {
    const d = Number(debit) || 0, c = Number(credit) || 0;
    if (acc.type === 'income') return c - d;
    if (acc.type === 'expense') return -(d - c);
    return 0;
}

const sumsMap = (sums) => {
    const m = new Map();
    for (const s of sums || []) m.set(Number(s.accountId), { debit: Number(s.debit) || 0, credit: Number(s.credit) || 0 });
    return m;
};
const get = (m, id) => m.get(Number(id)) || { debit: 0, credit: 0 };

/** Default Arus Kas class when an account has none set. */
export function cashFlowClassOf(acc) {
    if (acc.cashFlowClass) return acc.cashFlowClass;
    if (acc.type === 'income' || acc.type === 'expense') return 'operating';
    if (acc.type === 'equity') return 'financing';
    if (acc.type === 'asset') return String(acc.code || '').startsWith('1-2') ? 'investing' : 'operating';
    if (acc.type === 'liability') return String(acc.code || '').startsWith('2-2') ? 'financing' : 'operating';
    return 'operating';
}

// ─── Neraca Saldo (trial balance) ──────────────────────────────────────────
// beforeAll   = sums of everything before the period (all time)
// beforeFY    = sums from fiscal-year start up to the day before the period
// period      = sums inside the period
// Balance-sheet accounts open with beforeAll; P&L accounts open with beforeFY
// (they reset each fiscal year). Prior years' profit is shown as one virtual
// "Laba Ditahan s.d. tahun lalu" row so the trial balance always balances.
export function trialBalance(accounts, { beforeAll, beforeFY, period }) {
    const bA = sumsMap(beforeAll), bF = sumsMap(beforeFY), p = sumsMap(period);
    const rows = [];
    let priorRE = 0;
    for (const acc of accounts) {
        const before = get(bA, acc.id);
        if (isPL(acc)) {
            // Everything before FY start rolls into retained earnings.
            const fy = get(bF, acc.id);
            priorRE += plEffect(acc, before.debit - fy.debit, before.credit - fy.credit);
        }
        const open = isPL(acc) ? get(bF, acc.id) : before;
        const per = get(p, acc.id);
        const opening = signed(acc, open.debit, open.credit);
        const closing = opening + signed(acc, per.debit, per.credit);
        if (!open.debit && !open.credit && !per.debit && !per.credit) continue;
        rows.push(tbRow(acc, opening, per.debit, per.credit, closing));
    }
    if (Math.abs(priorRE) > 0.004) {
        const v = { id: null, code: '3-3000*', name: 'Laba Ditahan s.d. tahun lalu (otomatis)', type: 'equity', normalBalance: 'credit' };
        rows.push(tbRow(v, priorRE, 0, 0, priorRE));
    }
    rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const totals = rows.reduce((t, r) => ({
        debit: t.debit + r.debit, credit: t.credit + r.credit,
        closingDebit: t.closingDebit + r.closingDebit, closingCredit: t.closingCredit + r.closingCredit,
    }), { debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 });
    for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);
    return { rows, totals, balanced: Math.abs(totals.closingDebit - totals.closingCredit) < 0.01 };
}

function tbRow(acc, opening, debit, credit, closing) {
    // Closing shown on its natural side; a negative balance flips sides.
    const natDebit = acc.normalBalance !== 'credit';
    const onDebit = (natDebit && closing >= 0) || (!natDebit && closing < 0);
    return {
        accountId: acc.id, code: acc.code, name: acc.name, type: acc.type, normalBalance: acc.normalBalance,
        opening: round2(opening), debit: round2(debit), credit: round2(credit), closing: round2(closing),
        closingDebit: onDebit ? round2(Math.abs(closing)) : 0,
        closingCredit: onDebit ? 0 : round2(Math.abs(closing)),
    };
}

// ─── Laba Rugi (multi-step income statement) ───────────────────────────────
export function incomeStatement(accounts, periodSums) {
    const p = sumsMap(periodSums);
    const sec = { revenue: [], direct: [], operating: [], otherIncome: [], otherExpense: [] };
    for (const acc of accounts) {
        if (!isPL(acc)) continue;
        const s = get(p, acc.id);
        if (!s.debit && !s.credit) continue;
        const amount = round2(acc.type === 'income' ? s.credit - s.debit : s.debit - s.credit);
        const row = { accountId: acc.id, code: acc.code, name: acc.name, amount };
        const c = String(acc.code || '');
        if (acc.type === 'income') (c.startsWith('4') ? sec.revenue : sec.otherIncome).push(row);
        else if (c.startsWith('5')) sec.direct.push(row);
        else if (c.startsWith('7')) sec.otherExpense.push(row);
        else sec.operating.push(row);
    }
    const sum = (a) => round2(a.reduce((s, r) => s + r.amount, 0));
    const t = {
        revenue: sum(sec.revenue), direct: sum(sec.direct), operating: sum(sec.operating),
        otherIncome: sum(sec.otherIncome), otherExpense: sum(sec.otherExpense),
    };
    t.grossProfit = round2(t.revenue - t.direct);
    t.operatingProfit = round2(t.grossProfit - t.operating);
    t.netIncome = round2(t.operatingProfit + t.otherIncome - t.otherExpense);
    t.grossMargin = t.revenue ? round2((t.grossProfit / t.revenue) * 100) : 0;
    t.netMargin = t.revenue ? round2((t.netIncome / t.revenue) * 100) : 0;
    return { sections: sec, totals: t };
}

// ─── Neraca (balance sheet, cumulative as of a date) ───────────────────────
// allSums  = all posted sums up to asOf
// fySums   = sums from fiscal-year start up to asOf (current-year earnings)
export function balanceSheet(accounts, { allSums, fySums }) {
    const all = sumsMap(allSums), fy = sumsMap(fySums);
    const g = { currentAssets: [], fixedAssets: [], currentLiabilities: [], longLiabilities: [], equity: [] };
    let totalNI = 0, currentNI = 0;
    for (const acc of accounts) {
        const s = get(all, acc.id);
        if (isPL(acc)) {
            totalNI += plEffect(acc, s.debit, s.credit);
            const f = get(fy, acc.id);
            currentNI += plEffect(acc, f.debit, f.credit);
            continue;
        }
        if (!s.debit && !s.credit) continue;
        const c = String(acc.code || '');
        // Assets shown debit-positive, claims credit-positive, so a contra
        // account (Akumulasi Penyusutan, Prive) lands as a negative line.
        const amount = round2(acc.type === 'asset' ? s.debit - s.credit : s.credit - s.debit);
        const row = { accountId: acc.id, code: acc.code, name: acc.name, amount };
        if (acc.type === 'asset') (c.startsWith('1-2') ? g.fixedAssets : g.currentAssets).push(row);
        else if (acc.type === 'liability') (c.startsWith('2-2') ? g.longLiabilities : g.currentLiabilities).push(row);
        else g.equity.push(row);
    }
    const priorRE = round2(totalNI - currentNI);
    if (Math.abs(priorRE) > 0.004) g.equity.push({ accountId: null, code: '3-3000*', name: 'Laba Ditahan s.d. tahun lalu', amount: priorRE });
    g.equity.push({ accountId: null, code: '3-3900*', name: 'Laba (Rugi) Tahun Berjalan', amount: round2(currentNI) });
    const sum = (a) => round2(a.reduce((s, r) => s + r.amount, 0));
    const t = {
        currentAssets: sum(g.currentAssets), fixedAssets: sum(g.fixedAssets),
        currentLiabilities: sum(g.currentLiabilities), longLiabilities: sum(g.longLiabilities), equity: sum(g.equity),
    };
    t.assets = round2(t.currentAssets + t.fixedAssets);
    t.liabilities = round2(t.currentLiabilities + t.longLiabilities);
    t.liabilitiesAndEquity = round2(t.liabilities + t.equity);
    t.difference = round2(t.assets - t.liabilitiesAndEquity);
    return { groups: g, totals: t, balanced: Math.abs(t.difference) < 0.01 };
}

// ─── Arus Kas (direct method) ──────────────────────────────────────────────
// txLines: every line of posted transactions in the period that touch at
// least one cash account: [{ transactionId, accountId, debit, credit }].
// Per transaction: cash change = Σ cash lines (debit − credit). Only the ACTUAL
// cash amount is attributed — split pro-rata across the counter lines on the
// opposite side (inflow → net-credit lines, outflow → net-debit lines). The
// non-cash part of a mixed entry (e.g. a car bought 30M cash + 120M loan) is
// a non-cash transaction and correctly stays out of the statement. Pure
// Kas↔Bank transfers have no counter line and net to zero.
export function cashFlow(accounts, txLines, openingCash) {
    const byId = new Map(accounts.map((a) => [Number(a.id), a]));
    const cls = { operating: new Map(), investing: new Map(), financing: new Map() };
    const txs = new Map();
    for (const l of txLines || []) {
        const k = l.transactionId;
        if (!txs.has(k)) txs.set(k, []);
        txs.get(k).push(l);
    }
    const add = (acc, effect) => {
        const bucket = cls[cashFlowClassOf(acc)] || cls.operating;
        const cur = bucket.get(acc.id) || { accountId: acc.id, code: acc.code, name: acc.name, inflow: 0, outflow: 0 };
        if (effect >= 0) cur.inflow += effect; else cur.outflow += -effect;
        bucket.set(acc.id, cur);
    };
    for (const lines of txs.values()) {
        let cashNet = 0;
        const counter = new Map(); // accountId → net (debit − credit)
        for (const l of lines) {
            const acc = byId.get(Number(l.accountId));
            if (!acc) continue;
            const net = (Number(l.debit) || 0) - (Number(l.credit) || 0);
            if (acc.isCash) cashNet += net;
            else counter.set(acc.id, (counter.get(acc.id) || 0) + net);
        }
        cashNet = round2(cashNet);
        if (!cashNet) continue;
        // inflow ← credited counter accounts; outflow ← debited counter accounts
        const side = [...counter.entries()]
            .map(([id, net]) => [id, cashNet > 0 ? -net : net])
            .filter(([, w]) => w > 0);
        const totalW = side.reduce((s, [, w]) => s + w, 0);
        if (!totalW) continue;
        let assigned = 0;
        side.forEach(([id, w], i) => {
            const part = i === side.length - 1 ? round2(cashNet - assigned) : round2((cashNet * w) / totalW);
            assigned = round2(assigned + part);
            add(byId.get(id), part);
        });
    }
    const section = (m) => {
        const items = [...m.values()].map((i) => ({ ...i, inflow: round2(i.inflow), outflow: round2(i.outflow), net: round2(i.inflow - i.outflow) }))
            .sort((a, b) => String(a.code).localeCompare(String(b.code)));
        return { items, total: round2(items.reduce((s, i) => s + i.net, 0)) };
    };
    const operating = section(cls.operating), investing = section(cls.investing), financing = section(cls.financing);
    const netChange = round2(operating.total + investing.total + financing.total);
    return { operating, investing, financing, netChange, openingCash: round2(openingCash), closingCash: round2(openingCash + netChange) };
}

// ─── Laporan Perubahan Ekuitas ─────────────────────────────────────────────
export function equityStatement(accounts, { beforeSums, periodSums }) {
    const b = sumsMap(beforeSums), p = sumsMap(periodSums);
    let openingEquity = 0, openingRE = 0, netIncome = 0;
    const movements = [];
    for (const acc of accounts) {
        const bs = get(b, acc.id), ps = get(p, acc.id);
        if (isPL(acc)) {
            openingRE += plEffect(acc, bs.debit, bs.credit);
            netIncome += plEffect(acc, ps.debit, ps.credit);
            continue;
        }
        if (acc.type !== 'equity') continue;
        openingEquity += bs.credit - bs.debit;
        const mv = ps.credit - ps.debit;
        if (Math.abs(mv) > 0.004) movements.push({ accountId: acc.id, code: acc.code, name: acc.name, amount: round2(mv) });
    }
    const opening = round2(openingEquity + openingRE);
    const totalMovements = round2(movements.reduce((s, m) => s + m.amount, 0));
    return {
        opening, openingCapital: round2(openingEquity), openingRetained: round2(openingRE),
        movements, netIncome: round2(netIncome), closing: round2(opening + totalMovements + netIncome),
    };
}

// ─── Buku Besar (ledger for one account) ───────────────────────────────────
export function ledger(acc, openingSums, lines) {
    const opening = signed(acc, openingSums?.debit, openingSums?.credit);
    let bal = opening;
    const rows = (lines || []).map((l) => {
        bal += signed(acc, l.debit, l.credit);
        return { ...l, debit: round2(l.debit), credit: round2(l.credit), balance: round2(bal) };
    });
    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
    return { opening: round2(opening), rows, totalDebit, totalCredit, closing: round2(bal) };
}

// ─── Entry validation ──────────────────────────────────────────────────────
/** Validate journal lines. Returns { ok, errors, total }. */
export function validateLines(lines) {
    const errors = [];
    if (!Array.isArray(lines) || lines.length < 2) errors.push('Minimal 2 baris jurnal.');
    let d = 0, c = 0;
    (lines || []).forEach((l, i) => {
        const debit = round2(l.debit), credit = round2(l.credit);
        if (!l.accountId) errors.push(`Baris ${i + 1}: akun wajib dipilih.`);
        if (debit < 0 || credit < 0) errors.push(`Baris ${i + 1}: nilai tidak boleh negatif.`);
        if (debit > 0 && credit > 0) errors.push(`Baris ${i + 1}: isi Debit ATAU Kredit, tidak keduanya.`);
        if (!(debit > 0) && !(credit > 0)) errors.push(`Baris ${i + 1}: nilai Debit/Kredit kosong.`);
        d += debit; c += credit;
    });
    d = round2(d); c = round2(c);
    if (Math.abs(d - c) >= 0.01) errors.push(`Jurnal tidak seimbang: Debit ${d.toLocaleString('id-ID')} ≠ Kredit ${c.toLocaleString('id-ID')}.`);
    return { ok: errors.length === 0, errors, total: d };
}

/** Lines for a simple cash-in / cash-out entry. */
export function cashEntryLines({ direction, cashAccountId, counterAccountId, amount, memo }) {
    const a = round2(amount);
    return direction === 'in'
        ? [{ accountId: cashAccountId, debit: a, credit: 0, memo }, { accountId: counterAccountId, debit: 0, credit: a, memo }]
        : [{ accountId: counterAccountId, debit: a, credit: 0, memo }, { accountId: cashAccountId, debit: 0, credit: a, memo }];
}

// ─── Period helpers ────────────────────────────────────────────────────────
export const fyStartOf = (isoDate) => `${String(isoDate).slice(0, 4)}-01-01`;
export function dayBefore(isoDate) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}
