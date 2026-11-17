// ─── Kontrak — long-term corporate contracts (monthly / yearly) ─────────────
// Workflow (2026-11-05): agency OR client drafts a contract → each side lists
// the documents it requires from the other (penawaran, kontrak tender, akta…)
// → the other side uploads, the requester approves → BOTH sides approve →
// the contract becomes Aktif → lembur & operasional, monthly billing (M code).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api, apiCache } from "../lib/api";
import { can } from "../lib/permissions";
import { Btn, Note, Section, Empty } from "../components/books/shared";
import { policyOf, hourlyRateOf, SAMPLE_POLICY } from "../lib/ops";
import InfoTip, { LabelTip } from "../components/InfoTip";
import { PACKAGE_OPTIONS } from "../lib/booking-options";
import TimeInput24 from "../components/TimeInput24";
import MonthlyCodes from "../components/contracts/MonthlyCodes";
import AsyncButton from "../components/AsyncButton";

const inp = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100";
const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;
const fmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const STATUS_STYLE = { draft: "bg-slate-100 text-slate-600", active: "bg-emerald-100 text-emerald-700", ended: "bg-amber-100 text-amber-700", terminated: "bg-red-100 text-red-700" };
const INCLUDES = ["driver", "fuel", "maintenance", "insurance", "replacement"];

// embedded: rendered inside Kontrak & Perusahaan (no layout / page title).
export default function AdminContracts({ embedded = false, openContractId = null }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const isClient = user?.accountType === "client";
  const canCreate = can(user, "contracts", "create");
  const [status, setStatus] = useState("");
  const [list, setList] = useState(null);
  // Workspace: { id } = existing contract, { id: null } = new. Tabs inside.
  const [ws, setWs] = useState(openContractId ? { id: openContractId } : null);
  const Wrap = embedded ? Fragment : AdminLayout;
  const load = () => api.contracts.list(status).then((r) => setList(r?.data || [])).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setList(null); load(); }, [status]);

  return (
    <Wrap>
      <div className={`flex items-end gap-3 mb-4 flex-wrap ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("ct_title")}</h1>
          <p className="text-slate-500 text-sm mt-1">{isClient ? t("ct_subtitleClient") : t("ct_subtitle")}</p>
        </div>}
        <div className="flex gap-2">
          <select className={`${inp} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("ct_allStatus")}</option>
            {["draft", "active", "ended", "terminated"].map((s) => <option key={s} value={s}>{t(`ct_st_${s}`)}</option>)}
          </select>
          {canCreate && <Btn variant="primary" icon="add" onClick={() => setWs({ id: null })}>{t("ct_new")}</Btn>}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        {!list ? <Empty>{t("loading")}</Empty> : list.length === 0 ? <Empty>{t("ct_empty")}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                <th className="px-3 py-2 text-left">{t("ct_number")}</th><th className="px-3 py-2 text-left">{isClient ? t("ctw_agency") : t("ct_client")}</th>
                <th className="px-3 py-2 text-left">{t("ct_period")}</th><th className="px-3 py-2 text-right">{t("ct_units")}</th>
                <th className="px-3 py-2 text-right">{t("ct_monthly")}</th><th className="px-3 py-2 text-left">{t("ct_lastBilled")}</th>
                <th className="px-3 py-2 text-center">{t("ctw_steps_docs")}</th>
                <th className="px-3 py-2 text-center">{t("status")}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((c) => (
                  <tr key={c.id} onClick={() => setWs({ id: c.id })} className="hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-2 font-mono text-xs text-primary font-bold">{c.contractNumber}<div className="font-sans text-slate-500 font-normal">{c.title || ""}</div></td>
                    <td className="px-3 py-2">{isClient ? c.agencyName : c.clientName}</td>
                    <td className="px-3 py-2 text-xs">{fmt(c.startDate)} – {fmt(c.endDate)}
                      {c.status === "active" && c.daysLeft <= 60 && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold">{t("ct_daysLeft", { n: c.daysLeft })}</span>}</td>
                    <td className="px-3 py-2 text-right">{c.unitCount}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(c.monthlyTotal)}</td>
                    <td className="px-3 py-2 text-xs">{c.lastBilled || "-"}</td>
                    <td className="px-3 py-2 text-center text-xs">{c.docsTotal ? `${c.docsApproved}/${c.docsTotal}` : "-"}
                      {c.docsForMe > 0 && <div><span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">{t("ctw_needAction", { n: c.docsForMe })}</span></div>}</td>
                    <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[c.status]}`}>{t(`ct_st_${c.status}`)}</span>
                      {c.status === "draft" && <div className="text-[10px] text-slate-500 mt-0.5">{t("ctw_side_agency")} {c.agencyApprovedAt ? "✓" : "…"} · {t("ctw_side_client")} {c.clientApprovedAt ? "✓" : "…"}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {ws && <ContractWorkspace key={ws.id || "new"} id={ws.id} isClient={isClient} onClose={() => setWs(null)} onChanged={load} />}
    </Wrap>
  );
}

function ContractForm({ initial, isClient, readOnly = false, onSaved, onDraft }) {
  const { t } = useLanguage();
  const toast = useToast();
  const editing = !!initial.id;
  const [companies, setCompanies] = useState([]);
  const [cars, setCars] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [agencies, setAgencies] = useState([]);
  // active: terms agreed → only cars/drivers, title, notes. readOnly: no edit right.
  const locked = readOnly || (editing && initial.status && initial.status !== "draft");
  // New contracts start EMPTY (owner 2026-11-06): placeholders only show samples;
  // empty fields can be saved but block approval (server lists what is missing).
  const v = (x) => (x === null || x === undefined ? "" : x);
  const [f, setF] = useState(() => ({
    clientOrgId: v(initial.clientOrgId), agencyOrgId: v(initial.agencyOrgId),
    contractNumber: v(initial.contractNumber), title: v(initial.title),
    startDate: v(initial.startDate), endDate: v(initial.endDate), billingDay: v(initial.billingDay),
    package: v(initial.package), kmAllowanceMonth: v(initial.kmAllowanceMonth), excessKmRate: v(initial.excessKmRate),
    includes: initial.includes || {}, notes: v(initial.notes),
    cutoffDay: v(initial.cutoffDay), workStart: v(initial.workStart), workEnd: v(initial.workEnd),
    opsPolicy: policyOf(initial.opsPolicy),
    units: (initial.units || []).map((u) => ({ id: u.id, carId: u.carId || "", driverId: u.driverId || "", monthlyFee: u.monthlyFee, startDate: u.startDate || "", endDate: u.endDate || "", notes: u.notes || "" })),
  }));
  const [busy, setBusy] = useState(false);
  // Live draft for the Ringkasan tab (no save needed to preview). `dirty` =
  // differs from what is stored, so approval waits until it is saved.
  const [baseline] = useState(() => JSON.stringify(f));
  useEffect(() => {
    if (!onDraft) return;
    const carLabel = (id) => { const c = cars.find((x) => String(x.id) === String(id)); return c ? `${c.brand || ""} ${c.name || ""}`.trim() + (c.licensePlate ? ` · ${c.licensePlate}` : "") : null; };
    const drvName = (id) => drivers.find((x) => String(x.id) === String(id))?.name || null;
    onDraft({ ...f, units: f.units.map((u) => ({ ...u, carLabel: u.carId ? carLabel(u.carId) : null, driverName: u.driverId ? drvName(u.driverId) : null })) }, JSON.stringify(f) !== baseline);
  }, [f, cars, drivers, baseline, onDraft]);
  useEffect(() => {
    if (isClient) {
      api.myOrg.myAgencies().then((r) => setAgencies((r?.data || []).filter((a) => a.status === "active"))).catch(() => {});
      return;
    }
    api.companies.list("limit=1000").then((r) => setCompanies(Array.isArray(r) ? r : (r?.data || []))).catch(() => {});
    api.cars.list("limit=500&page=1").then((r) => setCars(r?.data || [])).catch(() => {});
    api.drivers.list("limit=500&page=1").then((r) => setDrivers(r?.data || [])).catch(() => {});
  }, [isClient]);
  const set = (k, val) => setF((x) => ({ ...x, [k]: val }));
  const setPolicy = (group, patch) => setF((x) => ({ ...x, opsPolicy: { ...x.opsPolicy, [group]: { ...x.opsPolicy[group], ...patch } } }));
  const n = (val) => (val === "" || val === null || val === undefined ? null : Number(val));
  const setUnit = (i, k, val) => setF((x) => ({ ...x, units: x.units.map((u, j) => (j === i ? { ...u, [k]: val } : u)) }));
  const total = f.units.reduce((sum, u) => sum + (Number(u.monthlyFee) || 0), 0);
  async function save() {
    setBusy(true);
    try {
      const body = {
        ...f, clientOrgId: isClient ? null : Number(f.clientOrgId), agencyOrgId: isClient && !editing ? Number(f.agencyOrgId) : undefined,
        billingDay: n(f.billingDay), kmAllowanceMonth: n(f.kmAllowanceMonth), excessKmRate: n(f.excessKmRate),
        contractNumber: f.contractNumber || null, package: f.package || null, cutoffDay: n(f.cutoffDay),
        workStart: f.workStart || null, workEnd: f.workEnd || null,
        units: f.units.map((u) => ({ id: u.id || null, carId: u.carId ? Number(u.carId) : null, driverId: u.driverId ? Number(u.driverId) : null, monthlyFee: Number(u.monthlyFee) || 0, startDate: u.startDate || null, endDate: u.endDate || null, notes: u.notes || null })),
      };
      const c = editing ? await api.contracts.update(initial.id, body) : await api.contracts.create(body);
      apiCache.invalidate("contracts:");
      toast.success(t("ct_saved")); onSaved(c);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
      <div className="space-y-5">
        {locked && !readOnly && <Note tone="warn">{t("ctw_lockedActive")}</Note>}

        <FormSection title={t("ctf_sec_parties")}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isClient ? (
              <Field k={t("ctw_agency")} req tip={t("ctf_tip_agency")}>
                <select className={inp} value={f.agencyOrgId} onChange={(e) => set("agencyOrgId", e.target.value)} disabled={editing}>
                  <option value="">{t("ctw_pickAgency")}</option>{agencies.map((a) => <option key={a.agencyOrgId} value={a.agencyOrgId}>{a.agencyName}</option>)}
                </select>
                {!editing && agencies.length === 0 && <span className="text-[11px] text-amber-700">{t("ctw_noAgency")}</span>}
              </Field>
            ) : (
              <Field k={t("ct_client")} req>
                <select className={inp} value={f.clientOrgId} onChange={(e) => set("clientOrgId", e.target.value)} disabled={locked}>
                  <option value="">{t("prc_corp_pick")}</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            <Field k={t("ct_number")} tip={t("ctf_tip_number")}><input className={inp} value={f.contractNumber} onChange={(e) => set("contractNumber", e.target.value)} placeholder={t("ct_numberAuto")} /></Field>
            <Field k={t("ct_titleField")}><input className={inp} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={t("ctf_ph", { v: "Operasional cabang Bandung" })} /></Field>
            <Field k={t("paket")} req tip={t("ctf_tip_package")}>
              <input className={inp} value={f.package} onChange={(e) => set("package", e.target.value)} list="ct-pkg" placeholder={t("ctf_ph", { v: "Lepas Kunci" })} disabled={locked} />
              <datalist id="ct-pkg">{PACKAGE_OPTIONS.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field k={t("ct_start")} req><input type="date" className={inp} value={f.startDate} onChange={(e) => set("startDate", e.target.value)} disabled={locked} /></Field>
              <Field k={t("ct_end")} req><input type="date" className={inp} value={f.endDate} onChange={(e) => set("endDate", e.target.value)} disabled={locked} /></Field>
            </div>
            <Field k={t("ct_billingDay")} req tip={t("ctf_tip_billingDay")}><input type="number" min="1" max="28" className={inp} value={f.billingDay} onChange={(e) => set("billingDay", e.target.value)} placeholder={t("ctf_ph", { v: "25" })} disabled={locked} /></Field>
          </div>
        </FormSection>

        <FormSection title={t("ctf_sec_km")}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field k={t("ct_kmAllowance")} tip={t("ctf_tip_km")}><input type="number" min="0" className={inp} value={f.kmAllowanceMonth} onChange={(e) => set("kmAllowanceMonth", e.target.value)} placeholder={t("ctf_ph", { v: "3000" })} disabled={locked} /></Field>
            <Field k={t("ct_excessRate")} tip={t("ctf_tip_excess")}><input type="number" min="0" className={inp} value={f.excessKmRate} onChange={(e) => set("excessKmRate", e.target.value)} placeholder={t("ctf_ph", { v: "2000" })} disabled={locked} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm mt-4">
            <span className="flex items-center gap-1 text-xs font-semibold text-slate-600">{t("ct_includes")} <InfoTip text={t("ctf_tip_includes")} size={14} /></span>
            {INCLUDES.map((k) => (
              <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!f.includes[k]} disabled={locked} onChange={(e) => set("includes", { ...f.includes, [k]: e.target.checked })} /> {t(`ct_inc_${k}`)}
              </label>
            ))}
          </div>
        </FormSection>

        <FormSection title={t("ctf_sec_hours")}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field k={t("ct_cutoffDay")} tip={t("ctf_tip_cutoff")}>
              <select className={inp} value={f.cutoffDay} onChange={(e) => set("cutoffDay", e.target.value)} disabled={locked}>
                <option value="">{t("ct_cutoffEom")}</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field k={t("ct_workStart")} req={f.opsPolicy.overtime.enabled} tip={t("ctf_tip_workHours")}><TimeInput24 className={inp} value={f.workStart} onChange={(v) => set("workStart", v)} disabled={locked} placeholder="08:00" /></Field>
            <Field k={t("ct_workEnd")} req={f.opsPolicy.overtime.enabled}><TimeInput24 className={inp} value={f.workEnd} onChange={(v) => set("workEnd", v)} disabled={locked} placeholder="17:00" /></Field>
          </div>
        </FormSection>

        {/* Owner 2026-11-09: a contract may follow the agency default (Pengaturan →
            Lembur & Perjalanan Dinas) instead of its own terms. */}
        <FormSection title={t("ctf_policySource")} tip={t("ctf_tip_policySource")}>
          <div className="flex flex-wrap gap-4 text-sm">
            {["own", "default"].map((src) => (
              <label key={src} className="inline-flex items-center gap-2 cursor-pointer">
                <input type="radio" name="policySource" checked={(f.opsPolicy.source || "own") === src} disabled={locked}
                  onChange={() => setF((x) => ({ ...x, opsPolicy: { ...x.opsPolicy, source: src } }))} />
                {t(`ctf_policySource_${src}`)}
              </label>
            ))}
          </div>
          {f.opsPolicy.source === "default" && (
            <p className="text-xs text-slate-500 mt-2">{t("ctf_policyDefaultNote")}
              {initial.opsPolicyEffective?.source === "default" && <> · {policySummary(initial.opsPolicyEffective, t)}</>}
            </p>
          )}
        </FormSection>
        {f.opsPolicy.source !== "default" && <>
          <OvertimeMatrix policy={f.opsPolicy} setPolicy={setPolicy} locked={locked} />
          <TripPolicy policy={f.opsPolicy} setPolicy={setPolicy} locked={locked} />
        </>}

        <FormSection title={t("ct_pol_sign")} tip={t("ctf_tip_sign")}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[["approverTitle", "Fungsi Umum"], ["knowerTitle", "User"], ["executorTitle", "Pengemudi"], ["approverName", "Budi Santoso"], ["approverPosition", "Manager GA"], ["city", "Bandung"]].map(([k, sample]) => (
              <Field key={k} k={t(`ct_pol_${k}`)}><input className={inp} value={f.opsPolicy.sign[k] || ""} onChange={(e) => setPolicy("sign", { [k]: e.target.value })} placeholder={t("ctf_ph", { v: sample })} disabled={locked} /></Field>
            ))}
          </div>
        </FormSection>

        <FormSection title={<>{t("ct_units")} <span className="text-xs text-slate-500 font-normal">· {t("ct_monthly")} {rp(total)}</span></>} tip={t("ct_unitDatesHint")}
          action={!locked && <Btn icon="add" onClick={() => set("units", [...f.units, { carId: "", driverId: "", monthlyFee: "", startDate: "", endDate: "", notes: "" }])}>{t("ct_addUnit")}</Btn>}>
          {f.units.length === 0 ? <p className="text-xs text-slate-400">{t("ct_noUnits")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr className="text-left">
                  <th className="py-1 pr-2 font-semibold">{t("ctw_unitNeed")}</th>
                  {!isClient && <th className="py-1 pr-2 font-semibold">{t("car")}</th>}
                  {!isClient && <th className="py-1 pr-2 font-semibold">{t("driver")}</th>}
                  <th className="py-1 pr-2 font-semibold">{t("ct_fee")} *</th>
                  <th className="py-1 pr-2 font-semibold">{t("ct_unitStart")}</th>
                  <th className="py-1 pr-2 font-semibold">{t("ct_unitEnd")}</th><th></th>
                </tr></thead>
                <tbody>
                  {f.units.map((u, i) => (
                    <tr key={u.id || `n${i}`} className="align-top">
                      <td className="py-1 pr-2 min-w-[180px]"><input className={inp} value={u.notes} onChange={(e) => setUnit(i, "notes", e.target.value)} placeholder={t("ctf_ph", { v: "MPV + driver, Jakarta" })} disabled={locked && isClient} /></td>
                      {!isClient && <td className="py-1 pr-2 min-w-[180px]"><select className={inp} value={u.carId} onChange={(e) => setUnit(i, "carId", e.target.value)}>
                        <option value="">{t("ct_pickCar")}</option>{cars.map((c) => <option key={c.id} value={c.id}>{c.licensePlate || "-"} · {c.brand} {c.name}</option>)}</select></td>}
                      {!isClient && <td className="py-1 pr-2 min-w-[150px]"><select className={inp} value={u.driverId} onChange={(e) => setUnit(i, "driverId", e.target.value)}>
                        <option value="">{t("ct_noDriver")}</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>}
                      <td className="py-1 pr-2 min-w-[130px]"><input type="number" min="0" className={`${inp} text-right`} value={u.monthlyFee} onChange={(e) => setUnit(i, "monthlyFee", e.target.value)} placeholder={t("ctf_ph", { v: "9000000" })} disabled={locked} /></td>
                      <td className="py-1 pr-2 min-w-[140px]"><input type="date" className={inp} value={u.startDate} onChange={(e) => setUnit(i, "startDate", e.target.value)} disabled={locked} /></td>
                      <td className="py-1 pr-2 min-w-[140px]"><input type="date" className={inp} value={u.endDate} onChange={(e) => setUnit(i, "endDate", e.target.value)} disabled={locked} /></td>
                      <td className="py-1">{!locked && <button onClick={() => set("units", f.units.filter((_, j) => j !== i))} className="p-2 text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>

        <Field k={t("ct_notes")}><textarea className={`${inp} h-20`} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        {!readOnly && (
          <div className="sticky bottom-0 -mx-5 md:-mx-6 px-5 md:px-6 py-3 bg-white/95 border-t border-slate-200 flex justify-end items-center gap-2">
            <span className="text-[11px] text-slate-400 mr-auto">{t("ctf_saveHint")}</span>
            <Btn variant="primary" icon="save" onClick={save} disabled={busy || (isClient ? !f.agencyOrgId : !f.clientOrgId) || !f.startDate || !f.endDate}>{editing ? t("save") : t("ctf_saveNext")}</Btn>
          </div>
        )}
      </div>
  );
}

// Label (+ required star + ⓘ) above an input — module level so inputs keep focus.
function Field({ k, tip, req, children }) {
  return <div><LabelTip tip={tip} required={req}>{k}</LabelTip>{children}</div>;
}

function FormSection({ title, tip, action, children }) {
  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1">{title}{tip && <InfoTip text={tip} size={15} />}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const DAY_ROWS = ["workday", "restday", "holiday"];

/** One-line summary of a policy's rates (agency default note). */
function policySummary(p, t) {
  const r = hourlyRateOf(p);
  const parts = [];
  parts.push(p.overtime.enabled ? `${t("ctf_sumOvertime")} ${r != null ? rp(Math.round(r)) + "/j" : "—"}` : t("ctf_sumNoOvertime"));
  parts.push(p.trip.enabled ? `${t("ctf_sumTrip")} ${rp(p.trip.dailyAllowance)}/hr · ${rp(p.trip.lodgingPerNight)}/mlm` : t("ctf_sumNoTrip"));
  return parts.join(" · ");
}
const cellInp = "w-full px-2 py-1.5 border border-slate-200 rounded-md text-sm bg-white text-right disabled:bg-slate-100";

// Overtime matrix: the contract's own rate, tiers per day type, rounding bands,
// waiting and break rules — no built-in formula (lib/ops.js spklCompute).
export function OvertimeMatrix({ policy, setPolicy, locked }) {
  const { t } = useLanguage();
  const o = policy.overtime;
  const num = (val) => (val === "" ? null : Number(val));
  const upd = (patch) => setPolicy("overtime", patch);
  const setTier = (day, i, k, val) => upd({ tiers: { ...o.tiers, [day]: o.tiers[day].map((x, j) => (j === i ? { ...x, [k]: num(val) } : x)) } });
  const addTier = (day) => {
    const last = o.tiers[day][o.tiers[day].length - 1];
    upd({ tiers: { ...o.tiers, [day]: [...o.tiers[day], { from: last ? (last.to ?? last.from + 1) : 0, to: null, mult: null }] } });
  };
  const delTier = (day, i) => upd({ tiers: { ...o.tiers, [day]: o.tiers[day].filter((_, j) => j !== i) } });
  const setBand = (i, k, val) => upd({ rounding: o.rounding.map((b, j) => (j === i ? { ...b, [k]: num(val) } : b)) });
  const hourly = hourlyRateOf(policy);
  // Every recommendation / reset keeps a snapshot so it can be undone (one step).
  const [undo, setUndo] = useState(null);
  const applyWithUndo = (patch, label) => { setUndo({ prev: o, label }); upd(patch); };
  function useSample() {
    applyWithUndo({ ...SAMPLE_POLICY.overtime, enabled: true, hourlyRate: o.hourlyRate, baseSalary: o.baseSalary }, t("ctf_useSample"));
  }
  function clearMatrix() {
    if (!confirm(t("ctf_clearConfirm"))) return;
    applyWithUndo({ ...policyOf({}).overtime, enabled: true }, t("ctf_clear"));
  }
  return (
    <FormSection title={t("ctf_sec_overtime")} tip={t("ctf_tip_overtime")}
      action={<label className="inline-flex items-center gap-2 text-sm font-semibold cursor-pointer"><input type="checkbox" checked={o.enabled} disabled={locked} onChange={(e) => upd({ enabled: e.target.checked })} /> {t("ctf_overtimeOn")}</label>}>
      {!o.enabled ? <p className="text-xs text-slate-400">{t("ctf_overtimeOff")}</p> : (
        <div className="space-y-5">
          {!locked && (
            <div className="flex justify-end items-center gap-2 flex-wrap">
              {undo && (
                <span className="mr-auto inline-flex items-center gap-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-1.5 text-xs text-sky-800">
                  {t("ctf_applied", { what: undo.label })}
                  <button type="button" onClick={() => { upd(undo.prev); setUndo(null); }} className="font-bold underline cursor-pointer">{t("ctf_undo")}</button>
                </span>
              )}
              <Btn icon="auto_fix_high" onClick={useSample}>{t("ctf_useSample")}</Btn>
              <Btn icon="restart_alt" onClick={clearMatrix}>{t("ctf_clear")}</Btn>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><LabelTip tip={t("ctf_tip_hourly")}>{t("ctf_hourlyRate")}</LabelTip>
              <input type="number" min="0" className={inp} value={o.hourlyRate ?? ""} onChange={(e) => upd({ hourlyRate: num(e.target.value) })} placeholder={t("ctf_ph", { v: "25000" })} disabled={locked} /></div>
            <div><LabelTip tip={t("ctf_tip_salary")}>{t("ct_pol_base")}</LabelTip>
              <input type="number" min="0" className={inp} value={o.baseSalary ?? ""} onChange={(e) => upd({ baseSalary: num(e.target.value) })} placeholder={t("ctf_ph", { v: "4500000" })} disabled={locked || o.hourlyRate != null} /></div>
            <div><LabelTip tip={t("ctf_tip_divisor")}>{t("ct_pol_divisor")}</LabelTip>
              <input type="number" min="1" className={inp} value={o.divisor ?? ""} onChange={(e) => upd({ divisor: num(e.target.value) })} placeholder={t("ctf_rec", { v: "173" })} disabled={locked || o.hourlyRate != null} />
              <span className="text-[11px] text-slate-500">{t("ct_pol_hourly", { v: hourly != null ? rp(hourly) : "—" })}</span></div>
          </div>

          <div>
            <p className="flex items-center gap-1 text-xs font-bold text-slate-700 mb-2">{t("ctf_tiers")} <InfoTip text={t("ctf_tip_tiers")} size={14} /></p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {DAY_ROWS.map((day) => (
                <div key={day} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-600 mb-2">{t(`ctf_day_${day}`)} *</p>
                  {o.tiers[day].length === 0 && <p className="text-[11px] text-slate-400 mb-1">{t("ctf_noTier")}</p>}
                  {o.tiers[day].length > 0 && <table className="w-full text-xs">
                    <thead className="text-slate-500"><tr><th className="text-left font-medium">{t("ctf_fromH")}</th><th className="text-left font-medium">{t("ctf_toH")}</th><th className="text-left font-medium">{t("ctf_mult")}</th><th></th></tr></thead>
                    <tbody>
                      {o.tiers[day].map((x, i) => (
                        <tr key={i}>
                          <td className="pr-1 py-0.5"><input type="number" min="0" step="0.5" className={cellInp} value={x.from ?? ""} onChange={(e) => setTier(day, i, "from", e.target.value)} disabled={locked} /></td>
                          <td className="pr-1 py-0.5"><input type="number" min="0" step="0.5" className={cellInp} value={x.to ?? ""} onChange={(e) => setTier(day, i, "to", e.target.value)} placeholder="∞" disabled={locked} /></td>
                          <td className="pr-1 py-0.5"><input type="number" min="0" step="0.05" className={cellInp} value={x.mult ?? ""} onChange={(e) => setTier(day, i, "mult", e.target.value)} placeholder="×" disabled={locked} /></td>
                          <td>{!locked && <button onClick={() => delTier(day, i)} className="text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[16px]">close</span></button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>}
                  {!locked && <button onClick={() => addTier(day)} className="mt-1 text-xs font-semibold text-primary cursor-pointer">+ {t("ctf_addTier")}</button>}
                  {o.tiers[day].length === 0 && (
                    <div className="mt-3 rounded-md bg-slate-50 border border-dashed border-slate-200 px-2 py-1.5 text-[11px] text-slate-500">
                      {t("ctf_recommend")}: {SAMPLE_POLICY.overtime.tiers[day].map((x) => `jam ${x.from}–${x.to ?? "∞"} ×${String(x.mult).replace(".", ",")}`).join(" | ")}
                      {!locked && <button type="button" onClick={() => applyWithUndo({ tiers: { ...o.tiers, [day]: SAMPLE_POLICY.overtime.tiers[day] } }, `${t("ctf_recommend")} · ${t(`ctf_day_${day}`)}`)} className="ml-2 font-semibold text-primary cursor-pointer">{t("ctf_apply")}</button>}
                    </div>
                  )}

                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="flex items-center gap-1 text-xs font-bold text-slate-700 mb-2">{t("ctf_rounding")} <InfoTip text={t("ctf_tip_rounding")} size={14} /></p>
              {o.rounding.length === 0 ? <p className="text-[11px] text-slate-400 mb-1">{t("ctf_roundingExact")}</p>               : (
                <table className="w-full text-xs">
                  <thead className="text-slate-500"><tr><th className="text-left font-medium">{t("ctf_minFrom")}</th><th className="text-left font-medium">{t("ctf_minTo")}</th><th className="text-left font-medium">{t("ctf_roundTo")}</th><th></th></tr></thead>
                  <tbody>{o.rounding.map((b, i) => (
                    <tr key={i}>
                      <td className="pr-1 py-0.5"><input type="number" min="0" max="59" className={cellInp} value={b.from ?? ""} onChange={(e) => setBand(i, "from", e.target.value)} disabled={locked} /></td>
                      <td className="pr-1 py-0.5"><input type="number" min="0" max="59" className={cellInp} value={b.to ?? ""} onChange={(e) => setBand(i, "to", e.target.value)} disabled={locked} /></td>
                      <td className="pr-1 py-0.5"><input type="number" min="0" max="1" step="0.25" className={cellInp} value={b.hours ?? ""} onChange={(e) => setBand(i, "hours", e.target.value)} disabled={locked} /></td>
                      <td>{!locked && <button onClick={() => upd({ rounding: o.rounding.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[16px]">close</span></button>}</td>
                    </tr>))}
                  </tbody>
                </table>
              )}
              {!locked && <button onClick={() => upd({ rounding: [...o.rounding, { from: null, to: null, hours: null }] })} className="mt-1 text-xs font-semibold text-primary cursor-pointer">+ {t("ctf_addBand")}</button>}
              {o.rounding.length === 0 && (
                <div className="mt-3 rounded-md bg-slate-50 border border-dashed border-slate-200 px-2 py-1.5 text-[11px] text-slate-500">
                  {t("ctf_recommend")}: {SAMPLE_POLICY.overtime.rounding.map((b) => `${b.from}–${b.to} mnt = ${String(b.hours).replace(".", ",")} jam`).join(" | ")}
                  {!locked && <button type="button" onClick={() => applyWithUndo({ rounding: SAMPLE_POLICY.overtime.rounding }, `${t("ctf_recommend")} · ${t("ctf_rounding")}`)} className="ml-2 font-semibold text-primary cursor-pointer">{t("ctf_apply")}</button>}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 p-3 grid grid-cols-2 gap-3">
              <div><LabelTip required tip={t("ctf_tip_waitPct")}>{t("ct_pol_waitPct")}</LabelTip>
                <input type="number" min="0" max="100" className={inp} value={o.waitingPct ?? ""} onChange={(e) => upd({ waitingPct: num(e.target.value) })} placeholder={t("ctf_ph", { v: "30" })} disabled={locked} /></div>
              <div><LabelTip tip={t("ctf_tip_waitRate")}>{t("ctf_waitRate")}</LabelTip>
                <input type="number" min="0" className={inp} value={o.waitingRate ?? ""} onChange={(e) => upd({ waitingRate: num(e.target.value) })} placeholder={hourly != null ? String(Math.round(hourly)) : t("ctf_ph", { v: "25000" })} disabled={locked} /></div>
              <div><LabelTip tip={t("ctf_tip_break")}>{t("ctf_breakEvery")}</LabelTip>
                <input type="number" min="0" className={inp} value={o.breakEvery ?? ""} onChange={(e) => upd({ breakEvery: num(e.target.value) })} placeholder={t("ctf_ph", { v: "5" })} disabled={locked} /></div>
              <div><LabelTip>{t("ctf_breakHours")}</LabelTip>
                <input type="number" min="0" step="0.5" className={inp} value={o.breakHours ?? ""} onChange={(e) => upd({ breakHours: num(e.target.value) })} placeholder={t("ctf_ph", { v: "1" })} disabled={locked} /></div>
              <div><LabelTip tip={t("ctf_tip_max")}>{t("ctf_maxWorkday")}</LabelTip>
                <input type="number" min="0" className={inp} value={o.maxWorkday ?? ""} onChange={(e) => upd({ maxWorkday: num(e.target.value) })} placeholder={t("ctf_ph", { v: "4" })} disabled={locked} /></div>
              <div><LabelTip>{t("ctf_maxHoliday")}</LabelTip>
                <input type="number" min="0" className={inp} value={o.maxHoliday ?? ""} onChange={(e) => upd({ maxHoliday: num(e.target.value) })} placeholder={t("ctf_ph", { v: "12" })} disabled={locked} /></div>
            </div>
          </div>
        </div>
      )}
    </FormSection>
  );
}

export function TripPolicy({ policy, setPolicy, locked }) {
  const { t } = useLanguage();
  const tr = policy.trip;
  const num = (val) => (val === "" ? null : Number(val));
  return (
    <FormSection title={t("ctf_sec_trip")} tip={t("ctf_tip_trip")}
      action={<label className="inline-flex items-center gap-2 text-sm font-semibold cursor-pointer"><input type="checkbox" checked={tr.enabled} disabled={locked} onChange={(e) => setPolicy("trip", { enabled: e.target.checked })} /> {t("ctf_tripOn")}</label>}>
      {!tr.enabled ? <p className="text-xs text-slate-400">{t("ctf_tripOff")}</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><LabelTip required tip={t("ctf_tip_daily")}>{t("ct_pol_daily")}</LabelTip>
            <input type="number" min="0" className={inp} value={tr.dailyAllowance ?? ""} onChange={(e) => setPolicy("trip", { dailyAllowance: num(e.target.value) })} placeholder={t("ctf_ph", { v: "65000" })} disabled={locked} /></div>
          <div><LabelTip required tip={t("ctf_tip_lodging")}>{t("ct_pol_lodging")}</LabelTip>
            <input type="number" min="0" className={inp} value={tr.lodgingPerNight ?? ""} onChange={(e) => setPolicy("trip", { lodgingPerNight: num(e.target.value) })} placeholder={t("ctf_ph", { v: "200000" })} disabled={locked} /></div>
        </div>
      )}
    </FormSection>
  );
}

// Stored contract + unsaved form values → what the summary shows.
function mergeDraft(c, d) {
  if (!d) return c;
  const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return {
    ...c,
    title: d.title || null, contractNumber: d.contractNumber || c.contractNumber, startDate: d.startDate || null, endDate: d.endDate || null,
    billingDay: n(d.billingDay), package: d.package || null, kmAllowanceMonth: n(d.kmAllowanceMonth), excessKmRate: n(d.excessKmRate),
    includes: d.includes || {}, cutoffDay: n(d.cutoffDay), workStart: d.workStart || null, workEnd: d.workEnd || null,
    opsPolicy: d.opsPolicy,
    units: d.units.map((u) => ({ ...u, monthlyFee: Number(u.monthlyFee) || 0 })),
  };
}

const firstOfNextMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10); };

// ─── Contract workspace (owner 2026-11-06) ──────────────────────────────────
// One window, four tabs that follow the contract's life:
//   1 Ketentuan  – the terms (editable while Draf; read-only otherwise)
//   2 Dokumen    – required documents both ways (upload / review)
//   3 Ringkasan  – read-only summary for the approver + approval
//   4 Penagihan  – only once Aktif: monthly billing (M code) & history
// Tabs are free to click; a ✓ shows when that part is complete.
export function ContractWorkspace({ id: initialId, isClient, onClose, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = can(user, "contracts", "edit");
  const canCreate = can(user, "contracts", "create");
  const [id, setId] = useState(initialId);
  const [c, setC] = useState(null);
  const [tab, setTab] = useState("terms");
  const [draft, setDraft] = useState({ values: null, dirty: false });
  const onDraft = useCallback((values, dirty) => setDraft({ values, dirty }), []);
  // What the other tabs show: stored contract overlaid with unsaved edits.
  const view = useMemo(() => (c ? mergeDraft(c, draft.values) : null), [c, draft.values]);
  const load = (cid = id) => cid && api.contracts.get(cid).then(setC).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);
  const changed = (x) => { setC(x); onChanged(); };
  // Amendment (owner 2026-11-13): a new draft copy; the old contract runs until it is approved.
  async function amend() {
    if (!confirm(t("am_confirm"))) return;
    const start = prompt(t("am_start"), firstOfNextMonth());
    if (start === null) return;
    try { const a = await api.contracts.amend(c.id, start || undefined); onChanged(); setId(a.id); setTab("terms"); }
    catch (e) { toast.error(e.message); }
  }
  const [stopDate, setStopDate] = useState("");
  async function stopOld() {
    try {
      const x = await api.contracts.supersede(c.id, stopDate || c.mustStop.suggestedEnd);
      toast.success(t("am_stopped", { old: c.mustStop.oldNumber, d: stopDate || c.mustStop.suggestedEnd }));
      changed(x);
    } catch (e) { toast.error(e.message); }
  }

  const units = view?.units || [];
  const docs = c?.documents || [];
  const termsOk = !!view && units.length > 0 && units.every((u) => u.monthlyFee > 0) && !!view.billingDay && !!view.package;
  const docsOk = !!c && docs.every((d) => !d.mandatory || d.status === "approved");
  const approved = !!c && (c.status !== "draft" || (c.agencyApprovedAt && c.clientApprovedAt));
  const running = c && c.status !== "draft";
  const tabs = [
    { k: "terms", done: termsOk },
    { k: "docs", done: c && docsOk, disabled: !id },
    { k: "summary", done: approved, disabled: !id },
    ...(running ? [{ k: "billing" }] : []),
  ];
  const editable = !c ? canCreate : canEdit && (c.status === "draft" || (!isClient && c.status === "active"));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 md:p-6" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 md:px-6 pt-4 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold truncate">
                {c ? c.contractNumber : t("ct_new")}
                {c && <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold align-middle ${STATUS_STYLE[c.status]}`}>{t(`ct_st_${c.status}`)}</span>}
              </h2>
              {c && <p className="text-sm text-slate-500 truncate">{t("ctw_parties", { agency: c.agencyName, client: c.clientName })}</p>}
              {c?.amendsContract && (
                <button type="button" onClick={() => { setId(c.amendsContract.id); setTab("terms"); }} className="text-xs text-indigo-700 font-semibold hover:underline cursor-pointer">
                  {t("am_of", { n: c.amendsContract.contractNumber })} →
                </button>)}
              {c?.amendments?.length > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">{t("am_list")}: {c.amendments.map((a) => (
                  <button key={a.id} type="button" onClick={() => { setId(a.id); setTab("terms"); }} className="mr-2 font-mono text-indigo-700 hover:underline cursor-pointer">{a.contractNumber} ({t(`ct_st_${a.status}`)})</button>
                ))}</p>)}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {c?.status === "active" && canEdit && !c.amendments?.some((a) => a.status === "draft") && (
                <Btn icon="edit_document" onClick={amend}>{t("am_btn")}</Btn>)}
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
            </div>
          </div>
          <div className="flex gap-1 mt-3 overflow-x-auto no-scrollbar">
            {tabs.map((x, i) => (
              <button key={x.k} type="button" disabled={x.disabled} onClick={() => setTab(x.k)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${tab === x.k ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${x.done ? "bg-emerald-500 text-white" : tab === x.k ? "bg-primary text-white" : "bg-slate-200 text-slate-600"}`}>{x.done ? "✓" : i + 1}</span>
                {t(`ctx_tab_${x.k}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-5">
          {/* Ketentuan stays mounted: unsaved edits survive switching tabs. */}
          <div className={tab === "terms" ? "" : "hidden"}>
            {id && !c ? <Empty>{t("loading")}</Empty> : (
              <ContractForm key={c?.updatedAt || "new"} initial={c || {}} isClient={isClient} readOnly={!editable} onDraft={onDraft}
                onSaved={(x) => { changed(x); if (!id) { setId(x.id); setTab("docs"); } }} />
            )}
          </div>
          {tab === "docs" && c && <DocumentsPanel c={c} canEdit={canEdit} onChanged={changed} />}
          {tab === "summary" && c && <SummaryTab c={view} dirty={draft.dirty} isClient={isClient} canEdit={canEdit} onChanged={changed} goTo={setTab} />}
          {tab === "billing" && c && <BillingTab c={c} canEdit={canEdit} onChanged={() => { load(); onChanged(); }} />}
        </div>
      </div>
      {/* Mandatory after an amendment is approved: stop the old contract (no dismiss). */}
      {c?.mustStop && canEdit && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-amber-600 px-5 py-4 text-white flex items-center gap-2">
              <span className="material-symbols-outlined">gavel</span><h3 className="font-bold text-lg">{t("am_stopTitle")}</h3>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <p>{t("am_stopText", { nw: c.mustStop.newNumber, old: c.mustStop.oldNumber })}</p>
              <label className="block text-xs font-semibold text-slate-600">{t("am_stopDate")}
                <input type="date" className={`${inp} mt-1`} value={stopDate || c.mustStop.suggestedEnd} onChange={(e) => setStopDate(e.target.value)} /></label>
            </div>
            <div className="px-5 pb-5 flex justify-end">
              <AsyncButton onClick={stopOld} className="px-5 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700">{t("am_stopBtn")}</AsyncButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SumItem({ k, v, req }) {
  const { t } = useLanguage();
  const empty = v === null || v === undefined || v === "";
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{k}</span>
      {empty && req ? <span className="font-semibold text-amber-700">{t("ctx_missing")}</span> : <span className="font-medium text-right">{empty ? "—" : v}</span>}
    </div>
  );
}
function SumCard({ title, tab, goTo, children }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-1"><h4 className="text-sm font-bold">{title}</h4>
        {tab && <button type="button" onClick={() => goTo(tab)} className="text-xs text-primary font-semibold cursor-pointer">{t("ctx_view")}</button>}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// Read-only, high-level view for whoever approves (no input fields).
function SummaryTab({ c, dirty = false, isClient, canEdit, onChanged, goTo }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const isSuper = user?.role === "superadmin";
  // Following the agency default → show the default's terms (from the server).
  const own = policyOf(c.opsPolicy);
  const p = own.source === "default" && c.opsPolicyEffective ? policyOf({ ...c.opsPolicyEffective, source: "default" }) : own, o = p.overtime, tr = p.trip;
  const hourly = hourlyRateOf(p);
  const total = c.units.reduce((s, u) => s + (u.monthlyFee || 0), 0);
  const docs = c.documents || [];
  const approvedAt = (s) => (s === "agency" ? c.agencyApprovedAt : c.clientApprovedAt);
  const me = c.mySide;
  const sides = me === "super" ? ["agency", "client"] : [me];
  async function approve(side) {
    if (!confirm(t("ctw_confirmApprove"))) return;
    try {
      const r = await api.contracts.approve(c.id, me === "super" ? side : undefined);
      onChanged(r);
      toast.success(r.status === "active" ? t("ctw_nowActive") : t("ctw_approved"));
    } catch (e) { toast.error(e.message); }
  }
  async function changeStatus(s) {
    if (!confirm(t("ct_confirmStatus", { s: t(`ct_st_${s}`) }))) return;
    try { onChanged(await api.contracts.setStatus(c.id, s)); } catch (e) { toast.error(e.message); }
  }
  const tierLine = (day) => (o.tiers[day].length ? o.tiers[day].map((x) => `${x.from}–${x.to ?? "∞"} j ×${String(x.mult).replace(".", ",")}`).join(" | ") : "—");
  return (
    <div className="space-y-5">
      {dirty && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>{t("ctx_unsaved")}</span>
          <button type="button" onClick={() => goTo("terms")} className="font-semibold underline cursor-pointer whitespace-nowrap">{t("ctx_goSave")}</button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SumCard goTo={goTo} title={t("ctx_sum_contract")} tab="terms">
          <SumItem k={t("ct_number")} v={c.contractNumber} />
          <SumItem k={t("ct_titleField")} v={c.title} />
          <SumItem k={t("ct_period")} v={`${fmt(c.startDate)} – ${fmt(c.endDate)}`} />
          <SumItem k={t("paket")} v={c.package} req />
          <SumItem k={t("ct_billingDay")} v={c.billingDay ? t("ct_billingDayN", { n: c.billingDay }) : null} req />
          <SumItem k={t("ct_cutoffDay")} v={c.cutoffDay ? String(c.cutoffDay) : t("ct_cutoffEom")} />
          <SumItem k={t("ctx_workHours")} v={c.workStart && c.workEnd ? `${c.workStart}–${c.workEnd}` : null} req={o.enabled} />
        </SumCard>
        <SumCard goTo={goTo} title={t("ctx_sum_units", { n: c.units.length, total: rp(total) })} tab="terms">
          {c.units.length === 0 ? <p className="text-slate-400">—</p> : c.units.map((u, i) => (
            <div key={u.id || `n${i}`} className="flex justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
              <span>{u.notes || "-"}<span className="block text-[11px] text-slate-400">{u.carId ? `${u.carLabel || u.label || `#${u.carId}`}${u.driverName ? ` · ${u.driverName}` : ""}` : t("ctw_unitCarByAgency")}</span></span>
              <span className="font-mono">{rp(u.monthlyFee)}</span>
            </div>
          ))}
          <SumItem k={t("ct_kmAllowance")} v={c.kmAllowanceMonth ? `${Number(c.kmAllowanceMonth).toLocaleString("id-ID")} km` : t("ct_noLimit")} />
          <SumItem k={t("ct_excessRate")} v={c.excessKmRate ? rp(c.excessKmRate) : null} />
          <SumItem k={t("ct_includes")} v={INCLUDES.filter((k) => c.includes?.[k]).map((k) => t(`ct_inc_${k}`)).join(", ") || null} />
        </SumCard>
        <SumCard goTo={goTo} title={t("ctf_sec_overtime")} tab="terms">
          {!o.enabled ? <p className="text-slate-400">{t("ctx_notIncluded")}</p> : <>
            <SumItem k={t("ctx_rate")} v={hourly != null ? `${rp(hourly)} / jam` : null} req />
            <SumItem k={t("ctf_day_workday")} v={tierLine("workday")} />
            <SumItem k={t("ctf_day_restday")} v={tierLine("restday")} />
            <SumItem k={t("ctf_day_holiday")} v={tierLine("holiday")} />
            <SumItem k={t("ctf_rounding")} v={o.rounding.length ? o.rounding.map((b) => `${b.from}–${b.to}→${b.hours}`).join(" | ") : t("ctx_exact")} />
            <SumItem k={t("ct_pol_waitPct")} v={o.waitingPct != null ? `${o.waitingPct}%` : null} />
            <SumItem k={t("ctx_break")} v={o.breakEvery ? t("ctx_breakV", { n: o.breakEvery, h: o.breakHours ?? 1 }) : "—"} />
          </>}
        </SumCard>
        <SumCard goTo={goTo} title={t("ctf_sec_trip")} tab="terms">
          {!tr.enabled ? <p className="text-slate-400">{t("ctx_notIncluded")}</p> : <>
            <SumItem k={t("ct_pol_daily")} v={tr.dailyAllowance != null ? rp(tr.dailyAllowance) : null} req />
            <SumItem k={t("ct_pol_lodging")} v={tr.lodgingPerNight != null ? rp(tr.lodgingPerNight) : null} req />
          </>}
        </SumCard>
        <SumCard goTo={goTo} title={t("ctx_sum_docs", { a: docs.filter((d) => d.status === "approved").length, n: docs.length })} tab="docs">
          {docs.length === 0 ? <p className="text-slate-400">{t("ctw_noDocs")}</p> : docs.map((d) => (
            <div key={d.id} className="flex justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
              <span>{d.title}<span className="block text-[11px] text-slate-400">{d.requiredFrom === "agency" ? t("ctw_fromAgency") : t("ctw_fromClient")}{d.mandatory ? ` · ${t("ctw_mandatory")}` : ""}</span></span>
              <span className={`self-start px-2 py-0.5 rounded-full text-[11px] font-bold ${DOC_STYLE[d.status]}`}>{t(`ctw_st_${d.status}`)}</span>
            </div>
          ))}
        </SumCard>
      </div>

      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <h4 className="text-sm font-bold flex items-center gap-1">{t("ctw_approvals")} <InfoTip text={t("ctw_approveHint")} size={15} /></h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {["agency", "client"].map((s) => (
            <div key={s} className={`rounded-lg border p-3 ${c.status !== "draft" || approvedAt(s) ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
              <p className="text-xs font-bold text-slate-600">{t(`ctw_side_${s}`)} · {s === "agency" ? c.agencyName : c.clientName}</p>
              <p className={`text-sm font-semibold ${approvedAt(s) ? "text-emerald-700" : "text-slate-400"}`}>
                {approvedAt(s) ? `✓ ${t("ctw_approvedAt", { at: new Date(approvedAt(s)).toLocaleString("id-ID") })}` : c.status !== "draft" ? "✓" : t("ctw_waiting")}</p>
            </div>
          ))}
        </div>
        {c.status === "draft" && !dirty && c.blockers?.length > 0 && (
          <Note tone="warn"><b>{t("ctw_blockers")}</b><ul className="list-disc pl-5">{c.blockers.map((b) => <li key={b}>{b}</li>)}</ul></Note>
        )}
        <div className="flex gap-2 flex-wrap">
          {c.status === "draft" && canEdit && sides.filter((s) => !approvedAt(s)).map((s) => (
            <Btn key={s} variant="success" icon="verified" onClick={() => approve(s)} disabled={dirty || c.blockers?.length > 0} title={dirty ? t("ctx_unsaved") : undefined}>
              {me === "super" ? t("ctw_approveAs", { side: t(`ctw_side_${s}`) }) : t("ctw_approveMine")}
            </Btn>
          ))}
          {canEdit && !isClient && c.status === "active" && <Btn icon="stop" onClick={() => changeStatus("ended")}>{t("ct_end_action")}</Btn>}
          {canEdit && !isClient && c.status === "active" && <Btn variant="danger" icon="block" onClick={() => changeStatus("terminated")}>{t("ct_terminate")}</Btn>}
          {canEdit && !isClient && c.status === "ended" && <Btn icon="restart_alt" onClick={() => changeStatus("active")}>{t("ct_reactivate")}</Btn>}
          {isSuper && c.status === "draft" && <Btn icon="play_arrow" onClick={() => changeStatus("active")}>{t("ct_activate")} (superadmin)</Btn>}
        </div>
      </div>
    </div>
  );
}

// Penagihan (only once Aktif): prepare a month as booking M### (invoice in Dokumen).
// Penagihan (once running): monthly M codes per unit — created automatically
// at the start of each month (owner 2026-11-13) — and the contract's invoices.
// Invoices themselves are made in Dokumen. Older contracts billed per month
// (one M for all units) keep their history below.
function BillingTab({ c }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-5">
      {["active", "ended"].includes(c.status) && <ReplacementsPanel c={c} />}
      <MonthlyCodes contractId={c.id} />
      {c.billings.length > 0 && (
        <div>
          <p className="text-sm font-bold mb-1">{t("ct_history")}</p>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
            {c.billings.map((b) => (
              <div key={b.id} className="flex justify-between px-3 py-2"><span>{b.period} · <span className="font-mono text-xs">{b.orderNumber || "-"}</span></span><b>{rp(b.amount)}</b></div>
            ))}
          </div>
        </div>
      )}
      <ContractInvoices contractId={c.id} />
    </div>
  );
}

// Unit pengganti (owner 2026-11-13): a replacement car per contract unit for a
// date range when the unit is in maintenance / an emergency. Agency sets it;
// the client sees it (and is notified). Forms in the range use the replacement.
function ReplacementsPanel({ c }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const isClient = user?.accountType === "client";
  const canEdit = !isClient && (user?.role === "superadmin" || can(user, "contracts", "edit") || can(user, "fleet", "edit"));
  const [d, setD] = useState(null);
  const [cars, setCars] = useState([]);
  const [f, setF] = useState({ contractUnitId: "", replacementCarId: "", startDate: "", endDate: "", reason: "maintenance", note: "" });
  const [n, setN] = useState(0);
  useEffect(() => { api.contracts.replacements(c.id).then(setD).catch(() => setD({ units: [], data: [], needed: [] })); }, [c.id, n]);
  useEffect(() => { if (canEdit) api.cars.list("limit=500&page=1").then((r) => setCars(r?.data || [])).catch(() => {}); }, [canEdit]);
  const fmtD = (x) => (x ? new Date(`${String(x).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "…");
  async function add() {
    try {
      await api.contracts.addReplacement(c.id, { ...f, contractUnitId: Number(f.contractUnitId), replacementCarId: Number(f.replacementCarId), endDate: f.endDate || null, note: f.note || null });
      toast.success(t("rp_added")); setF((x) => ({ ...x, replacementCarId: "", note: "" })); setN((x) => x + 1);
    } catch (e) { toast.error(e.message); }
  }
  async function end(r) {
    const v = prompt(t("rp_endPrompt"), "");
    if (v === null) return;
    try { await api.contracts.endReplacement(r.id, v.trim() || null); setN((x) => x + 1); } catch (e) { toast.error(e.message); }
  }
  if (!d) return null;
  if (!canEdit && !d.data.length && !d.needed.length) return null;
  const unitCarIds = new Set(d.units.map((u) => u.carId));
  const inp = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white";
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold flex items-center gap-1">{t("rp_title")} <InfoTip text={t("rp_help")} size={14} /></p>
      {d.needed.map((x) => (
        <div key={`${x.unitId}-${x.reason}-${x.refId}`} className="flex items-center justify-between gap-2 text-xs rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <span>⚠ <b>{t("rp_needed")}</b>: {x.unitLabel} · {t(`ue_reason_${x.reason}`)} {fmtD(x.from)}{x.to ? ` – ${fmtD(x.to)}` : ""}</span>
          {canEdit && <button type="button" onClick={() => setF((y) => ({ ...y, contractUnitId: String(x.unitId), startDate: x.from, endDate: x.to || "", reason: x.reason === "emergency" ? "emergency" : "maintenance" }))}
            className="font-semibold text-primary cursor-pointer">{t("rp_use")}</button>}
        </div>
      ))}
      {canEdit && (
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-2 items-end rounded-lg border border-slate-200 p-3">
          <label className="block col-span-2 lg:col-span-2 text-xs font-semibold text-slate-600">{t("rp_unit")}
            <select className={inp} value={f.contractUnitId} onChange={(e) => setF({ ...f, contractUnitId: e.target.value })}>
              <option value="">—</option>{d.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select></label>
          <label className="block col-span-2 lg:col-span-2 text-xs font-semibold text-slate-600">{t("rp_car")}
            <select className={inp} value={f.replacementCarId} onChange={(e) => setF({ ...f, replacementCarId: e.target.value })}>
              <option value="">—</option>
              {cars.filter((x) => !unitCarIds.has(x.id)).map((x) => <option key={x.id} value={x.id}>{[x.brand, x.name].filter(Boolean).join(" ")}{x.licensePlate ? ` (${x.licensePlate})` : ""}{x.status !== "available" ? ` · ${t(x.status)}` : ""}</option>)}
            </select></label>
          <label className="block text-xs font-semibold text-slate-600">{t("rp_from")}<input type="date" className={inp} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="block text-xs font-semibold text-slate-600" title={t("rp_to")}>{t("ue_to")}<input type="date" className={inp} min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
          <AsyncButton onClick={add} className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold">{t("rp_add")}</AsyncButton>
          <label className="block col-span-2 lg:col-span-2 text-xs font-semibold text-slate-600">{t("rp_reason")}
            <select className={inp} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
              {["maintenance", "emergency", "other"].map((r) => <option key={r} value={r}>{t(`ue_reason_${r}`)}</option>)}
            </select></label>
          <label className="block col-span-2 lg:col-span-5 text-xs font-semibold text-slate-600">{t("rp_note")}<input className={inp} value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        </div>
      )}
      {d.data.length === 0 ? <p className="text-xs text-slate-400">{t("rp_none")}</p> : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
          {d.data.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className={r.status === "ended" ? "text-slate-400" : ""}>
                <b>{r.replacementLabel}</b> ⇄ {r.unitLabel} · {fmtD(r.startDate)} – {fmtD(r.endDate)} · {t(`ue_reason_${r.reason}`)}{r.note ? ` · ${r.note}` : ""}
                <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-semibold ${r.status === "ended" ? "bg-slate-100" : "bg-emerald-100 text-emerald-700"}`}>{t(r.status === "ended" ? "rp_ended" : "rp_active")}</span>
              </span>
              {canEdit && r.status !== "ended" && <button type="button" onClick={() => end(r)} className="text-xs font-semibold text-slate-600 hover:text-red-600 cursor-pointer">{t("rp_end")}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Every invoice that bills this contract (M / L / R codes), with surat
// pengantar and faktur pajak (owner 2026-11-09). Invoices are still made in Dokumen.
const INV_STATUS = (i) => (i.isCancelled ? "ctx_invCancelled" : i.paidDate ? "ctx_invPaid" : i.sentDate ? "ctx_invSent" : "ctx_invDraft");
function ContractInvoices({ contractId }) {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => { api.contracts.invoices(contractId).then((r) => setRows(r?.data || [])).catch(() => setRows([])); }, [contractId, n]);
  // Cancel (owner 2026-11-13): agency admin only; unpaid and not in a terbit faktur. No overwrite for contract invoices.
  const isAgencyAdmin = user?.role === "superadmin" || (user?.accountType === "agency" && (user?.role === "admin" || user?.templateKey === "sys:agency_admin"));
  async function cancel(i) {
    const reason = prompt(t("ctx_cancelPrompt", { no: i.invoiceNumber }));
    if (!reason || !reason.trim()) return;
    try {
      const r = await api.invoices.cancel(i.id, reason.trim());
      toast.success(t("ctx_cancelled", { no: r.invoiceNumber }));
      apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); apiCache.invalidate("ops:");
      setN((x) => x + 1);
    } catch (e) { toast.error(e.message); }
  }
  const live = (rows || []).filter((i) => !i.isCancelled);
  const sum = live.reduce((s, i) => s + i.total, 0), paid = live.reduce((s, i) => s + i.paid, 0);
  return (
    <div>
      <p className="text-sm font-bold mb-1 flex items-center gap-1">{t("ctx_invoices")} <InfoTip text={t("ctx_invoicesTip")} size={14} /></p>
      {rows === null ? <p className="text-xs text-slate-400">{t("loadingShort")}</p> : rows.length === 0 ? <p className="text-xs text-slate-400">{t("ctx_noInvoices")}</p> : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="px-3 py-2 text-left">{t("ctx_invNo")}</th><th className="px-3 py-2 text-left">{t("ctx_invCodes")}</th>
              <th className="px-3 py-2 text-left">{t("ctx_invLetter")}</th><th className="px-3 py-2 text-left">{t("ctx_invFaktur")}</th>
              <th className="px-3 py-2 text-left">{t("ctx_invSentDate")}</th><th className="px-3 py-2 text-left">{t("status")}</th>
              <th className="px-3 py-2 text-right">{t("corp_total")}</th>
              {isAgencyAdmin && <th className="px-3 py-2" />}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((i) => (
              <tr key={i.id} className={i.isCancelled ? "text-slate-400 line-through" : ""}>
                <td className="px-3 py-1.5 font-mono text-xs">{i.invoiceNumber}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{i.codes.join(" | ")}</td>
                <td className="px-3 py-1.5 text-xs">{i.letterNumber || "-"}</td>
                <td className="px-3 py-1.5 text-xs">{i.fakturNsfp || (i.fakturId ? t("ctx_fakturDraft") : "-")}</td>
                <td className="px-3 py-1.5 text-xs">{fmt(i.sentDate)}</td>
                <td className="px-3 py-1.5 text-xs">{t(INV_STATUS(i))}{i.isCancelled && i.cancelReason ? <span className="block no-underline" style={{ textDecoration: "none" }}>{i.cancelReason}</span> : null}</td>
                <td className="px-3 py-1.5 text-right font-mono">{rp(i.total)}</td>
                {isAgencyAdmin && <td className="px-3 py-1.5 text-right">
                  {!i.isCancelled && !i.paidDate && !(i.paid > 0) && i.fakturStatus !== "terbit" && (
                    <button onClick={() => cancel(i)} className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer whitespace-nowrap">{t("ctx_cancel")}</button>)}
                </td>}
              </tr>
            ))}</tbody>
            <tfoot><tr className="bg-slate-50 text-xs font-semibold"><td colSpan={isAgencyAdmin ? 7 : 6} className="px-3 py-2">{t("ctx_invSum", { paid: rp(paid) })}</td><td className="px-3 py-2 text-right font-mono">{rp(sum)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

const DOC_STYLE = { pending: "bg-slate-100 text-slate-600", uploaded: "bg-sky-100 text-sky-700", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700" };
const DOC_PRESETS = ["Surat Penawaran Harga", "Kontrak / SPK tender (bertanda tangan)", "Akta Pendirian & Perubahan", "NIB", "NPWP", "KTP Direktur", "Surat Kuasa", "Daftar unit & STNK"];

function DocumentsPanel({ c, canEdit, onChanged }) {
  const { t } = useLanguage();
  const toast = useToast();
  const me = c.mySide;                               // agency | client | super
  const isSuper = me === "super";
  const askFrom = isSuper ? null : (me === "client" ? "agency" : "client");
  const [nf, setNf] = useState({ title: "", note: "", mandatory: true, dueDate: "", requiredFrom: "client" });
  const open = c.status === "draft" || c.status === "active";
  const run = async (fn, okMsg) => { try { const r = await fn(); onChanged(r); if (okMsg) toast.success(okMsg); } catch (e) { toast.error(e.message); } };
  const add = () => run(() => api.contracts.addDocument(c.id, { title: nf.title.trim(), note: nf.note || null, mandatory: nf.mandatory, dueDate: nf.dueDate || null, ...(isSuper ? { requiredFrom: nf.requiredFrom } : {}) }))
    .then(() => setNf((x) => ({ ...x, title: "", note: "", dueDate: "" })));
  const upload = (d, file) => file && run(() => api.contracts.uploadDocument(c.id, d.id, file));
  const review = (d, decision) => {
    let note = null;
    if (decision === "reject") { note = prompt(t("ctw_rejectReason")); if (!note) return; }
    return run(() => api.contracts.reviewDocument(c.id, d.id, decision, note));
  };
  const del = (d) => confirm(t("ctw_confirmDelDoc")) && run(() => api.contracts.removeDocument(c.id, d.id));
  const delFile = (d) => confirm(t("ctx_confirmDelFile")) && run(() => api.contracts.removeDocumentFile(c.id, d.id));

  const group = (from) => (c.documents || []).filter((d) => d.requiredFrom === from);
  const renderRow = (d) => {
    const iUpload = isSuper || me === d.requiredFrom;
    const iReview = isSuper || me !== d.requiredFrom;
    return (
      <div key={d.id} className="flex items-start gap-3 px-3 py-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-medium text-slate-800">{d.title}
            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${d.mandatory ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{d.mandatory ? t("ctw_mandatory") : t("ctw_optional")}</span>
            {d.dueDate && <span className="ml-1 text-[10px] text-slate-500">{t("ctw_due", { d: fmt(d.dueDate) })}</span>}</p>
          {d.note && <p className="text-xs text-slate-500">{d.note}</p>}
          {d.reviewNote && <p className="text-xs text-red-600">↳ {d.reviewNote}</p>}
          {d.fileName && <p className="text-[11px] text-slate-400">{d.fileName}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${DOC_STYLE[d.status]}`}>{t(`ctw_st_${d.status}`)}</span>
          {!d.hasFile && !iUpload && <span className="text-[11px] text-slate-400">{t("ctx_waitUpload", { side: t(`ctw_side_${d.requiredFrom}`) })}</span>}
        </div>
        <div className="flex gap-1 flex-wrap justify-end w-full sm:w-auto">
          {d.hasFile && <Btn icon="visibility" onClick={() => api.contracts.openDocument(c.id, d.id).catch((e) => toast.error(e.message))}>{t("ctw_open")}</Btn>}
          {canEdit && open && iUpload && d.status !== "approved" && (
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer bg-primary text-white hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">{d.hasFile ? "sync" : "upload"}</span>{d.hasFile ? t("ctw_replace") : t("ctw_upload")}
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={(e) => { upload(d, e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
          {canEdit && open && iUpload && d.hasFile && d.status !== "approved" && <Btn variant="danger" icon="delete" onClick={() => delFile(d)}>{t("ctx_delFile")}</Btn>}
          {canEdit && open && iReview && d.status === "uploaded" && <>
            <Btn variant="success" icon="check" onClick={() => review(d, "approve")}>{t("ctw_accept")}</Btn>
            <Btn variant="danger" icon="close" onClick={() => review(d, "reject")}>{t("ctw_reject")}</Btn>
          </>}
          {canEdit && open && iReview && !iUpload && (
            <Btn icon="delete" onClick={() => del(d)} disabled={d.hasFile} title={d.hasFile ? t("ctx_cantDelReq") : t("ctx_delReq")}>{t("delete")}</Btn>
          )}
        </div>
      </div>
    );
  };
  const renderGroup = (from) => {
    const rows = group(from);
    const hint = isSuper ? "" : me === from ? t("ctw_youUpload") : t("ctw_youReview");
    return (
      <div key={from} className="border border-slate-200 rounded-lg">
        <div className="px-3 py-2 bg-slate-50 text-xs font-bold text-slate-600 flex justify-between">
          <span>{from === "agency" ? t("ctw_fromAgency") : t("ctw_fromClient")}</span><span className="font-normal text-slate-400">{hint}</span>
        </div>
        {rows.length === 0 ? <p className="px-3 py-3 text-xs text-slate-400">{t("ctw_noDocs")}</p>
          : <div className="divide-y divide-slate-100">{rows.map((d) => renderRow(d))}</div>}
      </div>
    );
  };
  return (
    <Section title={<span className="inline-flex items-center gap-1">{t("ctw_docs")} <InfoTip text={t("ctw_docsHint")} size={15} /></span>}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {renderGroup("agency")}
        {renderGroup("client")}
      </div>
      {canEdit && open && (
        <div className="rounded-lg border border-dashed border-slate-300 p-3 space-y-2">
          <p className="text-xs font-bold text-slate-600">{isSuper ? t("ctw_reqFrom") : t("ctw_requestDoc", { side: t(`ctw_side_${askFrom}`) })}</p>
          <div className="flex flex-wrap gap-1 items-center text-[11px]"><span className="text-slate-400">{t("ctw_presets")}</span>
            {DOC_PRESETS.map((p) => <button key={p} type="button" onClick={() => setNf((x) => ({ ...x, title: p }))} className="px-2 py-0.5 rounded-full border border-slate-200 hover:border-primary cursor-pointer">{p}</button>)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            {isSuper && <select className={inp} value={nf.requiredFrom} onChange={(e) => setNf({ ...nf, requiredFrom: e.target.value })}>
              <option value="client">{t("ctw_side_client")}</option><option value="agency">{t("ctw_side_agency")}</option></select>}
            <input className={`${inp} ${isSuper ? "md:col-span-2" : "md:col-span-3"}`} value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} placeholder={t("ctw_docTitle")} />
            <input className={`${inp} md:col-span-2`} value={nf.note} onChange={(e) => setNf({ ...nf, note: e.target.value })} placeholder={t("ctw_docNote")} />
            <input type="date" className={inp} value={nf.dueDate} onChange={(e) => setNf({ ...nf, dueDate: e.target.value })} title={t("ctw_due", { d: "" })} />
          </div>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer"><input type="checkbox" checked={nf.mandatory} onChange={(e) => setNf({ ...nf, mandatory: e.target.checked })} /> {t("ctw_mandatory")}</label>
            <Btn variant="primary" icon="add" onClick={add} disabled={!nf.title.trim()}>{t("ctw_add")}</Btn>
          </div>
        </div>
      )}
    </Section>
  );
}
