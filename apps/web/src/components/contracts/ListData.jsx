import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../Toast";
import { api, apiCache } from "../../lib/api";
import { can } from "../../lib/permissions";
import InfoTip from "../InfoTip";
import AsyncButton from "../AsyncButton";
import OpsEntryModal from "../ops/OpsEntryModal";
import { MonthlyFormModal } from "./MonthlyCodes";

// Kontrak & Perusahaan → List Data (owner 2026-11-13): the ONE list of
// everything submitted for contracts — M (monthly, per unit), L lembur,
// T perjalanan dinas, O operasional, R (older operasional) and drafts —
// with its invoice, surat pengantar and faktur pajak. 👁 opens the detail;
// forms can be edited and approved / rejected here (Form tab = input only).
const rp = (n) => (n == null ? "-" : `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`);
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const inp = "px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white";
const TYPE_STYLE = { M: "bg-sky-100 text-sky-700", L: "bg-violet-100 text-violet-700", T: "bg-amber-100 text-amber-800", O: "bg-teal-100 text-teal-700", R: "bg-slate-200 text-slate-700" };
const ST = {
  draft: "bg-slate-200 text-slate-700", submitted: "bg-sky-100 text-sky-700", verified: "bg-indigo-100 text-indigo-700", client_ok: "bg-teal-100 text-teal-700",
  open: "bg-slate-100 text-slate-600", in_recap: "bg-amber-100 text-amber-800", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", billed: "bg-slate-200 text-slate-700",
};
const KIND_TYPE = { overtime: "L", trip: "T", expense: "O" };
const KIND_LABEL = { overtime: "Lembur", trip: "Perjalanan Dinas", expense: "Operasional" };

export default function ListData({ contracts = [] }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [codes, setCodes] = useState(null);       // /api/contracts/codes (invoice info)
  const [forms, setForms] = useState([]);          // /api/ops/entries (full forms incl. drafts)
  const [opsCtx, setOpsCtx] = useState({ contracts: [], actor: null });
  const [f, setF] = useState({ contractId: "", type: "", status: "", inv: "", q: "" });
  const [sel, setSel] = useState(new Set());
  const [open, setOpen] = useState(null);          // { kind: 'form', entry, edit } | { kind: 'M', row }

  const isSuper = user?.role === "superadmin";
  const actor = opsCtx.actor;
  const isAgency = actor === "agency" || actor === "super";
  const mySide = isSuper ? null : isAgency ? "agency" : actor === "client" ? "client" : null;
  const canVerify = isSuper || (mySide === "agency" && can(user, "opsrecap", "verify")) || (mySide === "client" && can(user, "opsrecap", "approve"));
  const clientCanFix = mySide === "client" && (can(user, "opsrecap", "approve") || can(user, "opsrecap", "edit"));
  const canInvoice = isSuper || (isAgency && can(user, "documents", "edit"));

  const load = useCallback(() => {
    api.contracts.codes({ contractId: f.contractId }).then((r) => { setCodes(r?.data || []); setSel(new Set()); }).catch((e) => { setCodes([]); toast.error(e.message); });
    api.ops.list({ contractId: f.contractId }).then((r) => setForms(r?.data || [])).catch(() => setForms([]));
  }, [f.contractId, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.ops.contracts().then((r) => setOpsCtx({ contracts: r?.data || [], actor: r?.actor || null })).catch(() => {}); }, []);

  // One row per item: M codes from /codes, forms from /entries enriched with invoice info.
  const rows = useMemo(() => {
    const byKey = new Map((codes || []).map((c) => [c.key, c]));
    const m = (codes || []).filter((c) => c.type === "M").map((c) => ({ ...c, kind: "M" }));
    const fr = forms.map((e) => {
      const info = byKey.get(`F-${e.id}`) || {};
      const type = /^R/.test(e.code || "") ? "R" : KIND_TYPE[e.kind] || "O";
      return {
        key: `F-${e.id}`, kind: "form", entry: e, code: e.code, type, typeLabel: type === "R" ? "Operasional (lama)" : KIND_LABEL[e.kind],
        contractNumber: e.contractNumber, clientName: e.clientName, date: e.entryDate,
        description: [e.kind === "overtime" && e.hours != null ? `${e.hours} jam` : null, [e.carName, e.plate].filter(Boolean).join(" "), e.driverName, e.note].filter(Boolean).join(" · "),
        amount: e.amount, formStatus: (["verified", "approved"].includes(e.status) && !e.billable) ? "recorded" : (e.viewStatus || e.status),
        invoiceNumber: info.invoiceNumber || null, invoiceSentDate: info.invoiceSentDate, letterNumber: info.letterNumber || null, fakturNsfp: info.fakturNsfp || null, paid: info.paid,
      };
    });
    return [...m, ...fr].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.code || "").localeCompare(String(a.code || "")));
  }, [codes, forms]);

  const list = rows.filter((r) => (!f.type || r.type === f.type)
    && (!f.status || r.formStatus === f.status)
    && (!f.inv || (f.inv === "yes" ? !!r.invoiceNumber : !r.invoiceNumber))
    && (!f.q || [r.code, r.contractNumber, r.clientName, r.description, r.invoiceNumber].filter(Boolean).join(" ").toLowerCase().includes(f.q.toLowerCase())));
  const sum = list.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  const mine = (e) => (mySide === "agency" ? e.agencyApproved : mySide === "client" ? e.clientApproved : e.agencyApproved && e.clientApproved);
  // Forms (L/T/O) and monthly M forms are approved here; selection keys are r.key (F-id / M-id).
  const selectable = (r) => (r.kind === "form" ? ["submitted", "verified"].includes(r.entry.status) && !mine(r.entry)
    : r.rawStatus === "submitted" && !r.invoiceNumber && !mine(r));
  const idsOf = (prefix) => [...sel].filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(2)));
  const editable = (e) => (e.status === "draft" ? e.createdBy === user?.id
    : isAgency || clientCanFix ? ["submitted", "rejected", "verified"].includes(e.status)
    : ["submitted", "rejected"].includes(e.status) && e.createdBy === user?.id);
  const ready = (r) => !r.invoiceNumber && r.formStatus === "approved" && (r.type === "M" || r.entry?.billable !== false);
  const selRows = list.filter(selectable);

  async function approve(side) {
    try {
      let n = 0, full = 0;
      const blocked = [];
      if (idsOf("F-").length) { const r = await api.ops.approve(idsOf("F-"), side); n += r.approved; full += r.fullyApproved; }
      if (idsOf("M-").length) { const r = await api.contracts.monthlyApprove(idsOf("M-"), side).catch((e) => { blocked.push(e.message); return { approved: 0, fullyApproved: 0 }; }); n += r.approved; full += r.fullyApproved; blocked.push(...(r.blocked || [])); }
      toast.success(t("ops_approvedForms", { n, full }));
      if (blocked.length) toast.error(blocked.join(" | "));
      apiCache.invalidate("ops:"); apiCache.invalidate("orders:"); load();
    } catch (e) { toast.error(e.message); }
  }
  async function reject(side) {
    const reason = prompt(t("ops_rejectReason"));
    if (!reason) return;
    try {
      let n = 0;
      if (idsOf("F-").length) n += (await api.ops.reject(idsOf("F-"), reason, side)).rejected;
      if (idsOf("M-").length) n += (await api.contracts.monthlyReject(idsOf("M-"), reason, side)).rejected;
      toast.success(t("ops_rejected", { n })); load();
    } catch (e) { toast.error(e.message); }
  }
  async function remove(e) {
    if (!confirm(t("ops_confirmDelete"))) return;
    try { await api.ops.remove(e.id); toast.success(t("ops_deleted")); load(); } catch (err) { toast.error(err.message); }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <select className={inp} value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}>
          <option value="">Semua kontrak</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contractNumber} · {c.clientName}</option>)}
        </select>
        <select className={inp} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">{t("ld_allTypes")}</option>
          {[["M", "M · Bulanan"], ["L", "L · Lembur"], ["T", "T · Perjalanan dinas"], ["O", "O · Operasional"], ["R", "R · Operasional (lama)"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={inp} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">{t("ops_allStatus")}</option>
          {["open", "draft", "submitted", "verified", "client_ok", "approved", "rejected", "billed"].map((s) => <option key={s} value={s}>{s === "open" ? t("mf_st_open") : t(`ops_st_${s}`)}</option>)}
        </select>
        <select className={inp} value={f.inv} onChange={(e) => setF({ ...f, inv: e.target.value })}>
          <option value="">{t("ld_inv_all")}</option><option value="no">{t("ld_inv_no")}</option><option value="yes">{t("ld_inv_yes")}</option>
        </select>
        <input className={`${inp} flex-1 min-w-[200px]`} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={t("ld_search")} />
        <InfoTip text={`${t("ld_help")} ${t("ops_statusHelp")}`} />
      </div>
      {codes && <p className="text-xs text-slate-500">{t("ld_total", { n: list.length, sum: rp(sum) })}</p>}

      {canVerify && sel.size > 0 && (
        <div className="flex items-center gap-2 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm flex-wrap">
          <span className="font-semibold">{t("ops_selected", { n: sel.size })}</span>
          <span className="flex-1" />
          {isSuper ? <>
            <AsyncButton onClick={() => approve("agency")} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">{t("ops_approveAs", { side: t("ctw_side_agency") })}</AsyncButton>
            <AsyncButton onClick={() => approve("client")} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">{t("ops_approveAs", { side: t("ctw_side_client") })}</AsyncButton>
          </> : <AsyncButton onClick={() => approve()} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">{t("ops_approveForms")}</AsyncButton>}
          <AsyncButton onClick={() => reject(isSuper ? "agency" : undefined)} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-200 text-xs font-semibold">{t("ops_reject")}</AsyncButton>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {codes === null ? <p className="p-6 text-center text-sm text-slate-400">{t("loadingShort")}</p> : list.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">{t("noData")}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              {canVerify && <th className="px-2 py-2 w-8"><input type="checkbox" checked={selRows.length > 0 && selRows.every((r) => sel.has(r.key))}
                onChange={(e) => setSel(e.target.checked ? new Set(selRows.map((r) => r.key)) : new Set())} /></th>}
              <th className="px-3 py-2 text-left">{t("mc_code")}</th>
              <th className="px-3 py-2 text-left">{t("mc_contract")}</th>
              <th className="px-3 py-2 text-left">{t("ld_date")}</th>
              <th className="px-3 py-2 text-left">{t("ld_desc")}</th>
              <th className="px-3 py-2 text-right">{t("mc_amount")}</th>
              <th className="px-3 py-2 text-left">{t("ld_status")}</th>
              <th className="px-3 py-2 text-left">{t("mc_invoice")}</th>
              <th className="px-3 py-2 text-left">{t("mc_letter")} / {t("mc_faktur")}</th>
              <th className="px-3 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{list.map((r) => (
              <tr key={r.key} className="align-top hover:bg-slate-50/60">
                {canVerify && <td className="px-2 py-2">{selectable(r) && <input type="checkbox" checked={sel.has(r.key)}
                  onChange={() => setSel((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} />}</td>}
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-1 ${TYPE_STYLE[r.type]}`}>{r.type}</span>
                  {r.code ? <span className="font-mono text-xs font-bold text-primary">{r.code}</span> : <span className="text-[11px] italic text-slate-400">{t("ops_noCodeYet")}</span>}
                  <p className="text-[10px] text-slate-400 mt-0.5">{r.typeLabel}</p>
                </td>
                <td className="px-3 py-2 text-xs"><p className="font-mono">{r.contractNumber}</p><p className="text-slate-500">{r.clientName}</p></td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{r.kind === "M" && r.from ? <>{fmt(r.from)}<br />– {fmt(r.to)}</> : fmt(r.date)}</td>
                <td className="px-3 py-2 text-xs max-w-[240px]">{r.description || "-"}</td>
                <td className="px-3 py-2 text-right font-mono">{rp(r.amount)}</td>
                <td className="px-3 py-2 text-xs">
                  {(() => {
                    const ap = r.kind === "M" ? r : r.entry;
                    const st = r.kind === "M" ? r.rawStatus : r.entry.status;
                    return <>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ST[r.formStatus] || "bg-slate-100 text-slate-600"}`}>{r.formStatus === "open" ? t("mf_st_open") : t(`ops_st_${r.formStatus}`)}</span>
                      {["submitted", "verified", "approved"].includes(st) && !r.invoiceNumber && (
                        <p className="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">
                          <span className={ap.agencyApproved ? "text-emerald-700 font-semibold" : ""}>{t("ctw_side_agency")} {ap.agencyApproved ? "✓" : "…"}</span>{" · "}
                          <span className={ap.clientApproved ? "text-emerald-700 font-semibold" : ""}>{t("ctw_side_client")} {ap.clientApproved ? "✓" : "…"}</span>
                        </p>)}
                      {r.kind === "M" && r.kmIssues?.length > 0 && <p className="text-[10px] text-red-600 font-semibold mt-0.5" title={r.kmIssues.join("\n")}>⚠ {t("mf_kmMismatch")}</p>}
                      {r.kind === "M" && r.invoiceDate && <p className="text-[10px] text-slate-500 mt-0.5">{t("mc_billDate")} {fmt(r.invoiceDate)}</p>}
                    </>;
                  })()}
                </td>
                <td className="px-3 py-2 text-xs">{r.invoiceNumber ? <><p className="font-mono">{r.invoiceNumber}</p><p className="text-slate-500">{fmt(r.invoiceSentDate)}{r.paid ? ` · ${t("mc_paid")}` : ""}</p></> : <span className="text-amber-700">{t("mc_notInvoiced")}</span>}</td>
                <td className="px-3 py-2 text-xs font-mono"><p>{r.letterNumber || "-"}</p><p className="text-slate-500">{r.fakturNsfp || ""}</p></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button title={t("ops_view")} className="p-1 text-slate-500 hover:text-primary cursor-pointer"
                    onClick={() => setOpen(r.kind === "M" ? { kind: "M", row: r } : { kind: "form", entry: r.entry, edit: editable(r.entry) })}>
                    <span className="material-symbols-outlined text-[18px]">{r.kind === "form" && editable(r.entry) ? "edit" : "visibility"}</span>
                    {r.kind === "form" && r.entry.comments?.length > 0 && <span className="text-[10px] font-bold align-top">{r.entry.comments.length}</span>}
                  </button>
                  {r.kind === "form" && editable(r.entry) && (r.entry.status === "draft" || isAgency || r.entry.createdBy === user?.id) && (
                    <button title={t("delete")} onClick={() => remove(r.entry)} className="p-1 text-slate-500 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>)}
                  {canInvoice && (ready(r) || r.invoiceNumber) && (
                    <button onClick={() => navigate(`/admin/documents?code=${encodeURIComponent(r.code)}`)}
                      className={`ml-1 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${r.invoiceNumber ? "border border-slate-200 text-slate-600" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                      {r.invoiceNumber ? "PDF →" : `${t("mc_makeInvoice")} →`}
                    </button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {open?.kind === "form" && (
        <OpsEntryModal contracts={opsCtx.contracts} initial={open.entry} readOnly={!open.edit}
          onClose={() => { setOpen(null); load(); }} onSaved={() => { setOpen(null); load(); }} />
      )}
      {open?.kind === "M" && <MonthlyFormModal id={open.row.billingId} onClose={() => { setOpen(null); load(); }} onChanged={() => { apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); }} />}
    </div>
  );
}
