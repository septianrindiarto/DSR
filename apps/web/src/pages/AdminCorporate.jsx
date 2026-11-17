// ─── Portal Perusahaan ───────────────────────────────────────────────────────
// Client company:  Persetujuan (approval queue) · Pengeluaran (spend
//                  dashboard) · Pusat Biaya · Pengaturan (approval on/off,
//                  cost centre required).
// Agency:          Invoice Bulanan — one consolidated invoice per client
//                  company per month (all completed, uninvoiced orders).
// Backend: /api/corporate (client) and /api/invoices/monthly (agency).
import { Fragment, useEffect, useMemo, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api, apiCache } from "../lib/api";
import { can } from "../lib/permissions";
import { Btn, Note, Section, Empty } from "../components/books/shared";

import AsyncButton from "../components/AsyncButton";
const inp = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100";
const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// embedded: rendered inside Kontrak & Perusahaan (no layout / page title).
export default function AdminCorporate({ embedded = false }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isClient = user?.accountType === "client";
  const tabs = useMemo(() => {
    if (!isClient) return ["monthly"];
    const list = [];
    if (can(user, "orders", "approve")) list.push("approvals");
    if (can(user, "corporate", "view") || can(user, "orders", "approve") || can(user, "corporate", "manage")) list.push("spend", "report", "invoices");
    if (can(user, "corporate", "manage")) list.push("costcenters", "settings");
    return list;
  }, [user, isClient]);
  const [tab, setTab] = useState(tabs[0]);
  const Wrap = embedded ? Fragment : AdminLayout;

  return (
    <Wrap>
      {!embedded && <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{isClient ? t("corp_title") : t("corp_agencyTitle")}</h1>
        <p className="text-slate-500 text-sm mt-1">{isClient ? t("corp_subtitle") : t("corp_agencySubtitle")}</p>
      </div>}
      {tabs.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto mb-4 border-b border-slate-200 pb-px">
          {tabs.map((id) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2.5 border-b-2 text-sm font-semibold whitespace-nowrap cursor-pointer ${tab === id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
              {t(`corp_tab_${id}`)}
            </button>
          ))}
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        {tab === "approvals" && <ApprovalsTab />}
        {tab === "spend" && <SpendTab />}
        {tab === "invoices" && <InvoicesTab />}
        {tab === "report" && <ReportTab />}
        {tab === "costcenters" && <CostCentersTab />}
        {tab === "settings" && <SettingsTab />}
        {tab === "monthly" && <MonthlyInvoiceTab />}
        {!tab && <Empty>{t("corp_noAccess")}</Empty>}
      </div>
    </Wrap>
  );
}

// ─── Approvals ───────────────────────────────────────────────────────────────
function ApprovalsTab() {
  const { t } = useLanguage();
  const toast = useToast();
  const [status, setStatus] = useState("waiting");
  const [list, setList] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const load = () => api.corporate.approvals(status).then((r) => setList(r?.data || [])).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setList(null); load(); }, [status]);
  async function decide(b, decision) {
    if (decision === "reject" && !confirm(t("corp_rejectConfirm", { no: b.orderNumber }))) return;
    setBusy(b.orderNumber);
    try {
      await api.corporate.decide(b.orderNumber, decision, notes[b.orderNumber]);
      toast.success(decision === "approve" ? t("corp_approved", { no: b.orderNumber }) : t("corp_rejected", { no: b.orderNumber }));
      apiCache.invalidate("orders:");
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }
  return (
    <Section title={t("corp_approvals_title")} subtitle={t("corp_approvals_subtitle")}
      actions={<select className={`${inp} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
        {["waiting", "approved", "rejected"].map((s) => <option key={s} value={s}>{t(`corp_status_${s}`)}</option>)}
      </select>}>
      {!list ? <Empty>{t("loading")}</Empty> : list.length === 0 ? <Empty>{t("corp_approvals_empty")}</Empty> : (
        <div className="space-y-3">
          {list.map((b) => (
            <div key={b.orderNumber} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-bold text-slate-900"><span className="font-mono text-primary">{b.orderNumber}</span> · {b.vehicles.length} {t("vehicles")}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t("corp_requestedBy", { name: b.requester })} · {fmtDate(b.createdAt)}{b.costCenter ? ` · ${t("corp_costCenter")}: ${b.costCenter}` : ""}
                  </p>
                  <p className="text-sm text-slate-700 mt-1">{fmtDate(b.pickupDate)} – {fmtDate(b.returnDate)} ({b.totalDays} {t("corp_days")}) · {b.customerName || "-"}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-900">{b.total > 0 ? rp(b.total) : t("corp_priceOnRequest")}</p>
                  {!b.priced && b.total > 0 && <p className="text-[11px] text-amber-700">{t("corp_partialPrice")}</p>}
                </div>
              </div>
              <ul className="mt-2 text-xs text-slate-600 space-y-0.5">
                {b.vehicles.map((v) => <li key={v.id}>• {v.category} · {v.package || "-"} · {v.destination || "-"}{v.price > 0 ? ` · ${rp(v.price)}` : ""}</li>)}
              </ul>
              {status === "waiting" ? (
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <input className={`${inp} flex-1 min-w-[200px]`} placeholder={t("corp_notePh")} value={notes[b.orderNumber] || ""} onChange={(e) => setNotes({ ...notes, [b.orderNumber]: e.target.value })} />
                  <Btn variant="danger" icon="close" onClick={() => decide(b, "reject")} disabled={busy === b.orderNumber}>{t("corp_reject")}</Btn>
                  <Btn variant="success" icon="check" onClick={() => decide(b, "approve")} disabled={busy === b.orderNumber}>{t("corp_approve")}</Btn>
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-2">{t(`corp_status_${b.status}`)} · {fmtDate(b.decidedAt)}{b.note ? ` · "${b.note}"` : ""}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Tagihan (client invoices + pay online) ─────────────────────────────────
const INV_STYLE = { Paid: "bg-emerald-100 text-emerald-700", Overdue: "bg-red-100 text-red-700", Sebagian: "bg-blue-100 text-blue-700", Pending: "bg-amber-100 text-amber-700" };
function InvoicesTab() {
  const { t } = useLanguage();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => api.corporate.invoices().then((r) => setList(r?.data || [])).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  async function pay(inv) {
    setBusy(inv.id);
    try {
      const link = await api.corporate.payInvoice(inv.id);
      if (link?.url) window.open(link.url, "_blank", "noopener");
      else toast.success(t("corp_inv_linkReady"));
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }
  return (
    <Section title={t("corp_inv_title")} subtitle={t("corp_inv_subtitle")}>
      {!list ? <Empty>{t("loading")}</Empty> : list.length === 0 ? <Empty>{t("corp_inv_empty")}</Empty> : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="px-3 py-2 text-left">{t("corp_inv_number")}</th><th className="px-3 py-2 text-left">{t("corp_inv_sent")}</th>
              <th className="px-3 py-2 text-left">{t("corp_inv_due")}</th><th className="px-3 py-2 text-right">{t("corp_total")}</th>
              <th className="px-3 py-2 text-right">{t("corp_inv_remaining")}</th><th className="px-3 py-2 text-center">{t("status")}</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-3 py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(inv.sentDate)}</td>
                  <td className="px-3 py-2 text-xs">{fmtDate(inv.dueDate)}</td>
                  <td className="px-3 py-2 text-right font-mono">{rp(inv.total)}</td>
                  <td className="px-3 py-2 text-right font-mono">{rp(inv.remaining)}</td>
                  <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${INV_STYLE[inv.status] || "bg-slate-100 text-slate-600"}`}>{inv.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {inv.status !== "Paid" && inv.remaining > 0 && inv.onlinePayment && (
                      <Btn variant="primary" icon="qr_code_2" onClick={() => pay(inv)} disabled={busy === inv.id}>{inv.link ? t("corp_inv_payContinue") : t("corp_inv_pay")}</Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-400">{t("corp_inv_hint")}</p>
    </Section>
  );
}

// ─── Laporan Bulanan (printable → PDF) ───────────────────────────────────────
function ReportTab() {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const now = new Date();
  const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [period, setPeriod] = useState(`${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}`);
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setR(null);
    api.corporate.report(period).then(setR).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);
  async function send() {
    setBusy(true);
    try { const x = await api.corporate.sendReport(period); toast.success(t("rep_sent", { email: x.sentTo })); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  const Group = ({ title, rows }) => (
    <div className="break-inside-avoid">
      <p className="text-xs font-bold text-slate-700 mb-1">{title}</p>
      <table className="w-full text-xs"><tbody>{rows.slice(0, 12).map((g) => (
        <tr key={g.key} className="border-b border-slate-100"><td className="py-1">{g.key}</td><td className="py-1 text-right">{g.vehicles} {t("corp_units")}</td><td className="py-1 text-right font-mono">{rp(g.amount)}</td></tr>
      ))}</tbody></table>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end flex-wrap print:hidden">
        <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("corp_mi_month")}</span>
          <input type="month" className={`${inp} w-44`} value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        <Btn icon="print" onClick={() => window.print()} disabled={!r}>{t("rep_print")}</Btn>
        {can(user, "corporate", "manage") && <Btn icon="mail" onClick={send} disabled={busy || !r}>{t("rep_sendMe")}</Btn>}
        <p className="text-[11px] text-slate-400">{t("rep_autoNote")}</p>
      </div>
      {!r ? <Empty>{t("loading")}</Empty> : (
        <div className="space-y-4 print:text-black" id="monthly-report">
          <div>
            <h2 className="text-xl font-bold">{t("rep_title")} — {r.company}</h2>
            <p className="text-sm text-slate-500">{r.label}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[[t("corp_total"), rp(r.totals.spend)], [t("corp_bookings"), r.totals.bookings], [t("rep_unitDays"), `${r.totals.vehicles} / ${r.totals.days}`], [t("rep_km"), `${r.totals.km.toLocaleString("id-ID")} km`]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">{k}</p><p className="text-lg font-bold">{v}</p></div>
            ))}
          </div>
          <p className="text-sm">{t("rep_invoiced")}: <b>{rp(r.totals.invoicedThisMonth)}</b> · {t("rep_outstanding")}: <b>{rp(r.totals.outstanding)}</b></p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Group title={t("corp_byCostCenter")} rows={r.byCostCenter} />
            <Group title={t("corp_byCategory")} rows={r.byCategory} />
            <Group title={t("corp_byRequester")} rows={r.byRequester} />
          </div>
          {r.contracts.length > 0 && <p className="text-xs text-slate-600">{t("rep_contracts")}: {r.contracts.map((c) => `${c.contractNumber} (s/d ${fmtDate(c.endDate)})`).join(", ")}</p>}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="px-2 py-1.5 text-left">{t("kodeTransaksi")}</th><th className="px-2 py-1.5 text-left">{t("corp_mi_dates")}</th><th className="px-2 py-1.5 text-left">{t("car")}</th>
                <th className="px-2 py-1.5 text-left">{t("corp_costCenter")}</th><th className="px-2 py-1.5 text-left">{t("rep_requester")}</th><th className="px-2 py-1.5 text-right">Km</th><th className="px-2 py-1.5 text-right">{t("kontrakHarga")}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">{r.orders.map((o, i) => (
                <tr key={i}><td className="px-2 py-1 font-mono">{o.orderNumber}</td><td className="px-2 py-1">{fmtDate(o.pickupDate)} – {fmtDate(o.returnDate)}</td><td className="px-2 py-1">{o.unit}</td>
                  <td className="px-2 py-1">{o.costCenter || "-"}</td><td className="px-2 py-1">{o.requester || "-"}</td><td className="px-2 py-1 text-right">{o.km ?? "-"}</td><td className="px-2 py-1 text-right font-mono">{rp(o.amount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {r.outstandingInvoices.length > 0 && (
            <div className="break-inside-avoid">
              <p className="text-xs font-bold text-slate-700 mb-1">{t("rep_outstandingList")}</p>
              <ul className="text-xs space-y-0.5">{r.outstandingInvoices.map((i) => <li key={i.invoiceNumber}>{i.invoiceNumber} · {t("corp_inv_due")} {fmtDate(i.dueDate)} · {rp(i.remaining)} · {i.status}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Spend dashboard ─────────────────────────────────────────────────────────
function SpendTab() {
  const { t } = useLanguage();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState(null);
  useEffect(() => {
    setD(null);
    api.corporate.spend(year).then(setD).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);
  const max = d ? Math.max(1, ...d.months.map((m) => m.amount)) : 1;
  const Breakdown = ({ title, rows }) => (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-xs font-bold text-slate-700 mb-2">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-slate-400">—</p> : rows.map((r) => {
        const pct = d.total ? (r.amount / d.total) * 100 : 0;
        return (
          <div key={r.key} className="text-xs py-1">
            <div className="flex justify-between gap-2"><span className="truncate">{r.key} <span className="text-slate-400">({r.vehicles} {t("corp_units")}, {r.days} {t("corp_days")})</span></span><b>{rp(r.amount)}</b></div>
            <div className="h-1.5 bg-slate-100 rounded-full mt-0.5"><div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
  return (
    <Section title={t("corp_spend_title")} subtitle={d && !d.companyWide ? t("corp_spend_own") : t("corp_spend_subtitle")}
      actions={<select className={`${inp} w-28`} value={year} onChange={(e) => setYear(Number(e.target.value))}>
        {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => <option key={y}>{y}</option>)}
      </select>}>
      {!d ? <Empty>{t("loading")}</Empty> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[[t("corp_total"), rp(d.total)], [t("corp_bookings"), d.bookings], [t("corp_vehiclesUsed"), d.vehicles], [t("corp_unpaid"), rp(d.unpaidInvoiced)]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">{k}</p><p className="text-xl font-bold text-slate-900">{v}</p></div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-bold text-slate-700 mb-3">{t("corp_monthly")}</p>
            <div className="grid grid-cols-12 gap-1.5 items-end h-36">
              {d.months.map((m) => (
                <div key={m.month} className="flex flex-col items-center justify-end h-full" title={`${MONTHS[m.month - 1]}: ${rp(m.amount)} · ${m.vehicles} ${t("corp_units")}`}>
                  <div className="w-full bg-primary/80 rounded-t" style={{ height: `${(m.amount / max) * 100}%` }} />
                  <span className="text-[10px] text-slate-500 mt-1">{MONTHS[m.month - 1]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Breakdown title={t("corp_byCostCenter")} rows={d.byCostCenter} />
            <Breakdown title={t("corp_byCategory")} rows={d.byCategory} />
            {d.companyWide && <Breakdown title={t("corp_byRequester")} rows={d.byRequester} />}
            <Breakdown title={t("corp_topDestinations")} rows={d.topDestinations} />
          </div>
        </>
      )}
    </Section>
  );
}

// ─── Cost centres ────────────────────────────────────────────────────────────
function CostCentersTab() {
  const { t } = useLanguage();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [form, setForm] = useState({ name: "", code: "" });
  const load = () => api.corporate.settings().then(setS).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  async function add() {
    try { setS(await api.corporate.addCostCenter({ name: form.name, code: form.code || null })); setForm({ name: "", code: "" }); }
    catch (e) { toast.error(e.message); }
  }
  async function toggle(c) {
    try { setS(await api.corporate.updateCostCenter(c.id, { isActive: !c.isActive })); } catch (e) { toast.error(e.message); }
  }
  return (
    <Section title={t("corp_cc_title")} subtitle={t("corp_cc_subtitle")}>
      <div className="flex gap-2 flex-wrap items-end">
        <label className="block w-32"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("corp_cc_code")}</span><input className={inp} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="OPS" /></label>
        <label className="block flex-1 min-w-[220px]"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("corp_cc_name")} *</span><input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("corp_cc_namePh")} /></label>
        <Btn variant="primary" icon="add" onClick={add} disabled={!form.name.trim()}>{t("add")}</Btn>
      </div>
      {!s ? <Empty>{t("loading")}</Empty> : s.costCenters.length === 0 ? <Empty>{t("corp_cc_empty")}</Empty> : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-w-2xl">
          {s.costCenters.map((c) => (
            <div key={c.id} className={`flex items-center justify-between px-3 py-2 text-sm ${c.isActive ? "" : "opacity-50"}`}>
              <span>{c.code && <span className="font-mono text-xs text-slate-500 mr-2">{c.code}</span>}{c.name}</span>
              <AsyncButton onClick={() => toggle(c)} className="text-xs text-slate-600 hover:underline cursor-pointer">{c.isActive ? t("corp_cc_deactivate") : t("corp_cc_activate")}</AsyncButton>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────
function SettingsTab() {
  const { t } = useLanguage();
  const toast = useToast();
  const [s, setS] = useState(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { api.corporate.settings().then(setS).catch((e) => toast.error(e.message)); }, []);
  async function save(patch) {
    try { setS(await api.corporate.saveSettings(patch)); toast.success(t("inlineSaved")); } catch (e) { toast.error(e.message); }
  }
  if (!s) return <Empty>{t("loading")}</Empty>;
  const Row = ({ k, title, hint }) => (
    <label className="flex items-start gap-3 py-3 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={!!s[k]} onChange={(e) => save({ [k]: e.target.checked })} />
      <span><span className="block text-sm font-semibold text-slate-800">{title}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </label>
  );
  return (
    <Section title={t("corp_settings_title")}>
      <div className="divide-y divide-slate-100 max-w-2xl">
        <Row k="requireApproval" title={t("corp_set_approval")} hint={t("corp_set_approvalHint")} />
        <Row k="costCenterRequired" title={t("corp_set_cc")} hint={t("corp_set_ccHint")} />
        <Row k="monthlyReport" title={t("rep_setting")} hint={t("rep_settingHint")} />
      </div>
      <Note>{t("corp_set_rolesHint")}</Note>
    </Section>
  );
}

// ─── Monthly consolidated invoice (agency) ──────────────────────────────────
function MonthlyInvoiceTab() {
  const { t } = useLanguage();
  const toast = useToast();
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [companies, setCompanies] = useState([]);
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState(`${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`);
  const [prev, setPrev] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [number, setNumber] = useState("");
  const [sentDate, setSentDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => {
    api.companies.list("limit=1000").then((r) => setCompanies(Array.isArray(r) ? r : (r?.data || []))).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function preview() {
    if (!clientId) return;
    setBusy(true); setDone(null);
    try {
      const p = await api.corporate.monthlyPreview(clientId, month);
      setPrev(p); setPicked(new Set(p.orders.map((o) => o.id))); setNumber(p.proposedNumber);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function issue() {
    if (!picked.size) return;
    setBusy(true);
    try {
      const inv = await api.corporate.issueMonthly({ clientOrgId: Number(clientId), month, orderIds: [...picked], invoiceNumber: number || null, sentDate: sentDate || null });
      setDone(inv); setPrev(null);
      apiCache.invalidate("orders:"); apiCache.invalidate("documents:");
      toast.success(t("corp_mi_created", { no: inv.invoiceNumber }));
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  const total = prev ? prev.orders.filter((o) => picked.has(o.id)).reduce((s, o) => s + o.totalPrice, 0) : 0;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Section title={t("corp_mi_title")} subtitle={t("corp_mi_subtitle")}>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="block min-w-[260px]"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("prc_corp_company")}</span>
          <select className={inp} value={clientId} onChange={(e) => { setClientId(e.target.value); setPrev(null); }}>
            <option value="">{t("prc_corp_pick")}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("corp_mi_month")}</span>
          <input type="month" className={inp} value={month} onChange={(e) => { setMonth(e.target.value); setPrev(null); }} /></label>
        <Btn icon="search" onClick={preview} disabled={!clientId || busy}>{t("corp_mi_preview")}</Btn>
      </div>
      {done && <Note tone="ok">{t("corp_mi_doneNote", { no: done.invoiceNumber, total: rp(done.totalAmount) })}</Note>}
      {prev && (prev.orders.length === 0 ? <Empty>{t("corp_mi_empty")}</Empty> : (
        <>
          {prev.unpriced > 0 && <Note tone="warn">{t("corp_mi_unpriced", { n: prev.unpriced })}</Note>}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={picked.size === prev.orders.length} onChange={(e) => setPicked(e.target.checked ? new Set(prev.orders.map((o) => o.id)) : new Set())} /></th>
                <th className="px-3 py-2 text-left">{t("kodeTransaksi")}</th><th className="px-3 py-2 text-left">{t("corp_mi_dates")}</th>
                <th className="px-3 py-2 text-left">{t("car")}</th><th className="px-3 py-2 text-left">{t("tujuan")}</th>
                <th className="px-3 py-2 text-left">{t("corp_costCenter")}</th><th className="px-3 py-2 text-right">{t("kontrakHarga")}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {prev.orders.map((o) => (
                  <tr key={o.id} className={picked.has(o.id) ? "" : "opacity-50"}>
                    <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td className="px-3 py-1.5 font-mono text-xs">{o.orderNumber}</td>
                    <td className="px-3 py-1.5 text-xs">{fmtDate(o.pickupDate)} – {fmtDate(o.returnDate)}</td>
                    <td className="px-3 py-1.5 text-xs">{[o.carName, o.plate].filter(Boolean).join(" · ") || "-"}</td>
                    <td className="px-3 py-1.5 text-xs">{o.destination || "-"}</td>
                    <td className="px-3 py-1.5 text-xs">{o.costCenter || "-"}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${o.totalPrice > 0 ? "" : "text-red-600"}`}>{rp(o.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={6} className="px-3 py-2">{t("corp_mi_total", { n: picked.size })}</td><td className="px-3 py-2 text-right font-mono">{rp(total)}</td></tr></tfoot>
            </table>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <label className="block min-w-[260px]"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("corp_mi_number")}</span><input className={inp} value={number} onChange={(e) => setNumber(e.target.value)} /></label>
            <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("corp_mi_sentDate")}</span><input type="date" className={inp} value={sentDate} onChange={(e) => setSentDate(e.target.value)} /></label>
            <Btn variant="primary" icon="receipt_long" onClick={issue} disabled={busy || !picked.size}>{t("corp_mi_create")}</Btn>
          </div>
          <p className="text-[11px] text-slate-400">{t("corp_mi_hint", { term: prev.client.paymentTermDays ?? "-" })}</p>
        </>
      ))}
    </Section>
  );
}
