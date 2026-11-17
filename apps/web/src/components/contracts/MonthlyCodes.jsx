import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../Toast";
import { api, apiCache } from "../../lib/api";
import { can } from "../../lib/permissions";
import AsyncButton from "../AsyncButton";
import InfoTip from "../InfoTip";

// ─── Form → Kontrak: the monthly M detail form (owner 2026-11-13) ───────────
// One row per unit per contract month, made by the system (first month when
// the contract becomes active, each next month on H+1 after the previous
// tanggal tagih). Earlier months stay. Each row is filled (km awal / akhir,
// nama user, tujuan, keterangan, bukti) and approved by BOTH sides; only then
// can Dokumen invoice it. Nominal = biaya bulanan + kelebihan km (👁 shows the
// calculation). KM must align with the unit's operasional forms in that month.
// Also used in a contract's Penagihan tab (contractId set).
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const inp = "px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white";
const fld = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white";
const fmtD = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-");
const nf = (n) => (n == null || n === "" ? "-" : Number(n).toLocaleString("id-ID"));
const isClientUser = (u) => u?.accountType === "client" || u?.role === "client" || u?.role === "client_admin";
const STATUS_STYLE = {
  open: "bg-slate-100 text-slate-600", submitted: "bg-amber-100 text-amber-800", verified: "bg-sky-100 text-sky-800",
  client_ok: "bg-sky-100 text-sky-800", approved: "bg-emerald-100 text-emerald-800", rejected: "bg-red-100 text-red-700", billed: "bg-indigo-100 text-indigo-700",
};
const statusLabel = (t, s) => (s === "open" ? t("mf_st_open") : t(`ops_st_${s}`));

function useRoles() {
  const { user } = useAuth();
  const client = isClientUser(user);
  const sa = user?.role === "superadmin";
  return {
    client, sa,
    canFill: sa || (!client && (can(user, "opsrecap", "create") || can(user, "opsrecap", "edit") || can(user, "contracts", "edit"))) || (client && can(user, "opsrecap", "approve")),
    approveSide: sa ? "agency" : !client && can(user, "opsrecap", "verify") ? "agency" : client && can(user, "opsrecap", "approve") ? "client" : null,
    canGenerate: sa || (!client && can(user, "contracts", "edit")),
    canInvoice: sa || (!client && can(user, "documents", "edit")),
  };
}

export default function MonthlyCodes({ contractId = null, contracts = null }) {
  const { t } = useLanguage();
  const toast = useToast();
  const navigate = useNavigate();
  const roles = useRoles();
  const [flt, setFlt] = useState({ contractId: contractId || "", period: "", status: "" });
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [calcOf, setCalcOf] = useState(null);
  const [sel, setSel] = useState(new Set());

  const load = useCallback(() => {
    api.contracts.monthly({ contractId: contractId || flt.contractId, period: flt.period, status: flt.status })
      .then((r) => { setRows(r?.data || []); setSel(new Set()); }).catch((e) => { setRows([]); toast.error(e.message); });
  }, [contractId, flt, toast]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); load(); };

  async function generate() {
    try {
      const res = await api.contracts.monthlyGenerate(contractId || flt.contractId || undefined);
      toast.success(t("mc_generated", { n: res.created || 0 }));
      changed();
    } catch (e) { toast.error(e.message); }
  }
  const selectable = (r) => roles.approveSide && ["submitted", "verified", "client_ok"].includes(r.status);
  async function approveSel() {
    try {
      const r = await api.contracts.monthlyApprove([...sel]);
      toast.success(t("mf_approved", { n: r.approved, full: r.fullyApproved }));
      if (r.blocked?.length) toast.error(r.blocked.join(" | "));
      changed();
    } catch (e) { toast.error(e.message); }
  }
  async function rejectSel() {
    const reason = prompt(t("ops_rejectReason"));
    if (!reason) return;
    try { const r = await api.contracts.monthlyReject([...sel], reason); toast.success(t("ops_rejected", { n: r.rejected })); changed(); } catch (e) { toast.error(e.message); }
  }
  const list = rows || [];
  const allOn = list.filter(selectable).length > 0 && list.filter(selectable).every((r) => sel.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        {!contractId && contracts && (
          <select className={inp} value={flt.contractId} onChange={(e) => setFlt({ ...flt, contractId: e.target.value })}>
            <option value="">Semua kontrak</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.contractNumber} · {c.clientName}</option>)}
          </select>
        )}
        <input type="month" className={inp} value={flt.period} onChange={(e) => setFlt({ ...flt, period: e.target.value })} />
        <select className={inp} value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value })}>
          <option value="">{t("mf_allStatus")}</option>
          {["open", "submitted", "verified", "client_ok", "approved", "rejected", "billed"].map((s) => <option key={s} value={s}>{statusLabel(t, s)}</option>)}
        </select>
        <InfoTip text={t("mf_help")} />
        <span className="flex-1" />
        {sel.size > 0 && roles.approveSide && <>
          <AsyncButton onClick={approveSel} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">{t("mf_approveN", { n: sel.size })}</AsyncButton>
          <button onClick={rejectSel} className="px-3 py-2 rounded-lg border border-red-200 text-red-700 bg-white text-sm font-semibold cursor-pointer">{t("ops_reject")}</button>
        </>}
        {roles.canGenerate && (contractId || flt.contractId) && <AsyncButton onClick={generate} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium">{t("mc_generate")}</AsyncButton>}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {rows === null ? <p className="p-6 text-center text-sm text-slate-400">{t("loadingShort")}</p> : list.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">{t("mc_none")}</p> : (
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              {roles.approveSide && <th className="px-2 py-2 w-8"><input type="checkbox" checked={allOn} onChange={(e) => setSel(e.target.checked ? new Set(list.filter(selectable).map((r) => r.id)) : new Set())} /></th>}
              <th className="px-3 py-2 text-left">{t("mc_code")}</th>
              {!contractId && <th className="px-3 py-2 text-left">{t("mc_contract")}</th>}
              <th className="px-3 py-2 text-left">{t("mc_month")}</th>
              <th className="px-3 py-2 text-left">{t("mc_unit")}</th>
              <th className="px-3 py-2 text-left">{t("mf_km")}</th>
              <th className="px-3 py-2 text-right">{t("mf_nominal")}</th>
              <th className="px-3 py-2 text-left">{t("mf_status")}</th>
              <th className="px-3 py-2 text-left">{t("mc_invoice")}</th>
              <th className="px-3 py-2 text-left">{t("mc_letter")}</th>
              <th className="px-3 py-2 text-left">{t("mc_faktur")}</th>
              <th className="px-3 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{list.map((r) => (
              <tr key={r.id} className="align-top">
                {roles.approveSide && <td className="px-2 py-2">{selectable(r) && <input type="checkbox" checked={sel.has(r.id)} onChange={(e) => setSel((p) => { const n = new Set(p); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} />}</td>}
                <td className="px-3 py-2 font-mono text-xs font-bold text-primary">{r.code}</td>
                {!contractId && <td className="px-3 py-2 text-xs"><p className="font-mono">{r.contractNumber}</p><p className="text-slate-500">{r.clientName}</p></td>}
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <p>{t("mc_monthN", { n: r.monthIndex })}</p>
                  <p className="text-slate-500">{r.from ? `${fmtD(r.from)} – ${fmtD(r.to)}` : r.period}</p>
                  {r.invoiceDate && <p className="text-slate-500">{t("mc_billDate")}: <b className="text-slate-700">{fmtD(r.invoiceDate)}</b></p>}
                </td>
                <td className="px-3 py-2 text-xs"><p>{[r.unit, r.plate].filter(Boolean).join(" · ") || "-"}</p><p className="text-slate-500">{r.driverName || "-"}</p></td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {r.kmSegments > 1 ? <p>{t("mf_nSegments", { n: r.kmSegments })}</p> : <p className="font-mono">{nf(r.kmStart)} → {nf(r.kmEnd)}</p>}
                  {r.kmUsed != null && <p className="text-slate-500">{nf(r.kmUsed)} km{r.detail?.kmAllowed ? ` / ${nf(r.detail.kmAllowed)}` : ""}</p>}
                  {r.kmIssues?.length > 0 && <p className="text-red-600 font-semibold" title={r.kmIssues.join("\n")}>⚠ {t("mf_kmMismatch")}</p>}
                  {!r.kmIssues?.length && r.kmWarnings?.length > 0 && <p className="text-amber-700" title={r.kmWarnings.join("\n")}>⚠ {t("mf_kmWarn")}</p>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <span className="font-mono">{rp(r.amount)}</span>
                  <button onClick={() => setCalcOf(r)} title={t("mf_calc")} className="ml-1 text-slate-400 hover:text-primary align-middle cursor-pointer"><span className="material-symbols-outlined text-[16px]">visibility</span></button>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-semibold text-[11px] whitespace-nowrap ${STATUS_STYLE[r.status] || ""}`}>{statusLabel(t, r.status)}</span>
                  {r.status === "rejected" && r.rejectReason && <p className="text-red-600 mt-1 max-w-[180px]">{r.rejectReason}</p>}
                  {(r.commentCount > 0 || r.evidenceCount > 0) && <p className="text-slate-400 mt-1">{r.commentCount > 0 && `💬 ${r.commentCount} `}{r.evidenceCount > 0 && `📎 ${r.evidenceCount}`}</p>}
                </td>
                <td className="px-3 py-2 text-xs">{r.invoiceNumber ? <><p className="font-mono">{r.invoiceNumber}</p>{r.paid && <p className="text-emerald-700 font-semibold">{t("mc_paid")}</p>}</> : <span className="text-slate-400">-</span>}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.letterNumber || "-"}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.fakturNsfp || (r.fakturStatus ? "draft" : "-")}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setOpen(r.id)} className={`px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer mr-1 ${roles.canFill && ["open", "rejected"].includes(r.status) ? "bg-primary text-white" : "border border-slate-200 text-slate-600"}`}>
                    {roles.canFill && ["open", "rejected", "submitted", "verified", "client_ok"].includes(r.status) ? t("mf_fill") : t("mf_view")}
                  </button>
                  {roles.canInvoice && (r.status === "approved" || r.invoiceNumber) && (
                    <button onClick={() => navigate(`/admin/documents?code=${encodeURIComponent(r.code)}`)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${r.invoiceNumber ? "border border-slate-200 text-slate-600" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                      {r.invoiceNumber ? "PDF →" : `${t("mc_makeInvoice")} →`}
                    </button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {calcOf && <CalcPopup row={calcOf} onClose={() => setCalcOf(null)} />}
      {open && <MonthlyFormModal id={open} onClose={() => setOpen(null)} onChanged={changed} />}
    </div>
  );
}

function CalcRow({ l, v, b }) {
  return <div className={`flex justify-between gap-4 ${b ? "font-bold border-t border-slate-200 pt-1 mt-1" : ""}`}><span className="text-slate-600">{l}</span><span className="font-mono">{v}</span></div>;
}

/** 👁 Nominal = biaya bulanan + kelebihan km. */
function CalcLines({ calc, kmUsed }) {
  const { t } = useLanguage();
  const c = calc || {};
  const used = kmUsed !== undefined ? kmUsed : (c.kmUsed ?? null);
  const allowed = Number(c.kmAllowed) || 0, rate = Number(c.excessRate) || 0;
  const excess = used != null && allowed && rate ? Math.max(0, used - allowed) : 0;
  const charge = Math.round(excess * rate);
  const fee = Number(c.fee) || 0;
  return (
    <div className="text-sm space-y-0.5">
      {/* Full monthly fee for every contract month, however many days are used (owner 2026-11-13). */}
      <CalcRow l={t("md_fee")} v={rp(fee)} />
      <CalcRow l={t("mc_kmQuota")} v={allowed ? `${nf(allowed)} km` : "-"} />
      <CalcRow l={t("mc_kmUsed")} v={used != null ? `${nf(used)} km` : t("mc_kmUnknown")} />
      <CalcRow l={`${t("md_over")}${rate ? ` (× ${rp(rate)}/km)` : ""}`} v={excess ? `${nf(excess)} km = ${rp(charge)}` : "-"} />
      <CalcRow l={t("mf_nominal")} v={rp(fee + charge)} b />
    </div>
  );
}

function CalcPopup({ row, onClose }) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">{row.code} · {t("mf_calc")}</h3>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        <p className="text-xs text-slate-500">{t("mc_monthN", { n: row.monthIndex })} · {fmtD(row.from)} – {fmtD(row.to)}</p>
        <CalcLines calc={row.detail} />
      </div>
    </div>
  );
}

/** Fill / review one monthly M form. */
export function MonthlyFormModal({ id, onClose, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const roles = useRoles();
  const [m, setM] = useState(null);
  const [f, setF] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  // Parents pass inline callbacks — keep the latest in a ref so loading doesn't loop.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  const load = useCallback(() => {
    api.contracts.monthlyGet(id).then((r) => {
      setM(r);
      setF({
        segs: (r.segments || []).map((x) => ({ key: x.key, kmStart: x.kmStart ?? "", kmEnd: x.kmEnd ?? "" })),
        picName: r.picName || "", destination: r.destination || "", note: r.note || "",
      });
    }).catch((e) => { toast.error(e.message); closeRef.current?.(); });
  }, [id, toast]);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setSeg = (key, k, v) => setF((x) => ({ ...x, segs: x.segs.map((s) => (s.key === key ? { ...s, [k]: v } : s)) }));
  const editable = !!m?.editable && roles.canFill;
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const dirty = useMemo(() => m && f && (f.segs.some((s) => { const o = m.segments.find((x) => x.key === s.key) || {}; return String(s.kmStart) !== String(o.kmStart ?? "") || String(s.kmEnd) !== String(o.kmEnd ?? ""); })
    || f.picName !== (m.picName || "") || f.destination !== (m.destination || "") || f.note !== (m.note || "")), [m, f]);
  // km used = sum of the filled segments (unit + replacement; maintenance days without one don't count).
  const kmUsed = useMemo(() => {
    const done = (f?.segs || []).filter((s) => num(s.kmStart) != null && num(s.kmEnd) != null && num(s.kmEnd) >= num(s.kmStart));
    return done.length ? done.reduce((a, s) => a + num(s.kmEnd) - num(s.kmStart), 0) : null;
  }, [f]);
  // Live KM check (same rule as the server): KM per segment must EQUAL the operasional km; empty is allowed.
  const liveIssues = useMemo(() => {
    if (!m || !f) return [];
    const out = [];
    for (const s of f.segs) {
      const seg = m.segments.find((x) => x.key === s.key);
      const ks = num(s.kmStart), ke = num(s.kmEnd), name = seg ? `${seg.label} (${fmtD(seg.from)} – ${fmtD(seg.to)})` : "";
      if (ks != null && ke != null && ke < ks) out.push(t("mf_kmEndLower", { seg: name }));
      if (seg?.o && (ks != null || ke != null) && (ks !== seg.o.oFirst || ke !== seg.o.oLast)) out.push(t("mf_kmNotEqual", { seg: name, a: nf(seg.o.oFirst), b: nf(seg.o.oLast) }));
    }
    return out;
  }, [m, f, t]);

  async function save(submit = false) {
    setBusy(true);
    try {
      await api.contracts.monthlySave(id, {
        segments: f.segs.map((s) => ({ key: s.key, kmStart: num(s.kmStart), kmEnd: num(s.kmEnd) })),
        picName: f.picName || null, destination: f.destination || null, note: f.note || null, ...(submit ? { submit: true } : {}),
      });
      if (files.length) { const fd = new FormData(); files.forEach((x) => fd.append("files", x)); await api.contracts.monthlyAddEvidence(id, fd); setFiles([]); }
      toast.success(submit ? t("mf_submitted") : t("mf_saved"));
      onChanged(); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true);
    try {
      const r = await api.contracts.monthlyApprove([id]);
      if (r.approved) toast.success(t("mf_approved", { n: r.approved, full: r.fullyApproved }));
      else if (r.blocked?.length) toast.error(r.blocked.join(" | "));
      onChanged(); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function reject() {
    const reason = prompt(t("ops_rejectReason"));
    if (!reason) return;
    setBusy(true);
    try { await api.contracts.monthlyReject([id], reason); toast.success(t("ops_rejected", { n: 1 })); onChanged(); load(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function sendComment() {
    if (!comment.trim()) return;
    try { const r = await api.contracts.monthlyComment(id, comment.trim()); setM((x) => ({ ...x, comments: r.comments })); setComment(""); } catch (e) { toast.error(e.message); }
  }
  async function removeFile(idx) {
    if (!confirm(t("mf_removeFile"))) return;
    try { await api.contracts.monthlyRemoveEvidence(id, idx); load(); } catch (e) { toast.error(e.message); }
  }

  const myApproved = m && (roles.approveSide === "agency" ? m.agencyApproved : roles.approveSide === "client" ? m.clientApproved : false);
  const canApprove = m && roles.approveSide && m.rawStatus === "submitted" && m.status !== "billed" && !myApproved;
  const canReject = m && roles.approveSide && ["submitted", "approved"].includes(m.rawStatus) && m.status !== "billed";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-5xl max-h-[94vh] overflow-y-auto p-5 sm:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        {!m || !f ? <p className="text-sm text-slate-400">{t("loadingShort")}</p> : <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-lg">{t("mf_title")} <span className="font-mono text-primary">{m.code}</span>
                <span className={`ml-2 align-middle px-1.5 py-0.5 rounded font-semibold text-[11px] ${STATUS_STYLE[m.status] || ""}`}>{statusLabel(t, m.status)}</span></h3>
              <p className="text-xs text-slate-500">{m.contractNumber} · {m.clientName} · {t("mc_monthN", { n: m.monthIndex })} ({fmtD(m.from)} – {fmtD(m.to)}) · {t("mc_billDate")} {fmtD(m.invoiceDate)}</p>
              <p className="text-xs text-slate-500">{[m.unit, m.plate].filter(Boolean).join(" · ") || "-"}{m.driverName ? ` · ${m.driverName}` : ""}</p>
            </div>
            <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
          </div>
          {m.status === "rejected" && m.rejectReason && <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{t("ops_rejectedBecause")}: {m.rejectReason}</p>}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <fieldset disabled={!editable || busy} className="lg:col-span-2 grid grid-cols-2 gap-3 content-start min-w-0">
              {/* KM per segment: the unit, and a replacement car while one runs (maintenance days without one don't count). */}
              <div className="col-span-2 border border-slate-200 rounded-lg overflow-x-auto">
                <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 flex items-center gap-1">{t("mf_segments")} <InfoTip text={t("mf_segHelp")} /></div>
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="text-[11px] text-slate-500 text-left"><tr>
                    <th className="px-2 py-1.5">{t("mf_seg_unit")}</th><th className="px-2 py-1.5">{t("mf_seg_period")}</th>
                    <th className="px-2 py-1.5 w-[110px]">{t("mf_kmStart")}</th><th className="px-2 py-1.5 w-[110px]">{t("mf_kmEnd")}</th><th className="px-2 py-1.5 text-right">km</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">{f.segs.map((s) => {
                    const seg = m.segments.find((x) => x.key === s.key) || {};
                    const used = num(s.kmStart) != null && num(s.kmEnd) != null ? num(s.kmEnd) - num(s.kmStart) : null;
                    return (
                      <tr key={s.key} className="align-top">
                        <td className="px-2 py-1.5 text-xs">{seg.label}{seg.role === "replacement" && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-semibold">{t("mf_seg_replacement")}</span>}
                          {seg.o && <p className="text-[11px] text-slate-500 mt-0.5">{t("mf_seg_o", { a: nf(seg.o.oFirst), b: nf(seg.o.oLast), n: seg.o.days })}</p>}
                          {editable && (seg.suggest?.kmStart != null || seg.suggest?.kmEnd != null) && (
                            <button type="button" onClick={() => { setSeg(s.key, "kmStart", seg.suggest.kmStart ?? s.kmStart); setSeg(s.key, "kmEnd", seg.suggest.kmEnd ?? s.kmEnd); }}
                              className="block text-[11px] font-semibold text-primary cursor-pointer">{t("mf_useSuggest")} ({nf(seg.suggest.kmStart)} → {nf(seg.suggest.kmEnd)})</button>)}
                        </td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">{fmtD(seg.from)} – {fmtD(seg.to)}</td>
                        <td className="px-2 py-1.5"><input type="number" min="0" className={fld} value={s.kmStart} onChange={(e) => setSeg(s.key, "kmStart", e.target.value)} /></td>
                        <td className="px-2 py-1.5"><input type="number" min="0" className={fld} value={s.kmEnd} onChange={(e) => setSeg(s.key, "kmEnd", e.target.value)} /></td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">{used != null ? nf(used) : "-"}</td>
                      </tr>
                    );
                  })}</tbody>
                  <tfoot className="bg-slate-50 text-xs font-semibold"><tr><td colSpan={4} className="px-2 py-1.5">{t("mf_totalKm")}</td><td className="px-2 py-1.5 text-right font-mono">{kmUsed != null ? nf(kmUsed) : "-"}</td></tr></tfoot>
                </table>
              </div>
              <label className="block">{<span className="block text-xs font-semibold text-slate-600 mb-1">{t("mf_pic")}</span>}
                <input className={fld} value={f.picName} onChange={(e) => set("picName", e.target.value)} maxLength={120} placeholder={m.clientName || ""} /></label>
              <label className="block">{<span className="block text-xs font-semibold text-slate-600 mb-1">{t("mf_dest")}</span>}
                <input className={fld} value={f.destination} onChange={(e) => set("destination", e.target.value)} maxLength={200} /></label>
              <label className="block col-span-2">{<span className="block text-xs font-semibold text-slate-600 mb-1">{t("ops_note")}</span>}
                <textarea rows={2} className={fld} value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={1000} /></label>
              <div className="col-span-2">
                <span className="block text-xs font-semibold text-slate-600 mb-1">{t("mf_files")}</span>
                {m.evidence.length > 0 && (
                  <ul className="mb-2 space-y-1">{m.evidence.map((x) => (
                    <li key={x.idx} className="flex items-center gap-2 text-sm">
                      <button type="button" onClick={() => api.contracts.monthlyOpenEvidence(id, x.idx).catch((e) => toast.error(e.message))} className="text-primary hover:underline cursor-pointer truncate">📎 {x.name}</button>
                      {editable && <button type="button" onClick={() => removeFile(x.idx)} className="text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[16px]">delete</span></button>}
                    </li>
                  ))}</ul>
                )}
                {editable && <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles([...e.target.files].slice(0, 10))}
                  className="block w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary-light file:text-primary file:font-semibold" />}
                <span className="block text-[11px] text-slate-400 mt-1">{t("ops_filesHintAny")}</span>
              </div>
            </fieldset>

            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-600 mb-2">👁 {t("mf_calc")}</p>
                <CalcLines calc={m.calc} kmUsed={kmUsed} />
                {m.amountOutdated && <p className="text-[11px] text-amber-700 mt-2">{t("mf_amountOutdated", { old: rp(m.amount) })}</p>}
              </div>
              <div className={`rounded-lg border p-3 text-xs space-y-1 ${liveIssues.length ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                <p className="font-bold text-slate-600 flex items-center gap-1">{t("mf_kmCheck")} <InfoTip text={t("mf_kmCheckHelp")} /></p>
                {m.segments.some((x) => x.o)
                  ? m.segments.filter((x) => x.o).map((x) => <p key={x.key} className="text-slate-600">{x.label}: {t("mf_oSummary", { a: nf(x.o.oFirst), b: nf(x.o.oLast), km: nf(x.o.oKm), n: x.o.days })}</p>)
                  : <p className="text-slate-500">{t("mf_noO")}</p>}
                {m.check?.prevKmEnd != null && <p className="text-slate-500">{t("mf_prevEnd", { km: nf(m.check.prevKmEnd) })}</p>}
                {liveIssues.map((w) => <p key={w} className="text-red-700 font-semibold">⚠ {w}</p>)}
                {!liveIssues.length && (m.check?.warnings || []).map((w) => <p key={w} className="text-amber-700">⚠ {w}</p>)}
                {liveIssues.length > 0 && <p className="text-red-700">{t("mf_blocks")}</p>}
              </div>
              {m.invoice && (
                <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-0.5">
                  <p><span className="text-slate-500">{t("mc_invoice")}:</span> <b className="font-mono">{m.invoice.number}</b></p>
                  <p><span className="text-slate-500">{t("mc_letter")}:</span> <span className="font-mono">{m.invoice.letterNumber || "-"}</span></p>
                  <p><span className="text-slate-500">{t("mc_faktur")}:</span> <span className="font-mono">{m.invoice.fakturNsfp || "-"}</span></p>
                </div>
              )}
              <p className="text-[11px] text-slate-500">{t("mf_approvals")}: {t("ctw_side_agency")} {m.agencyApproved ? "✓" : "—"} · {t("ctw_side_client")} {m.clientApproved ? "✓" : "—"}</p>
            </div>
          </div>

          {/* Feedback thread */}
          <div className="rounded-lg border border-slate-200">
            <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{t("ops_comments")}</div>
            <div className="p-3 space-y-2">
              {m.comments.length === 0 && <p className="text-xs text-slate-400">{t("ops_noComments")}</p>}
              {m.comments.map((c, i) => (
                <div key={i} className="text-sm">
                  <p className="text-[11px] text-slate-500"><b className="text-slate-700">{c.by}</b> · {c.side === "client" ? t("ctw_side_client") : t("ctw_side_agency")} · {new Date(c.at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</p>
                  <p className="whitespace-pre-wrap">{c.text}</p>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder={t("ops_commentPh")} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                <button type="button" onClick={sendComment} disabled={!comment.trim()} className="self-end px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer">{t("ops_send")}</button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 flex-wrap">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold cursor-pointer">{t("cancel")}</button>
            {canReject && <button type="button" onClick={reject} disabled={busy} className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-semibold disabled:opacity-50 cursor-pointer">{t("ops_reject")}</button>}
            {editable && <button type="button" onClick={() => save(false)} disabled={busy} className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-sm font-semibold disabled:opacity-50 cursor-pointer">{t("mf_save")}</button>}
            {editable && ["open", "rejected"].includes(m.rawStatus) && <button type="button" onClick={() => save(true)} disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-50 cursor-pointer">{t("mf_submit")}</button>}
            {canApprove && <button type="button" onClick={approve} disabled={busy || dirty || liveIssues.length > 0} title={dirty ? t("mf_saveFirst") : liveIssues.length ? t("mf_blocks") : ""}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 cursor-pointer">{t("mf_approve")}</button>}
          </div>
        </>}
      </div>
    </div>
  );
}
