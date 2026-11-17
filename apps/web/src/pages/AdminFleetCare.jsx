// ─── Perawatan & Dokumen — fleet care (service by km/date, document expiry) ──
// Per unit: odometer, next service (km / date), STNK, pajak, KIR, asuransi.
// Hover ✏️ edits a date or number in place; "Catat servis" records a service
// (maintenance row + resets the plan). A daily 08:00 WIB digest goes to the
// agency (Telegram + email) for anything expired or due within 30 days.
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api, apiCache } from "../lib/api";
import { can } from "../lib/permissions";
import InlineEdit from "../components/InlineEdit";
import { Btn, Empty } from "../components/books/shared";

const DOCS = ["stnkExpiry", "taxExpiry", "kirExpiry", "insuranceExpiry"];
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const BADGE = { expired: "bg-red-100 text-red-700", overdue: "bg-red-100 text-red-700", soon: "bg-amber-100 text-amber-700", ok: "bg-emerald-50 text-emerald-700", unknown: "bg-slate-100 text-slate-500" };

export default function AdminFleetCare() {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = can(user, "fleet", "edit");
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("attention");
  const [serviceFor, setServiceFor] = useState(null);
  const load = () => api.fleetCare.list().then(setData).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  async function save(car, patch) {
    try { await api.fleetCare.update(car.id, patch); toast.success(t("inlineSaved")); apiCache.invalidate("cars:"); load(); }
    catch (e) { toast.error(e.message); throw e; }
  }
  const rows = useMemo(() => (data?.data || []).filter((c) => filter === "all" || c.alerts.length > 0), [data, filter]);
  const counts = useMemo(() => {
    const all = data?.data || [];
    return { expired: all.filter((c) => c.alerts.some((a) => a.status === "expired")).length, soon: all.filter((c) => c.alerts.some((a) => a.status === "soon")).length };
  }, [data]);

  const docCell = (car, k) => {
    const d = car.docs[k];
    return (
      <InlineEdit disabled={!canEdit} type="date" value={d?.date || ""} onSave={(v) => save(car, { [k]: v || null })}
        display={d ? <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${BADGE[d.status]}`}>{fmt(d.date)}</span> : <span className="text-slate-300 text-xs">—</span>} />
    );
  };

  return (
    <AdminLayout>
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("fc_title")}</h1>
          <p className="text-slate-500 text-sm mt-1">{t("fc_subtitle")}</p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 font-semibold">{t("fc_expiredN", { n: counts.expired })}</span>
          <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 font-semibold">{t("fc_soonN", { n: counts.soon })}</span>
          <select className="px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="attention">{t("fc_onlyAttention")}</option><option value="all">{t("fc_all")}</option>
          </select>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        {!data ? <Empty>{t("loading")}</Empty> : rows.length === 0 ? <Empty>{filter === "attention" ? t("fc_allGood") : t("noData")}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                <th className="px-3 py-2 text-left">{t("car")}</th><th className="px-3 py-2 text-right">{t("fc_odometer")}</th>
                <th className="px-3 py-2 text-left">{t("fc_service")}</th>
                {DOCS.map((k) => <th key={k} className="px-3 py-2 text-left">{t(`fc_${k}`)}</th>)}
                <th className="px-3 py-2"></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2"><p className="font-medium">{c.brand} {c.name}</p><p className="text-xs text-slate-500 font-mono">{c.plate || "-"}</p></td>
                    <td className="px-3 py-2 text-right">
                      <InlineEdit disabled={!canEdit} type="number" value={c.currentOdometer ?? ""} onSave={(v) => save(c, { currentOdometer: v })}
                        display={c.currentOdometer != null ? `${c.currentOdometer.toLocaleString("id-ID")} km` : <span className="text-slate-300">—</span>} />
                      {c.odometerUpdatedAt && <p className="text-[10px] text-slate-400">{fmt(c.odometerUpdatedAt)}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded font-semibold ${BADGE[c.service.status]}`}>{t(`fc_sv_${c.service.status}`)}</span>
                      <p className="text-slate-500 mt-0.5">
                        {c.service.dueKm != null && <>{t("fc_atKm", { km: c.service.dueKm.toLocaleString("id-ID") })}{c.service.kmLeft != null && ` (${c.service.kmLeft.toLocaleString("id-ID")} km)`}</>}
                        {c.service.dueDate && <> · {fmt(c.service.dueDate)}</>}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {t("fc_plan")}: <InlineEdit disabled={!canEdit} type="number" value={c.serviceIntervalKm ?? ""} onSave={(v) => save(c, { serviceIntervalKm: v })} display={`${(c.serviceIntervalKm || 10000).toLocaleString("id-ID")} km`} />
                        {" / "}<InlineEdit disabled={!canEdit} type="number" value={c.serviceIntervalMonths ?? ""} onSave={(v) => save(c, { serviceIntervalMonths: v })} display={t("fc_months", { n: c.serviceIntervalMonths || 6 })} />
                      </p>
                    </td>
                    {DOCS.map((k) => <td key={k} className="px-3 py-2">{docCell(c, k)}</td>)}
                    <td className="px-3 py-2 text-right">{canEdit && <Btn icon="build" onClick={() => setServiceFor(c)}>{t("fc_recordService")}</Btn>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-2">{t("fc_hint")}</p>
      {serviceFor && <ServiceModal car={serviceFor} onClose={() => setServiceFor(null)} onDone={() => { setServiceFor(null); load(); }} />}
    </AdminLayout>
  );
}

function ServiceModal({ car, onClose, onDone }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [f, setF] = useState({ date: new Date().toLocaleDateString("en-CA"), odometer: car.currentOdometer ?? "", cost: "", description: "", type: "routine" });
  const [busy, setBusy] = useState(false);
  const inp = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm";
  async function submit() {
    setBusy(true);
    try { await api.fleetCare.recordService(car.id, { ...f, odometer: f.odometer === "" ? null : Number(f.odometer), cost: f.cost === "" ? null : Number(f.cost) }); toast.success(t("fc_serviceSaved")); onDone(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">{t("fc_recordService")} · {car.brand} {car.name} <span className="font-mono text-xs text-slate-500">{car.plate}</span></h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("fc_date")}</span><input type="date" className={inp} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("fc_odometer")}</span><input type="number" className={inp} value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} /></label>
          <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("fc_type")}</span>
            <select className={inp} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{["routine", "repair", "inspection"].map((x) => <option key={x} value={x}>{t(`fc_t_${x}`)}</option>)}</select></label>
          <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("fc_cost")}</span><input type="number" className={inp} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
          <label className="block col-span-2"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("fc_desc")}</span><input className={inp} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t("fc_descPh")} /></label>
        </div>
        <p className="text-[11px] text-slate-400">{t("fc_serviceHint")}</p>
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>{t("cancel")}</Btn><Btn variant="primary" onClick={submit} disabled={busy}>{t("save")}</Btn></div>
      </div>
    </div>
  );
}
