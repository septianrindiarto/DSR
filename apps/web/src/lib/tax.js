// ─── Invoice tax rules — COPY of apps/api/src/services/tax-core.js (keep in sync) ─
// Owner 2026-11-09: the invoice must equal the faktur pajak, and clients bill
// differently, so the tax treatment is a PROFILE, not a fixed formula:
//
//   ppn.enabled   agency is PKP and charges PPN
//   ppn.rate      12 (%)
//   ppn.base      'nilai_lain' → DPP Nilai Lain = 11/12 × DPP (PMK 131/2024,
//                 effective 11 %) · 'full' → PPN on the whole DPP
//   pph.mode      'none' · 'withheld' (PPh 23: the client deducts it from the
//                 payment and gives a bukti potong — shown for information) ·
//                 'added' (some clients want a tax line ADDED to the bill,
//                 e.g. "Pajak 2,5 %" / "Pajak 2 %")
//   pph.rate      2 (PPh 23 sewa harta) or what the client uses
//   pph.label     printed label, e.g. "PPh 23" / "Pajak"
//
// Amounts: subtotal → − discount = DPP (harga jual) → DPP nilai lain → PPN.
// PPh is on the DPP (harga jual before PPN), never on the 11/12 base.
// Every amount is rounded to whole rupiah. A faktur gabungan computes PPN on
// the SUM of its invoices; allocatePpn() spreads it back so Σ = faktur.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_TAX_PROFILE = {
    ppn: { enabled: false, rate: 12, base: 'nilai_lain' },
    pph: { mode: 'none', rate: 2, label: 'PPh 23' },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));
const rp = (n) => Math.round(Number(n) || 0);

/** Normalised profile (unknown keys dropped). */
export function taxProfileOf(raw) {
    const p = isObj(raw) ? raw : {};
    const ppn = isObj(p.ppn) ? p.ppn : {}, pph = isObj(p.pph) ? p.pph : {};
    return {
        ppn: {
            enabled: !!ppn.enabled,
            rate: num(ppn.rate, DEFAULT_TAX_PROFILE.ppn.rate),
            base: ppn.base === 'full' ? 'full' : 'nilai_lain',
        },
        pph: {
            mode: ['withheld', 'added'].includes(pph.mode) ? pph.mode : 'none',
            rate: num(pph.rate, DEFAULT_TAX_PROFILE.pph.rate),
            label: String(pph.label || (pph.mode === 'added' ? 'Pajak' : 'PPh 23')).slice(0, 40),
        },
    };
}

/** Pair profile → agency default → built-in default. */
export function resolveTaxProfile(pairProfile, agencyProfile) {
    if (isObj(pairProfile) && Object.keys(pairProfile).length) return taxProfileOf(pairProfile);
    return taxProfileOf(agencyProfile);
}

/** DPP Nilai Lain for a DPP under a profile. */
export function dppOtherOf(dpp, profile) {
    const p = taxProfileOf(profile);
    return p.ppn.base === 'nilai_lain' ? rp((Number(dpp) || 0) * 11 / 12) : rp(dpp);
}

/**
 * Invoice totals.
 *   amounts  per-line amounts (order rows / printed lines), before discount
 *   discount Rp discount on the whole invoice
 * → { subtotal, discount, dpp, dppOther, ppn, pphMode, pphRate, pphLabel, pph,
 *     added, total, withheld, net }
 *   total    = what the invoice bills (faktur: DPP + PPN; + added tax)
 *   withheld = PPh the client deducts (info) · net = total − withheld
 */
export function computeInvoiceTax({ amounts = [], discount = 0, profile } = {}) {
    const p = taxProfileOf(profile);
    const subtotal = rp(amounts.reduce((s, a) => s + (Number(a) || 0), 0));
    const disc = Math.min(Math.max(0, rp(discount)), subtotal);
    const dpp = subtotal - disc;
    const dppOther = p.ppn.enabled ? dppOtherOf(dpp, p) : 0;
    const ppn = p.ppn.enabled ? rp(dppOther * p.ppn.rate / 100) : 0;
    const pphAmt = p.pph.mode === 'none' ? 0 : rp(dpp * p.pph.rate / 100);
    const added = p.pph.mode === 'added' ? pphAmt : 0;
    const withheld = p.pph.mode === 'withheld' ? pphAmt : 0;
    const total = dpp + ppn + added;
    return {
        subtotal, discount: disc, dpp, dppOther, ppn,
        ppnEnabled: p.ppn.enabled, ppnRate: p.ppn.rate, ppnBase: p.ppn.base,
        pphMode: p.pph.mode, pphRate: p.pph.rate, pphLabel: p.pph.label, pph: pphAmt,
        added, total, withheld, net: total - withheld,
    };
}

/**
 * Faktur gabungan: PPN computed ONCE on Σ DPP nilai lain, then allocated back
 * to the invoices (largest remainder) so Σ invoice PPN = faktur PPN exactly.
 * invoices: [{ id, dpp }] (all under the same profile) → { dpp, dppOther, ppn, shares: { id: ppn } }
 */
export function allocatePpn(invoices, profile) {
    const p = taxProfileOf(profile);
    const dpp = invoices.reduce((s, i) => s + rp(i.dpp), 0);
    const dppOther = p.ppn.enabled ? dppOtherOf(dpp, p) : 0;
    const ppn = p.ppn.enabled ? rp(dppOther * p.ppn.rate / 100) : 0;
    const shares = {};
    if (!dpp || !ppn) { invoices.forEach((i) => { shares[i.id] = 0; }); return { dpp, dppOther, ppn, shares }; }
    const raw = invoices.map((i) => ({ id: i.id, exact: ppn * rp(i.dpp) / dpp }));
    let given = 0;
    raw.forEach((r) => { shares[r.id] = Math.floor(r.exact); given += shares[r.id]; });
    raw.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
    for (let k = 0; given < ppn; k = (k + 1) % raw.length) { shares[raw[k].id] += 1; given += 1; }
    return { dpp, dppOther, ppn, shares };
}

/** Can these invoices share one faktur? Returns the reasons they can't. */
export function fakturBlockers(invoices) {
    const out = [];
    if (!invoices.length) return ['Pilih minimal satu invoice.'];
    const keyOf = (i) => String(i.clientOrgId ?? i.companyName ?? '');
    if (new Set(invoices.map(keyOf)).size > 1) out.push('Semua invoice harus untuk pembeli yang sama.');
    if (new Set(invoices.map((i) => String(i.masa || ''))).size > 1) out.push('Semua invoice harus dalam masa pajak (bulan) yang sama.');
    if (invoices.some((i) => !i.sentDate)) out.push('Invoice harus sudah dikirim (Tgl Kirim terisi).');
    if (invoices.some((i) => i.isCancelled)) out.push('Invoice yang dibatalkan tidak bisa masuk faktur.');
    if (invoices.some((i) => i.fakturId)) out.push('Ada invoice yang sudah masuk faktur lain.');
    if (invoices.some((i) => !i.ppnEnabled)) out.push('Ada invoice tanpa PPN (agency non-PKP / profil tanpa PPN).');
    return out;
}
