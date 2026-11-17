import { useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { can } from "../lib/permissions";
import RequestAccessModal from "./RequestAccessModal";

// Lists the menus this user cannot open yet and lets them ask for access.
// Hidden menus can't be clicked, so this is the visible entry point for
// access requests (opened from the sidebar). Clients only see features a
// client account may ever get (rule R-01); the server enforces the same.
const FEATURE_LIST = [
  { key: "dashboard", label: "dashboard" },
  { key: "orders", label: "orderRecap" },
  { key: "schedule", label: "schedule" },
  { key: "fleet", label: "fleet", agencyOnly: true },
  { key: "fleetcare", label: "fc_menu", agencyOnly: true },
  { key: "customers", label: "customers", agencyOnly: true },
  { key: "drivers", label: "drivers", agencyOnly: true },
  { key: "analytics", label: "analytics", agencyOnly: true },
  { key: "finance", label: "finance", agencyOnly: true },
  { key: "documents", label: "documents", agencyOnly: true },
  { key: "pricing", label: "prc_menu", agencyOnly: true },
  { key: "contracts", label: "hub_tab_contracts" },
  { key: "opsrecap", label: "hub_tab_ops" },
  { key: "corporate", label: "hub_tab_portal", clientOnly: true },
  { key: "users", label: "userManagement" },
  { key: "settings", label: "settings" },
];

export default function FeatureAccessModal({ user, onClose }) {
  const { t } = useLanguage();
  const [picked, setPicked] = useState(null);
  const isClient = user?.accountType === "client";
  const locked = FEATURE_LIST.filter((f) => !(isClient && f.agencyOnly) && !(!isClient && f.clientOnly) && !can(user, f.key, "view"));

  if (picked) {
    return <RequestAccessModal featureKey={picked.key} featureLabel={t(picked.label)} onClose={() => setPicked(null)} onSuccess={onClose} />;
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-slate-900 font-semibold text-base">{t("requestFeatureAccess")}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="p-5">
          {locked.length === 0 ? (
            <p className="text-sm text-slate-500">{t("requestFeatureNone")}</p>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-3">{t("requestFeatureHint")}</p>
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {locked.map((f) => (
                  <li key={f.key} className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm text-slate-700 flex items-center gap-2"><span className="material-symbols-outlined text-[18px] text-slate-400">lock</span>{t(f.label)}</span>
                    <button onClick={() => setPicked(f)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:border-primary hover:text-primary cursor-pointer">{t("requestFeatureBtn")}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
