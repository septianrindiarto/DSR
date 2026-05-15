import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

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
  const navigate = useNavigate();
  const { login, register } = useAuth();
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
        await register(name, email, password);
      } else {
        await login(email, password);
      }
      navigate("/admin/dashboard");
    } catch (err) {
      setError(err.message || "Login gagal. Periksa email dan password Anda.");
    } finally {
      setLoading(false);
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

            {/* Demo login — lets visitors explore the admin panel instantly */}
            <div className="mt-8 pt-6 border-t border-dashed border-slate-300">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
                Hanya ingin lihat-lihat?
              </p>
              <button
                onClick={handleDemoLogin}
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold shadow-lg shadow-emerald-500/30 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">play_circle</span>
                    Coba Demo Admin
                  </>
                )}
              </button>
              <p className="text-[11px] text-slate-400 mt-2">
                Login otomatis sebagai admin demo · data fiktif
              </p>
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

          {/* Login Form */}
          <form
            className="px-8 pb-10 flex flex-col gap-5"
            onSubmit={handleSubmit}
          >
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

            {/* Demo login shortcut */}
            {!isRegister && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-dashed border-slate-200"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                    atau
                  </span>
                </div>
              </div>
            )}
            {!isRegister && (
              <button
                type="button"
                onClick={handleDemoLogin}
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50 font-semibold transition-colors active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">play_circle</span>
                Coba Demo Admin
              </button>
            )}

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
            <div className="p-6 text-sm text-slate-700 leading-relaxed space-y-4">
              {showModal === 'privacy' ? (
                <>
                  <p className="font-semibold">Terakhir diperbarui: 1 Januari 2026</p>
                  <h3 className="text-base font-bold mt-4">1. Pengumpulan Data</h3>
                  <p>Kami mengumpulkan informasi pribadi Anda seperti nama, nomor telepon, email, dan alamat saat Anda melakukan pemesanan sewa mobil.</p>
                  <h3 className="text-base font-bold mt-4">2. Penggunaan Data</h3>
                  <p>Data Anda digunakan untuk memproses pesanan sewa, menghubungi Anda terkait konfirmasi, dan meningkatkan layanan kami.</p>
                  <h3 className="text-base font-bold mt-4">3. Perlindungan Data</h3>
                  <p>Kami menerapkan langkah-langkah keamanan teknis dan organisasi untuk melindungi data pribadi Anda.</p>
                  <h3 className="text-base font-bold mt-4">4. Hak Anda</h3>
                  <p>Anda memiliki hak untuk mengakses, memperbarui, atau menghapus data pribadi Anda.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Terakhir diperbarui: 1 Januari 2026</p>
                  <h3 className="text-base font-bold mt-4">1. Ketentuan Umum</h3>
                  <p>Dengan menggunakan layanan DSR Solution, Anda menyetujui syarat dan ketentuan yang berlaku.</p>
                  <h3 className="text-base font-bold mt-4">2. Persyaratan Penyewa</h3>
                  <p>Penyewa harus berusia minimal 21 tahun, memiliki SIM yang masih berlaku, dan menyerahkan identitas diri.</p>
                  <h3 className="text-base font-bold mt-4">3. Pembayaran</h3>
                  <p>Pembayaran dilakukan di muka. Harga sewa sudah termasuk asuransi dasar.</p>
                  <h3 className="text-base font-bold mt-4">4. Pembatalan</h3>
                  <p>Pembatalan dapat dilakukan maksimal 24 jam sebelum pengambilan. Kurang dari 24 jam dikenakan biaya 50%.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
