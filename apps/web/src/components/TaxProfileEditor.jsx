import { useLanguage } from "../context/LanguageContext";
import { taxProfileOf, computeInvoiceTax } from "../lib/tax";
import { LabelTip } from "./InfoTip";

// Tax profile editor (lib/tax.js) — Pengaturan → Pajak invoice and the
// per-invoice override in Dokumen. value/onChange use the normalised profile.
const inp = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100";
const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;

export default function TaxProfileEditor({ value, onChange, disabled = false, showExample = true }) {
  const { t } = useLanguage();
  const p = taxProfileOf(value);
  const set = (group, patch) => onChange({ ...p, [group]: { ...p[group], ...patch } });
  const num = (v) => (v === "" ? "" : Number(v));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <LabelTip tip={t("tx_tip_ppn")}>{t("tx_ppn")}</LabelTip>
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer py-2">
            <input type="checkbox" checked={p.ppn.enabled} disabled={disabled} onChange={(e) => set("ppn", { enabled: e.target.checked })} /> {t("tx_ppnOn")}
          </label>
        </div>
        <div>
          <LabelTip>{t("tx_ppnRate")}</LabelTip>
          <input type="number" min="0" max="100" step="0.5" className={inp} value={p.ppn.rate} disabled={disabled || !p.ppn.enabled} onChange={(e) => set("ppn", { rate: num(e.target.value) })} />
        </div>
        <div>
          <LabelTip>{t("tx_ppnBase")}</LabelTip>
          <select className={inp} value={p.ppn.base} disabled={disabled || !p.ppn.enabled} onChange={(e) => set("ppn", { base: e.target.value })}>
            <option value="nilai_lain">{t("tx_base_nilai_lain")}</option>
            <option value="full">{t("tx_base_full")}</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <LabelTip tip={t("tx_tip_pph")}>{t("tx_pph")}</LabelTip>
          <select className={inp} value={p.pph.mode} disabled={disabled}
            onChange={(e) => set("pph", { mode: e.target.value, label: e.target.value === "added" ? (p.pph.label === "PPh 23" ? "Pajak" : p.pph.label) : (p.pph.label === "Pajak" ? "PPh 23" : p.pph.label) })}>
            {["none", "withheld", "added"].map((m) => <option key={m} value={m}>{t(`tx_mode_${m}`)}</option>)}
          </select>
        </div>
        <div>
          <LabelTip>{t("tx_pphRate")}</LabelTip>
          <input type="number" min="0" max="100" step="0.5" className={inp} value={p.pph.rate} disabled={disabled || p.pph.mode === "none"} onChange={(e) => set("pph", { rate: num(e.target.value) })} />
        </div>
        <div>
          <LabelTip>{t("tx_pphLabel")}</LabelTip>
          <input className={inp} value={p.pph.label} maxLength={40} disabled={disabled || p.pph.mode === "none"} onChange={(e) => set("pph", { label: e.target.value })} />
        </div>
      </div>
      {showExample && <TaxBreakdown title={t("tx_example")} result={computeInvoiceTax({ amounts: [10_000_000], profile: p })} />}
    </div>
  );
}

/** Rows: Sub Total, Diskon, DPP, DPP nilai lain, PPN, [added], TOTAL, [withheld, net]. */
export function TaxBreakdown({ title, result: r }) {
  const { t } = useLanguage();
  const row = (k, v, bold = false) => (
    <div key={k} className={`flex justify-between gap-4 ${bold ? "font-bold" : ""}`}><span>{k}</span><span className="font-mono">{v}</span></div>
  );
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-0.5 max-w-sm">
      {title && <p className="font-semibold text-slate-600 mb-1">{title}</p>}
      {row(t("tx_subtotal"), rp(r.subtotal))}
      {r.discount > 0 && row(t("tx_discount"), `− ${rp(r.discount)}`)}
      {(r.discount > 0 || r.ppnEnabled) && row(t("tx_dpp"), rp(r.dpp))}
      {r.ppnEnabled && r.ppnBase === "nilai_lain" && row(t("tx_dppOther"), rp(r.dppOther))}
      {r.ppnEnabled && row(t("tx_ppnRow", { rate: r.ppnRate }), rp(r.ppn))}
      {r.added > 0 && row(`${r.pphLabel} ${r.pphRate}%`, rp(r.added))}
      {row(t("tx_total"), rp(r.total), true)}
      {r.withheld > 0 && row(t("tx_withheld", { label: r.pphLabel, rate: r.pphRate }), `− ${rp(r.withheld)}`)}
      {r.withheld > 0 && row(t("tx_net"), rp(r.net), true)}
    </div>
  );
}
