import { useState, useEffect } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api, apiCache, swr } from "../lib/api";

// ─── Defaults — match the constants currently hard-coded in AdminDocuments ──
const DEFAULT_COMPANY = {
  name: "AKOMODASI & RENTAL MOBIL",
  address: "Jl. Kiara Sari V No. 1 Bandung",
  phone1: "Tlp: 082237578244 / 081322978843",
  phone2: "Tlp: 082219812530 / 081322978843",
  email: "",
  signatory: "Septian Rindiarto",
  brand: "DSR",
};

const DEFAULT_NUMBERING = {
  yearPrefix: String(new Date().getFullYear()).slice(-2), // "26" for 2026
  invoicePrefix: "DSR/INV/",
  letterPrefix: "DSR/",
  kwitansiPrefix: "DSR/KW/",
  penawaranPrefix: "DSR/PNW/",
  perjanjianPrefix: "DSR/PRJ/",
  suratJalanPrefix: "DSR/SJ/",
};

const DEFAULT_PREFS = {
  defaultPageSize: 20,
  autoDiscountEnabled: true,
  autoDiscountThresholdDays: 4,
  autoDiscountPercent: 5,
};

// ─── localStorage keys (single source of truth used by Documents/Tables) ────
const COMPANY_KEY    = "dsr:settings:company";
const NUMBERING_KEY  = "dsr:settings:numbering";
const PREFS_KEY      = "dsr:settings:prefs";

function loadObj(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw);
    return { ...fallback, ...(parsed || {}) };
  } catch { return { ...fallback }; }
}
function saveObj(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

const SECTIONS = [
  { id: "profile",    label: "Profil",            icon: "person" },
  { id: "company",    label: "Informasi Perusahaan", icon: "business" },
  { id: "numbering",  label: "Penomoran Dokumen", icon: "tag" },
  { id: "sync",       label: "Sinkronisasi Data", icon: "cloud_sync" },
  { id: "prefs",      label: "Preferensi",        icon: "tune" },
];

export default function AdminSettings() {
  const { t, lang, toggleLanguage } = useLanguage();
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState("profile");

  // Form state for each section — load once on mount, save on demand
  const [company, setCompany] = useState(() => loadObj(COMPANY_KEY, DEFAULT_COMPANY));
  const [numbering, setNumbering] = useState(() => loadObj(NUMBERING_KEY, DEFAULT_NUMBERING));
  const [prefs, setPrefs] = useState(() => loadObj(PREFS_KEY, DEFAULT_PREFS));

  // Sync status (re-uses the existing /api/sync/status endpoint)
  const [syncStatus, setSyncStatus] = useState(() => apiCache.get("sync:status") || null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    swr("sync:status", () => api.sync.status(), (s) => setSyncStatus(s))
      .catch(err => console.error("sync status:", err));
  }, []);

  function saveCompany() {
    saveObj(COMPANY_KEY, company);
    alert("Informasi perusahaan disimpan.");
  }
  function resetCompany() {
    if (!confirm("Kembalikan ke nilai bawaan?")) return;
    setCompany({ ...DEFAULT_COMPANY });
    saveObj(COMPANY_KEY, DEFAULT_COMPANY);
  }
  function saveNumbering() {
    saveObj(NUMBERING_KEY, numbering);
    alert("Penomoran dokumen disimpan.");
  }
  function savePrefs() {
    saveObj(PREFS_KEY, prefs);
    alert("Preferensi disimpan.");
  }

  async function triggerSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const { ok, summary } = await api.sync.runRekap();
      const msg = ok
        ? `Sync ${summary.status}: orders +${summary.ordersInserted}/~${summary.ordersUpdated}, customers +${summary.customersInserted}, drivers +${summary.driversInserted}, cars +${summary.carsInserted}.`
        : `Sync GAGAL — ${(summary.errors || []).slice(0, 3).map(e => e.message).join(" / ")}`;
      alert(msg);
      apiCache.invalidate("sync:");
      const status = await api.sync.status();
      setSyncStatus(status);
    } catch (err) {
      alert("Sync error: " + err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AdminLayout>
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pengaturan</h1>
        <p className="text-slate-500 text-sm mt-1">Kelola profil, informasi perusahaan, penomoran dokumen, dan sinkronisasi data.</p>
      </div>

      {/* Two-column layout: section nav + section content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Section nav */}
        <aside className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm cursor-pointer border-l-4 transition-colors ${
                  activeSection === s.id
                    ? "bg-primary/5 border-primary text-primary font-bold"
                    : "border-transparent text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Section content */}
        <section className="lg:col-span-9">
          {activeSection === "profile"   && <ProfileSection user={user} logout={logout} />}
          {activeSection === "company"   && <CompanySection company={company} setCompany={setCompany} onSave={saveCompany} onReset={resetCompany} />}
          {activeSection === "numbering" && <NumberingSection numbering={numbering} setNumbering={setNumbering} onSave={saveNumbering} />}
          {activeSection === "sync"      && <SyncSection syncStatus={syncStatus} syncing={syncing} onTrigger={triggerSync} />}
          {activeSection === "prefs"     && <PrefsSection prefs={prefs} setPrefs={setPrefs} onSave={savePrefs} lang={lang} toggleLanguage={toggleLanguage} t={t} />}
        </section>
      </div>
    </AdminLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section components
// ═══════════════════════════════════════════════════════════════════════════════

function Card({ title, subtitle, children, footer }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-5 space-y-4">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">{footer}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", hint = "" }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 2, hint = "" }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-y"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function ProfileSection({ user, logout }) {
  return (
    <Card title="Profil" subtitle="Informasi akun yang sedang masuk">
      <div className="flex items-center gap-4 pb-2 border-b border-slate-100">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl">
          {user?.name?.[0]?.toUpperCase() || "A"}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">{user?.name || "Admin"}</p>
          <p className="text-xs text-slate-500">{user?.email || "—"}</p>
          <p className="text-xs text-slate-400 mt-0.5">Peran: <span className="font-medium uppercase">{user?.role || "admin"}</span></p>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Untuk mengubah nama, email, atau kata sandi, silakan hubungi superadmin atau gunakan endpoint Better Auth langsung.
        Form pengeditan akan ditambahkan pada update berikutnya.
      </p>
      <div className="flex justify-end">
        <button
          onClick={async () => { if (confirm("Yakin ingin keluar?")) { await logout(); window.location.href = "/admin/login"; } }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          Keluar
        </button>
      </div>
    </Card>
  );
}

function CompanySection({ company, setCompany, onSave, onReset }) {
  const upd = (patch) => setCompany({ ...company, ...patch });
  return (
    <Card
      title="Informasi Perusahaan"
      subtitle="Dipakai sebagai header di Invoice, Kwitansi, Surat Jalan, Penawaran, dan Perjanjian."
      footer={
        <>
          <button onClick={onReset} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-white cursor-pointer">Reset</button>
          <button onClick={onSave} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">Simpan</button>
        </>
      }
    >
      <Field label="Nama Bidang Usaha" value={company.name} onChange={(v) => upd({ name: v })} />
      <TextArea label="Alamat" value={company.address} onChange={(v) => upd({ address: v })} rows={2} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Telepon Utama" value={company.phone1} onChange={(v) => upd({ phone1: v })} hint='Format: "Tlp: 0822... / 0813..."' />
        <Field label="Telepon Alternatif" value={company.phone2} onChange={(v) => upd({ phone2: v })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Email" type="email" value={company.email} onChange={(v) => upd({ email: v })} placeholder="dsr@example.com" />
        <Field label="Nama Penanda Tangan" value={company.signatory} onChange={(v) => upd({ signatory: v })} hint="Tampil di footer dokumen" />
      </div>
      <Field label="Brand / Singkatan" value={company.brand} onChange={(v) => upd({ brand: v })} hint='Singkatan brand, mis. "DSR"' />
    </Card>
  );
}

function NumberingSection({ numbering, setNumbering, onSave }) {
  const upd = (patch) => setNumbering({ ...numbering, ...patch });
  const example = (prefix) => `${numbering.yearPrefix || "26"}/${prefix}001`;
  return (
    <Card
      title="Penomoran Dokumen"
      subtitle="Awalan otomatis untuk No. Invoice, No. Surat, dll. yang muncul di halaman Dokumen."
      footer={<button onClick={onSave} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">Simpan</button>}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Awalan Tahun" value={numbering.yearPrefix} onChange={(v) => upd({ yearPrefix: v })} hint='2-digit tahun, mis. "26" untuk 2026' />
        <Field label="Awalan Invoice" value={numbering.invoicePrefix} onChange={(v) => upd({ invoicePrefix: v })} hint={`Contoh: ${example(numbering.invoicePrefix)}`} />
        <Field label="Awalan Surat Pengantar" value={numbering.letterPrefix} onChange={(v) => upd({ letterPrefix: v })} hint={`Contoh: ${example(numbering.letterPrefix)}`} />
        <Field label="Awalan Kwitansi" value={numbering.kwitansiPrefix} onChange={(v) => upd({ kwitansiPrefix: v })} hint={`Contoh: ${example(numbering.kwitansiPrefix)}`} />
        <Field label="Awalan Surat Penawaran" value={numbering.penawaranPrefix} onChange={(v) => upd({ penawaranPrefix: v })} hint={`Contoh: ${example(numbering.penawaranPrefix)}`} />
        <Field label="Awalan Surat Perjanjian" value={numbering.perjanjianPrefix} onChange={(v) => upd({ perjanjianPrefix: v })} hint={`Contoh: ${example(numbering.perjanjianPrefix)}`} />
        <Field label="Awalan Surat Jalan" value={numbering.suratJalanPrefix} onChange={(v) => upd({ suratJalanPrefix: v })} hint={`Contoh: ${example(numbering.suratJalanPrefix)}`} />
      </div>
    </Card>
  );
}

function SyncSection({ syncStatus, syncing, onTrigger }) {
  const fmtDate = (d) => d ? new Date(d).toLocaleString("id-ID") : "-";
  const last = syncStatus?.lastSync;
  return (
    <Card
      title="Sinkronisasi Data Rekap"
      subtitle="Mengelola sinkronisasi otomatis antara Rekap 2026.xlsx (Google Drive) dengan database web app."
      footer={
        <button
          onClick={onTrigger}
          disabled={syncing}
          className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {syncing
            ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <span className="material-symbols-outlined text-[18px]">cloud_sync</span>}
          {syncing ? "Sinkronisasi..." : "Sinkronisasi Sekarang"}
        </button>
      }
    >
      {!syncStatus && <p className="text-sm text-slate-500">Memuat status…</p>}
      {syncStatus && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <Stat label="File Rekap.xlsx">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${syncStatus.file?.exists ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="font-medium text-slate-700 break-all">
                {syncStatus.file?.exists
                  ? `${(syncStatus.file.size / 1024).toFixed(0)} KB`
                  : "tidak ditemukan di lokal"}
              </span>
            </div>
            {syncStatus.file?.path && <p className="text-xs text-slate-400 mt-1 truncate" title={syncStatus.file.path}>{syncStatus.file.path}</p>}
          </Stat>
          <Stat label="File Diperbarui">
            <span className="font-medium text-slate-700">{fmtDate(syncStatus.file?.mtime)}</span>
          </Stat>
          <Stat label="Sync Terakhir">
            {last ? (
              <div>
                <span className="font-medium text-slate-700">{fmtDate(last.createdAt)}</span>
                {" "}<span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                  last.status === "success" ? "bg-emerald-100 text-emerald-700" :
                  last.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                }`}>{last.status}</span>
                <p className="text-xs text-slate-400 mt-1">
                  +{last.ordersInserted ?? 0} order, +{last.customersInserted ?? 0} pelanggan, +{last.driversInserted ?? 0} driver — {last.durationMs ?? 0}ms
                </p>
              </div>
            ) : <span className="text-slate-400">Belum pernah</span>}
          </Stat>
          {syncStatus.counts && (
            <Stat label="Order di Database">
              <span className="font-medium text-slate-700">{syncStatus.counts.total_orders}</span>
              <span className="text-xs text-slate-400 ml-1">({syncStatus.counts.web_orders} web · {syncStatus.counts.rekap_orders} rekap)</span>
              <p className="text-xs text-amber-700 mt-1">Belum invoice: {syncStatus.counts.pending_invoice}</p>
            </Stat>
          )}
        </div>
      )}
      <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
        <p><b>Cara kerja:</b> Scheduler di backend memantau perubahan file <code className="bg-slate-100 px-1 rounded">Rekap 2026.xlsx</code> setiap 10 menit. Setiap perubahan otomatis dimasukkan ke database. Atur interval atau matikan via env <code className="bg-slate-100 px-1 rounded">REKAP_SYNC_INTERVAL_MS</code> / <code className="bg-slate-100 px-1 rounded">REKAP_SYNC_DISABLED</code>.</p>
      </div>
    </Card>
  );
}

function Stat({ label, children }) {
  return (
    <div>
      <p className="text-[10px] uppercase font-medium text-slate-400 tracking-wide mb-1">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function PrefsSection({ prefs, setPrefs, onSave, lang, toggleLanguage, t }) {
  const upd = (patch) => setPrefs({ ...prefs, ...patch });
  return (
    <Card
      title="Preferensi"
      subtitle="Pengaturan tampilan dan perilaku default."
      footer={<button onClick={onSave} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">Simpan</button>}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Bahasa Antarmuka</label>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">translate</span>
            <span>{lang === "id" ? "🇮🇩 Indonesia" : "🇬🇧 English"}</span>
            <span className="text-xs text-slate-400">(klik untuk ganti)</span>
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Jumlah Baris per Halaman (default)</label>
        <select
          value={prefs.defaultPageSize}
          onChange={(e) => upd({ defaultPageSize: Number(e.target.value) })}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer"
        >
          {[10, 20, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <p className="text-xs text-slate-400 mt-1">Berlaku untuk semua tabel admin (Rekap Order, Armada, Driver, Pelanggan).</p>
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-3">
        <p className="text-xs font-bold text-slate-700 uppercase">Diskon Otomatis Invoice</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prefs.autoDiscountEnabled}
            onChange={(e) => upd({ autoDiscountEnabled: e.target.checked })}
            className="accent-primary"
          />
          <span className="text-slate-700">Aktifkan diskon otomatis untuk sewa berdurasi panjang</span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Minimum Hari Sewa"
            type="number"
            value={prefs.autoDiscountThresholdDays}
            onChange={(v) => upd({ autoDiscountThresholdDays: v })}
            hint="Diskon aktif jika ≥ jumlah ini"
          />
          <Field
            label="Persentase Diskon"
            type="number"
            value={prefs.autoDiscountPercent}
            onChange={(v) => upd({ autoDiscountPercent: v })}
            hint="Persen dari subtotal"
          />
        </div>
      </div>
    </Card>
  );
}
