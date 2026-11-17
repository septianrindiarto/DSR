// ─── AgencyProfileCard — trust signals of one agency (Phase C) ──────────────
// Verified legal documents, fleet size, rating, claim speed, volume, latest
// reviews. Used in the price estimate (client compares agencies) and in
// Pengaturan → Profil Agency (the agency's own view).
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

export default function AgencyProfileCard({ agencyId = null, own = false }) {
  const { t } = useLanguage();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    (own ? api.marketplace.myAgency() : api.marketplace.agency(agencyId)).then(setP).catch((e) => setErr(e.message));
  }, [agencyId, own]);
  if (err) return <p className="text-xs text-red-600">{err}</p>;
  if (!p) return <p className="text-xs text-slate-400">{t("loading")}</p>;
  const stat = (label, value) => (
    <div className="rounded-lg border border-slate-200 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="text-lg font-bold text-slate-900">{value}</p></div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-bold text-slate-900">{p.name}</p>
        {p.verified
          ? <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">✓ {t("ap_verified")}</span>
          : <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold">{t("ap_unverified")}</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {stat(t("ap_rating"), p.rating?.count ? `★ ${p.rating.avg} (${p.rating.count})` : "—")}
        {stat(t("ap_units"), p.units)}
        {stat(t("ap_claimSpeed"), p.avgClaimMinutes == null ? "—" : t("ap_minutes", { n: p.avgClaimMinutes }))}
        {stat(t("ap_completed90"), p.completedBookings90d)}
      </div>
      {p.latestReviews?.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-600">
          {p.latestReviews.map((r, i) => <li key={i}><span className="text-amber-500">{"★".repeat(r.rating)}</span> {r.comment || <i className="text-slate-400">{t("ap_noComment")}</i>}</li>)}
        </ul>
      )}
      {own && <p className="text-[11px] text-slate-400">{t("ap_ownHint")}</p>}
    </div>
  );
}
