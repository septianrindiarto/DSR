import { useState, useEffect } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api, apiCache, swr } from "../lib/api";
import InviteCodeCard from "../components/InviteCodeCard";
import RelationshipManager from "../components/RelationshipManager";
import { useToast } from "../components/Toast";

// ─── Defaults — used only for users with NO organizationId (legacy agency
// users without an org assignment). Client/agency users WITH an org load from
// the /api/orgs/my-info endpoint and these defaults are never seen.
const DEFAULT_COMPANY = {
  name: "",
  address: "",
  phone1: "",
  phone2: "",
  email: "",
  signatory: "",
  brand: "",
  npwp: "",
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

const ALL_SECTIONS = [
  { id: "profile",       label: "Profil",                 icon: "person" },
  { id: "company",       label: "Informasi Perusahaan",   icon: "business" },
  { id: "relationships", label: "Mitra",                  icon: "handshake" },
  { id: "numbering",     label: "Penomoran Dokumen",      icon: "tag" },
  { id: "sync",          label: "Sinkronisasi Data",      icon: "cloud_sync" },
  { id: "notifications", label: "Notifikasi",             icon: "notifications" },
  { id: "prefs",         label: "Preferensi",             icon: "tune" },
];

// Phase 4A-driven section visibility:
//   • Agency (any role)          → all 5 sections
//   • Client + has organization  → no Penomoran, no Sinkronisasi (those are
//                                   agency-only invoicing/data ops)
//   • Client + no organization   → also no Informasi Perusahaan
function getVisibleSections(user) {
  const accountType = user?.accountType
    || (user?.role === 'client' || user?.role === 'client_admin' ? 'client' : 'agency');
  const hasOrg = !!user?.organizationId;

  if (accountType === 'agency') return ALL_SECTIONS;

  // Client side
  const allowed = new Set(['profile', 'prefs']);
  if (hasOrg) { allowed.add('company'); allowed.add('relationships'); }
  return ALL_SECTIONS.filter(s => allowed.has(s.id));
}

export default function AdminSettings() {
  const { t, lang, toggleLanguage } = useLanguage();
  const toast = useToast();
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState("profile");
  const SECTIONS = getVisibleSections(user);
  // If activeSection was hidden for this user (e.g. they used to be agency
  // but logged out as a private client), bounce back to profile.
  useEffect(() => {
    if (!SECTIONS.find(s => s.id === activeSection)) setActiveSection("profile");
  }, [user]);

  // Form state for each section — load once on mount, save on demand
  const [company, setCompany] = useState(() => loadObj(COMPANY_KEY, DEFAULT_COMPANY));
  const [companyIsAdmin, setCompanyIsAdmin] = useState(false);
  const [numbering, setNumbering] = useState(() => loadObj(NUMBERING_KEY, DEFAULT_NUMBERING));
  const [prefs, setPrefs] = useState(() => loadObj(PREFS_KEY, DEFAULT_PREFS));

  // Phase 4B — when the user is tied to an org, pull company info from the DB
  // instead of localStorage. localStorage is only used as a legacy fallback
  // for agency users with no organizationId assigned yet.
  useEffect(() => {
    if (!user?.organizationId) return;
    api.myOrg.getInfo()
      .then((data) => {
        setCompany({ ...DEFAULT_COMPANY, ...data });
        setCompanyIsAdmin(Boolean(data?.isCallerAdmin));
      })
      .catch((err) => console.error("Failed to load company info:", err));
  }, [user?.organizationId]);

  // Sync status (re-uses the existing /api/sync/status endpoint)
  const [syncStatus, setSyncStatus] = useState(() => apiCache.get("sync:status") || null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    swr("sync:status", () => api.sync.status(), (s) => setSyncStatus(s))
      .catch(err => console.error("sync status:", err));
  }, []);

  async function saveCompany() {
    // If the user has an org → write to DB (Phase 4B).
    // Else → fall back to localStorage (legacy agency-no-org case).
    if (user?.organizationId) {
      try {
        const updated = await api.myOrg.updateInfo(company);
        setCompany({ ...DEFAULT_COMPANY, ...updated });
        toast.success(updated.message || "Informasi perusahaan tersimpan.");
      } catch (err) {
        toast.error("Gagal menyimpan: " + (err.message || "Terjadi kesalahan."));
      }
      return;
    }
    saveObj(COMPANY_KEY, company);
    toast.success("Informasi perusahaan disimpan (lokal).");
  }
  async function resetCompany() {
    if (!confirm("Kembalikan ke nilai dari server (membatalkan perubahan)?")) return;
    if (user?.organizationId) {
      try {
        const data = await api.myOrg.getInfo();
        setCompany({ ...DEFAULT_COMPANY, ...data });
      } catch (err) {
        toast.error("Gagal mengambil ulang: " + (err.message || "Terjadi kesalahan."));
      }
      return;
    }
    setCompany({ ...DEFAULT_COMPANY });
    saveObj(COMPANY_KEY, DEFAULT_COMPANY);
  }
  function saveNumbering() {
    saveObj(NUMBERING_KEY, numbering);
    toast.success("Penomoran dokumen disimpan.");
  }
  function savePrefs() {
    saveObj(PREFS_KEY, prefs);
    toast.success("Preferensi disimpan.");
  }

  async function triggerSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const { ok, summary } = await api.sync.runRekap();
      const msg = ok
        ? `Sync ${summary.status}: orders +${summary.ordersInserted}/~${summary.ordersUpdated}, customers +${summary.customersInserted}, drivers +${summary.driversInserted}, cars +${summary.carsInserted}.`
        : `Sync GAGAL — ${(summary.errors || []).slice(0, 3).map(e => e.message).join(" / ")}`;
      toast[ok ? "success" : "error"](msg);
      apiCache.invalidate("sync:");
      const status = await api.sync.status();
      setSyncStatus(status);
    } catch (err) {
      toast.error("Sync error: " + err.message);
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
          {activeSection === "company"   && <CompanySection company={company} setCompany={setCompany} onSave={saveCompany} onReset={resetCompany} canEdit={
            // Editable when ANY of:
            //   - No org yet (legacy agency-no-org localStorage path)
            //   - This is the org admin (existing client-admin path)
            //   - Caller is an agency account (DSR staff can always edit DSR's
            //     own company row regardless of whether they happen to be the
            //     org.adminUserId)
            !user?.organizationId
            || companyIsAdmin
            || user?.accountType === 'agency'
            || user?.role === 'superadmin'
          } />}
          {activeSection === "relationships" && <RelationshipManager />}
          {activeSection === "numbering" && <NumberingSection numbering={numbering} setNumbering={setNumbering} onSave={saveNumbering} />}
          {activeSection === "sync"          && <SyncSection syncStatus={syncStatus} syncing={syncing} onTrigger={triggerSync} />}
          {activeSection === "notifications" && <NotificationsSection />}
          {activeSection === "prefs"         && <PrefsSection prefs={prefs} setPrefs={setPrefs} onSave={savePrefs} lang={lang} toggleLanguage={toggleLanguage} t={t} />}
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

function Field({ label, value, onChange, type = "text", placeholder = "", hint = "", disabled = false }) {
  // When disabled, visually gray the input so the user does not believe they
  // can type into it. Previously the onChange would silently no-op, which
  // looked like a broken Simpan button.
  const base = "w-full px-3 py-2 border rounded-lg text-sm outline-none";
  const cls = disabled
    ? base + " border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed"
    : base + " border-slate-200 focus:border-primary focus:ring-1 focus:ring-primary";
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={disabled}
        className={cls}
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 2, hint = "", disabled = false }) {
  const base = "w-full px-3 py-2 border rounded-lg text-sm outline-none resize-y";
  const cls = disabled
    ? base + " border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed"
    : base + " border-slate-200 focus:border-primary focus:ring-1 focus:ring-primary";
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        disabled={disabled}
        readOnly={disabled}
        className={cls}
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function ProfileSection({ user, logout }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [info, setInfo] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.me.get()
      .then((data) => {
        setMe(data);
        setName(data?.name || "");
        setPhone(data?.customer?.phone || "");
        setLoading(false);
      })
      .catch((e) => { setErr(e.message); setLoading(false); });
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setInfo(""); setErr("");
    try {
      await api.me.update({ name, phone });
      setInfo("Profil tersimpan.");
      setTimeout(() => setInfo(""), 2000);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const accountType = me?.accountType || user?.accountType || "";
  const rawRole = me?.role || user?.role || "";

  // Collapse legacy strings to the canonical pair so the pill never reads
  // CLIENT CLIENT or repeats the account type unnecessarily.
  // - 'client'       -> 'user'  (legacy default from Better Auth signup)
  // - 'client_admin' -> 'admin' (legacy from before Phase 4)
  const role =
    rawRole === "client"       ? "user"  :
    rawRole === "client_admin" ? "admin" :
    rawRole;

  const accountTypeLabel =
    accountType === "agency" ? "Agency" :
    accountType === "client" ? "Client" :
    accountType.toUpperCase();
  const roleLabel =
    role === "superadmin" ? "Superadmin" :
    role === "admin"      ? (accountType === "client" ? "Admin" : "Admin DSR") :
    role === "user"       ? (accountType === "client" ? "User" : "Staf") :
    role === "demo"       ? "Demo" :
    role === "agent"      ? "Agent" :
    role.toUpperCase();

  return (
    <div className="space-y-6">
      <InviteCodeCard />
      <Card title="Profil Akun" subtitle="Data yang dapat Anda edit kapan saja">
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-400">Memuat...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            {/* Identity strip — name, email, and the account-type / role /
                organization badges. The avatar circle that used to live here
                was removed because there's no profile-photo upload feature
                and the empty-initials circle was misleading users into
                thinking the photo was customizable. */}
            <div className="pb-4 border-b border-slate-100">
              <p className="text-base font-bold text-slate-900">{name || "—"}</p>
              <p className="text-xs text-slate-500">{me?.email || user?.email}</p>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                  {accountTypeLabel}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">
                  {roleLabel}
                </span>
                {me?.organizationName && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700">
                    <span className="material-symbols-outlined text-[12px]">business</span>
                    {me.organizationName}
                  </span>
                )}
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Nama Lengkap"
                value={name}
                onChange={setName}
                placeholder="Nama yang ditampilkan"
              />
              <Field
                label="No. HP / WhatsApp"
                value={phone}
                onChange={setPhone}
                placeholder="08xxxxxxxxxx"
                hint="Digunakan untuk notifikasi pemesanan"
              />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email (login)</label>
                <input
                  type="email"
                  value={me?.email || ""}
                  disabled
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500"
                />
                <p className="text-xs text-slate-400 mt-1">Mengubah email memerlukan verifikasi ulang — lihat menu Keamanan (segera hadir).</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status Verifikasi</label>
                <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
                  <span className="material-symbols-outlined text-[14px]">{me?.emailVerified ? "verified" : "warning"}</span>
                  {me?.emailVerified ? "Email Terverifikasi" : "Belum Diverifikasi"}
                </div>
              </div>
            </div>

            {info && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                {info}
              </div>
            )}
            {err && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">error</span>
                {err}
              </div>
            )}

            {/* Footer — save + logout */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={async () => { if (confirm("Yakin ingin keluar?")) { await logout(); window.location.href = "/admin/login"; } }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
                Keluar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark cursor-pointer disabled:opacity-60"
              >
                {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <span className="material-symbols-outlined text-[18px]">save</span>
                Simpan Perubahan
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

function CompanySection({ company, setCompany, onSave, onReset, canEdit = true }) {
  const upd = (patch) => canEdit && setCompany({ ...company, ...patch });
  return (
    <Card
      title="Informasi Perusahaan"
      subtitle={canEdit
        ? "Dipakai sebagai header di Invoice, Kwitansi, Surat Jalan, Penawaran, dan Perjanjian."
        : "Hanya admin perusahaan yang dapat mengubah data ini. Anda dapat melihat tapi tidak mengedit."}
      footer={
        <>
          <button onClick={onReset} disabled={!canEdit} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Reset</button>
          <button onClick={onSave} disabled={!canEdit} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Simpan</button>
        </>
      }
    >
      <Field label="Nama Perusahaan" value={company.name} onChange={(v) => upd({ name: v })} disabled={!canEdit} />
      <TextArea label="Alamat" value={company.address} onChange={(v) => upd({ address: v })} rows={2} disabled={!canEdit} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Telepon Utama" value={company.phone1} onChange={(v) => upd({ phone1: v })} hint='Format: "082212345678"' disabled={!canEdit} />
        <Field label="Telepon Alternatif" value={company.phone2} onChange={(v) => upd({ phone2: v })} hint='Format: "082212345678"' disabled={!canEdit} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Email" type="email" value={company.email} onChange={(v) => upd({ email: v })} hint="dsr@example.com" disabled={!canEdit} />
        <Field label="NPWP" value={company.npwp} onChange={(v) => upd({ npwp: v })} hint="16 Digit NPWP" disabled={!canEdit} />
      </div>
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
            :
            <span className="material-symbols-outlined text-[18px]">cloud_sync</span>}
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
        </div>
      )}
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

function PrefsSection({ prefs, setPrefs, onSave, lang, toggleLanguage }) {
  const upd = (patch) => setPrefs({ ...prefs, ...patch });
  return (
    <Card
      title="Preferensi"
      subtitle="Pengaturan tampilan dan perilaku default."
      footer={
        <button onClick={onSave} className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">save</span>
          Simpan
        </button>
      }
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
        <p className="text-xs text-slate-400 mt-1">Berlaku untuk semua tabel admin.</p>
      </div>
    </Card>
  );
}

function NotificationsSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.notifications.telegramStatus()
      .then(s => setStatus(s))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function runTest() {
    setTesting(true);
    setInfo("");
    setError("");
    try {
      const r = await api.notifications.telegramTest();
      setInfo(r.message || "Test terkirim.");
    } catch (err) {
      setError(err.message || "Gagal mengirim test.");
    } finally {
      setTesting(false);
    }
  }

  const configured = Boolean(status?.configured);
  const chatCount = status?.chatIdCount || 0;

  return (
    <Card
      title="Notifikasi Telegram"
      subtitle="Kirim alert ke Telegram pribadi Anda setiap kali ada order baru. WhatsApp tetap dipakai untuk follow-up customer."
    >
      {loading ? (
        <div className="py-6 text-center text-sm text-slate-400">Memuat status...</div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className={"inline-block w-2.5 h-2.5 rounded-full " + (configured ? "bg-emerald-500" : "bg-amber-500")} />
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {configured ? "Telegram aktif" : "Telegram belum dikonfigurasi"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {configured
                  ? chatCount + " chat tujuan terdaftar."
                  : "Atur TELEGRAM_BOT_TOKEN dan TELEGRAM_ADMIN_CHAT_ID di .env, lalu restart API."}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800">Cara menyiapkan, sekali setup, sekitar 15 menit:</p>
            <p>1. Buka Telegram, cari @BotFather, kirim perintah /newbot, ikuti instruksinya. Simpan token yang diberikan.</p>
            <p>2. Buka link bot Anda dari BotFather, lalu tekan tombol Start.</p>
            <p>3. Kunjungi https://api.telegram.org/bot{"[TOKEN]"}/getUpdates di browser dan salin chat.id dari respon JSON.</p>
            <p>4. Tambahkan ke apps/api/.env dua baris: TELEGRAM_BOT_TOKEN dan TELEGRAM_ADMIN_CHAT_ID.</p>
            <p>5. Restart API, lalu klik tombol Kirim Test di bawah untuk verifikasi.</p>
          </div>

          {info && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">check_circle</span>
              {info}
            </div>
          )}
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">error</span>
              {error}
            </div>
          )}

          <div>
            <button
              onClick={runTest}
              disabled={testing || !configured}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {testing && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span className="material-symbols-outlined text-base">send</span>
              Kirim Test
            </button>
            {!configured && (
              <p className="text-xs text-slate-400 mt-2">Tombol akan aktif setelah konfigurasi dimuat.</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
