// ─── Kontrak & Perusahaan (owner 2026-11-13) ────────────────────────────────
//   Kontrak    create / change (amandemen) / monitor every contract
//   Form       input forms by type — Kontrak (monthly M detail form per unit),
//              Lembur (L), Perjalanan Dinas (T), Operasional (O)
//   List Data  every contract code (M/L/T/O, older R) with invoice, surat
//              pengantar and faktur pajak
// The former Ringkasan tab is gone and Portal Perusahaan moved to its own
// menu "Laporan & Audit" (/admin/reports). Old links (?tab=ops / ?tab=portal)
// still work.
import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { can } from "../lib/permissions";
import { Empty } from "../components/books/shared";
import AdminContracts from "./AdminContracts";
import ListData from "../components/contracts/ListData";
import FormSubmit from "../components/contracts/FormSubmit";
import MonthlyCodes from "../components/contracts/MonthlyCodes";

const SUBS = [
  { id: "kontrak", icon: "contract", label: "frm_kontrak" },
  { id: "lembur", icon: "schedule", label: "frm_lembur", kind: "overtime" },
  { id: "trip", icon: "flight_takeoff", label: "frm_trip", kind: "trip" },
  { id: "ops", icon: "receipt", label: "frm_ops", kind: "expense" },
];

export default function AdminContractHub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = useMemo(() => {
    const list = [];
    if (can(user, "contracts", "view")) list.push({ id: "contracts", icon: "contract", label: "hub_tab_contracts" });
    if (can(user, "contracts", "view") || can(user, "opsrecap", "view")) list.push({ id: "form", icon: "edit_note", label: "hub_tab_form" });
    if (can(user, "contracts", "view")) list.push({ id: "list", icon: "table_rows", label: "hub_tab_list" });
    return list;
  }, [user]);
  const raw = params.get("tab");
  // Contracts for the filters of Form → Kontrak and List Data.
  const [contracts, setContracts] = useState([]);
  useEffect(() => {
    if (!can(user, "contracts", "view")) return;
    api.contracts.list().then((r) => setContracts(r?.data || [])).catch(() => {});
  }, [user]);
  if (raw === "portal") return <Navigate to="/admin/reports" replace />;
  const wanted = raw === "ops" || raw === "summary" ? "form" : raw;
  const tab = tabs.some((x) => x.id === wanted) ? wanted : tabs[0]?.id;
  const contractId = params.get("contract") || "";
  const subs = SUBS.filter((x) => (x.kind ? can(user, "opsrecap", "view") : can(user, "contracts", "view") || can(user, "opsrecap", "view")));
  const sub = subs.some((x) => x.id === params.get("sub")) ? params.get("sub") : (raw === "ops" ? "lembur" : subs[0]?.id);
  const go = (id, extra = {}) => setParams({ tab: id, ...extra }, { replace: false });

  return (
    <AdminLayout>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("hub_title")}</h1>
        <p className="text-slate-500 text-sm mt-1">{t("hub_subtitle")}</p>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto mb-4 border-b border-slate-200 pb-px">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => go(x.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${tab === x.id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
            <span className="material-symbols-outlined text-[18px]">{x.icon}</span>{t(x.label)}
          </button>
        ))}
      </div>
      {!tab && <Empty>{t("corp_noAccess")}</Empty>}
      {tab === "contracts" && <AdminContracts key={`c-${contractId}`} embedded openContractId={contractId ? Number(contractId) : null} />}
      {tab === "form" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {subs.map((x) => (
              <button key={x.id} onClick={() => go("form", { sub: x.id, ...(contractId ? { contract: contractId } : {}) })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-semibold cursor-pointer ${sub === x.id ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
                <span className="material-symbols-outlined text-[18px]">{x.icon}</span>{t(x.label)}
              </button>
            ))}
          </div>
          {/* Input only — every submitted item is listed (detail, edit, approve) in List Data. */}
          {/* Kontrak = the monthly M detail form (per unit per contract month), not contract creation. */}
          {sub === "kontrak" && <MonthlyCodes contracts={contracts} />}
          {SUBS.filter((x) => x.kind).map((x) => sub === x.id && (
            <FormSubmit key={`f-${x.id}`} kind={x.kind} onGoList={() => go("list")} />
          ))}
        </div>
      )}
      {tab === "list" && <ListData contracts={contracts} />}
    </AdminLayout>
  );
}
