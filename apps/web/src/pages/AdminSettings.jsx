import { useState, useEffect, lazy, Suspense } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api, apiCache } from "../lib/api";
import InviteCodeCard from "../components/InviteCodeCard";
import RelationshipManager from "../components/RelationshipManager";
import { useToast } from "../components/Toast";
import { can } from "../lib/permissions";
import AgencyProfileCard from "../components/AgencyProfileCard";

import AsyncButton from "../components/AsyncButton";
const TaxSettings = lazy(() => import("../components/settings/TaxSettings"));
const OpsDefaultSettings = lazy(() => import("../components/settings/OpsDefaultSettings"));
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
  { id: "profile",       labelKey: "setProfile",                 icon: "person" },
  { id: "security",      labelKey: "setSecurity",                icon: "shield_lock" },
  { id: "company",       labelKey: "setCompanyInfo",   icon: "business" },
  { id: "relationships", labelKey: "setPartners",                  icon: "handshake" },
  { id: "numbering",     labelKey: "setNumbering",      icon: "tag" },
  { id: "terms",         labelKey: "paymentTerms",      icon: "event_available" },
  { id: "tax",           labelKey: "tx_sectionTitle",   icon: "percent" },
  { id: "opsDefault",    labelKey: "tx_opsTitle",       icon: "more_time" },
  { id: "legal",         labelKey: "setLegal",          icon: "verified_user" },
  { id: "agencyProfile", labelKey: "ap_title",          icon: "storefront" },
  { id: "notifications", labelKey: "setNotifications",             icon: "notifications" },
  { id: "prefs",         labelKey: "setPrefs",             icon: "tune" },
];

// Phase 4A-driven section visibility:
//   • Agency (any role)          → all 5 sections
//   • Client + has organization  → no Penomoran / Termin (those are
//                                   agency-only invoicing/data ops)
//   • Client + no organization   → also no Informasi Perusahaan
function getVisibleSections(user) {
  const accountType = user?.accountType
    || (user?.role === 'client' || user?.role === 'client_admin' ? 'client' : 'agency');
  const hasOrg = !!user?.organizationId;

  if (accountType === 'agency') {
    // RBAC v2: section visibility follows permissions. Payment terms,
    // numbering and notifications need settings.edit.
    const editSettings = can(user, 'settings', 'edit');
    const hide = new Set(editSettings ? [] : ['terms', 'notifications', 'numbering', 'tax', 'opsDefault']);
    if (user?.role === 'superadmin' && !user?.organizationId) { hide.add('legal'); hide.add('agencyProfile'); }
    return ALL_SECTIONS.filter(s => !hide.has(s.id));
  }

  // Client side
  const allowed = new Set(['profile', 'security', 'prefs']);
  if (hasOrg) { allowed.add('company'); allowed.add('relationships'); }
  return ALL_SECTIONS.filter(s => allowed.has(s.id));
}

export default function AdminSettings() {
  const { t, lang, toggleLanguage } = useLanguage();
  const toast = useToast();
  const { user, logout } = useAuth();
  // ?section=legal deep-links from the setup-mode banner.
  const [activeSection, setActiveSection] = useState(() => new URLSearchParams(window.location.search).get("section") || "profile");
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
        // Hydrate document-numbering from the org (DB) so it's shared across
        // devices/users. Mirror to localStorage — that's still the fast read
        // path used by the Dokumen page.
        if (data?.docNumbering && typeof data.docNumbering === "object") {
          const merged = { ...DEFAULT_NUMBERING, ...data.docNumbering };
          setNumbering(merged);
          saveObj(NUMBERING_KEY, merged);
        }
      })
      .catch((err) => console.error("Failed to load company info:", err));
  }, [user?.organizationId]);

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
  async function saveNumbering() {
    // Always keep the local read-path in sync (Dokumen page reads localStorage).
    saveObj(NUMBERING_KEY, numbering);
    // Persist to the org (DB) so the prefixes follow the company across devices.
    if (user?.organizationId) {
      try {
        await api.myOrg.updateInfo({ docNumbering: numbering });
        toast.success("Penomoran dokumen disimpan.");
      } catch (err) {
        toast.error("Tersimpan lokal, gagal sinkron ke server: " + (err.message || ""));
      }
      return;
    }
    toast.success("Penomoran dokumen disimpan (lokal).");
  }
  function savePrefs() {
    saveObj(PREFS_KEY, prefs);
    toast.success("Preferensi disimpan.");
  }

  return (
    <AdminLayout>
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pengaturan</h1>
        <p className="text-slate-500 text-sm mt-1">Kelola profil, informasi perusahaan, penomoran dokumen, dan termin pembayaran.</p>
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
                <span>{t(s.labelKey)}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Section content */}
        <section className="lg:col-span-9">
          {activeSection === "profile"   && <ProfileSection user={user} logout={logout} />}
          {activeSection === "security"  && <SecuritySection />}
          {activeSection === "agencyProfile" && <Card title={t("ap_title")} subtitle={t("ap_subtitle")}><AgencyProfileCard own /></Card>}
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
          {activeSection === "terms"         && <PaymentTermsSection />}
          {activeSection === "tax"           && <Suspense fallback={null}><TaxSettings /></Suspense>}
          {activeSection === "opsDefault"    && <Suspense fallback={null}><OpsDefaultSettings /></Suspense>}
          {activeSection === "legal"         && <LegalDocsSection />}
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

// ─── Keamanan Akun — password + optional two-step verification (TOTP) ───────
function SecuritySection() {
  const { t } = useLanguage();
  const toast = useToast();
  const { user, checkSession } = useAuth();
  const enabled = !!user?.twoFactorEnabled;
  const [pw, setPw] = useState("");
  const [setup, setSetup] = useState(null);       // { secret, uri, backupCodes }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const inp = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm";

  async function start() {
    if (!pw) { toast.error(t("secNeedPassword")); return; }
    setBusy(true);
    try {
      const r = await api.auth.twoFactor.enable(pw);
      const secret = new URL(r.totpURI.replace(/^otpauth:/, "http:")).searchParams.get("secret") || "";
      setSetup({ secret, uri: r.totpURI, backupCodes: r.backupCodes || [] });
      setPw("");
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function confirmCode() {
    setBusy(true);
    try {
      await api.auth.twoFactor.verifyTotp(code.replace(/\s+/g, ""));
      toast.success(t("sec2faEnabled"));
      setSetup(null); setCode("");
      await checkSession();
    } catch (e) { toast.error(e.message || t("tfInvalidCode")); } finally { setBusy(false); }
  }
  async function disable() {
    if (!pw) { toast.error(t("secNeedPassword")); return; }
    if (!confirm(t("sec2faDisableConfirm"))) return;
    setBusy(true);
    try { await api.auth.twoFactor.disable(pw); setPw(""); toast.success(t("sec2faDisabled")); await checkSession(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function downloadMyData() {
    setBusy(true);
    try {
      const data = await api.me.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = `data-saya-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function changePassword(e) {
    e.preventDefault();
    if (pwForm.next.length < 8) { toast.error(t("secPwMin")); return; }
    if (pwForm.next !== pwForm.confirm) { toast.error(t("secPwMismatch")); return; }
    setBusy(true);
    try { await api.auth.changePassword(pwForm.current, pwForm.next); setPwForm({ current: "", next: "", confirm: "" }); toast.success(t("secPwChanged")); }
    catch (e2) { toast.error(e2.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <Card title={t("sec2faTitle")} subtitle={t("sec2faSubtitle")}>
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {enabled ? t("sec2faOn") : t("sec2faOff")}
        </div>
        {!setup && (
          <div className="flex items-end gap-2 flex-wrap">
            <label className="block flex-1 min-w-[220px]"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("secCurrentPassword")}</span>
              <input type="password" className={inp} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></label>
            {enabled
              ? <button onClick={disable} disabled={busy} className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 cursor-pointer">{t("sec2faDisable")}</button>
              : <button onClick={start} disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer">{t("sec2faEnable")}</button>}
          </div>
        )}
        {setup && (
          <div className="space-y-4">
            <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1">
              <li>{t("sec2faStep1")}</li>
              <li>{t("sec2faStep2")}</li>
              <li>{t("sec2faStep3")}</li>
            </ol>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500 mb-1">{t("sec2faKey")}</p>
              <p className="font-mono text-base tracking-wider break-all select-all">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
              <a href={setup.uri} className="text-xs text-blue-600 hover:underline">{t("sec2faOpenApp")}</a>
            </div>
            {setup.backupCodes.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-2">{t("sec2faBackupCodes")}</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 font-mono text-xs select-all">{setup.backupCodes.map((c) => <span key={c}>{c}</span>)}</div>
              </div>
            )}
            <div className="flex items-end gap-2 flex-wrap">
              <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("tfEnterCode")}</span>
                <input inputMode="numeric" maxLength={8} className={`${inp} w-40 font-mono tracking-widest`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" /></label>
              <button onClick={confirmCode} disabled={busy || !code.trim()} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer">{t("tfVerify")}</button>
              <button onClick={() => { setSetup(null); setCode(""); }} className="px-4 py-2 rounded-lg border text-sm cursor-pointer">{t("cancel")}</button>
            </div>
          </div>
        )}
      </Card>

      <Card title={t("secDataTitle")} subtitle={t("secDataSubtitle")}>
        <button onClick={downloadMyData} disabled={busy} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 cursor-pointer inline-flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">download</span>{t("secDataDownload")}
        </button>
      </Card>

      <Card title={t("secPwTitle")} subtitle={t("secPwSubtitle")}>
        <form onSubmit={changePassword} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("secCurrentPassword")}</span>
            <input type="password" className={inp} value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} autoComplete="current-password" /></label>
          <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("secNewPassword")}</span>
            <input type="password" className={inp} value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} autoComplete="new-password" /></label>
          <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("secConfirmPassword")}</span>
            <input type="password" className={inp} value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} autoComplete="new-password" /></label>
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" disabled={busy || !pwForm.current || !pwForm.next} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer">{t("secPwChange")}</button>
          </div>
        </form>
      </Card>
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
          <AsyncButton onClick={onSave} disabled={!canEdit} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">Simpan</AsyncButton>
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
      footer={<AsyncButton onClick={onSave} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">Simpan</AsyncButton>}
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

// ─── Dokumen Legal Agency (RBAC v2 onboarding) ──────────────────────────────
// NIB, Akta/SK Kemenkumham, NPWP Badan, KTP Penanggung Jawab + phone. When all
// are present the agency leaves "setup" mode automatically. Files are private
// (opened through an authenticated request, never a public link).
const LEGAL_DOC_LABEL = {
  nib: "NIB (Nomor Induk Berusaha)", akta: "Akta Pendirian / SK Kemenkumham",
  npwp: "NPWP Badan", ktp: "KTP Penanggung Jawab",
};
const LEGAL_MISSING_LABEL = { nibNumber: "No. NIB", npwpNumber: "No. NPWP", phone: "No. telepon" };
function LegalDocsSection() {
  const toast = useToast();
  const { user, refreshAccess } = useAuth();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ nib: "", npwp: "", phone: "" });
  const [busy, setBusy] = useState(null);
  const canEditLegal = can(user, "settings", "edit");
  const apply = (d) => { setData(d); setForm({ nib: d.nib, npwp: d.npwp, phone: d.phone }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { api.legal.get().then(apply).catch((e) => toast.error(e.message)); }, []);
  async function saveNumbers() {
    setBusy("numbers");
    try { const d = await api.legal.update(form); apply(d); toast.success("Tersimpan."); if (d.legalStatus === "active") refreshAccess?.(); }
    catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function upload(doc, file) {
    if (!file) return;
    setBusy(doc);
    try { const d = await api.legal.upload(doc, file); apply(d); toast.success("Dokumen diunggah."); if (d.legalStatus === "active") refreshAccess?.(); }
    catch (e) { toast.error(e.message); } finally { setBusy(null); }
  }
  if (!data) return <Card title="Dokumen Legal"><p className="text-sm text-slate-500">Memuat…</p></Card>;
  const inp = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-100";
  return (
    <Card title="Dokumen Legal Agency"
      subtitle="Wajib untuk menerima & mengklaim order dan tampil ke klien. Status aktif otomatis setelah semua lengkap — tanpa persetujuan superadmin.">
      <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${data.legalStatus === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {data.legalStatus === "active"
          ? (data.complete ? "✓ Agency aktif, dokumen lengkap." : "✓ Agency aktif (terdaftar sebelum verifikasi dokumen). Tetap disarankan melengkapi dokumen.")
          : `Mode persiapan — belum lengkap: ${data.missing.map((m) => LEGAL_MISSING_LABEL[m] || LEGAL_DOC_LABEL[m]).join(", ")}.`}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">No. NIB *</span><input className={inp} disabled={!canEditLegal} value={form.nib} onChange={(e) => setForm({ ...form, nib: e.target.value })} /></label>
        <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">No. NPWP Badan *</span><input className={inp} disabled={!canEditLegal} value={form.npwp} onChange={(e) => setForm({ ...form, npwp: e.target.value })} /></label>
        <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">No. telepon perusahaan *</span><input className={inp} disabled={!canEditLegal} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
      </div>
      {canEditLegal && <div className="flex justify-end mb-5"><button onClick={saveNumbers} disabled={busy === "numbers"} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50 cursor-pointer">Simpan nomor</button></div>}
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
        {Object.entries(LEGAL_DOC_LABEL).map(([k, label]) => {
          const d = data.documents[k];
          return (
            <div key={k} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm flex-wrap">
              <span className="font-medium text-slate-700">{label} *</span>
              <span className="flex items-center gap-3 text-xs">
                {d ? <AsyncButton type="button" onClick={() => api.legal.openFile(k).catch((e) => toast.error(e.message))} className="text-blue-600 hover:underline cursor-pointer">✓ {d.originalName || "Lihat"}</AsyncButton> : <span className="text-slate-400">Belum diunggah</span>}
                {canEditLegal && (
                  <label className="px-3 py-1.5 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
                    {busy === k ? "Mengunggah…" : d ? "Ganti" : "Unggah"}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { upload(k, e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400 mt-2">PDF/JPG/PNG maks 10 MB. Dokumen disimpan privat dan hanya dapat dibuka anggota agency Anda.</p>
    </Card>
  );
}

// ─── Konfigurasi Jadwal Jatuh Tempo Tagihan (D.2) ─────────────────────────────────────────────────
// Default term (agency) + per-client term (company directory). Changing a
// client's term never rewrites sent invoices; the affected ones are listed
// with a "Batalkan & Buat Ulang" action instead.
function PaymentTermsSection() {
  const { t } = useLanguage();
  const toast = useToast();
  const [data, setData] = useState(null);             // { defaultTermDays, companies }
  const [defaultDays, setDefaultDays] = useState("");
  const [drafts, setDrafts] = useState({});           // orgId → string
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [affected, setAffected] = useState(null);     // { company, list }
  const [reissuingId, setReissuingId] = useState(null);

  function load() {
    api.invoices.terms()
      .then((r) => { setData(r); setDefaultDays(String(r?.defaultTermDays ?? "")); setDrafts({}); })
      .catch((e) => toast.error(e.message));
  }
  useEffect(load, []);

  async function saveDefault() {
    const n = Number(defaultDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) { toast.error("0–365"); return; }
    setSavingId("default");
    try { await api.invoices.setDefaultTerm(n); toast.success(t("paymentTermSaved")); load(); }
    catch (e) { toast.error(e.message); }
    finally { setSavingId(null); }
  }

  async function saveCompany(c) {
    const raw = drafts[c.id];
    const days = raw === "" ? null : Number(raw);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) { toast.error("0–365"); return; }
    setSavingId(c.id);
    try {
      const r = await api.invoices.setCompanyTerm(c.id, days);
      toast.success(t("paymentTermSaved"));
      setData((d) => ({ ...d, companies: d.companies.map((x) => x.id === c.id ? { ...x, paymentTermDays: days } : x) }));
      setDrafts((p) => { const n = { ...p }; delete n[c.id]; return n; });
      if (r?.affected?.length) setAffected({ company: r.company, list: r.affected });
    } catch (e) { toast.error(e.message); }
    finally { setSavingId(null); }
  }

  async function reissue(inv) {
    if (!confirm(t("invReissueConfirm"))) return;
    setReissuingId(inv.id);
    try {
      await api.invoices.reissue(inv.id, "Perubahan termin pembayaran");
      apiCache.invalidate("orders:"); apiCache.invalidate("documents:");
      toast.success(t("invReissued"));
      setAffected((a) => ({ ...a, list: a.list.filter((x) => x.id !== inv.id) }));
    } catch (e) { toast.error(e.message); }
    finally { setReissuingId(null); }
  }

  const fmtD = (d) => (d ? new Date(d).toLocaleDateString("id-ID") : "-");
  const list = (data?.companies || []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Card title={t("Konfigurasi Termin Pembayaran")} subtitle={t("Pengaturan termin untuk menghitung waktu jatuh tempo pembayaran setelah tagihan dikirimkan")}>
      {!data ? <p className="text-sm text-slate-500">{t("loadingShort")}</p> : (
        <div className="space-y-5">
          <div className="flex items-end gap-3 flex-wrap">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">{t("paymentTermDefault")} ({t("days")})</span>
              <input type="number" min="0" max="365" value={defaultDays} onChange={(e) => setDefaultDays(e.target.value)}
                className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </label>
            <button onClick={saveDefault} disabled={savingId === "default"}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 cursor-pointer">{t("save")}</button>
          </div>

          <div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("paymentTermSearch")}
              className="w-full md:w-80 px-3 py-2 border border-slate-200 rounded-lg text-sm mb-3" />
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {list.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">{t("noData")}</p>}
              {list.map((c) => {
                const draft = drafts[c.id];
                const value = draft !== undefined ? draft : (c.paymentTermDays ?? "");
                const dirty = draft !== undefined && String(draft) !== String(c.paymentTermDays ?? "");
                return (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{c.name}</span>
                    <input type="number" min="0" max="365" value={value}
                      placeholder={`${t("paymentTermUseDefault")} (${data.defaultTermDays})`}
                      onChange={(e) => setDrafts((p) => ({ ...p, [c.id]: e.target.value }))}
                      className="w-40 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                    <button onClick={() => saveCompany(c)} disabled={!dirty || savingId === c.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">
                      {t("save")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {affected?.list?.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-800 mb-2"><b>{affected.company?.name}</b> — {t("paymentTermAffected")}</p>
              <ul className="space-y-1.5">
                {affected.list.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-mono text-slate-700">{inv.invoiceNumber}</span>
                    <span className="text-xs text-slate-500">{fmtD(inv.sentDate)} → {fmtD(inv.dueDate)} · {inv.status}</span>
                    <button onClick={() => reissue(inv)} disabled={reissuingId === inv.id}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60 cursor-pointer">
                      {reissuingId === inv.id ? t("loadingShort") : t("invReissue")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}


function PrefsSection({ prefs, setPrefs, onSave, lang, toggleLanguage }) {
  const upd = (patch) => setPrefs({ ...prefs, ...patch });
  return (
    <Card
      title="Preferensi"
      subtitle="Pengaturan tampilan dan perilaku default."
      footer={
        <AsyncButton onClick={onSave} className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">save</span>
          Simpan
        </AsyncButton>
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
