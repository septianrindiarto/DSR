// ─── Keuangan — Books v2 (double-entry, SAK EMKM, accrual basis) ────────────
// Tabs: Catat Transaksi (guided input + auto-posting status) · Ringkasan ·
// Transaksi (Jurnal Umum) · Impor Buku Kas · Buku Besar ·
// Neraca Saldo · Laba Rugi · Neraca · Arus Kas · Perubahan Ekuitas ·
// Daftar Akun · Kunci Periode · Arsip (jurnal lama, read-only) · Dokumen.
// Backend: /api/books (org-scoped). The legacy /api/journal data is shown
// read-only under "Arsip".
import { useCallback, useEffect, useMemo, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/permissions";
import { TabJurnal } from "../components/finance/ReportTabs";
import TransactionsTab from "../components/books/TransactionsTab";
import ImportCashbookTab from "../components/books/ImportCashbookTab";
import QuickEntryTab from "../components/books/QuickEntryTab";
import { SummaryTab, IncomeTab, BalanceTab, CashFlowTab, EquityTab, TrialBalanceTab, LedgerTab } from "../components/books/ReportsTabs";
import { AccountsTab, LocksTab } from "../components/books/SetupTabs";
import { PeriodPicker } from "../components/books/shared";
import { rangeFor } from "../components/books/utils";

import AsyncButton from "../components/AsyncButton";
// label = i18n key (finance.id.js)
const TABS = [
  { id: "catat",        label: "fin_tab_quick",      icon: "edit_note" },
  { id: "ringkasan",    label: "fin_tab_summary",    icon: "insights" },
  { id: "transaksi",    label: "fin_tab_journal",    icon: "menu_book" },
  { id: "impor",        label: "fin_tab_import",     icon: "upload_file" },
  { id: "buku-besar",   label: "fin_ledger",         icon: "account_tree" },
  { id: "neraca-saldo", label: "fin_tb_title",       icon: "balance" },
  { id: "laba-rugi",    label: "fin_tab_income",     icon: "trending_up" },
  { id: "neraca",       label: "fin_tab_balance",    icon: "account_balance" },
  { id: "arus-kas",     label: "fin_tab_cashflow",   icon: "payments" },
  { id: "ekuitas",      label: "fin_tab_equity",     icon: "pie_chart" },
  { id: "coa",          label: "fin_tab_coa",        icon: "list_alt" },
  { id: "periods",      label: "fin_tab_locks",      icon: "lock" },
  { id: "arsip",        label: "fin_tab_archive",    icon: "inventory_2" },
  { id: "dokumen",      label: "fin_tab_docs",       icon: "folder" },
];
// Tabs that use the period picker.
const PERIOD_TABS = new Set(["transaksi", "buku-besar", "neraca-saldo", "laba-rugi", "neraca", "arus-kas", "ekuitas"]);

export default function AdminFinance() {
  const { t } = useLanguage();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("catat");
  const now = new Date();
  const [period, setPeriod] = useState({
    type: "monthly", year: now.getFullYear(), month: now.getMonth() + 1, quarter: Math.floor(now.getMonth() / 3) + 1,
    semester: now.getMonth() < 6 ? 1 : 2, compare: false, from: "", to: "",
  });
  const range = useMemo(() => rangeFor(period), [period]);
  // RBAC v2 — finance action permissions passed to every tab.
  const { user } = useAuth();
  const fin = useMemo(() => ({
    create: can(user, "finance", "create"), edit: can(user, "finance", "edit"),
    post: can(user, "finance", "post"), lock: can(user, "finance", "lock"),
  }), [user]);

  // Accounts are shared by every tab.
  const [accounts, setAccounts] = useState([]);
  const loadAccounts = useCallback(() => {
    api.books.accounts().then((a) => setAccounts(Array.isArray(a) ? a : [])).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Documents sub-section
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  function loadDocs() {
    setDocsLoading(true);
    swr("finance:docs", () => api.finance.list("limit=100"), (r) => { setDocs(r?.data || []); setDocsLoading(false); })
      .catch(() => setDocsLoading(false));
  }
  useEffect(() => { if (activeTab === "dokumen") loadDocs(); }, [activeTab]);

  // Legacy archive needs its old query-string period.
  const legacyParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("year", period.year);
    if (period.type === "monthly") p.set("month", period.month);
    if (period.type === "quarterly") p.set("quarter", period.quarter);
    if (period.type === "semesterly") p.set("semester", period.semester);
    return p.toString();
  }, [period]);

  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => { setReloadKey((k) => k + 1); loadAccounts(); };

  return (
    <AdminLayout>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("finance")}</h1>
          <p className="text-slate-500 text-sm mt-1">{t("fin_pageSubtitle")}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto mb-4 border-b border-slate-200 pb-px">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>{t(tab.label)}
          </button>
        ))}
      </div>

      {(PERIOD_TABS.has(activeTab) || activeTab === "ringkasan" || activeTab === "arsip") && (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <PeriodPicker period={period} onChange={setPeriod} />
          {PERIOD_TABS.has(activeTab) && <span className="text-xs text-slate-500">{range.label}{period.compare ? ` vs ${range.prevLabel}` : ""}</span>}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5" key={reloadKey}>
        {activeTab === "catat"        && <QuickEntryTab accounts={accounts} onChanged={bump} onGo={setActiveTab} fin={fin} />}
        {activeTab === "ringkasan"    && <SummaryTab year={period.type === "custom" && period.from ? Number(period.from.slice(0, 4)) : period.year} onGo={setActiveTab} />}
        {activeTab === "transaksi"    && <TransactionsTab accounts={accounts} range={range} onChanged={bump} fin={fin} />}
        {activeTab === "impor"        && (fin.create ? <ImportCashbookTab accounts={accounts} onDone={bump} fin={fin} /> : <p className="text-sm text-slate-400 text-center py-10">{t("fin_noImportPermission")}</p>)}
        {activeTab === "buku-besar"   && <LedgerTab range={range} accounts={accounts} />}
        {activeTab === "neraca-saldo" && <TrialBalanceTab range={range} />}
        {activeTab === "laba-rugi"    && <IncomeTab range={range} compare={period.compare} />}
        {activeTab === "neraca"       && <BalanceTab range={range} compare={period.compare} />}
        {activeTab === "arus-kas"     && <CashFlowTab range={range} />}
        {activeTab === "ekuitas"      && <EquityTab range={range} />}
        {activeTab === "coa"          && <AccountsTab accounts={accounts} onChanged={loadAccounts} fin={fin} />}
        {activeTab === "periods"      && <LocksTab fin={fin} />}
        {activeTab === "arsip"        && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("fin_archiveNote")}
            </div>
            <TabJurnal params={legacyParams} onClearSuccess={() => apiCache.invalidate("journal")} />
          </div>
        )}
        {activeTab === "dokumen"      && <DokumenSection docs={docs} loading={docsLoading} onRefresh={loadDocs} />}
      </div>
    </AdminLayout>
  );
}

// --- Dokumen Sub-section ---
function DokumenSection({ docs, loading, onRefresh }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", category: "keuangan_inti", period: "", fileUrl: "", fileType: "" });

  const CATS = ["keuangan_inti", "perpajakan", "aset_armada", "kepatuhan", "operasional", "payroll"]
    .map((value) => ({ value, label: t(`fin_docCat_${value}`) }));
  const fmtDate = d => d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

  async function handleSave() {
    try { await api.finance.create(form); apiCache.invalidate("finance"); setShowForm(false); onRefresh(); } catch (e) { toast.error(e.message); }
  }
  async function handleDelete(id) {
    if (!confirm(t("fin_doc_confirmDelete"))) return;
    try { await api.finance.delete(id); apiCache.invalidate("finance"); onRefresh(); } catch (e) { toast.error(e.message); }
  }
  async function handleUpload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { const r = await api.finance.upload(fd); setForm(p => ({ ...p, fileUrl: r.url, fileType: file.name.split(".").pop().toUpperCase() })); } catch (err) { toast.error(err.message || t("fin_doc_uploadFailed")); }
  }

  if (loading) return <div className="py-12 text-center text-slate-400">{t("loading")}</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{t("fin_doc_subtitle")}</p>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">upload_file</span>{t("fin_doc_upload")}
        </button>
      </div>
      {docs.length === 0 ? (
        <div className="py-12 text-center text-slate-400">{t("fin_doc_empty")}</div>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400 border-b">
            <th className="px-4 py-3 text-left">{t("fin_colName")}</th><th className="px-4 py-3 text-left">{t("fin_category")}</th>
            <th className="px-4 py-3 text-left">{t("fin_period")}</th><th className="px-4 py-3 text-left">{t("fin_colDate")}</th>
            <th className="px-4 py-3 text-right">{t("actions")}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {docs.map(d => (
              <tr key={d.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-medium">{d.name} {d.fileType && <span className="ml-1 text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{d.fileType}</span>}</td>
                <td className="px-4 py-2.5 text-xs">{CATS.find(c => c.value === d.category)?.label}</td>
                <td className="px-4 py-2.5 text-xs">{d.period || "-"}</td>
                <td className="px-4 py-2.5 text-xs">{fmtDate(d.createdAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  {d.fileUrl && <AsyncButton type="button" onClick={() => api.finance.openFile(d.id).catch((e) => toast.error(e.message))} className="text-slate-400 hover:text-primary mr-2 cursor-pointer"><span className="material-symbols-outlined text-[18px]">download</span></AsyncButton>}
                  <AsyncButton onClick={() => handleDelete(d.id)} className="text-slate-400 hover:text-red-500 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></AsyncButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b flex justify-between">
              <h3 className="font-bold text-lg">{t("fin_doc_upload")}</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="block text-sm font-medium mb-1">{t("fin_colName")} *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">{t("fin_category")}</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  {CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div><label className="block text-sm font-medium mb-1">{t("fin_period")}</label>
                <input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder={t("fin_doc_phPeriod")} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">File</label>
                {form.fileUrl
                  ? <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                      <span className="material-symbols-outlined text-green-600 text-[18px]">check_circle</span>
                      <span className="text-green-700 flex-1 truncate">{form.fileUrl.split("/").pop()}</span>
                      <button onClick={() => setForm({ ...form, fileUrl: "", fileType: "" })} className="text-slate-400 hover:text-red-500 cursor-pointer"><span className="material-symbols-outlined text-[16px]">close</span></button>
                    </div>
                  : <label className="flex items-center justify-center gap-2 py-6 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-primary">
                      <span className="material-symbols-outlined text-slate-400">cloud_upload</span>
                      <span className="text-sm text-slate-500">{t("fin_doc_pickFile")}</span>
                      <input type="file" onChange={handleUpload} className="hidden" accept=".pdf,.xlsx,.xls,.doc,.docx,.csv" />
                    </label>
                }
              </div>
            </div>
            <div className="p-5 border-t flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border text-sm cursor-pointer">{t("cancel")}</button>
              <AsyncButton onClick={handleSave} disabled={!form.name} className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer">{t("fin_doc_uploadBtn")}</AsyncButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
