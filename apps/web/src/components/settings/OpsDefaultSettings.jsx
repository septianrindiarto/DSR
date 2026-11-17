import { useEffect, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../Toast";
import { api, apiCache } from "../../lib/api";
import AsyncButton from "../AsyncButton";
import InfoTip from "../InfoTip";
import { policyOf, dailyRatesOf } from "../../lib/ops";
import { OvertimeMatrix, TripPolicy } from "../../pages/AdminContracts";

// Pengaturan → Lembur & perjalanan dinas (default). Same editor as a contract.
// Used by contracts without their own terms and by daily orders (owner 2026-11-09).
const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;

export default function OpsDefaultSettings() {
  const { t } = useLanguage();
  const toast = useToast();
  const [state, setState] = useState(null);     // server response
  const [p, setP] = useState(null);

  useEffect(() => {
    api.ops.policyDefault().then((r) => { setState(r); setP(policyOf(r.policy)); }).catch((e) => toast.error(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setPolicy = (group, patch) => setP((x) => ({ ...x, [group]: { ...x[group], ...patch } }));
  async function save() {
    try {
      const r = await api.ops.setPolicyDefault(p);
      setState(r); setP(policyOf(r.policy));
      apiCache.invalidate("ops:"); apiCache.invalidate("documents:");
      toast.success(t("tx_opsSaved"));
    } catch (e) { toast.error(e.message); }
  }

  if (!p) return <p className="text-sm text-slate-500">{t("loadingShort")}</p>;
  const rates = dailyRatesOf(p);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-1">{t("tx_opsTitle")} <InfoTip text={t("tx_opsSub")} size={15} /></h2>
        <p className="text-xs text-slate-500 mt-1">
          {state?.configured && rates.configured ? t("tx_opsDaily", { ot: rp(rates.overtime), lod: rp(rates.lodging) }) : t("tx_opsNotSet")}
        </p>
      </div>
      <div className="p-5 space-y-4">
        <OvertimeMatrix policy={p} setPolicy={setPolicy} locked={false} />
        <TripPolicy policy={p} setPolicy={setPolicy} locked={false} />
        {state?.blockers?.length > 0 && (
          <ul className="text-xs text-amber-700 list-disc pl-5">{state.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        )}
        <AsyncButton onClick={save} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">{t("save")}</AsyncButton>
      </div>
    </div>
  );
}
