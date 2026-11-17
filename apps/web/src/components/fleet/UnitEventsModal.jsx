import { useCallback, useEffect, useState } from "react";
import { api, apiCache } from "../../lib/api";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../Toast";
import AsyncButton from "../AsyncButton";
import InfoTip from "../InfoTip";

// ─── Armada → one unit: maintenance schedule + emergency reports (owner 2026-11-13)
// The schedule set here is what Jadwal, contracts (unit pengganti), the
// dashboard and the daily reminders read — no second place to enter it.
const inp = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white";
const lbl = (s) => <span className="block text-xs font-semibold text-slate-600 mb-1">{s}</span>;
const todayWib = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const fmtD = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-");
const fmtDT = (d) => (d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");
const M_STYLE = { scheduled: "bg-sky-100 text-sky-700", in_progress: "bg-amber-100 text-amber-800", completed: "bg-emerald-100 text-emerald-700" };
const INCIDENT_KINDS = ["breakdown", "accident", "tire", "other"];

/** Emergency / problem report (agency admin or the unit's driver). */
export function IncidentForm({ cars, defaultCarId = "", onDone, onCancel }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [f, setF] = useState({ carId: defaultCarId || (cars.length === 1 ? cars[0].id : ""), kind: "breakdown", description: "", location: "", offRoad: true });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function send() {
    if (!f.carId || !f.description.trim()) { toast.error(t("ue_incFill")); return; }
    try {
      const r = await api.fleetCare.reportIncident({ carId: Number(f.carId), kind: f.kind, description: f.description.trim(), location: f.location || null, offRoad: !!f.offRoad });
      toast.success(t("ue_incSent", { c: r.contract ? ` (${r.contract})` : "" }));
      apiCache.invalidate("fleet:"); onDone?.();
    } catch (e) { toast.error(e.message); }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{t("ue_incHelp")}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2 sm:col-span-1">{lbl(`${t("ue_unit")} *`)}
          <select className={inp} value={f.carId} onChange={(e) => set("carId", e.target.value)} disabled={!!defaultCarId}>
            <option value="">—</option>
            {cars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select></label>
        <label className="block col-span-2 sm:col-span-1">{lbl(t("ue_incKind"))}
          <select className={inp} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            {INCIDENT_KINDS.map((k) => <option key={k} value={k}>{t(`ue_kind_${k}`)}</option>)}
          </select></label>
        <label className="block col-span-2">{lbl(`${t("ue_incWhat")} *`)}<textarea rows={3} className={inp} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} /></label>
        <label className="block col-span-2">{lbl(t("ue_incWhere"))}<input className={inp} value={f.location} onChange={(e) => set("location", e.target.value)} maxLength={200} /></label>
        <label className="col-span-2 inline-flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={f.offRoad} onChange={(e) => set("offRoad", e.target.checked)} /> {t("ue_incOffRoad")}</label>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold cursor-pointer">{t("cancel")}</button>}
        <AsyncButton onClick={send} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold">{t("ue_incSend")}</AsyncButton>
      </div>
    </div>
  );
}

export default function UnitEventsModal({ car, canEdit, onClose }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [ev, setEv] = useState(null);
  const [nm, setNm] = useState({ startDate: todayWib(), endDate: todayWib(), type: "routine", description: "" });
  const [showInc, setShowInc] = useState(false);
  const load = useCallback(() => { api.fleetCare.events(car.id).then(setEv).catch((e) => toast.error(e.message)); }, [car.id, toast]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { apiCache.invalidate("fleet:"); apiCache.invalidate("schedule:"); load(); };

  async function addMaint() {
    try {
      const r = await api.fleetCare.addMaintenance(car.id, { ...nm, description: nm.description || null });
      toast.success(r.contract ? t("ue_mAddedContract", { c: r.contract }) : t("ue_mAdded"));
      setNm((x) => ({ ...x, description: "" })); changed();
    } catch (e) { toast.error(e.message); }
  }
  const setStatus = async (m, status) => { try { await api.fleetCare.updateMaintenance(m.id, { status }); changed(); } catch (e) { toast.error(e.message); } };
  const remove = async (m) => { if (!confirm(t("ue_mRemove"))) return; try { await api.fleetCare.removeMaintenance(m.id); changed(); } catch (e) { toast.error(e.message); } };
  async function resolve(i) {
    const resolution = prompt(t("ue_incResolvePrompt"));
    if (resolution === null) return;
    try { await api.fleetCare.resolveIncident(i.id, resolution); changed(); } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-4xl max-h-[94vh] overflow-y-auto p-5 sm:p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-lg">{t("ue_title")} · {ev?.car.label || car.name}</h3>
            {ev?.contract && <p className="text-xs text-slate-500">{t("ue_onContract", { c: ev.contract.number })}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        {!ev ? <p className="text-sm text-slate-400">{t("loadingShort")}</p> : <>
          {/* Maintenance schedule */}
          <section className="space-y-2">
            <p className="text-sm font-bold flex items-center gap-1">{t("ue_schedule")} <InfoTip text={t("ue_scheduleHelp")} /></p>
            {canEdit && (
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end rounded-lg border border-slate-200 p-3">
                <label className="block">{lbl(t("ue_from"))}<input type="date" className={inp} value={nm.startDate} onChange={(e) => setNm({ ...nm, startDate: e.target.value, endDate: nm.endDate < e.target.value ? e.target.value : nm.endDate })} /></label>
                <label className="block">{lbl(t("ue_to"))}<input type="date" className={inp} min={nm.startDate} value={nm.endDate} onChange={(e) => setNm({ ...nm, endDate: e.target.value })} /></label>
                <label className="block">{lbl(t("ue_type"))}
                  <select className={inp} value={nm.type} onChange={(e) => setNm({ ...nm, type: e.target.value })}>
                    {["routine", "repair", "inspection"].map((x) => <option key={x} value={x}>{t(`ue_type_${x}`)}</option>)}
                  </select></label>
                <label className="block col-span-2">{lbl(t("ue_desc"))}<input className={inp} value={nm.description} onChange={(e) => setNm({ ...nm, description: e.target.value })} maxLength={1000} /></label>
                <AsyncButton onClick={addMaint} className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold">{t("ue_add")}</AsyncButton>
              </div>
            )}
            {ev.maintenance.length === 0 ? <p className="text-xs text-slate-400">{t("ue_noSchedule")}</p> : (
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                    <th className="px-3 py-2 text-left">{t("ue_when")}</th><th className="px-3 py-2 text-left">{t("ue_type")}</th>
                    <th className="px-3 py-2 text-left">{t("ue_desc")}</th><th className="px-3 py-2 text-left">{t("status")}</th><th className="px-3 py-2" />
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">{ev.maintenance.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtD(m.from)}{m.to !== m.from ? ` – ${fmtD(m.to)}` : ""}</td>
                      <td className="px-3 py-2 text-xs">{t(`ue_type_${m.type}`)}</td>
                      <td className="px-3 py-2 text-xs">{m.description || "-"}</td>
                      <td className="px-3 py-2 text-xs"><span className={`px-1.5 py-0.5 rounded font-semibold ${M_STYLE[m.status] || ""}`}>{t(`ue_m_${m.status}`)}</span></td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
                        {canEdit && m.status === "scheduled" && <>
                          <button onClick={() => setStatus(m, "in_progress")} className="font-semibold text-amber-700 mr-2 cursor-pointer">{t("ue_start")}</button>
                          <button onClick={() => remove(m)} className="text-slate-400 hover:text-red-600 cursor-pointer">{t("delete")}</button>
                        </>}
                        {canEdit && m.status === "in_progress" && <button onClick={() => setStatus(m, "completed")} className="font-semibold text-emerald-700 cursor-pointer">{t("ue_done")}</button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          {/* Emergencies */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">{t("ue_incidents")}</p>
              {!showInc && <button onClick={() => setShowInc(true)} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer">{t("ue_report")}</button>}
            </div>
            {showInc && <div className="rounded-lg border border-red-200 p-3"><IncidentForm cars={[{ id: car.id, label: ev.car.label }]} defaultCarId={car.id} onCancel={() => setShowInc(false)} onDone={() => { setShowInc(false); changed(); }} /></div>}
            {ev.incidents.length === 0 ? <p className="text-xs text-slate-400">{t("ue_noIncidents")}</p> : (
              <ul className="space-y-2">{ev.incidents.map((i) => (
                <li key={i.id} className={`rounded-lg border p-3 text-sm ${i.status === "open" ? "border-red-200 bg-red-50/60" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{t(`ue_kind_${i.kind}`)} {i.offRoad && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white">{t("ue_offRoad")}</span>}</p>
                      <p className="text-xs text-slate-500">{fmtDT(i.reportedAt)}{i.location ? ` · ${i.location}` : ""}</p>
                      <p className="mt-1 whitespace-pre-wrap">{i.description}</p>
                      {i.status === "resolved" && <p className="text-xs text-emerald-700 mt-1">✓ {t("ue_resolved")} {fmtDT(i.resolvedAt)}{i.resolution ? ` — ${i.resolution}` : ""}</p>}
                    </div>
                    {canEdit && i.status === "open" && <button onClick={() => resolve(i)} className="text-xs font-semibold text-emerald-700 whitespace-nowrap cursor-pointer">{t("ue_resolve")}</button>}
                  </div>
                </li>
              ))}</ul>
            )}
          </section>

          {ev.replacements.length > 0 && (
            <section className="space-y-1">
              <p className="text-sm font-bold">{t("ue_replacements")}</p>
              {ev.replacements.map((r) => (
                <p key={r.id} className="text-xs text-slate-600">{fmtD(r.startDate)} – {r.endDate ? fmtD(r.endDate) : "…"} · {r.originalCarId === car.id ? t("ue_repBy") : t("ue_repFor")} · {t(`ue_reason_${r.reason}`)} {r.status === "ended" ? `(${t("ue_ended")})` : ""}</p>
              ))}
            </section>
          )}
        </>}
      </div>
    </div>
  );
}
