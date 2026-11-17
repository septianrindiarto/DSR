import { useEffect, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../Toast";
import { api, apiCache } from "../../lib/api";
import { can } from "../../lib/permissions";
import OpsEntryModal from "../ops/OpsEntryModal";
import { HolidaysModal } from "../../pages/AdminOpsRecap";

// Form → Lembur / Perjalanan Dinas / Operasional: input only (owner
// 2026-11-13: lists, detail, edit and approval live in List Data).
export default function FormSubmit({ kind, onGoList }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const toast = useToast();
  const [ctx, setCtx] = useState(null);
  const [n, setN] = useState(0);
  const [holidays, setHolidays] = useState(false);
  useEffect(() => { api.ops.contracts().then((r) => setCtx({ contracts: r?.data || [], actor: r?.actor })).catch((e) => toast.error(e.message)); }, [toast]);
  const isAgency = ctx?.actor === "agency" || ctx?.actor === "super";
  const canCreate = user?.role === "superadmin" || can(user, "opsrecap", "create") || ctx?.actor === "driver";
  if (!ctx) return <p className="text-sm text-slate-400">{t("loadingShort")}</p>;
  return (
    <div className="space-y-3 max-w-6xl mx-auto">
      <div className="flex items-center justify-end gap-2">
        {kind === "overtime" && isAgency && can(user, "settings", "edit") && (
          <button onClick={() => setHolidays(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">event_busy</span>{t("ops_holidays")}
          </button>)}
        <button onClick={onGoList} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">table_rows</span>{t("frm_toList")}
        </button>
      </div>
      {canCreate
        ? <OpsEntryModal key={`${kind}-${n}`} inline fixedKind={kind} contracts={ctx.contracts}
            onClose={() => setN((x) => x + 1)}
            onSaved={() => { apiCache.invalidate("ops:"); toast.success(t("frm_saved")); setN((x) => x + 1); }} />
        : <p className="text-sm text-slate-500">{t("corp_noAccess")}</p>}
      {holidays && <HolidaysModal onClose={() => setHolidays(false)} />}
    </div>
  );
}
