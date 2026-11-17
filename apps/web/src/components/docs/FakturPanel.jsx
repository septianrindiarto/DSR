import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../Toast";
import { api, apiCache } from "../../lib/api";
import AsyncButton from "../AsyncButton";
import InfoTip from "../InfoTip";
import { allocatePpn, fakturBlockers } from "../../lib/tax";

// Dokumen → Faktur Pajak (owner 2026-11-09). One faktur = one or more invoices
// of the same buyer in the same masa pajak. PPN is computed once on Σ DPP and
// allocated back to the invoices, so Σ invoice = faktur.
const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;
const fmt = (d) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const inp = "px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100";
const STATUS_STYLE = { draft: "bg-slate-100 text-slate-600", terbit: "bg-emerald-100 text-emerald-700", diganti: "bg-amber-100 text-amber-700", batal: "bg-red-100 text-red-700" };
const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);
const buyerKey = (i) => String(i.clientOrgId ?? i.companyName ?? "");

export default function FakturPanel() {
  const { t } = useLanguage();
  const toast = useToast();
  const [masa, setMasa] = useState(thisMonth);
  const [cands, setCands] = useState(null);
  const [list, setList] = useState(null);
  const [picked, setPicked] = useState(new Set());

  const load = useCallback(() => {
    api.faktur.candidates({ masa }).then((r) => { setCands(Array.isArray(r) ? r : []); setPicked(new Set()); }).catch((e) => { setCands([]); toast.error(e.message); });
    api.faktur.list({ masa }).then((r) => setList(r?.data || [])).catch((e) => { setList([]); toast.error(e.message); });
  }, [masa, toast]);
  useEffect(() => { load(); }, [load]);

  const chosen = useMemo(() => (cands || []).filter((i) => picked.has(i.id)), [cands, picked]);
  const blockers = chosen.length ? fakturBlockers(chosen) : [];
  // Preview of the combined PPN (same rule as the server).
  const preview = chosen.length && !blockers.length ? allocatePpn(chosen.map((i) => ({ id: i.id, dpp: i.dpp })), { ppn: { enabled: true, rate: chosen[0].ppnRate, base: chosen[0].ppnBase } }) : null;

  function toggle(inv) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(inv.id)) { next.delete(inv.id); return next; }
      const other = (cands || []).find((x) => next.has(x.id));
      if (other && buyerKey(other) !== buyerKey(inv)) { toast.error(t("fk_mixedBuyer")); return prev; }
      next.add(inv.id); return next;
    });
  }
  async function create() {
    try { await api.faktur.create({ invoiceIds: [...picked] }); toast.success(t("fk_created")); apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); load(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <div className="space-y-5 print:hidden">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-1">{t("fk_title")} <InfoTip text={t("fk_help")} size={15} /></h2>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">{t("fk_masa")}</label>
            <input type="month" className={inp} value={masa} onChange={(e) => setMasa(e.target.value)} />
            <AsyncButton onClick={() => api.faktur.exportCsv(masa).catch((e) => toast.error(e.message))} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm">{t("fk_export")}</AsyncButton>
          </div>
        </div>

        <div>
          <p className="text-sm font-bold text-slate-800 mb-2">{t("fk_candidates")}</p>
          {cands === null ? <p className="text-xs text-slate-400">{t("loadingShort")}</p> : cands.length === 0 ? <p className="text-xs text-slate-400">{t("fk_noCandidates")}</p> : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                  <th className="px-3 py-2 w-8" /><th className="px-3 py-2 text-left">No. Invoice</th><th className="px-3 py-2 text-left">{t("fk_buyer")}</th>
                  <th className="px-3 py-2 text-left">Tgl kirim</th><th className="px-3 py-2 text-right">DPP</th><th className="px-3 py-2 text-right">PPN</th><th className="px-3 py-2 text-right">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">{cands.map((i) => (
                  <tr key={i.id} className={picked.has(i.id) ? "bg-primary/5" : ""}>
                    <td className="px-3 py-1.5"><input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i)} /></td>
                    <td className="px-3 py-1.5 font-mono text-xs">{i.invoiceNumber}{!i.ppnEnabled && <span className="ml-1 text-[10px] text-amber-600">tanpa PPN</span>}</td>
                    <td className="px-3 py-1.5">{i.companyName || "-"}</td>
                    <td className="px-3 py-1.5 text-xs">{fmt(i.sentDate)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{rp(i.dpp)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{rp(i.ppn)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{rp(i.total)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {chosen.length > 0 && (
            <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="text-xs">
                {blockers.length > 0 ? <ul className="text-amber-700 list-disc pl-4">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                  : preview && <span className="text-slate-600">DPP {rp(preview.dpp)} · DPP nilai lain {rp(preview.dppOther)} · PPN {rp(preview.ppn)}</span>}
              </div>
              <AsyncButton onClick={create} disabled={blockers.length > 0} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {t("fk_make", { n: chosen.length })}
              </AsyncButton>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
        <p className="text-sm font-bold text-slate-800">{t("fk_list")}</p>
        {list === null ? <p className="text-xs text-slate-400">{t("loadingShort")}</p> : list.length === 0 ? <p className="text-xs text-slate-400">{t("fk_empty")}</p>
          : list.map((f) => <FakturCard key={f.id} f={f} onChanged={load} />)}
      </div>
    </div>
  );
}

function FakturCard({ f, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [nsfp, setNsfp] = useState(f.nsfp || "");
  const [date, setDate] = useState(f.fakturDate || "");
  const [npwp, setNpwp] = useState(f.buyerNpwp || "");
  const draft = f.status === "draft";
  const sumTotal = f.invoices.reduce((s, i) => s + i.total, 0);
  const run = async (fn, msg) => {
    try { await fn(); if (msg) toast.success(msg); apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); onChanged(); }
    catch (e) { toast.error(e.message); }
  };
  const header = { nsfp: nsfp || null, fakturDate: date || null, buyerNpwp: npwp || null };
  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLE[f.status]}`}>{t(`fk_status_${f.status}`)}</span>
        <span className="text-xs text-slate-500">{t(`fk_kind_${f.kind}`)} · {f.masa}</span>
        <b className="flex-1 min-w-0 truncate">{f.buyerName || "-"}</b>
        <span className="font-mono text-xs">DPP {rp(f.dpp)} · PPN {rp(f.ppnAmount)}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
        <label className="text-xs">{t("fk_nsfp")}<input className={`${inp} w-full`} value={nsfp} onChange={(e) => setNsfp(e.target.value)} disabled={!draft} placeholder="04002500000000001" /></label>
        <label className="text-xs">{t("fk_date")}<input type="date" className={`${inp} w-full`} value={date} onChange={(e) => setDate(e.target.value)} disabled={!draft} /></label>
        <label className="text-xs">{t("fk_npwp")}<input className={`${inp} w-full`} value={npwp} onChange={(e) => setNpwp(e.target.value)} disabled={!draft} /></label>
        <div className="flex gap-2 flex-wrap">
          {draft && <AsyncButton onClick={() => run(() => api.faktur.update(f.id, header), t("fk_updated"))} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs">{t("fk_save")}</AsyncButton>}
          {draft && <AsyncButton onClick={() => run(() => api.faktur.update(f.id, { ...header, status: "terbit" }), t("fk_updated"))} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs">{t("fk_issue")}</AsyncButton>}
        </div>
      </div>
      {draft && <p className="text-[11px] text-slate-400">{t("fk_issueNeed")}</p>}
      {f.status === "terbit" && <p className="text-[11px] text-slate-500">{t("fk_lockedNote")}</p>}
      <table className="w-full text-xs">
        <tbody className="divide-y divide-slate-100">{f.invoices.map((i) => (
          <tr key={i.id}>
            <td className="py-1 font-mono">{i.invoiceNumber}</td>
            <td className="py-1">{fmt(i.sentDate)}</td>
            <td className="py-1 text-right font-mono">DPP {rp(i.dpp)}</td>
            <td className="py-1 text-right font-mono">PPN {rp(i.ppn)}</td>
            <td className="py-1 text-right font-mono font-semibold">{rp(i.total)}</td>
            <td className="py-1 text-right w-14">{draft && f.invoices.length > 1 && (
              <button className="text-red-600 hover:underline cursor-pointer" onClick={() => run(() => api.faktur.update(f.id, { removeInvoiceIds: [i.id] }), t("fk_updated"))}>{t("fk_remove")}</button>
            )}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="font-semibold"><td colSpan={4} className="pt-1">Σ invoice = DPP + PPN</td><td className="pt-1 text-right font-mono">{rp(sumTotal)}</td><td /></tr></tfoot>
      </table>
      <div className="flex gap-3 flex-wrap text-xs">
        {f.status !== "batal" && f.status !== "diganti" && (
          <label className="font-semibold text-primary cursor-pointer">{t("fk_upload")}
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) run(() => api.faktur.uploadFile(f.id, file), t("fk_updated")); }} />
          </label>
        )}
        {f.hasFile && <button className="font-semibold text-primary cursor-pointer" onClick={() => api.faktur.openFile(f.id).catch((e) => toast.error(e.message))}>{t("fk_open")}</button>}
        {f.status === "terbit" && <button className="font-semibold text-amber-700 cursor-pointer" onClick={() => confirm(t("fk_confirmReplace")) && run(() => api.faktur.replace(f.id), t("fk_updated"))}>{t("fk_replace")}</button>}
        {(f.status === "draft" || f.status === "terbit") && <button className="font-semibold text-red-600 cursor-pointer" onClick={() => confirm(t("fk_confirmCancel")) && run(() => api.faktur.cancel(f.id), t("fk_updated"))}>{t("fk_cancel")}</button>}
      </div>
    </div>
  );
}
