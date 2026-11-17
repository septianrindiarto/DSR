// ─── Rekap Operasional & Lembur ──────────────────────────────────────────────
// Monthly-contract overtime and operational costs.
//   Data tab   : every entry (driver / agency / client), filters, evidence,
//                agency verify / reject in bulk, edit while not locked.
//   Rekap tab  : R### codes per contract × period × kind. Agency creates and
//                refreshes; the client approves or rejects single lines.
//                Approved recaps are invoiced in Dokumen → Invoice (X-05).
// Rules & statuses: apps/api/src/services/ops.service.js.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api, apiCache } from "../lib/api";
import { can } from "../lib/permissions";
import { cutoffRange } from "../lib/ops";
import { Btn, Empty, Note } from "../components/books/shared";
import OpsEntryModal from "../components/ops/OpsEntryModal";

import AsyncButton from "../components/AsyncButton";
import InfoTip from "../components/InfoTip";
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const inp = "px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white";
const ST = {
  draft: "bg-slate-200 text-slate-700", submitted: "bg-sky-100 text-sky-700", verified: "bg-indigo-100 text-indigo-700", client_ok: "bg-teal-100 text-teal-700", in_recap: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", billed: "bg-slate-200 text-slate-700", recorded: "bg-slate-100 text-slate-600",
};
const RST = { waiting: "bg-amber-100 text-amber-800", approved: "bg-emerald-100 text-emerald-700", invoiced: "bg-slate-200 text-slate-700", cancelled: "bg-slate-100 text-slate-500" };
const statusKey = (e) => (["verified", "approved"].includes(e.status) && !e.billable ? "recorded" : (e.viewStatus || e.status));
const currentMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);

// embedded: rendered inside Kontrak & Perusahaan (no layout / page title).
// fixedKind: Kontrak & Perusahaan → Form → Lembur / Perjalanan Dinas / Operasional
// shows one form type with its input form inline (owner 2026-11-13).
export default function AdminOpsRecap({ embedded = false, initialContractId = "", fixedKind = null }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [tab, setTab] = useState("entries");
  const [contracts, setContracts] = useState([]);
  const [actor, setActor] = useState(null);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const toast = useToast();
  useEffect(() => {
    api.ops.contracts().then((r) => { setContracts(r.data || []); setActor(r.actor); }).catch((e) => toast.error(e.message));
  }, [toast]);
  const isAgency = actor === "agency" || actor === "super";
  const Wrap = embedded ? Fragment : AdminLayout;
  // "Rekap lama" = monthly R recaps from before per-form codes; only shown when some exist.
  const [hasLegacy, setHasLegacy] = useState(false);
  useEffect(() => { api.ops.recaps({}).then((r) => setHasLegacy((r?.data || []).length > 0)).catch(() => {}); }, []);

  return (
    <Wrap>
      <div className={`flex items-end gap-3 mb-4 flex-wrap ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("ops_title")}</h1>
          <p className="text-slate-500 text-sm mt-1 max-w-3xl">{t("ops_subtitle")}</p>
        </div>}
        {isAgency && can(user, "settings", "edit") && <Btn icon="event_busy" onClick={() => setHolidaysOpen(true)}>{t("ops_holidays")}</Btn>}
      </div>
      <div className="flex gap-1 mb-4 border-b border-slate-200 items-center">
        {(hasLegacy && (!fixedKind || fixedKind === "expense") ? ["entries", "recaps"] : ["entries"]).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${tab === k ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {k === "recaps" ? t("ops_tab_recapsLegacy") : t(`ops_tab_${k}`)}
          </button>
        ))}
        <span className="ml-1"><InfoTip text={t("ops_codesInfo")} /></span>
      </div>
      {tab === "entries" ? <EntriesTab contracts={contracts} actor={actor} initialContractId={initialContractId} fixedKind={fixedKind} /> : <RecapsTab contracts={contracts} actor={actor} initialContractId={initialContractId} />}
      {holidaysOpen && <HolidaysModal onClose={() => setHolidaysOpen(false)} />}
    </Wrap>
  );
}

// ─── Data tab ──────────────────────────────────────────────────────────────
function EntriesTab({ contracts, actor, initialContractId = "", fixedKind = null }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const toast = useToast();
  const [flt, setFlt] = useState({ contractId: initialContractId ? String(initialContractId) : "", period: currentMonth(), kind: fixedKind || "", status: "", q: "" });
  const [showNew, setShowNew] = useState(true);   // inline form (Form tab)
  const [formKey, setFormKey] = useState(0);
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [modal, setModal] = useState(null); // {} new | entry edit
  const [viewing, setViewing] = useState(null); // entry opened read-only
  const navigate = useNavigate();
  const [evidenceOf, setEvidenceOf] = useState(null);
  const isAgency = actor === "agency" || actor === "super";
  // Both sides approve each form: agency (opsrecap.verify), client (opsrecap.approve).
  const isSuper = user?.role === "superadmin";
  const mySide = isSuper ? null : isAgency ? "agency" : actor === "client" ? "client" : null;
  const canVerify = isSuper || (mySide === "agency" && can(user, "opsrecap", "verify")) || (mySide === "client" && can(user, "opsrecap", "approve"));
  const canCreate = user?.role === "superadmin" || can(user, "opsrecap", "create");
  const contract = contracts.find((c) => String(c.id) === String(flt.contractId));
  const range = useMemo(() => {
    if (!flt.period) return null;
    try { return cutoffRange(flt.period, contract?.cutoffDay); } catch { return null; }
  }, [flt.period, contract]);

  const load = useCallback(() => {
    const params = { contractId: flt.contractId, kind: flt.kind, status: flt.status, q: flt.q };
    if (flt.contractId) params.period = flt.period; else if (range) { params.from = range.from; params.to = range.to; }
    api.ops.list(params).then((r) => { setData(r); setSel(new Set()); }).catch((e) => toast.error(e.message));
  }, [flt, range, toast]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);

  const rows = data?.data || [];
  const mine = (e) => (mySide === "agency" ? e.agencyApproved : mySide === "client" ? e.clientApproved : e.agencyApproved && e.clientApproved);
  const selectable = rows.filter((e) => (e.status === "submitted" || e.status === "verified") && !mine(e));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function approve(side) {
    try {
      const r = await api.ops.approve([...sel], side);
      toast.success(t("ops_approvedForms", { n: r.approved, full: r.fullyApproved }));
      apiCache.invalidate("ops:"); load();
    } catch (e) { toast.error(e.message); }
  }
  async function reject(side) {
    const reason = prompt(t("ops_rejectReason"));
    if (!reason) return;
    try { const r = await api.ops.reject([...sel], reason, side); toast.success(t("ops_rejected", { n: r.rejected })); load(); } catch (e) { toast.error(e.message); }
  }
  async function remove(e) {
    if (!confirm(t("ops_confirmDelete"))) return;
    try { await api.ops.remove(e.id); toast.success(t("ops_deleted")); load(); } catch (err) { toast.error(err.message); }
  }
  // Client approvers may also correct a submitted form; the agency then approves again.
  const clientCanFix = mySide === "client" && (can(user, "opsrecap", "approve") || can(user, "opsrecap", "edit"));
  const editable = (e) => (e.status === "draft" ? e.createdBy === user?.id
    : isAgency || clientCanFix ? ["submitted", "rejected", "verified"].includes(e.status)
    : ["submitted", "rejected"].includes(e.status) && e.createdBy === user?.id);
  const canInvoice = isSuper || (isAgency && can(user, "documents", "edit"));
  const summary = data?.summary || {};

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-end">
        <select className={inp} value={flt.contractId} onChange={(e) => setFlt({ ...flt, contractId: e.target.value })}>
          <option value="">{t("ops_allContracts")}</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contractNumber} · {c.clientName}</option>)}
        </select>
        <input type="month" className={inp} value={flt.period} onChange={(e) => setFlt({ ...flt, period: e.target.value })} title={t("ops_period")} />
        {!fixedKind && <select className={inp} value={flt.kind} onChange={(e) => setFlt({ ...flt, kind: e.target.value })}>
          <option value="">{t("ops_allKinds")}</option><option value="overtime">{t("ops_kind_overtime")}</option><option value="trip">{t("ops_kind_trip")}</option><option value="expense">{t("ops_kind_expense")}</option>
        </select>}
        <select className={inp} value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value })}>
          <option value="">{t("ops_allStatus")}</option>
          {["draft", "submitted", "verified", "client_ok", "approved", "rejected", "billed"].map((s) => <option key={s} value={s}>{t(`ops_st_${s}`)}</option>)}
        </select>
        <input className={`${inp} flex-1 min-w-[180px]`} value={flt.q} onChange={(e) => setFlt({ ...flt, q: e.target.value })} placeholder={t("ops_search")} />
        {canCreate && !fixedKind && <Btn variant="primary" icon="add" onClick={() => setModal({})}>{t("ops_add")}</Btn>}
        {canCreate && fixedKind && <Btn icon={showNew ? "expand_less" : "add"} onClick={() => setShowNew((v) => !v)}>{showNew ? t("frm_hideNew") : t("frm_new")}</Btn>}
      </div>
      {canCreate && fixedKind && showNew && (
        <OpsEntryModal key={`${fixedKind}-${formKey}`} inline fixedKind={fixedKind} contracts={contracts}
          onClose={() => setShowNew(false)} onSaved={() => { setFormKey((k) => k + 1); load(); }} />
      )}
      {range && <p className="text-xs text-slate-500">{t("ops_range")}: {fmt(range.from)} – {fmt(range.to)}</p>}

      <div className="flex items-center gap-1 text-xs text-slate-500">{t("ops_status")} <InfoTip text={t("ops_statusHelp")} size={14} /></div>
      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        {["draft", "submitted", "verified", "client_ok", "approved", "rejected", "billed", ...(summary.in_recap?.count ? ["in_recap"] : [])].map((s) => (
          <button key={s} onClick={() => setFlt({ ...flt, status: flt.status === s ? "" : s })}
            className={`text-left rounded-xl border p-2.5 bg-white cursor-pointer ${flt.status === s ? "border-primary ring-2 ring-primary/15" : "border-slate-200"}`}>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${ST[s]}`}>{t(`ops_st_${s}`)}</span>
            <p className="font-black text-lg leading-tight mt-1">{summary[s]?.count || 0}</p>
            <p className="text-[11px] text-slate-500">{summary[s]?.hours ? `${summary[s].hours} jam · ` : ""}{rp(summary[s]?.amount)}</p>
          </button>
        ))}
      </div>

      {canVerify && sel.size > 0 && (
        <div className="flex items-center gap-2 bg-slate-900 text-white rounded-xl px-3 py-2 text-sm">
          <span className="font-semibold">{t("ops_selected", { n: sel.size })}</span>
          <span className="flex-1" />
          {isSuper ? <>
            <Btn variant="success" icon="verified" onClick={() => approve("agency")}>{t("ops_approveAs", { side: t("ctw_side_agency") })}</Btn>
            <Btn variant="success" icon="verified" onClick={() => approve("client")}>{t("ops_approveAs", { side: t("ctw_side_client") })}</Btn>
          </> : <Btn variant="success" icon="verified" onClick={() => approve()}>{t("ops_approveForms")}</Btn>}
          <Btn variant="danger" icon="block" onClick={() => reject(isSuper ? "agency" : undefined)}>{t("ops_reject")}</Btn>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        {!data ? <Empty>{t("loading")}</Empty> : rows.length === 0 ? <Empty>{t("ops_none")}</Empty> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              {canVerify && <th className="px-2 py-2 w-8"><input type="checkbox" checked={selectable.length > 0 && selectable.every((e) => sel.has(e.id))} onChange={(e) => setSel(e.target.checked ? new Set(selectable.map((x) => x.id)) : new Set())} /></th>}
              <th className="px-3 py-2 text-left">{t("ops_date")}</th>
              <th className="px-3 py-2 text-left">{t("ops_contract")} / {t("ops_unit")}</th>
              <th className="px-3 py-2 text-left">{t("ops_kind")}</th>
              <th className="px-3 py-2 text-left">{t("ops_time")}</th>
              <th className="px-3 py-2 text-right">{t("ops_hours")}</th>
              <th className="px-3 py-2 text-right">{t("ops_amount")}</th>
              <th className="px-3 py-2 text-center">{t("ops_evidence")}</th>
              <th className="px-3 py-2 text-left">{t("ops_status")}</th>
              <th className="px-3 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => {
                const sk = statusKey(e);
                return (
                  <tr key={e.id} className="hover:bg-slate-50/60 align-top">
                    {canVerify && <td className="px-2 py-2">{selectable.includes(e) && <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} />}</td>}
                    <td className="px-3 py-2 whitespace-nowrap">{e.code ? <p className="font-mono text-xs font-bold text-primary">{e.code}</p> : <p className="text-[10px] text-slate-400 italic">{t("ops_noCodeYet")}</p>}{fmt(e.entryDate)}{e.dayType !== "workday" && <p className="text-[10px] text-amber-700">{t(`ops_day_${e.dayType}`)}</p>}</td>
                    <td className="px-3 py-2"><p className="font-mono text-xs">{e.contractNumber}</p><p className="text-xs">{[e.carName, e.plate].filter(Boolean).join(" · ") || "-"}</p><p className="text-[11px] text-slate-500">{e.driverName || "-"}</p></td>
                    <td className="px-3 py-2"><p className="font-semibold">{t(`ops_type_${e.type}`)}</p><p className="text-[11px] text-slate-400">{t(`ops_src_${e.source}`)}</p></td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : "-"}</td>
                    <td className="px-3 py-2 text-right font-mono">{e.hours != null ? e.hours : "-"}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {e.amount != null ? rp(e.amount) : "-"}
                      {e.kind === "overtime" && e.detail?.calc?.missing?.length > 0 && (
                        <span className="ml-1 align-middle text-amber-600" title={(e.detail.calc.warnings || []).join(" ") || t("ops_payZero")}>
                          <span className="material-symbols-outlined text-[15px]">warning</span>
                        </span>)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => setEvidenceOf(e)} className={`inline-flex items-center gap-0.5 text-xs font-semibold cursor-pointer ${e.evidence.length ? "text-primary" : "text-slate-300"}`}>
                        <span className="material-symbols-outlined text-[16px]">attach_file</span>{e.evidence.length}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${ST[sk]}`}>{t(`ops_st_${sk}`)}</span>
                      {["submitted", "verified", "approved"].includes(e.status) && (
                        <p className="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">
                          <span className={e.agencyApproved ? "text-emerald-700 font-semibold" : ""}>{t("ctw_side_agency")} {e.agencyApproved ? "✓" : "…"}</span>
                          {" · "}
                          <span className={e.clientApproved ? "text-emerald-700 font-semibold" : ""}>{t("ctw_side_client")} {e.clientApproved ? "✓" : "…"}</span>
                        </p>)}
                      {e.recapCode && <p className="text-[11px] font-mono text-slate-500 mt-0.5">{e.recapCode}</p>}
                      {e.status === "rejected" && e.rejectReason && <p className="text-[11px] text-red-600 mt-0.5 max-w-[180px]">{t("ops_rejectedBecause", { r: e.rejectReason })}</p>}
                      {e.note && <p className="text-[11px] text-slate-500 mt-0.5 max-w-[200px]">{e.note}</p>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canInvoice && e.status === "approved" && e.billable && e.code && (
                        <button onClick={() => navigate(`/admin/documents?ops=${encodeURIComponent(e.code)}`)}
                          className="mr-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 cursor-pointer" title={t("ops_makeInvoice")}>
                          {t("ops_makeInvoice")} →
                        </button>)}
                      {editable(e) ? (
                        <>
                          <button onClick={() => setModal(e)} className="p-1 text-slate-500 hover:text-primary cursor-pointer" title={t("edit")}><span className="material-symbols-outlined text-[18px]">edit</span></button>
                          {(e.status === "draft" || isAgency || e.createdBy === user?.id) && <AsyncButton onClick={() => remove(e)} className="p-1 text-slate-500 hover:text-red-600 cursor-pointer" title={t("delete")}><span className="material-symbols-outlined text-[18px]">delete</span></AsyncButton>}
                        </>
                      ) : (
                        <button onClick={() => setViewing(e)} className="p-1 text-slate-500 hover:text-primary cursor-pointer" title={t("ops_view")}>
                          <span className="material-symbols-outlined text-[18px]">visibility</span>
                          {e.comments?.length > 0 && <span className="text-[10px] font-bold align-top">{e.comments.length}</span>}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {modal && <OpsEntryModal contracts={contracts} initial={modal.id ? modal : null} onClose={() => { setModal(null); load(); }} onSaved={() => { setModal(null); load(); }} />}
      {viewing && <OpsEntryModal contracts={contracts} initial={viewing} readOnly onClose={() => { setViewing(null); load(); }} onSaved={() => { setViewing(null); load(); }} />}
      {evidenceOf && <EvidenceModal entry={evidenceOf} canEdit={editable(evidenceOf)} onClose={() => setEvidenceOf(null)} onChanged={load} />}
    </div>
  );
}

function EvidenceModal({ entry, canEdit, onClose, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [list, setList] = useState(entry.evidence);
  const [busy, setBusy] = useState(false);
  async function add(files) {
    if (!files.length) return;
    setBusy(true);
    try {
      const fd = new FormData(); [...files].slice(0, 5).forEach((f) => fd.append("files", f));
      await api.ops.addEvidence(entry.id, fd);
      const r = await api.ops.list({ contractId: entry.contractId, q: "" });
      setList(r.data.find((x) => x.id === entry.id)?.evidence || list); onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function del(idx) {
    if (!confirm(t("ops_confirmDelete"))) return;
    try { await api.ops.removeEvidence(entry.id, idx); setList(list.filter((x) => x.idx !== idx).map((x, i) => ({ ...x, idx: i }))); onChanged(); } catch (e) { toast.error(e.message); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold">{t("ops_evidence")} · {fmt(entry.entryDate)} · {t(`ops_type_${entry.type}`)}</h3>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button></div>
        {list.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {list.map((f) => (
              <li key={f.idx} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="material-symbols-outlined text-[18px] text-slate-400">{String(f.type).includes("pdf") ? "picture_as_pdf" : "image"}</span>
                <AsyncButton onClick={() => api.ops.openEvidence(entry.id, f.idx).catch((e) => toast.error(e.message))} className="flex-1 text-left truncate text-primary hover:underline cursor-pointer">{f.name}</AsyncButton>
                {canEdit && <AsyncButton onClick={() => del(f.idx)} className="text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></AsyncButton>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <label className="block text-sm">
            <span className="block text-xs font-semibold text-slate-600 mb-1">{t("ops_addFiles")}</span>
            <input type="file" multiple accept="image/*,application/pdf" disabled={busy} onChange={(e) => add(e.target.files)} className="block w-full text-sm" />
          </label>
        )}
      </div>
    </div>
  );
}

// ─── Rekap tab ─────────────────────────────────────────────────────────────
function RecapsTab({ contracts, actor, initialContractId = "" }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api.ops.recaps({ status, contractId: initialContractId }).then(setData).catch((e) => toast.error(e.message)), [status, initialContractId, toast]);
  useEffect(() => { load(); }, [load]);
  const rows = data?.data || [];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("ops_allStatus")}</option>
          {["waiting", "approved", "invoiced", "cancelled"].map((s) => <option key={s} value={s}>{t(`ops_rst_${s}`)}</option>)}
        </select>
        <span className="flex-1" />
        {/* "Buat rekap R" retired 2026-11-05: each form has its own L/R code (server returns 410). */}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        {!data ? <Empty>{t("loading")}</Empty> : rows.length === 0 ? <Empty>{t("ops_noRecaps")}</Empty> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="px-3 py-2 text-left">{t("ops_recapCode")}</th><th className="px-3 py-2 text-left">{t("ops_contract")}</th>
              <th className="px-3 py-2 text-left">{t("ops_period")}</th><th className="px-3 py-2 text-left">{t("ops_kind")}</th>
              <th className="px-3 py-2 text-right">{t("ops_lines")}</th><th className="px-3 py-2 text-right">{t("ops_totalHours")}</th>
              <th className="px-3 py-2 text-right">{t("ops_totalAmount")}</th><th className="px-3 py-2 text-left">{t("ops_status")}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2 font-mono font-bold text-primary">{r.code}</td>
                  <td className="px-3 py-2"><p className="font-mono text-xs">{r.contractNumber}</p><p className="text-xs text-slate-500">{r.clientName}</p></td>
                  <td className="px-3 py-2 text-xs">{r.period}<p className="text-[11px] text-slate-400">{fmt(r.dateFrom)} – {fmt(r.dateTo)}</p></td>
                  <td className="px-3 py-2">{t(`ops_kind_${r.kind}`)}</td>
                  <td className="px-3 py-2 text-right">{r.entryCount}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.kind === "overtime" ? r.totalHours : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono">{rp(r.totalAmount)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${RST[r.status]}`}>{t(`ops_rst_${r.status}`)}</span>
                    {r.status === "waiting" && <p className="text-[11px] text-slate-500 mt-0.5">{t("ops_waitingDays", { n: r.waitingWorkdays })}{r.reminderCount ? ` · ${t("ops_reminders", { n: r.reminderCount })}` : ""}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <RecapDetail id={open} actor={actor} onClose={() => setOpen(null)} onChanged={load} />}
      {creating && <CreateRecapModal contracts={contracts.filter((c) => c.extrasMode !== "none")} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setOpen(id); }} />}
    </div>
  );
}

function CreateRecapModal({ contracts, onClose, onDone }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [f, setF] = useState({ contractId: contracts.length === 1 ? contracts[0].id : "", period: "", kind: "overtime" });
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState(false);
  const c = contracts.find((x) => String(x.id) === String(f.contractId));
  const period = f.period || c?.currentPeriod || currentMonth();
  async function preview() {
    setBusy(true);
    try { setPrev(await api.ops.recapPreview({ contractId: Number(f.contractId), period, kind: f.kind })); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true);
    try {
      const r = await api.ops.createRecap({ contractId: Number(f.contractId), period, kind: f.kind });
      toast.success(t("ops_recapCreated", { code: r.code })); apiCache.invalidate("ops:"); onDone(r.id);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold">{t("ops_recapTitle")}</h3>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button></div>
        {contracts.length === 0 ? <Note tone="warn">{t("ops_modeNone")}</Note> : (
          <>
            <div className="flex gap-2 flex-wrap items-end">
              <select className={`${inp} flex-1 min-w-[220px]`} value={f.contractId} onChange={(e) => { setF({ ...f, contractId: e.target.value, period: "" }); setPrev(null); }}>
                <option value="">{t("ops_pickContract")}</option>
                {contracts.map((x) => <option key={x.id} value={x.id}>{x.contractNumber} · {x.clientName}</option>)}
              </select>
              <input type="month" className={inp} value={period} onChange={(e) => { setF({ ...f, period: e.target.value }); setPrev(null); }} />
              <select className={inp} value={f.kind} onChange={(e) => { setF({ ...f, kind: e.target.value }); setPrev(null); }}>
                <option value="overtime">{t("ops_kind_overtime")}</option><option value="trip">{t("ops_kind_trip")}</option><option value="expense">{t("ops_kind_expense")}</option>
              </select>
              <Btn icon="search" onClick={preview} disabled={!f.contractId || busy}>{t("ops_preview")}</Btn>
            </div>
            {c && <p className="text-xs text-slate-500">{t("ops_modeLabel")}: {t(`ct_mode_${c.extrasMode}`)}</p>}
            {prev && (
              <>
                <p className="text-xs text-slate-500">{t("ops_range")}: {fmt(prev.from)} – {fmt(prev.to)}</p>
                {prev.waitingRecap && <Note tone="warn">{t("ops_waitingExists", { code: prev.waitingRecap.code })}</Note>}
                {prev.pendingVerification > 0 && <Note tone="warn">{t("ops_pendingVerify", { n: prev.pendingVerification })}</Note>}
                {prev.entries.length === 0 ? <Note>{t("ops_noReady")}</Note> : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-100">
                        {prev.entries.map((e) => (
                          <tr key={e.id}><td className="px-3 py-1.5">{fmt(e.entryDate)}</td><td className="px-3 py-1.5">{t(`ops_type_${e.type}`)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{e.hours ?? "-"}</td><td className="px-3 py-1.5 text-right font-mono">{e.amount != null ? rp(e.amount) : "-"}</td></tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="bg-slate-50 font-bold"><td className="px-3 py-2" colSpan={2}>{t("ops_sum_count", { n: prev.totals.count })}</td>
                        <td className="px-3 py-2 text-right font-mono">{prev.kind === "overtime" ? prev.totals.hours : ""}</td><td className="px-3 py-2 text-right font-mono">{rp(prev.totals.amount)}</td></tr></tfoot>
                    </table>
                  </div>
                )}
                <div className="flex justify-end">
                  <Btn variant="primary" icon="playlist_add_check" onClick={create} disabled={busy || !prev.entries.length || !!prev.waitingRecap}>{t("ops_createRecap")}</Btn>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RecapDetail({ id, actor, onClose, onChanged }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const isClient = actor === "client";
  const canApprove = (isClient && can(user, "opsrecap", "approve")) || user?.role === "superadmin";
  const canManage = (actor === "agency" && can(user, "opsrecap", "edit")) || user?.role === "superadmin";
  const load = useCallback(() => api.ops.recap(id).then((x) => { setR(x); setSel(new Set()); }).catch((e) => toast.error(e.message)), [id, toast]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, msg) => {
    setBusy(true);
    try { const res = await fn(); if (msg) toast.success(typeof msg === "function" ? msg(res) : msg); apiCache.invalidate("ops:"); await load(); onChanged(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!r) return null;
  const waiting = r.status === "waiting";
  const pending = r.entries.filter((e) => e.status === "in_recap");
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold"><span className="font-mono text-primary">{r.code}</span> · {t(`ops_kind_${r.kind}`)}
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold align-middle ${RST[r.status]}`}>{t(`ops_rst_${r.status}`)}</span></h2>
            <p className="text-sm text-slate-600">{r.contractNumber} · {r.clientName} · {r.period} ({fmt(r.dateFrom)} – {fmt(r.dateTo)})</p>
            <p className="text-xs text-slate-500">{t("ops_modeLabel")}: {t(`ct_mode_${r.extrasMode || "none"}`)} · {t("ops_sum_count", { n: r.entryCount })}{r.kind === "overtime" ? ` · ${r.totalHours} jam` : ""} · <b>{rp(r.totalAmount)}</b></p>
          </div>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        {waiting && (
          <div className="flex gap-2 flex-wrap">
            {canApprove && <Btn variant="success" icon="task_alt" disabled={busy || pending.length === 0}
              onClick={() => confirm(t("ops_confirmApprove", { code: r.code, n: pending.length, total: rp(r.totalAmount) })) && act(() => api.ops.approveRecap(r.id), t("ops_approved"))}>{t("ops_approve")}</Btn>}
            {canApprove && sel.size > 0 && <Btn variant="danger" icon="block" disabled={busy}
              onClick={() => { const why = prompt(t("ops_rejectReason")); if (why) act(() => api.ops.rejectRecapEntries(r.id, [...sel], why), (x) => t("ops_rejected", { n: x.rejected })); }}>{t("ops_rejectLines")} ({sel.size})</Btn>}
            {canManage && <Btn icon="sync" disabled={busy} onClick={() => act(() => api.ops.refreshRecap(r.id), (x) => t("ops_refreshed", { n: x.added }))}>{t("ops_refresh")}</Btn>}
            {canManage && <Btn variant="danger" icon="cancel" disabled={busy} onClick={() => confirm(t("ops_confirmCancel", { code: r.code })) && act(() => api.ops.cancelRecap(r.id), null)}>{t("ops_cancelRecap")}</Btn>}
          </div>
        )}
        {r.status === "approved" && <Note tone="ok">{t("ops_invoiceHint", { code: r.code, m: r.extrasMode === "included" ? t("ops_invoiceHintM") : "" })}</Note>}
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              {canApprove && waiting && <th className="px-2 py-2 w-8"></th>}
              <th className="px-3 py-2 text-left">{t("ops_date")}</th><th className="px-3 py-2 text-left">{t("ops_unit")} / {t("ops_driver")}</th>
              <th className="px-3 py-2 text-left">{t("ops_kind")}</th><th className="px-3 py-2 text-left">{t("ops_time")}</th>
              <th className="px-3 py-2 text-right">{t("ops_hours")}</th><th className="px-3 py-2 text-right">{t("ops_amount")}</th>
              <th className="px-3 py-2 text-left">{t("ops_evidence")}</th><th className="px-3 py-2 text-left">{t("ops_note")}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.entries.map((e) => (
                <tr key={e.id} className="align-top">
                  {canApprove && waiting && <td className="px-2 py-2">{e.status === "in_recap" && <input type="checkbox" checked={sel.has(e.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />}</td>}
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(e.entryDate)}{e.dayType !== "workday" && <p className="text-[10px] text-amber-700">{t(`ops_day_${e.dayType}`)}</p>}</td>
                  <td className="px-3 py-2 text-xs">{[e.carName, e.plate].filter(Boolean).join(" · ") || "-"}<p className="text-slate-500">{e.driverName || "-"}</p></td>
                  <td className="px-3 py-2">{t(`ops_type_${e.type}`)}</td>
                  <td className="px-3 py-2 text-xs">{e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono">{e.hours ?? "-"}</td>
                  <td className="px-3 py-2 text-right font-mono">{e.amount != null ? rp(e.amount) : "-"}</td>
                  <td className="px-3 py-2 text-xs">{e.evidence.length === 0 ? <span className="text-slate-300">—</span> : e.evidence.map((f) => (
                    <AsyncButton key={f.idx} onClick={() => api.ops.openEvidence(e.id, f.idx).catch((x) => toast.error(x.message))} className="block text-primary hover:underline truncate max-w-[140px] cursor-pointer">{f.name}</AsyncButton>
                  ))}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 max-w-[200px]">{e.note || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Holidays ──────────────────────────────────────────────────────────────
export function HolidaysModal({ onClose }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [list, setList] = useState(null);
  const [f, setF] = useState({ date: "", name: "", national: false });
  const load = useCallback(() => api.ops.holidays(year).then((r) => setList(r.data)).catch((e) => toast.error(e.message)), [year, toast]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    try { await api.ops.addHoliday(f); setF({ date: "", name: "", national: f.national }); load(); } catch (e) { toast.error(e.message); }
  }
  async function del(id) {
    try { await api.ops.removeHoliday(id); load(); } catch (e) { toast.error(e.message); }
  }
  const isSuper = user?.role === "superadmin";
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold">{t("ops_holidayTitle")}</h3>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button></div>
        <p className="text-xs text-slate-500">{t("ops_holidayHint")}</p>
        <div className="flex gap-2 items-center">
          <button onClick={() => setYear(year - 1)} className="px-2 py-1 rounded border border-slate-200 cursor-pointer">‹</button>
          <span className="font-bold">{year}</span>
          <button onClick={() => setYear(year + 1)} className="px-2 py-1 rounded border border-slate-200 cursor-pointer">›</button>
        </div>
        <div className="flex gap-2 flex-wrap items-end">
          <input type="date" className={inp} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <input className={`${inp} flex-1 min-w-[160px]`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("ops_holidayName")} />
          <Btn variant="primary" icon="add" onClick={add} disabled={!f.date || !f.name}>{t("ops_holidayAdd")}</Btn>
        </div>
        {isSuper && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.national} onChange={(e) => setF({ ...f, national: e.target.checked })} />{t("ops_holidayNational")}</label>}
        {!list ? <Empty>{t("loading")}</Empty> : list.length === 0 ? <Empty>{t("ops_holidayNone")}</Empty> : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {list.map((h) => (
              <li key={h.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs w-24">{fmt(h.date)}</span>
                <span className="flex-1">{h.name}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${h.national ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>{h.national ? t("ops_national") : t("ops_ownAgency")}</span>
                {(isSuper || !h.national) && <AsyncButton onClick={() => del(h.id)} className="text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></AsyncButton>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
