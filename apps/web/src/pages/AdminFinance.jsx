import { useState, useEffect, useMemo } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr, API_BASE } from "../lib/api";
import { useToast } from '../components/Toast';
import PeriodSelector from "../components/finance/PeriodSelector";
import ImportModal from "../components/finance/ImportModal";
import ExportModal from "../components/finance/ExportModal";
import { TabJurnal, TabBukuBesar, TabNeracaSaldo, TabLabaRugi, TabArusKas, TabNeraca } from "../components/finance/ReportTabs";

const TABS = [
  { id: "jurnal",       label: "Jurnal Umum",    icon: "menu_book" },
  { id: "buku-besar",   label: "Buku Besar",     icon: "account_tree" },
  { id: "neraca-saldo", label: "Neraca Saldo",   icon: "balance" },
  { id: "laba-rugi",    label: "Laba Rugi",      icon: "trending_up" },
  { id: "arus-kas",     label: "Arus Kas",       icon: "payments" },
  { id: "neraca",       label: "Neraca",         icon: "account_balance" },
  { id: "coa",          label: "Daftar Akun",    icon: "list_alt" },
  { id: "periods",      label: "Kunci Periode",  icon: "lock" },
  { id: "dokumen",      label: "Dokumen",        icon: "folder" },
];

export default function AdminFinance() {
  const { t } = useLanguage();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("jurnal");
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [period, setPeriod] = useState({ type: "monthly", year: new Date().getFullYear(), month: 0, quarter: 1, semester: 1 });

  // Documents sub-section state
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { if (activeTab === "dokumen") loadDocs(); }, [activeTab]);

  function loadStats() {
  }

  function loadDocs() {
    setDocsLoading(true);
    swr("finance:docs", () => api.finance.list("limit=100"), r => {
      setDocs(r?.data || []); setDocsLoading(false);
    }).catch(() => setDocsLoading(false));
  }

  function handleImportSuccess() {
    apiCache.invalidate("journal");
    loadStats();
  }

  const periodParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("year", period.year);
    if (period.type === "monthly" && period.month > 0) p.set("month", period.month);
    if (period.type === "quarterly") p.set("quarter", period.quarter);
    if (period.type === "semesterly") p.set("semester", period.semester);
    return p.toString();
  }, [period]);

  const MONTH_LABELS = ["","Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const periodLabel = useMemo(() => {
    const y = period.year;
    if (period.type === "monthly" && period.month > 0) return `${MONTH_LABELS[period.month]} ${y}`;
    if (period.type === "quarterly") return `Q${period.quarter} ${y}`;
    if (period.type === "semesterly") return `S${period.semester} ${y}`;
    return `Tahun ${y}`;
  }, [period]);

  function goToDokumen() { setActiveTab("dokumen"); loadDocs(); }

  const fmt = v => Number(v || 0).toLocaleString("id-ID");

  const showPeriodSelector = !["coa", "periods", "dokumen"].includes(activeTab);

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("finance")}</h1>
          <p className="text-slate-500 text-sm mt-1">Kelola jurnal, laporan keuangan, dan dokumen</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowExport(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">download</span>Export
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark transition-colors shadow-sm cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">upload</span>Import Data
          </button>
        </div>
      </div>


      {/* Period Selector — only for financial report tabs */}
      {showPeriodSelector && (
        <div className="mb-4">
          <PeriodSelector period={period} onChange={setPeriod} />
        </div>
      )}

      {/* Report Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto mb-6 border-b border-slate-200 pb-px">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-700"
            }`}>
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        {activeTab === "jurnal"       && <TabJurnal params={periodParams} periodLabel={periodLabel} onClearSuccess={handleImportSuccess} />}
        {activeTab === "buku-besar"   && <TabBukuBesar params={periodParams} periodLabel={periodLabel} onGoToDokumen={goToDokumen} />}
        {activeTab === "neraca-saldo" && <TabNeracaSaldo params={periodParams} periodLabel={periodLabel} onGoToDokumen={goToDokumen} />}
        {activeTab === "laba-rugi"    && <TabLabaRugi params={periodParams} periodLabel={periodLabel} onGoToDokumen={goToDokumen} />}
        {activeTab === "arus-kas"     && <TabArusKas params={periodParams} periodLabel={periodLabel} onGoToDokumen={goToDokumen} />}
        {activeTab === "neraca"       && <TabNeraca params={periodParams} periodLabel={periodLabel} onGoToDokumen={goToDokumen} />}
        {activeTab === "coa"          && <TabChartOfAccounts />}
        {activeTab === "periods"      && <TabLockedPeriods />}
        {activeTab === "dokumen"      && <DokumenSection docs={docs} loading={docsLoading} onRefresh={loadDocs} />}
      </div>

      {/* Modals */}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={handleImportSuccess} />}
      {showExport && <ExportModal onClose={() => setShowExport(false)} periodParams={periodParams} />}
    </AdminLayout>
  );
}

// ─── Chart of Accounts Tab ────────────────────────────────────────────────────
function TabChartOfAccounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ code: "", name: "", type: "asset", normalBalance: "debit", description: "" });
  const [saving, setSaving] = useState(false);

  const TYPE_OPTS = [
    { value: "asset",     label: "Aset" },
    { value: "liability", label: "Liabilitas" },
    { value: "equity",    label: "Ekuitas" },
    { value: "income",    label: "Pendapatan" },
    { value: "expense",   label: "Beban" },
  ];
  const TYPE_COLORS = {
    asset:     "bg-blue-100 text-blue-700",
    liability: "bg-red-100 text-red-700",
    equity:    "bg-green-100 text-green-700",
    income:    "bg-emerald-100 text-emerald-700",
    expense:   "bg-orange-100 text-orange-700",
  };

  const load = () => {
    setLoading(true);
    swr("accounts:list", () => api.accounts.list(), r => { setAccounts(r || []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditId(null);
    setForm({ code: "", name: "", type: "asset", normalBalance: "debit", description: "" });
    setShowForm(true);
  }

  function openEdit(a) {
    setEditId(a.id);
    setForm({ code: a.code, name: a.name, type: a.type, normalBalance: a.normalBalance, description: a.description || "" });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.code || !form.name) return toast.error("Kode dan nama wajib diisi.");
    setSaving(true);
    try {
      if (editId) await api.accounts.update(editId, form);
      else await api.accounts.create(form);
      apiCache.invalidate("accounts");
      setShowForm(false);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(a) {
    if (!confirm(`Hapus akun "${a.code} – ${a.name}"?`)) return;
    try { await api.accounts.delete(a.id); apiCache.invalidate("accounts"); load(); }
    catch (e) { toast.error(e.message); }
  }

  // Auto-set normalBalance when type changes
  function handleTypeChange(type) {
    const nb = ["asset", "expense"].includes(type) ? "debit" : "credit";
    setForm(p => ({ ...p, type, normalBalance: nb }));
  }

  if (loading) return <div className="py-12 text-center text-slate-400">Memuat daftar akun...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-semibold text-slate-800">Daftar Akun (Chart of Accounts)</p>
          <p className="text-xs text-slate-500 mt-0.5">{accounts.length} akun terdaftar — digunakan untuk klasifikasi otomatis laporan keuangan</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium cursor-pointer hover:opacity-90">
          <span className="material-symbols-outlined text-[18px]">add</span>Tambah Akun
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="py-12 text-center text-slate-400">Belum ada akun. Klik Tambah Akun untuk mulai.</div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400 tracking-wider border-b">
              <th className="px-4 py-3 text-left">Kode</th>
              <th className="px-4 py-3 text-left">Nama Akun</th>
              <th className="px-4 py-3 text-left">Tipe</th>
              <th className="px-4 py-3 text-left">Saldo Normal</th>
              <th className="px-4 py-3 text-left">Deskripsi</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700">{a.code}</td>
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TYPE_COLORS[a.type] || "bg-slate-100 text-slate-600"}`}>
                      {TYPE_OPTS.find(t => t.value === a.type)?.label || a.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs capitalize text-slate-600">{a.normalBalance}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate">{a.description || "-"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => openEdit(a)} className="text-slate-400 hover:text-primary mr-2 cursor-pointer">
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>
                    <button onClick={() => handleDelete(a)} className="text-slate-400 hover:text-red-500 cursor-pointer">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-bold text-lg">{editId ? "Edit Akun" : "Tambah Akun"}</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Kode Akun *</label>
                  <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                    placeholder="1-1000" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tipe *</label>
                  <select value={form.type} onChange={e => handleTypeChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                    {TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Nama Akun *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Kas, Hutang Usaha, Pendapatan Sewa..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Saldo Normal *</label>
                <div className="flex gap-3">
                  {["debit", "credit"].map(nb => (
                    <label key={nb} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      form.normalBalance === nb ? "border-primary bg-primary/5 text-primary font-semibold" : "border-slate-200 hover:bg-slate-50"
                    }`}>
                      <input type="radio" name="nb" value={nb} checked={form.normalBalance === nb}
                        onChange={() => setForm(p => ({ ...p, normalBalance: nb }))} className="hidden" />
                      <span className="text-sm capitalize">{nb === "debit" ? "Debit" : "Kredit"}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Deskripsi</label>
                <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Keterangan singkat..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
            </div>
            <div className="p-5 border-t bg-slate-50/50 rounded-b-2xl flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-200 bg-white rounded-lg text-sm font-medium text-slate-600 cursor-pointer">Batal</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 cursor-pointer">
                {saving ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Locked Periods Tab ---
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function TabLockedPeriods() {
  const toast = useToast();
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ year: new Date().getFullYear(), month: "", scope: "monthly" });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    swr("journal:periods", () => api.journal.listLockedPeriods(), r => { setPeriods(r || []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function handleLock() {
    setSaving(true);
    try {
      await api.journal.lockPeriod(
        Number(form.year),
        form.scope === "monthly" ? Number(form.month) : null,
      );
      apiCache.invalidate("journal:periods");
      setShowForm(false);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleUnlock(p) {
    const label = p.month ? `${MONTHS[p.month]} ${p.year}` : `Seluruh tahun ${p.year}`;
    if (!confirm(`Buka kunci periode ${label}?`)) return;
    try {
      await api.journal.unlockPeriod(p.id);
      apiCache.invalidate("journal:periods");
      load();
    } catch (e) { toast.error(e.message); }
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

  if (loading) return <div className="py-12 text-center text-slate-400">Memuat periode terkunci...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-semibold text-slate-800">Penguncian Periode</p>
          <p className="text-xs text-slate-500 mt-0.5">Periode yang dikunci tidak bisa ditambah, diedit, atau dihapus entri jurnalnya.</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium cursor-pointer hover:bg-slate-700">
          <span className="material-symbols-outlined text-[18px]">lock</span>Kunci Periode
        </button>
      </div>

      {periods.length === 0 ? (
        <div className="py-12 text-center text-slate-400">Belum ada periode yang dikunci.</div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400 tracking-wider border-b">
              <th className="px-4 py-3 text-left">Periode</th>
              <th className="px-4 py-3 text-left">Dikunci Pada</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {periods.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-slate-400">lock</span>
                      <span className="font-semibold text-slate-800">
                        {p.month ? `${MONTHS[p.month]} ${p.year}` : `Seluruh Tahun ${p.year}`}
                      </span>
                      {!p.month && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">TAHUN PENUH</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(p.lockedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleUnlock(p)}
                      className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 cursor-pointer ml-auto">
                      <span className="material-symbols-outlined text-[15px]">lock_open</span>Buka Kunci
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-bold text-lg">Kunci Periode</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                <p className="font-semibold">Perhatian!</p>
                <p className="mt-0.5">Setelah dikunci, entri jurnal tidak bisa ditambah, diedit, atau dihapus. Gunakan fitur Reversal untuk koreksi.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Cakupan Kunci</label>
                <div className="flex gap-2">
                  {[{ value: "monthly", label: "Bulanan" }, { value: "annual", label: "Satu Tahun" }].map(o => (
                    <label key={o.value} className={`flex-1 flex items-center justify-center py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      form.scope === o.value ? "border-slate-800 bg-slate-800 text-white font-semibold" : "border-slate-200 hover:bg-slate-50"
                    }`}>
                      <input type="radio" name="scope" value={o.value} checked={form.scope === o.value}
                        onChange={() => setForm(p => ({ ...p, scope: o.value }))} className="hidden" />
                      <span className="text-sm">{o.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tahun *</label>
                  <input type="number" value={form.year} min="2000" max="2100"
                    onChange={e => setForm(p => ({ ...p, year: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                </div>
                {form.scope === "monthly" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Bulan *</label>
                    <select value={form.month} onChange={e => setForm(p => ({ ...p, month: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                      <option value="">Pilih bulan</option>
                      {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="p-5 border-t bg-slate-50/50 rounded-b-2xl flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-200 bg-white rounded-lg text-sm font-medium text-slate-600 cursor-pointer">Batal</button>
              <button onClick={handleLock} disabled={saving || (form.scope === "monthly" && !form.month)}
                className="flex-1 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">lock</span>
                {saving ? "Mengunci..." : "Kunci Sekarang"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Dokumen Sub-section ---
function DokumenSection({ docs, loading, onRefresh }) {
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", category: "keuangan_inti", period: "", fileUrl: "", fileType: "" });

  const CATS = [
    { value: "keuangan_inti", label: "Keuangan Inti" }, { value: "perpajakan", label: "Perpajakan" },
    { value: "aset_armada", label: "Aset & Armada" }, { value: "kepatuhan", label: "Kepatuhan" },
    { value: "operasional", label: "Operasional" }, { value: "payroll", label: "Payroll" },
  ];
  const fmtDate = d => d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

  async function handleSave() {
    try { await api.finance.create(form); apiCache.invalidate("finance"); setShowForm(false); onRefresh(); } catch (e) { toast.error(e.message); }
  }
  async function handleDelete(id) {
    if (!confirm("Hapus dokumen?")) return;
    try { await api.finance.delete(id); apiCache.invalidate("finance"); onRefresh(); } catch (e) { toast.error(e.message); }
  }
  async function handleUpload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try { const r = await api.finance.upload(fd); setForm(p => ({ ...p, fileUrl: r.url, fileType: file.name.split(".").pop().toUpperCase() })); } catch { toast.error("Upload gagal"); }
  }

  if (loading) return <div className="py-12 text-center text-slate-400">Memuat dokumen...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">Upload dan kelola dokumen keuangan manual</p>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">upload_file</span>Upload Dokumen
        </button>
      </div>
      {docs.length === 0 ? (
        <div className="py-12 text-center text-slate-400">Belum ada dokumen</div>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400 border-b">
            <th className="px-4 py-3 text-left">Nama</th><th className="px-4 py-3 text-left">Kategori</th>
            <th className="px-4 py-3 text-left">Periode</th><th className="px-4 py-3 text-left">Tanggal</th>
            <th className="px-4 py-3 text-right">Aksi</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {docs.map(d => (
              <tr key={d.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-medium">{d.name} {d.fileType && <span className="ml-1 text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{d.fileType}</span>}</td>
                <td className="px-4 py-2.5 text-xs">{CATS.find(c => c.value === d.category)?.label}</td>
                <td className="px-4 py-2.5 text-xs">{d.period || "-"}</td>
                <td className="px-4 py-2.5 text-xs">{fmtDate(d.createdAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  {d.fileUrl && <a href={`${API_BASE}${d.fileUrl}`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-primary mr-2"><span className="material-symbols-outlined text-[18px]">download</span></a>}
                  <button onClick={() => handleDelete(d.id)} className="text-slate-400 hover:text-red-500 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>
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
              <h3 className="font-bold text-lg">Upload Dokumen</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="block text-sm font-medium mb-1">Nama *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">Kategori</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                  {CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div><label className="block text-sm font-medium mb-1">Periode</label>
                <input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="e.g. Q3 2026" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">File</label>
                {form.fileUrl
                  ? <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                      <span className="material-symbols-outlined text-green-600 text-[18px]">check_circle</span>
                      <span className="text-green-700 flex-1 truncate">{form.fileUrl.split("/").pop()}</span>
                      <button onClick={() => setForm({ ...form, fileUrl: "", fileType: "" })} className="text-slate-400 hover:text-red-500 cursor-pointer"><span className="material-symbols-outlined text-[16px]">close</span></button>
                    </div>
                  : <label className="flex items-center justify-center gap-2 py-6 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-primary">
                      <span className="material-symbols-outlined text-slate-400">cloud_upload</span>
                      <span className="text-sm text-slate-500">Pilih file</span>
                      <input type="file" onChange={handleUpload} className="hidden" accept=".pdf,.xlsx,.xls,.doc,.docx,.csv" />
                    </label>
                }
              </div>
            </div>
            <div className="p-5 border-t flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border text-sm cursor-pointer">Batal</button>
              <button onClick={handleSave} disabled={!form.name} className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer">Upload</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
