import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { api } from "../lib/api";

export default function AdminLogin() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [loginType, setLoginType] = useState(null); // null | 'client' | 'agency'
  const [showModal, setShowModal] = useState(null); // 'privacy' | 'terms'
  // After a successful register we DON'T log the user in. Instead we show a
  // "Cek inbox" panel so the user knows to verify their email first.
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendInfo, setResendInfo] = useState("");
  // Extended registration fields — captured only when isRegister.
  const [phone, setPhone] = useState("");
  const [customerType, setCustomerType] = useState("private");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [agencyCode, setAgencyCode] = useState("");
  const navigate = useNavigate();
  const { login, register, logout, sessionExpired, clearSessionExpired } = useAuth();
  const { t } = useLanguage();

  // Demo credentials — seeded by `npm run db:seed` in the API.
  // Lets prospective clients explore the admin panel without real credentials.
  const DEMO_EMAIL = "demo@dsrsolution.com";
  const DEMO_PASSWORD = "demo123";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isRegister) {
        if (!name.trim()) { setError("Nama wajib diisi"); setLoading(false); return; }
        if (!phone.trim()) { setError("No. HP wajib diisi"); setLoading(false); return; }
        // For tipe Perusahaan, accept EITHER an invite code (joins existing
        // org) OR a company name (creates new org). The Nama Perusahaan input
        // is hidden the moment a kode undangan is typed, so blocking on the
        // empty companyName field locked second-and-onward teammates out of
        // registering with their code. Mirror the backend Zod refine here.
        if (
          customerType === "company"
          && !inviteCode.trim()
          && !companyName.trim()
        ) {
          setError("Untuk tipe Perusahaan, isi Nama Perusahaan ATAU Kode Undangan");
          setLoading(false); return;
        }
        await register({
          name, email, password, phone,
          customerType,
          companyName: (customerType === "company" && !inviteCode.trim()) ? companyName : null,
          // Phase 4A: invite code joins an existing org. Mutually exclusive
          // with companyName (the backend enforces this too).
          inviteCode: inviteCode.trim() || null,
          // Stage 2 — optional agency code links the new client to that agency.
          agencyCode: (!isAgency && agencyCode.trim()) ? agencyCode.trim() : null,
          // Agency mode is only used by DSR internal devs — sets role=admin.
          // Client mode → role=client (the default).
          accountType: isAgency ? "agency" : "client",
        });
        // Do NOT navigate. Better Auth blocks login until email is verified —
        // show the "cek inbox" panel and let the user click the link.
        setRegisteredEmail(email);
      } else {
        const result = await login(email, password);
        // Enforce that the chosen login mode matches the account type: an
        // agency account must use the Agency menu and a client account the
        // Client menu. Superadmin is internal and may use either.
        const acct = result?.user?.accountType;
        const role = result?.user?.role;
        if (acct && role !== 'superadmin') {
          const isAgencyAcct = acct === 'agency';
          if (isAgency !== isAgencyAcct) {
            await logout(); // discard the session we just created
            setError(isAgency
              ? "Akun ini bukan akun Agency. Silakan masuk melalui menu Client / Perorangan."
              : "Akun ini adalah akun Agency. Silakan masuk melalui menu Agency / Perusahaan.");
            setLoading(false);
            return;
          }
        }
        navigate("/admin/dashboard");
      }
    } catch (err) {
      setError(err.message || "Login gagal. Periksa email dan password Anda.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!registeredEmail) return;
    setResending(true);
    setResendInfo("");
    setError("");
    try {
      await api.auth.sendVerification(registeredEmail);
      setResendInfo(t("verifyEmailResent"));
    } catch (err) {
      setError(err.message || "Gagal mengirim ulang.");
    } finally {
      setResending(false);
    }
  };

  const handleDemoLogin = async () => {
    setError("");
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setLoading(true);
    try {
      await login(DEMO_EMAIL, DEMO_PASSWORD);
      navigate("/admin/dashboard");
    } catch (err) {
      setError(
        err.message ||
          "Demo login gagal. Pastikan database sudah di-seed dengan akun demo."
      );
    } finally {
      setLoading(false);
    }
  };

  // If loginType not selected yet, show the selection screen
  if (!loginType) {
    return (
      <div className="bg-[#f8f5f5] font-[Inter,sans-serif] antialiased text-slate-900 min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-center px-10 py-4 border-b border-primary/10 bg-white/50 backdrop-blur-sm">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/dsr-logo.png" alt="DSR Solution" className="h-10 w-auto" />
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              DSR <span className="text-primary">Solution</span>
            </h1>
          </Link>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-md text-center">
            <div className="inline-flex items-center justify-center size-20 rounded-full bg-primary/10 text-primary mb-6">
              <span className="material-symbols-outlined text-4xl">login</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Pilih Jenis Akun</h2>
            <p className="text-slate-500 text-sm mb-8">Silakan pilih cara masuk sesuai kebutuhan Anda</p>

            <div className="space-y-4">
              <button
                onClick={() => setLoginType('client')}
                className="w-full flex items-center gap-4 p-5 rounded-xl bg-white border-2 border-slate-200 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
              >
                <div className="flex items-center justify-center size-12 rounded-full bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                  <span className="material-symbols-outlined text-2xl">person</span>
                </div>
                <div className="text-left flex-1">
                  <h3 className="font-bold text-slate-900">Masuk sebagai Client</h3>
                  <p className="text-xs text-slate-400">Untuk pelanggan perorangan</p>
                </div>
                <span className="material-symbols-outlined text-slate-300 group-hover:text-primary transition-colors">arrow_forward</span>
              </button>

              <button
                onClick={() => setLoginType('agency')}
                className="w-full flex items-center gap-4 p-5 rounded-xl bg-white border-2 border-slate-200 hover:border-amber-500 hover:shadow-md transition-all group cursor-pointer"
              >
                <div className="flex items-center justify-center size-12 rounded-full bg-amber-50 text-amber-600 group-hover:bg-amber-100 transition-colors">
                  <span className="material-symbols-outlined text-2xl">business</span>
                </div>
                <div className="text-left flex-1">
                  <h3 className="font-bold text-slate-900">Masuk sebagai Agency</h3>
                  <p className="text-xs text-slate-400">Untuk perusahaan / instansi</p>
                </div>
                <span className="material-symbols-outlined text-slate-300 group-hover:text-amber-500 transition-colors">arrow_forward</span>
              </button>
            </div>

            <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-primary mt-6 transition-colors">
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Kembali ke Beranda
            </Link>
          </div>
        </main>

        <footer className="py-6 text-center text-sm text-slate-400">
          © 2026 DSR Solution. All rights reserved.
        </footer>
      </div>
    );
  }

  const isAgency = loginType === 'agency';
  const accentColor = isAgency ? 'amber' : 'primary';

  return (
    <div className="bg-[#f8f5f5] font-[Inter,sans-serif] antialiased text-slate-900 min-h-screen flex flex-col">
      {/* Header / Branding */}
      <header className="flex items-center justify-between px-10 py-4 border-b border-primary/10 bg-white/50 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/dsr-logo.png" alt="DSR Solution" className="h-10 w-auto" />
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            DSR <span className="text-primary">Solution</span>
          </h1>
        </Link>
        <button
          onClick={() => setLoginType(null)}
          className="text-sm font-medium text-slate-500 hover:text-primary transition-colors cursor-pointer flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
          Ganti Jenis Akun
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-primary/10 overflow-hidden">
          {/* Card Header */}
          <div className="pt-10 pb-6 px-8 text-center">
            <div className={`inline-flex items-center justify-center size-16 rounded-full mb-6 ${
              isAgency ? 'bg-amber-100 text-amber-600' : 'bg-primary/10 text-primary'
            }`}>
              <span className="material-symbols-outlined text-3xl">
                {isAgency ? 'business' : 'person'}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {isRegister ? 'Daftar Akun' : t('loginTitle')}
            </h2>
            <p className="text-slate-500 mt-2 text-sm">
              {isRegister
                ? `Buat akun ${isAgency ? 'agency' : 'client'} baru`
                : `Masuk sebagai ${isAgency ? 'Agency / Perusahaan' : 'Client / Perorangan'}`
              }
            </p>
            {/* Account type badge */}
            <div className={`inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-bold ${
              isAgency ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
            }`}>
              <span className="material-symbols-outlined text-[14px]">{isAgency ? 'business' : 'person'}</span>
              {isAgency ? 'Agency' : 'Client'}
            </div>
          </div>

          {/* Post-register success panel — replaces the form once the user
              completes registration so they know to verify their email. */}
          {registeredEmail && (
            <div className="px-8 pb-10 flex flex-col gap-4 text-center">
              <div className="inline-flex items-center justify-center size-14 rounded-full bg-green-100 text-green-600 mx-auto">
                <span className="material-symbols-outlined text-3xl">mark_email_read</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{t('verifyEmailTitle')}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {t('verifyEmailCheckInbox')}
              </p>
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg py-2 px-3 break-all">
                {registeredEmail}
              </p>
              {resendInfo && (
                <p className="text-xs text-green-700 flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">check_circle</span>
                  {resendInfo}
                </p>
              )}
              {error && (
                <p className="text-xs text-red-600 flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">error</span>
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resending}
                className="w-full py-2.5 px-4 rounded-lg border border-primary text-primary text-sm font-semibold hover:bg-primary/5 transition-colors disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
              >
                {resending && <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>}
                {t('verifyEmailResend')}
              </button>
              <button
                type="button"
                onClick={() => { setRegisteredEmail(""); setIsRegister(false); setResendInfo(""); setError(""); }}
                className="text-sm text-slate-500 hover:text-primary cursor-pointer"
              >
                {t('back')}
              </button>
            </div>
          )}

          {/* Login Form */}
          {!registeredEmail && (
          <form
            className="px-8 pb-10 flex flex-col gap-5"
            onSubmit={handleSubmit}
          >
            {/* Audit M-05: session-expired banner. Fires when a 401 from
                any API call escalated to AuthContext. Dismisses on any new
                input the user gives (clearSessionExpired is called inline). */}
            {sessionExpired && !error && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] mt-0.5">timer_off</span>
                <div className="flex-1">
                  <p className="font-semibold">Sesi Anda telah berakhir</p>
                  <p className="text-xs mt-0.5">Silakan masuk kembali untuk melanjutkan.</p>
                </div>
                <button type="button" onClick={clearSessionExpired} className="text-amber-500 hover:text-amber-700">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">error</span>
                {error}
              </div>
            )}

            {/* Name Field (Register only) */}
            {isRegister && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700" htmlFor="name">
                  {isAgency ? 'Nama Perusahaan' : 'Nama Lengkap'}
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">{isAgency ? 'business' : 'badge'}</span>
                  </div>
                  <input
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 transition-all outline-none"
                    id="name"
                    placeholder={isAgency ? 'PT Contoh Indonesia' : 'Admin DSR'}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Phone Field (Register only) */}
            {isRegister && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700" htmlFor="phone">
                  {t('registerPhone')}
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">phone</span>
                  </div>
                  <input
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 transition-all outline-none"
                    id="phone"
                    placeholder="0812xxxxxxxx"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Customer Type (CLIENT register only) — Pribadi / Perusahaan.
                Hidden for Agency: an agency is always a company, and its name
                is captured by the "Nama Perusahaan" field above, so this toggle
                + the second company-name field below don't apply. */}
            {isRegister && !isAgency && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">
                  {t('registerCustomerType')}
                </label>
                <div className="flex gap-2">
                  {[
                    { v: 'private', label: t('registerTypePrivate'), icon: 'person' },
                    { v: 'company', label: t('registerTypeCompany'), icon: 'business' },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setCustomerType(opt.v)}
                      className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                        customerType === opt.v
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Agency Code (CLIENT register, private & company) — links the
                new client to that agency. */}
            {isRegister && !isAgency && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700" htmlFor="agencyCode">
                  Kode Agency <span className="text-slate-400 text-xs font-normal">(opsional)</span>
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">handshake</span>
                  </div>
                  <input
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 transition-all outline-none uppercase tracking-wider font-mono"
                    id="agencyCode"
                    placeholder="ABCD2345"
                    type="text"
                    value={agencyCode}
                    onChange={(e) => setAgencyCode(e.target.value.toUpperCase())}
                    maxLength={20}
                    autoComplete="off"
                  />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">Tautkan akun Anda ke agency tertentu (jika diberi kode oleh agency).</p>
              </div>
            )}

            {/* Invite Code (Client register, type=company) — joins an
                existing org. When filled, the Nama Perusahaan field below
                is suppressed (mutually exclusive). */}
            {isRegister && !isAgency && customerType === 'company' && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700" htmlFor="inviteCode">
                  {t('inviteCode')} <span className="text-slate-400 text-xs font-normal">(opsional)</span>
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">vpn_key</span>
                  </div>
                  <input
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 transition-all outline-none uppercase tracking-wider font-mono"
                    id="inviteCode"
                    placeholder="A3K7-9P2X"
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    maxLength={20}
                    autoComplete="off"
                  />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{t('inviteCodeHint')}</p>
              </div>
            )}

            {/* Company Name (CLIENT register only, when type=company AND no invite code) */}
            {isRegister && !isAgency && customerType === 'company' && !inviteCode.trim() && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700" htmlFor="companyName">
                  {t('registerCompanyName')}
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                    <span className="material-symbols-outlined text-[20px]">business</span>
                  </div>
                  <input
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 transition-all outline-none"
                    id="companyName"
                    placeholder="PT Contoh Indonesia"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700" htmlFor="email">
                {t('username')}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">person</span>
                </div>
                <input
                  className="block w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 transition-all outline-none"
                  id="email"
                  placeholder={isAgency ? 'admin@company.com' : 'admin@dsrsolution.com'}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-700" htmlFor="password">
                  {t('password')}
                </label>
                {!isRegister && (
                  <a className="text-xs font-semibold text-primary hover:text-primary-hover" href="#">
                    {t('forgotPassword')}
                  </a>
                )}
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">lock</span>
                </div>
                <input
                  className="block w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 pl-10 pr-10 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 transition-all outline-none"
                  id="password"
                  placeholder="••••••••"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              className={`w-full mt-2 font-semibold py-3 px-4 rounded-lg transition-colors shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 group cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                isAgency
                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                  : 'bg-primary hover:bg-primary-hover text-white shadow-primary/20'
              }`}
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <span>{isRegister ? 'DAFTAR' : t('login')}</span>
                  <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">
                    arrow_forward
                  </span>
                </>
              )}
            </button>

            {/* Toggle Register/Login */}
            <div className="text-center">
              <button
                type="button"
                onClick={() => { setIsRegister(!isRegister); setError(""); }}
                className="text-sm text-primary hover:text-primary-dark font-medium cursor-pointer"
              >
                {isRegister ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
              </button>
            </div>

            {/* Footer Links */}
            <div className="text-center mt-2">
              <p className="text-xs text-slate-400">
                Dilindungi dan tunduk pada{" "}
                <button type="button" className="underline hover:text-slate-600 cursor-pointer" onClick={() => setShowModal('privacy')}>Kebijakan Privasi</button>{" "}
                dan{" "}
                <button type="button" className="underline hover:text-slate-600 cursor-pointer" onClick={() => setShowModal('terms')}>Syarat & Ketentuan</button>.
              </p>
            </div>
          </form>
          )}
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="py-6 text-center text-sm text-slate-400">
        © 2026 DSR Solution. All rights reserved.
      </footer>

      {/* Privacy / Terms Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={() => setShowModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto text-slate-900" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-xl font-bold">
                {showModal === 'privacy' ? 'Kebijakan Privasi' : 'Syarat & Ketentuan'}
              </h2>
              <button onClick={() => setShowModal(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 prose prose-sm max-w-none text-slate-700 leading-relaxed whitespace-pre-line">
              {showModal === 'privacy' ? t('privacyPolicyText') : t('termsText')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
