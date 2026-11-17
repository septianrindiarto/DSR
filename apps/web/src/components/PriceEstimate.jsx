// ─── PriceEstimate — live quote from the pricing engine ─────────────────────
// Used by the landing & dashboard booking forms (estimate before submitting)
// and by Tarif → Simulasi (detailed). For a company user served by several
// agencies it lists each agency's price side by side.
// vehicles: [{ category, package, destination, quantity, carModel?, overtimeHours?, overnightNights? }]
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;

export default function PriceEstimate({ vehicles = [], pickupDate, returnDate, clientOrgId = null, detailed = false, className = "" }) {
  const { t } = useLanguage();
  const [state, setState] = useState({ loading: false, quotes: null, error: null });
  const items = useMemo(() => vehicles
    .filter((v) => v.category && v.category !== "Lainnya" && v.package)
    .map((v) => ({
      category: v.category, package: v.package, destination: v.destination || null,
      quantity: Math.max(1, Number(v.quantity) || 1),
      ...(v.carModel ? { carModel: v.carModel } : {}),
      ...(v.overtimeHours ? { overtimeHours: Number(v.overtimeHours) } : {}),
      ...(v.overnightNights ? { overnightNights: Number(v.overnightNights) } : {}),
    })), [vehicles]);
  const key = JSON.stringify({ items, pickupDate, returnDate, clientOrgId });

  useEffect(() => {
    if (!items.length || !pickupDate || !returnDate) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const r = await api.pricing.quote({ items, pickupDate, returnDate, ...(clientOrgId ? { clientOrgId } : {}) });
        if (alive) setState({ loading: false, quotes: r?.quotes || [], error: null });
      } catch (e) {
        if (alive) setState({ loading: false, quotes: null, error: e.message });
      }
    }, 450);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!items.length || !pickupDate || !returnDate) return null;
  const quotes = state.quotes || [];
  const priced = quotes.filter((q) => q.total > 0);

  return (
    <div className={`rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm ${className}`}>
      <div className="flex items-center gap-2 font-semibold text-emerald-800">
        <span className="material-symbols-outlined text-[20px]">sell</span>{t("prc_est_title")}
        {state.loading && <span className="w-3.5 h-3.5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />}
      </div>
      {state.error && <p className="text-xs text-red-600 mt-1">{state.error}</p>}
      {!state.loading && state.quotes && priced.length === 0 && <p className="text-xs text-slate-600 mt-1">{t("prc_est_onRequest")}</p>}
      {priced.map((q) => (
        <div key={q.agencyId} className="mt-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="text-slate-700">
              {(quotes.length > 1 || detailed) && <b>{q.agencyName}</b>}
              {q.corporate && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">{t("prc_est_corporate")}</span>}
              {q.rating?.count > 0 && <span className="ml-2 text-xs text-amber-600">★ {q.rating.avg} ({q.rating.count})</span>}
              <span className="text-xs text-slate-500 ml-2">{t("prc_est_days", { n: q.days })}</span>
            </span>
            <span className="text-lg font-bold text-emerald-800">{rp(q.total)}{!q.complete && <span className="text-xs font-normal text-amber-700"> +{t("prc_est_partial")}</span>}</span>
          </div>
          {detailed && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {q.items.map((it, i) => (
                <li key={i}>
                  {it.quantity}× {it.category || "?"} · {it.package || "?"} · {it.zone ? t("prc_zoneN", { n: it.zone }) : t("prc_est_noZone")}
                  {it.zoneCity ? ` (${it.zoneCity})` : ""} — {it.perUnit > 0
                    ? <>{rp(it.unitPrice)}/hari{it.discountPct ? ` (−${it.discountPct}%)` : ""} → <b>{rp(it.total)}</b> <span className="text-slate-400">[{t(`prc_src_${it.source}`)}]</span></>
                    : <span className="text-amber-700">{t("prc_est_missing")}: {it.missing.map((m) => t(`prc_miss_${m}`)).join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-[11px] text-slate-500 mt-2">{t("prc_est_note")}</p>
    </div>
  );
}
