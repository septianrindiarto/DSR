// ─── Laporan & Audit (owner 2026-11-13) ─────────────────────────────────────
// The former Portal Perusahaan (booking approvals, spending, monthly report,
// cost centers, invoices) as its own menu, plus an audit trail: who approved
// or changed what on contracts and their forms — insight for client and agency.
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { can } from "../lib/permissions";
import InfoTip from "../components/InfoTip";
import AdminCorporate from "./AdminCorporate";

const inp = "px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white";
const KIND_STYLE = {
  contract: "bg-sky-100 text-sky-700", approval: "bg-emerald-100 text-emerald-700", document: "bg-indigo-100 text-indigo-700",
  form: "bg-violet-100 text-violet-700", note: "bg-amber-100 text-amber-800", monthly: "bg-teal-100 text-teal-700", change: "bg-slate-200 text-slate-700",
};

export default function AdminReports() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const tabs = useMemo(() => {
    const list = [];
    if (can(user, "corporate", "view") || can(user, "orders", "approve")) list.push("portal");
    if (can(user, "contracts", "view") || can(user, "corporate", "view")) list.push("audit");
    return list;
  }, [user]);
  const [tab, setTab] = useState(tabs[0]);
  return (
    <AdminLayout>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("ra_title")}</h1>
        <p className="text-slate-500 text-sm mt-1 max-w-3xl">{t("ra_subtitle")}</p>
      </div>
      {tabs.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto mb-4 border-b border-slate-200 pb-px">
          {tabs.map((id) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2.5 border-b-2 text-sm font-semibold whitespace-nowrap cursor-pointer ${tab === id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
              {t(`ra_tab_${id}`)}
            </button>
          ))}
        </div>
      )}
      {tab === "portal" && <AdminCorporate embedded />}
      {tab === "audit" && <AuditTrail />}
    </AdminLayout>
  );
}

function AuditTrail() {
  const { t } = useLanguage();
  const toast = useToast();
  const [contracts, setContracts] = useState([]);
  const [f, setF] = useState({ contractId: "", kind: "", q: "" });
  const [rows, setRows] = useState(null);
  useEffect(() => { api.contracts.list().then((r) => setContracts(r?.data || [])).catch(() => {}); }, []);
  useEffect(() => {
    api.contracts.audit({ contractId: f.contractId }).then((r) => setRows(r?.data || [])).catch((e) => { setRows([]); toast.error(e.message); });
  }, [f.contractId, toast]);
  const list = (rows || []).filter((r) => (!f.kind || r.kind === f.kind)
    && (!f.q || [r.ref, r.contractNumber, r.text, r.actor].filter(Boolean).join(" ").toLowerCase().includes(f.q.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <select className={inp} value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}>
          <option value="">Semua kontrak</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contractNumber} · {c.clientName}</option>)}
        </select>
        <select className={inp} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="">{t("aud_kindAll")}</option>
          {Object.keys(KIND_STYLE).map((k) => <option key={k} value={k}>{t(`aud_k_${k}`)}</option>)}
        </select>
        <input className={`${inp} flex-1 min-w-[200px]`} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Cari…" />
        <InfoTip text={t("aud_help")} />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        {rows === null ? <p className="p-6 text-center text-sm text-slate-400">{t("loadingShort")}</p> : list.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">{t("aud_none")}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="px-3 py-2 text-left">{t("aud_when")}</th>
              <th className="px-3 py-2 text-left">{t("aud_ref")}</th>
              <th className="px-3 py-2 text-left">{t("aud_what")}</th>
              <th className="px-3 py-2 text-left">{t("aud_who")}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{list.map((r, i) => (
              <tr key={`${r.at}-${i}`} className="align-top">
                <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(r.at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-3 py-2 text-xs"><p className="font-mono font-bold text-primary">{r.ref || "-"}</p>{r.ref !== r.contractNumber && <p className="text-slate-500 font-mono">{r.contractNumber}</p>}</td>
                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold mr-1.5 ${KIND_STYLE[r.kind] || ""}`}>{t(`aud_k_${r.kind}`)}</span>{r.text}</td>
                <td className="px-3 py-2 text-xs">{r.actor || "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
