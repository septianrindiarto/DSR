// ─── Aplikasi Driver (/driver) — mobile-first, installable (PWA) ────────────
// Today's & upcoming assignments → Mulai (odometer, BBM, photos, GPS) →
// Selesai (same) → order status follows (confirmed→active→completed).
// "Catat biaya" sends BBM/tol/parkir with a receipt photo to finance.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../components/Toast";
import OpsEntryModal from "../components/ops/OpsEntryModal";
import { IncidentForm } from "../components/fleet/UnitEventsModal";

import AsyncButton from "../components/AsyncButton";
const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;
const fmt = (d, withTime = false) => (d ? new Date(d).toLocaleString("id-ID", { weekday: "short", day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "-");
const inp = "w-full px-3 py-3 border border-slate-300 rounded-xl text-base bg-white";

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 8000, maximumAge: 60000 });
  });
}

export default function DriverApp() {
  const { t } = useLanguage();
  const toast = useToast();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [list, setList] = useState(null);
  const [view, setView] = useState("jobs"); // jobs | expense | ops
  const [action, setAction] = useState(null); // { job, phase: start|finish }
  const [sos, setSos] = useState(false);      // emergency report sheet
  const [units, setUnits] = useState([]);     // contract units of this driver
  useEffect(() => {
    api.ops.contracts().then((r) => setUnits((r?.data || []).filter((c) => c.status === "active").flatMap((c) => (c.units || []).filter((u) => u.carId).map((u) => ({ id: u.carId, label: `${u.label} · ${c.contractNumber}` }))))).catch(() => {});
  }, []);
  // Cars the driver may report: contract units + cars of current jobs.
  const sosCars = [...units, ...(list || []).filter((j) => j.carId && j.status !== "completed").map((j) => ({ id: j.carId, label: [j.car, j.plate].filter(Boolean).join(" · ") || j.orderNumber }))]
    .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);

  const load = useCallback(() => {
    api.driverApp.assignments().then((r) => setList(r?.data || [])).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    api.driverApp.me().then(setMe).catch((e) => toast.error(e.message));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = (list || []).filter((j) => j.status !== "completed" || (j.trip && j.trip.status !== "finished"));
  const done = (list || []).filter((j) => !active.includes(j));

  return (
    <div className="min-h-screen bg-slate-100 font-[Inter,sans-serif] text-slate-900">
      <header className="sticky top-0 z-10 bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">{t("drv_hello")}</p>
          <p className="font-bold">{me?.name || "…"}</p>
        </div>
        <button onClick={async () => { await logout(); navigate("/admin/login"); }} className="text-xs text-slate-300 underline cursor-pointer">{t("logout")}</button>
      </header>

      <div className="flex bg-white border-b border-slate-200">
        {["jobs", "expense", "ops"].map((v) => (
          <button key={v} onClick={() => setView(v)} className={`flex-1 py-3 text-sm font-semibold cursor-pointer ${view === v ? "text-primary border-b-2 border-primary" : "text-slate-500"}`}>{v === "ops" ? t("ops_driverTab") : t(`drv_tab_${v}`)}</button>
        ))}
      </div>

      <main className="p-4 space-y-3 max-w-xl mx-auto pb-24">
        {view === "jobs" && (
          !list ? <p className="text-center text-slate-500 py-10">{t("loading")}</p>
            : active.length === 0 && done.length === 0 ? <p className="text-center text-slate-500 py-10">{t("drv_noJobs")}</p>
              : <>
                {active.map((j) => <JobCard key={j.id} job={j} onAction={(phase) => setAction({ job: j, phase })} />)}
                {done.length > 0 && <p className="text-xs font-bold uppercase text-slate-400 pt-3">{t("drv_done")}</p>}
                {done.map((j) => <JobCard key={j.id} job={j} />)}
              </>
        )}
        {view === "expense" && <ExpenseForm jobs={list || []} />}
        {view === "ops" && <DriverOps />}
      </main>

      {action && <TripSheet job={action.job} phase={action.phase} onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />}

      {/* Lapor darurat / kendala (owner 2026-11-13): agency + client notified at once. */}
      {sosCars.length > 0 && !sos && (
        <button onClick={() => setSos(true)} className="fixed bottom-4 right-4 z-20 flex items-center gap-1.5 px-4 py-3 rounded-full bg-red-600 text-white font-bold shadow-lg cursor-pointer">
          <span className="material-symbols-outlined">emergency</span>{t("nt_driverReport")}
        </button>
      )}
      {sos && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setSos(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg text-red-700">{t("nt_driverReport")}</h3>
            <IncidentForm cars={sosCars} onCancel={() => setSos(false)} onDone={() => setSos(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, onAction }) {
  const { t } = useLanguage();
  const trip = job.trip;
  const canStart = onAction && !trip && ["pending", "confirmed", "active"].includes(job.status);
  const canFinish = onAction && trip && trip.status === "started";
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-primary font-bold">{job.orderNumber}</p>
          <p className="font-bold text-lg leading-tight">{job.car || t("drv_carTbd")} {job.plate && <span className="text-sm text-slate-500">· {job.plate}</span>}</p>
        </div>
        <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold uppercase">{t(job.status)}</span>
      </div>
      <p className="text-sm"><span className="material-symbols-outlined text-[16px] align-middle text-slate-400">event</span> {fmt(job.pickupDate)} – {fmt(job.returnDate)} · {job.package || "-"}</p>
      <p className="text-sm"><span className="material-symbols-outlined text-[16px] align-middle text-slate-400">person</span> {job.passenger}{job.company ? ` (${job.company})` : ""}</p>
      {job.pickupLocation && <p className="text-sm"><span className="material-symbols-outlined text-[16px] align-middle text-slate-400">location_on</span> {t("drv_pickup")}: {job.pickupLocation}</p>}
      {job.destination && <p className="text-sm"><span className="material-symbols-outlined text-[16px] align-middle text-slate-400">flag</span> {t("drv_destination")}: {job.destination}</p>}
      {job.contact && (
        <div className="flex gap-2">
          <a href={`tel:${job.contact}`} className="flex-1 text-center py-2 rounded-xl border border-slate-200 text-sm font-medium">{t("drv_call")}</a>
          <a href={`https://wa.me/${String(job.contact).replace(/\D/g, "").replace(/^0/, "62")}`} target="_blank" rel="noreferrer" className="flex-1 text-center py-2 rounded-xl border border-emerald-200 text-emerald-700 text-sm font-medium">WhatsApp</a>
        </div>
      )}
      {trip && (
        <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
          {t("drv_started")}: {fmt(trip.startedAt, true)} · {trip.startOdometer} km
          {trip.endedAt && <> · {t("drv_finished")}: {fmt(trip.endedAt, true)} · {trip.km ?? "-"} km</>}
          {Number(trip.overtimeHoursSuggested) > 0 && <> · {t("drv_overtime", { n: trip.overtimeHoursSuggested })}</>}
        </p>
      )}
      {canStart && <button onClick={() => onAction("start")} className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-bold text-base cursor-pointer">{t("drv_start")}</button>}
      {canFinish && <button onClick={() => onAction("finish")} className="w-full py-3.5 rounded-xl bg-primary text-white font-bold text-base cursor-pointer">{t("drv_finish")}</button>}
    </div>
  );
}

function TripSheet({ job, phase, onClose, onDone }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [odo, setOdo] = useState("");
  const [fuel, setFuel] = useState(4);
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (odo === "") { toast.error(t("drv_needOdo")); return; }
    if (photos.length === 0) { toast.error(t("drv_needPhoto")); return; }
    setBusy(true);
    try {
      const pos = await getPosition();
      const fd = new FormData();
      fd.append("odometer", odo); fd.append("fuel", String(fuel)); if (notes) fd.append("notes", notes);
      if (pos) { fd.append("lat", String(pos.lat)); fd.append("lng", String(pos.lng)); }
      photos.slice(0, 5).forEach((f) => fd.append("photos", f));
      if (phase === "start") await api.driverApp.startTrip(job.id, fd); else await api.driverApp.finishTrip(job.id, fd);
      toast.success(phase === "start" ? t("drv_startedOk") : t("drv_finishedOk"));
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-20 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{phase === "start" ? t("drv_start") : t("drv_finish")} · {job.orderNumber}</h2>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        <label className="block"><span className="block text-sm font-semibold mb-1">{t("drv_odometer")} *</span>
          <input type="number" inputMode="numeric" className={inp} value={odo} onChange={(e) => setOdo(e.target.value)} placeholder="mis. 45210" /></label>
        <div>
          <span className="block text-sm font-semibold mb-1">{t("drv_fuel")}: {fuel}/8</span>
          <input type="range" min="0" max="8" value={fuel} onChange={(e) => setFuel(Number(e.target.value))} className="w-full" />
        </div>
        <label className="block"><span className="block text-sm font-semibold mb-1">{t("drv_photos")} *</span>
          <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setPhotos([...photos, ...Array.from(e.target.files || [])].slice(0, 5))} className="block w-full text-sm" />
          <span className="text-xs text-slate-500">{t("drv_photosHint", { n: photos.length })}</span></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">{t("drv_notes")}</span>
          <textarea className={`${inp} h-20`} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button onClick={submit} disabled={busy} className={`w-full py-4 rounded-xl text-white font-bold text-base cursor-pointer disabled:opacity-60 ${phase === "start" ? "bg-emerald-600" : "bg-primary"}`}>
          {busy ? t("drv_sending") : t("drv_send")}
        </button>
        <p className="text-[11px] text-slate-400 text-center">{t("drv_gpsNote")}</p>
      </div>
    </div>
  );
}

function ExpenseForm({ jobs }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [f, setF] = useState({ type: "bbm", amount: "", orderId: "", note: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const load = () => api.driverApp.expenses().then((r) => setList(r?.data || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function submit() {
    if (!(Number(f.amount) > 0)) { toast.error(t("drv_needAmount")); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v !== "" && fd.append(k, v));
      if (file) fd.append("receipt", file);
      await api.driverApp.addExpense(fd);
      toast.success(t("drv_expenseOk"));
      setF({ type: f.type, amount: "", orderId: f.orderId, note: "" }); setFile(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {["bbm", "tol", "parkir", "lainnya"].map((k) => (
            <button key={k} onClick={() => setF({ ...f, type: k })} className={`py-3 rounded-xl text-sm font-semibold border cursor-pointer ${f.type === k ? "bg-primary text-white border-primary" : "border-slate-200"}`}>{t(`drv_exp_${k}`)}</button>
          ))}
        </div>
        <label className="block"><span className="block text-sm font-semibold mb-1">{t("drv_amount")} *</span>
          <input type="number" inputMode="numeric" className={inp} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0" /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">{t("drv_forJob")}</span>
          <select className={inp} value={f.orderId} onChange={(e) => setF({ ...f, orderId: e.target.value })}>
            <option value="">{t("drv_noJob")}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.orderNumber} · {j.plate || j.car || ""}</option>)}
          </select></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">{t("drv_receipt")}</span>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" /></label>
        <label className="block"><span className="block text-sm font-semibold mb-1">{t("drv_notes")}</span>
          <input className={inp} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t("drv_notePh")} /></label>
        <button onClick={submit} disabled={busy} className="w-full py-4 rounded-xl bg-primary text-white font-bold cursor-pointer disabled:opacity-60">{busy ? t("drv_sending") : t("drv_saveExpense")}</button>
      </div>
      {list.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {list.slice(0, 20).map((x) => (
            <div key={x.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{t(`drv_exp_${x.type}`)} · <span className="text-slate-500">{fmt(x.spentAt, true)}</span>{x.hasReceipt ? " 🧾" : ""}</span>
              <b>{rp(x.amount)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Lembur, SPPD & biaya on monthly contracts (Rekap Operasional & Lembur) ──
// The driver fills SPKL / SPPD / cost forms, keeps them as drafts until ready,
// then "Ajukan". The month view is the driver's own recap.
const OPS_ST = { draft: "bg-slate-200 text-slate-700", submitted: "bg-sky-100 text-sky-700", verified: "bg-indigo-100 text-indigo-700", in_recap: "bg-amber-100 text-amber-800", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", billed: "bg-slate-200 text-slate-700" };
const OPS_ICON = { overtime: "schedule", trip: "flight_takeoff", expense: "receipt" };
function DriverOps() {
  const { t } = useLanguage();
  const toast = useToast();
  const [contracts, setContracts] = useState(null);
  const [rows, setRows] = useState(null);
  const [modal, setModal] = useState(null);
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7));
  const load = useCallback(() => {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    api.ops.list({ from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` }).then((r) => setRows(r.data || [])).catch((e) => toast.error(e.message));
  }, [month, toast]);
  useEffect(() => {
    api.ops.contracts().then((r) => setContracts(r.data || [])).catch((e) => toast.error(e.message));
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  const list = rows || [];
  const drafts = list.filter((e) => e.status === "draft");
  const sum = {
    hours: Math.round(list.filter((e) => e.kind === "overtime" && e.status !== "rejected").reduce((t2, e) => t2 + (e.hours || 0), 0) * 100) / 100,
    tripDays: list.filter((e) => e.kind === "trip" && e.status !== "rejected").reduce((t2, e) => t2 + (e.detail?.calc?.days || 0), 0),
    costs: list.filter((e) => e.kind === "expense" && e.status !== "rejected").reduce((t2, e) => t2 + (e.amount || 0), 0),
  };
  async function submitDrafts() {
    try { const r = await api.ops.submit(drafts.map((e) => e.id)); toast.success(t("ops_submitted", { n: r.submitted })); load(); }
    catch (e) { toast.error(e.message); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">{t("ops_driverHint")}</p>
      <button onClick={() => setModal({})} disabled={!contracts} className="w-full py-3 rounded-xl bg-primary text-white font-bold cursor-pointer disabled:opacity-50">
        <span className="material-symbols-outlined align-middle mr-1">add</span>{t("ops_add")}
      </button>
      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-sm">{t("ops_myMonth")}</p>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-2 py-1 border border-slate-200 rounded-lg text-sm" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-2"><p className="text-[11px] text-slate-500">{t("ops_kind_overtime")}</p><p className="font-black">{sum.hours} {t("ops_hoursShort")}</p></div>
          <div className="rounded-xl bg-slate-50 p-2"><p className="text-[11px] text-slate-500">{t("ops_kind_trip")}</p><p className="font-black">{sum.tripDays} {t("ops_daysShort")}</p></div>
          <div className="rounded-xl bg-slate-50 p-2"><p className="text-[11px] text-slate-500">{t("ops_kind_expense")}</p><p className="font-black text-sm">{rp(sum.costs)}</p></div>
        </div>
        {drafts.length > 0 && (
          <AsyncButton onClick={submitDrafts} className="w-full py-2 rounded-xl border border-primary text-primary font-semibold text-sm cursor-pointer">
            {t("ops_submitDrafts")} ({t("ops_myDrafts", { n: drafts.length })})
          </AsyncButton>
        )}
      </div>
      {!rows ? <p className="text-center text-slate-500 py-6">{t("loading")}</p> : list.length === 0 ? <p className="text-center text-slate-500 py-6">{t("ops_none")}</p> : list.map((e) => (
        <div key={e.id} className="bg-white rounded-2xl border border-slate-200 p-3 flex gap-3 cursor-pointer" onClick={() => setModal(e)}>
          <span className="material-symbols-outlined text-primary">{OPS_ICON[e.kind] || "receipt"}</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{e.code && <span className="font-mono text-primary mr-1">{e.code}</span>}{t(`ops_type_${e.type}`)} · {new Date(`${e.entryDate}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}</p>
            <p className="text-xs text-slate-500">
              {e.kind === "overtime" ? `${e.startTime || ""}–${e.endTime || ""} · ${e.hours ?? 0} ${t("ops_hoursShort")}` : ""}
              {e.kind === "trip" ? `${e.detail?.destinationCity || "-"} · ${e.detail?.calc?.days || 0} ${t("ops_daysShort")}` : ""}
              {e.kind === "expense" ? rp(e.amount) : ""}
            </p>
            <p className="text-xs text-slate-400">{e.plate || e.carName || ""} · {e.evidence.length} {t("ops_evidence").toLowerCase()}</p>
            {e.status === "rejected" && e.rejectReason && <p className="text-xs text-red-600">{t("ops_rejectedBecause", { r: e.rejectReason })}</p>}
          </div>
          <span className={`self-start px-2 py-0.5 rounded-full text-[11px] font-bold ${OPS_ST[e.status] || ""}`}>{t(`ops_st_${e.status}`)}</span>
        </div>
      ))}
      {modal && contracts && <OpsEntryModal contracts={contracts} isDriver initial={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
    </div>
  );
}
