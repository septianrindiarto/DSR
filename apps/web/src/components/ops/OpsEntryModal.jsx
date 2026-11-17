// ─── OpsEntryModal — SPKL (lembur), SPPD (perjalanan dinas) or a cost ───────
// Used by Kontrak & Perusahaan → Lembur & Operasional (agency, client) and the
// driver app. Layout follows the client's paper forms (Form LEMBUR DRIVER,
// Form SPPD). "Simpan draf" keeps it private to the writer; "Ajukan" sends it
// to the agency for checking. Hours / allowance are previewed with the
// contract policy (lib/ops.js = copy of the server rules); the server
// recomputes and stores the real values.
import { useMemo, useRef, useState } from "react";
import { api, apiCache } from "../../lib/api";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../Toast";
import { dayTypeOf, spklComputeDays, tripCompute, EXPENSE_TYPES, lodgingClaimed, hhmm } from "../../lib/ops";
import TimeInput24 from "../TimeInput24";
import InfoTip from "../InfoTip";

const inp = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white";
const sm = "w-full px-2 py-1.5 border border-slate-200 rounded-md text-sm bg-white";
const ro = "w-full px-3 py-2 border border-slate-100 rounded-lg text-sm bg-slate-50 font-mono tabular-nums text-slate-700";
const lbl = (s) => <span className="block text-xs font-semibold text-slate-600 mb-1">{s}</span>;
const todayWib = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const num = (v) => (v === "" || v == null ? "" : Number(v));
/** "YYYY-MM-DD" → "Jumat, 13 November 2026" (owner 2026-11-13). */
const longDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
function datesBetween(a, b) {
  if (!a || !b || b < a) return a ? [a] : [];
  const out = []; let t = Date.parse(`${a}T00:00:00Z`); const end = Date.parse(`${b}T00:00:00Z`);
  while (t <= end && out.length < 62) { out.push(new Date(t).toISOString().slice(0, 10)); t += 86400000; }
  return out;
}
const minToHM = (m) => (m ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` : "");
const hmToMin = (s) => { const [h, m] = String(s || "").split(":").map(Number); return (Number(h) || 0) * 60 + (Number(m) || 0); };
const COSTS = ["bbm", "tol", "parkir", "makan", "lainnya"];

const emptyRow = (date = "") => ({ date, dayType: "", start: "", end: "", wait: "", location: "", description: "" });
const emptyLeg = () => ({ arrivedAt: "", date: "", lodging: false });
const emptyORow = (date = "", kmStart = "") => ({ date, kmStart, kmEnd: "", bbm: "", tol: "", parkir: "", makan: "", lainnya: "", note: "" });
const toRow = (r, fallbackDate) => ({ ...emptyRow(fallbackDate), ...r, date: r.date || fallbackDate, dayType: r.dayType || "", wait: minToHM(Number(r.waitMinutes) || 0) });

// readOnly: view a locked form (e.g. the client looking at L001) + leave feedback.
// inline: rendered inside a page (Kontrak & Perusahaan → Form → Lembur/…), not as a modal.
// fixedKind: the form type is set by the submenu ('overtime' | 'trip' | 'expense').
export default function OpsEntryModal({ contracts, initial = null, isDriver = false, readOnly = false, inline = false, fixedKind = null, onClose, onSaved }) {
  const { t } = useLanguage();
  const toast = useToast();
  const editing = !!initial?.id;
  const active = contracts.filter((c) => c.status === "active" || (editing && c.id === initial.contractId));
  const d = initial?.detail || {};
  // Older single-cost forms (BBM / Tol … one amount) stay editable in their old shape.
  const legacyExpense = initial?.kind === "expense" && initial.type !== "operasional";
  const [f, setF] = useState(() => {
    const start = d.startDate || initial?.entryDate || todayWib();
    return {
      contractId: initial?.contractId || (active.length === 1 ? active[0].id : ""),
      contractUnitId: initial?.contractUnitId || "",
      kind: initial?.kind || fixedKind || "overtime",
      type: legacyExpense ? initial.type : "bbm",
      entryDate: initial?.entryDate || todayWib(),
      startDate: start, endDate: d.endDate || initial?.entryDate || todayWib(),
      amount: legacyExpense ? initial.amount ?? "" : "", note: initial?.note || "",
      // Lembur
      location: d.location || "",
      rows: d.rows?.length && initial?.kind === "overtime" ? d.rows.map((r) => toRow(r, start))
        : initial?.startTime ? [toRow({ start: initial.startTime, end: initial.endTime, dayType: initial.dayType }, start)] : [emptyRow(start)],
      // Perjalanan dinas
      destinationCity: d.destinationCity || "", taskLocation: d.taskLocation || "",
      departDate: d.departDate || todayWib(), returnDate: d.returnDate || todayWib(), userName: d.userName || "", sector: d.sector || "",
      legs: d.legs?.length ? d.legs.map((l) => ({ ...emptyLeg(), ...l })) : [emptyLeg()],
      // Operasional
      oRows: initial?.kind === "expense" && d.rows?.length ? d.rows.map((r) => ({ ...emptyORow(), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ""])) })) : [emptyORow(start)],
    };
  });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (i, k, v) => setF((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const setLeg = (i, k, v) => setF((x) => ({ ...x, legs: x.legs.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const setO = (i, k, v) => setF((x) => ({ ...x, oRows: x.oRows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const contract = active.find((c) => String(c.id) === String(f.contractId));
  const units = contract?.units || [];
  const unitId = f.contractUnitId || (units.length === 1 ? units[0].id : "");
  const unit = units.find((u) => String(u.id) === String(unitId));
  const holidays = useMemo(() => new Set(contract?.holidays || []), [contract]);
  const range = useMemo(() => datesBetween(f.startDate, f.endDate), [f.startDate, f.endDate]);
  const autoDay = (date) => dayTypeOf(date, holidays);
  const isOps = f.kind === "expense" && !legacyExpense;

  const spkl = useMemo(() => (f.kind === "overtime" ? spklComputeDays({
    rows: f.rows.map((r) => ({ date: r.date, dayType: r.dayType || dayTypeOf(r.date, holidays), start: r.start, end: r.end, waitMinutes: hmToMin(r.wait) })),
    workStart: contract?.workStart, workEnd: contract?.workEnd, policy: contract?.policy,
  }) : null), [f.kind, f.rows, contract, holidays]);
  const trip = useMemo(() => (f.kind === "trip" ? tripCompute({ departDate: f.departDate, returnDate: f.returnDate, legs: f.legs, policy: contract?.policy }) : null), [f.kind, f.departDate, f.returnDate, f.legs, contract]);
  const ops = useMemo(() => {
    if (!isOps) return null;
    const totals = Object.fromEntries(COSTS.map((k) => [k, f.oRows.reduce((s, r) => s + (Number(r[k]) || 0), 0)]));
    const withKm = f.oRows.filter((r) => r.kmStart !== "" && r.kmEnd !== "");
    return {
      totals, total: COSTS.reduce((s, k) => s + totals[k], 0),
      kmStart: withKm.length ? withKm[0].kmStart : "", kmEnd: withKm.length ? withKm[withKm.length - 1].kmEnd : "",
      totalKm: withKm.reduce((s, r) => s + Math.max(0, Number(r.kmEnd) - Number(r.kmStart)), 0),
    };
  }, [isOps, f.oRows]);
  const editable = !readOnly && (!editing || ["draft", "submitted", "rejected", "verified"].includes(initial.status));

  // Header dates move → rows outside the new range snap to the start date.
  function setRange(k, v) {
    setF((x) => {
      const next = { ...x, [k]: v };
      if (k === "startDate" && (!next.endDate || next.endDate < v)) next.endDate = v;
      const inR = (dt) => dt && dt >= next.startDate && dt <= next.endDate;
      next.rows = x.rows.map((r) => (inR(r.date) ? r : { ...r, date: next.startDate }));
      next.oRows = x.oRows.map((r) => (inR(r.date) ? r : { ...r, date: next.startDate }));
      return next;
    });
  }
  function addRow() {
    const last = f.rows[f.rows.length - 1];
    set("rows", [...f.rows, emptyRow(last?.date || f.startDate)]);
  }
  function addORow() {
    const last = f.oRows[f.oRows.length - 1];
    const next = last?.date ? range[range.indexOf(last.date) + 1] || last.date : f.startDate;
    set("oRows", [...f.oRows, emptyORow(next, last?.kmEnd ?? "")]);
  }

  async function save(status) {
    setBusy(true);
    try {
      const detail = f.kind === "overtime"
        ? { startDate: f.startDate, endDate: f.endDate, location: f.location, rows: f.rows.map((r) => ({ date: r.date, dayType: r.dayType || "", start: r.start, end: r.end, waitMinutes: hmToMin(r.wait), location: r.location, description: r.description })) }
        : f.kind === "trip"
          ? { destinationCity: f.destinationCity, taskLocation: f.taskLocation, departDate: f.departDate, returnDate: f.returnDate, userName: f.userName, sector: f.sector, legs: f.legs }
          : isOps ? { startDate: f.startDate, endDate: f.endDate, rows: f.oRows.map((r) => ({ ...r, kmStart: num(r.kmStart), kmEnd: num(r.kmEnd), ...Object.fromEntries(COSTS.map((k) => [k, Number(r[k]) || 0])) })) }
            : undefined;
      const body = {
        contractId: f.contractId, contractUnitId: unitId, kind: f.kind,
        entryDate: f.kind === "trip" ? f.departDate : (f.kind === "overtime" || isOps) ? f.startDate : f.entryDate, note: f.note || null, status,
        ...(legacyExpense ? { type: f.type, amount: f.amount } : {}),
        ...(detail ? { detail } : {}),
      };
      if (editing) {
        await api.ops.update(initial.id, body);
        if (files.length) { const fd = new FormData(); files.forEach((x) => fd.append("files", x)); await api.ops.addEvidence(initial.id, fd); }
      } else {
        const fd = new FormData();
        Object.entries(body).forEach(([k, v]) => {
          if (v === null || v === undefined || v === "") return;
          fd.append(k, typeof v === "object" ? JSON.stringify(v) : v);
        });
        files.forEach((x) => fd.append("files", x));
        await api.ops.create(fd);
      }
      apiCache.invalidate("ops:");
      toast.success(status === "draft" ? t("ops_draftSaved") : t("ops_saved"));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  const KINDS = [["overtime", "schedule", "ops_form_spkl"], ["trip", "flight_takeoff", "ops_form_sppd"], ["expense", "receipt", "ops_o_title"]];
  // Row date: one-line box "Jumat, 13 November 2026" that opens the calendar (limited to start–end).
  const dateSelect = (value, onChange) => <RowDate value={value} min={f.startDate} max={f.endDate} bad={!!value && !range.includes(value)} onChange={onChange} />;
  const lineOf = (r) => spkl?.lines.find((x) => x.date === r.date && x.start === r.start && x.end === r.end);
  const waitPct = contract?.policy?.overtime?.waitingPct;

  return (
    <div className={inline ? "" : "fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4"} onClick={inline ? undefined : onClose}>
      <div className={inline ? "bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-4 max-w-6xl mx-auto" : "bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full max-w-5xl max-h-[94vh] overflow-y-auto p-5 sm:p-6 space-y-4"} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">{readOnly ? `${t("ops_viewEntry")}${initial?.code ? ` ${initial.code}` : ""}` : editing ? `${t("ops_editEntry")}${initial?.code ? ` ${initial.code}` : ""}` : fixedKind ? t(KINDS.find((k) => k[0] === fixedKind)?.[2] || "ops_newEntry") : t("ops_newEntry")}{editing && initial.status === "draft" && <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[11px]">{t("ops_st_draft")}</span>}</h3>
          {!inline && <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>}
        </div>
        {active.length === 0 ? <p className="text-sm text-slate-500">{t("ops_noContracts")}</p> : (
          <>
          <fieldset disabled={readOnly} className="space-y-4 min-w-0">
            {!fixedKind && <div className="grid grid-cols-3 gap-2">
              {KINDS.map(([k, icon, label]) => (
                <button key={k} type="button" disabled={editing} onClick={() => set("kind", k)}
                  className={`py-2 rounded-lg border text-xs sm:text-sm font-semibold ${f.kind === k ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200"} disabled:opacity-70`}>
                  <span className="material-symbols-outlined text-[18px] align-middle mr-1">{icon}</span>{t(label)}
                </button>
              ))}
            </div>}

            {/* ── Header: kontrak · unit · (period) ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="block col-span-2 lg:col-span-1">{lbl(`${t("ops_contract")} *`)}
                <select className={inp} value={f.contractId} disabled={editing} onChange={(e) => setF((x) => ({ ...x, contractId: e.target.value, contractUnitId: "" }))}>
                  <option value="">{t("ops_pickContract")}</option>
                  {active.map((c) => <option key={c.id} value={c.id}>{c.contractNumber} · {c.clientName}</option>)}
                </select></label>
              <label className="block col-span-2 lg:col-span-1">{lbl(`${t("ops_unit")} *`)}
                <select className={inp} value={unitId} onChange={(e) => set("contractUnitId", e.target.value)} disabled={!contract}>
                  <option value="">{t("ops_pickUnit")}</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.label}{u.driverName ? ` · ${u.driverName}` : ""}</option>)}
                </select></label>
              {(f.kind === "overtime" || isOps) && <>
                <label className="block">{lbl(`${t("ops_startDate")} *`)}<input type="date" className={inp} max={todayWib()} min={contract?.startDate} value={f.startDate} onChange={(e) => setRange("startDate", e.target.value)} /></label>
                <label className="block">{lbl(`${t("ops_endDate")} *`)}<input type="date" className={inp} max={todayWib()} min={f.startDate} value={f.endDate} onChange={(e) => setRange("endDate", e.target.value)} /></label>
              </>}
            </div>
            {contract?.extrasMode === "none" && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{t("ops_notBillable")}</p>}

            {/* ── Form lembur ── */}
            {f.kind === "overtime" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                  <label className="block col-span-2">{lbl(t("ops_spkl_location"))}<input className={inp} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={t("ops_spkl_locationPh")} /></label>
                  <div className="block">{lbl(<span className="inline-flex items-center gap-1">{t("ops_spkl_totalRO")} <InfoTip text={t("ops_spkl_totalHelp")} /></span>)}
                    <input readOnly tabIndex={-1} className={ro} value={spkl ? `${hhmm(spkl.hours)} ${t("ops_hoursShort")}` : "00:00"} /></div>
                  <p className="text-[11px] text-slate-500 pb-2">{t("ops_spkl_workHours", { ws: contract?.workStart || "08:00", we: contract?.workEnd || "17:00" })}</p>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{t("ops_spkl_report")}</div>
                  <table className="w-full text-sm min-w-[980px]">
                    <thead className="text-[11px] text-slate-500 text-left"><tr>
                      <th className="px-2 py-1.5 w-[215px]">{t("ops_rowDate")}</th>
                      <th className="px-2 py-1.5 w-[150px]">{t("ops_dayType")}</th>
                      <th className="px-2 py-1.5 w-[84px]">{t("ops_start")}</th>
                      <th className="px-2 py-1.5 w-[84px]">{t("ops_end")}</th>
                      <th className="px-2 py-1.5 w-[84px]">{t("ops_spkl_wait")}</th>
                      <th className="px-2 py-1.5">{t("ops_spkl_rowLocation")}</th>
                      <th className="px-2 py-1.5">{t("ops_spkl_desc")}</th>
                      <th className="w-8" />
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {f.rows.map((r, i) => {
                        const ln = r.start && r.end ? lineOf(r) : null;
                        return (
                          <tr key={i} className="align-top">
                            <td className="px-2 py-1.5">{dateSelect(r.date, (v) => setRow(i, "date", v))}</td>
                            <td className="px-2 py-1.5">
                              <select className={sm} value={r.dayType} onChange={(e) => setRow(i, "dayType", e.target.value)}>
                                <option value="">{t(`ops_day_${autoDay(r.date)}`)} ({t("ops_auto")})</option>
                                {["workday", "restday", "holiday"].map((x) => <option key={x} value={x}>{t(`ops_day_${x}`)}</option>)}
                              </select></td>
                            <td className="px-2 py-1.5"><TimeInput24 className={sm} value={r.start} onChange={(v) => setRow(i, "start", v)} /></td>
                            <td className="px-2 py-1.5"><TimeInput24 className={sm} value={r.end} onChange={(v) => setRow(i, "end", v)} /></td>
                            <td className="px-2 py-1.5"><TimeInput24 className={sm} value={r.wait} onChange={(v) => setRow(i, "wait", v)} /></td>
                            <td className="px-2 py-1.5"><input className={sm} value={r.location} onChange={(e) => setRow(i, "location", e.target.value)} /></td>
                            <td className="px-2 py-1.5"><input className={sm} value={r.description} onChange={(e) => setRow(i, "description", e.target.value)} placeholder={t("ops_spkl_descPh")} />
                              {ln && <p className="text-[11px] text-slate-500 mt-0.5">{t("ops_spkl_rowCalc", { ot: fmtMin(ln.overtimeMinutes), drive: fmtMin(ln.driveMinutes) })}</p>}</td>
                            <td className="px-1 py-1.5 text-right">
                              {f.rows.length > 1 && <button type="button" onClick={() => set("rows", f.rows.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button type="button" onClick={addRow} className="w-full py-2 text-xs font-semibold text-primary hover:bg-primary-light cursor-pointer border-t border-slate-100">+ {t("ops_spkl_addRow")}</button>
                </div>
                {spkl && spkl.overtimeMinutes > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-emerald-800">{t("ops_spkl_sumOt")}</p>
                      {spkl.byMult.length ? spkl.byMult.map((x) => (
                        <p key={x.mult} className="font-mono tabular-nums text-sm text-emerald-900">{hhmm(x.hours)} <span className="text-emerald-700">× {String(x.mult).replace(".", ",")}</span></p>
                      )) : <p className="font-mono text-sm text-emerald-900">{hhmm(spkl.driveHours)}</p>}
                    </div>
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-sky-800">{t("ops_spkl_sumWait")}</p>
                      <p className="font-mono tabular-nums text-sm text-sky-900">{hhmm(spkl.waitHours)}{waitPct != null && <span className="text-sky-700"> × {waitPct}% </span>}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-700">{t("ops_spkl_sumTotal")}</p>
                      <p className="font-mono tabular-nums text-sm font-bold text-slate-900">{hhmm(spkl.hours)}</p>
                      {!isDriver && spkl.method !== "none" && spkl.amount > 0 && <p className="text-xs text-slate-600">{t("ops_spkl_pay")}: <b>{rp(spkl.amount)}</b></p>}
                    </div>
                    {(isDriver ? spkl.warnings.filter((w) => !w.includes("Rp0")) : spkl.warnings).map((w) => <p key={w} className="sm:col-span-3 text-xs text-amber-700">⚠ {w}</p>)}
                  </div>
                )}
              </div>
            )}

            {/* ── Perjalanan dinas ── */}
            {f.kind === "trip" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <label className="block">{lbl(`${t("ops_sppd_depart")} *`)}<input type="date" max={todayWib()} className={inp} value={f.departDate} onChange={(e) => set("departDate", e.target.value)} /></label>
                  <label className="block">{lbl(`${t("ops_sppd_return")} *`)}<input type="date" min={f.departDate} className={inp} value={f.returnDate} onChange={(e) => set("returnDate", e.target.value)} /></label>
                  <label className="block">{lbl(`${t("ops_sppd_city")} *`)}<input className={inp} value={f.destinationCity} onChange={(e) => set("destinationCity", e.target.value)} placeholder="Jakarta" /></label>
                  <label className="block">{lbl(t("ops_sppd_taskLocation"))}<input className={inp} value={f.taskLocation} onChange={(e) => set("taskLocation", e.target.value)} placeholder={t("ops_sppd_taskLocationPh")} /></label>
                  <label className="block">{lbl(t("ops_sppd_user"))}<input className={inp} value={f.userName} onChange={(e) => set("userName", e.target.value)} placeholder={t("ops_sppd_userPh")} /></label>
                  <label className="block">{lbl(t("ops_sppd_sector"))}<input className={inp} value={f.sector} onChange={(e) => set("sector", e.target.value)} /></label>
                  <p className="col-span-2 text-xs text-slate-500 self-end pb-2">{t("ops_sppd_vehicle")}: <b>{unit?.label || "-"}</b>{trip ? ` · ${t("ops_sppd_days", { n: trip.days })}` : ""}</p>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{t("ops_sppd_legs")}</div>
                  <div className="divide-y divide-slate-100">
                    {f.legs.map((l, i) => (
                      <div key={i} className="p-3 grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                        <label className="block sm:col-span-5">{lbl(t("ops_sppd_arrivedAt"))}<input className={sm} value={l.arrivedAt} onChange={(e) => setLeg(i, "arrivedAt", e.target.value)} placeholder="Cawang" /></label>
                        <label className="block sm:col-span-3">{lbl(t("ops_date"))}<input type="date" className={sm} min={f.departDate} max={f.returnDate} value={l.date} onChange={(e) => setLeg(i, "date", e.target.value)} /></label>
                        <label className="col-span-2 sm:col-span-3 inline-flex items-center gap-2 text-sm cursor-pointer pb-2">
                          <input type="checkbox" checked={lodgingClaimed(l.lodging)} onChange={(e) => setLeg(i, "lodging", e.target.checked)} /> {t("ops_sppd_lodging")}
                        </label>
                        <div className="sm:col-span-1 text-right">
                          {f.legs.length > 1 && <button type="button" onClick={() => set("legs", f.legs.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => set("legs", [...f.legs, emptyLeg()])} className="w-full py-2 text-xs font-semibold text-primary hover:bg-primary-light cursor-pointer">+ {t("ops_sppd_addLeg")}</button>
                </div>
                {trip && trip.amount > 0 && (
                  <p className="rounded-lg bg-emerald-50 text-emerald-900 px-3 py-2 text-xs">{t("ops_sppd_calc", { n: trip.days, daily: rp(trip.dailyAllowance), lodging: rp(trip.lodging), total: rp(trip.amount) })}</p>
                )}
              </div>
            )}

            {/* ── Operasional: header km + day rows with a column per cost ── */}
            {isOps && ops && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                  <div>{lbl(t("ops_o_kmStart"))}<input readOnly tabIndex={-1} className={ro} value={ops.kmStart === "" ? "-" : Number(ops.kmStart).toLocaleString("id-ID")} /></div>
                  <div>{lbl(t("ops_o_kmEnd"))}<input readOnly tabIndex={-1} className={ro} value={ops.kmEnd === "" ? "-" : Number(ops.kmEnd).toLocaleString("id-ID")} /></div>
                  <div>{lbl(t("ops_o_totalKm"))}<input readOnly tabIndex={-1} className={ro} value={`${ops.totalKm.toLocaleString("id-ID")} km`} /></div>
                  <div>{lbl(t("ops_o_total"))}<input readOnly tabIndex={-1} className={`${ro} font-bold`} value={rp(ops.total)} /></div>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 flex items-center gap-1">{t("ops_o_rows")} <InfoTip text={t("ops_o_help")} /></div>
                  <table className="w-full text-sm min-w-[1060px]">
                    <thead className="text-[11px] text-slate-500 text-left"><tr>
                      <th className="px-2 py-1.5 w-[215px]">{t("ops_rowDate")}</th>
                      <th className="px-2 py-1.5 w-[100px]">{t("ops_o_kmStart")}</th>
                      <th className="px-2 py-1.5 w-[100px]">{t("ops_o_kmEnd")}</th>
                      {COSTS.map((k) => <th key={k} className="px-2 py-1.5 w-[105px]">{t(`ops_o_${k}`)}</th>)}
                      <th className="px-2 py-1.5">{t("ops_o_note")}</th>
                      <th className="w-8" />
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {f.oRows.map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5">{dateSelect(r.date, (v) => setO(i, "date", v))}</td>
                          <td className="px-2 py-1.5"><input type="number" min="0" className={sm} value={r.kmStart} onChange={(e) => setO(i, "kmStart", e.target.value)} /></td>
                          <td className="px-2 py-1.5"><input type="number" min="0" className={`${sm} ${r.kmEnd !== "" && r.kmStart !== "" && Number(r.kmEnd) < Number(r.kmStart) ? "border-red-400" : ""}`} value={r.kmEnd} onChange={(e) => setO(i, "kmEnd", e.target.value)} /></td>
                          {COSTS.map((k) => <td key={k} className="px-2 py-1.5"><input type="number" min="0" className={sm} value={r[k]} onChange={(e) => setO(i, k, e.target.value)} placeholder="0" /></td>)}
                          <td className="px-2 py-1.5"><input className={sm} value={r.note} onChange={(e) => setO(i, "note", e.target.value)} /></td>
                          <td className="px-1 py-1.5 text-right">
                            {f.oRows.length > 1 && <button type="button" onClick={() => set("oRows", f.oRows.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 text-xs font-semibold text-slate-700"><tr>
                      <td className="px-2 py-1.5">{t("ops_o_sum")}</td>
                      <td className="px-2 py-1.5" colSpan={2}>{ops.totalKm.toLocaleString("id-ID")} km</td>
                      {COSTS.map((k) => <td key={k} className="px-2 py-1.5 font-mono tabular-nums">{rp(ops.totals[k])}</td>)}
                      <td className="px-2 py-1.5 font-mono tabular-nums font-bold" colSpan={2}>{rp(ops.total)}</td>
                    </tr></tfoot>
                  </table>
                  <button type="button" onClick={addORow} className="w-full py-2 text-xs font-semibold text-primary hover:bg-primary-light cursor-pointer border-t border-slate-100">+ {t("ops_o_addRow")}</button>
                </div>
                {(d.warnings || []).map((w) => <p key={w} className="text-xs text-amber-700">⚠ {w}</p>)}
              </div>
            )}

            {/* ── Older single-cost form ── */}
            {legacyExpense && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <p className="col-span-2 lg:col-span-4 text-xs text-slate-500">{t("ops_o_legacy")}</p>
                <label className="block">{lbl(`${t("ops_date")} *`)}<input type="date" className={inp} max={todayWib()} value={f.entryDate} onChange={(e) => set("entryDate", e.target.value)} /></label>
                <label className="block">{lbl(`${t("ops_type")} *`)}
                  <select className={inp} value={f.type} onChange={(e) => set("type", e.target.value)}>
                    {EXPENSE_TYPES.map((x) => <option key={x} value={x}>{t(`ops_type_${x}`)}</option>)}
                  </select></label>
                <label className="block col-span-2">{lbl(`${t("ops_amount")} *`)}<input type="number" min="0" className={inp} value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="Rp" /></label>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="block">{lbl(t("ops_note"))}<textarea rows={2} className={inp} value={f.note} onChange={(e) => set("note", e.target.value)} maxLength={500} /></label>
              <label className="block">{lbl(editing ? t("ops_addFiles") : t("ops_files"))}
                <input type="file" multiple accept="image/*,application/pdf" capture={isDriver ? "environment" : undefined}
                  className="block w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary-light file:text-primary file:font-semibold"
                  onChange={(e) => setFiles([...e.target.files].slice(0, 10))} />
                <span className="block text-[11px] text-slate-400 mt-1">{f.kind === "overtime" ? t("ops_filesHintSpkl") : t("ops_filesHintAny")}</span>
              </label>
            </div>
          </fieldset>
            {editing && <EntryComments entry={initial} />}
            {editable && (
              <div className="flex justify-end gap-2 pt-1 flex-wrap">
                <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold cursor-pointer">{t("cancel")}</button>
                {(!editing || initial.status === "draft") && (
                  <button type="button" onClick={() => save("draft")} disabled={busy || !f.contractId || !unitId}
                    className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-sm font-semibold disabled:opacity-50 cursor-pointer">{t("ops_saveDraft")}</button>
                )}
                <button type="button" onClick={() => save("submitted")} disabled={busy || !f.contractId || !unitId}
                  className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-50 cursor-pointer">{!editing || initial.status === "draft" ? t("ops_submit") : t("ops_save")}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Same height as the other row fields: the visible box shows the long date, the
// native date input underneath only supplies the calendar (min / max respected).
function RowDate({ value, min, max, bad, onChange }) {
  const ref = useRef(null);
  const open = () => {
    const el = ref.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  return (
    <div className="relative">
      <button type="button" onClick={open}
        className={`${sm} flex items-center justify-between gap-1 text-left cursor-pointer disabled:cursor-default ${bad ? "border-red-400 text-red-700" : ""}`}>
        <span className="truncate text-[13px]">{value ? longDate(value) : "—"}</span>
        <span className="material-symbols-outlined text-[16px] text-slate-400 shrink-0">calendar_month</span>
      </button>
      <input ref={ref} type="date" tabIndex={-1} aria-hidden="true" value={value || ""} min={min} max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="absolute inset-x-0 bottom-0 h-px w-full opacity-0 pointer-events-none" />
    </div>
  );
}

function fmtMin(m) {
  const n = Math.max(0, Number(m) || 0);
  const h = Math.floor(n / 60), mm = n % 60;
  return h && mm ? `${h}j ${mm}m` : h ? `${h}j` : `${mm}m`;
}

// Feedback thread on a form — agency, client and driver (owner 2026-11-13).
function EntryComments({ entry }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [list, setList] = useState(entry.comments || []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try { const r = await api.ops.comment(entry.id, text.trim()); setList(r.comments || []); setText(""); apiCache.invalidate("ops:"); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  const sideLabel = (sd) => (sd === "client" ? t("ctw_side_client") : sd === "driver" ? "Driver" : t("ctw_side_agency"));
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{t("ops_comments")}</div>
      <div className="p-3 space-y-2">
        {list.length === 0 && <p className="text-xs text-slate-400">{t("ops_noComments")}</p>}
        {list.map((c, i) => (
          <div key={i} className="text-sm">
            <p className="text-[11px] text-slate-500"><b className="text-slate-700">{c.by}</b> · {sideLabel(c.side)} · {new Date(c.at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</p>
            <p className="whitespace-pre-wrap">{c.text}</p>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={t("ops_commentPh")}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button type="button" onClick={send} disabled={busy || !text.trim()} className="self-end px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer">{t("ops_send")}</button>
        </div>
      </div>
    </div>
  );
}
