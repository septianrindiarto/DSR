import { useState } from "react";
import { Link } from "react-router-dom";
import AdminSidebar from "./AdminSidebar";
import PageHelp from "./PageHelp";
import NotificationBell from "./NotificationBell";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

const NUDGE_KEY = "dsr-2fa-nudge-until";
const nudgeSnoozed = () => { try { return Number(localStorage.getItem(NUDGE_KEY) || 0) > Date.now(); } catch { return false; } };

export default function AdminLayout({ children, title, subtitle }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth();
  // RBAC v2: agency still in legal "setup" mode → can set up, can't take orders.
  const setupMode = user?.accountType === "agency" && user?.legalStatus === "setup" && user?.role !== "superadmin";
  const { t } = useLanguage();
  // Security batch 2: nudge admins to turn on two-step verification (optional).
  const [snoozed, setSnoozed] = useState(nudgeSnoozed);
  const show2faNudge = !snoozed && !user?.isDemo && !user?.twoFactorEnabled && (user?.role === "admin" || user?.role === "superadmin");
  const snooze = () => { try { localStorage.setItem(NUDGE_KEY, String(Date.now() + 7 * 86400000)); } catch { /* ignore */ } setSnoozed(true); };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f8f5f5] font-[Inter,sans-serif] text-slate-900 antialiased">
      <AdminSidebar
        mobileMenuOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#f8f5f5] relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <img
              src="/dsr-logo.png"
              alt="DSR Solution"
              className="h-8 w-auto"
            />
            <span className="font-bold text-slate-900">DSR Solution</span>
          </div>
          <button
            className="p-2 text-slate-500 hover:text-primary cursor-pointer"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        </header>

        {/* ⓘ page guide (help.id.js) */}
        <PageHelp />
        {/* 🔔 per-user notifications + "Perlu tindakan" */}
        <NotificationBell />

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:px-12">
          <div className="max-w-7xl mx-auto space-y-8">
            {setupMode && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
                <span className="inline-flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px]">verified_user</span>
                  Akun agency Anda dalam mode persiapan. Lengkapi dokumen legal (NIB, Akta, NPWP, KTP, No. telepon) agar dapat menerima & mengklaim order dan terlihat oleh klien.
                </span>
                <Link to="/admin/settings?section=legal" className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">Lengkapi dokumen</Link>
              </div>
            )}
            {show2faNudge && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-center justify-between gap-3 flex-wrap">
                <span className="inline-flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px]">shield_lock</span>
                  {t("sec2faNudge")}
                </span>
                <span className="flex items-center gap-2">
                  <Link to="/admin/settings?section=security" className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">{t("sec2faEnable")}</Link>
                  <button type="button" onClick={snooze} className="text-xs text-blue-700 hover:underline cursor-pointer">{t("sec2faLater")}</button>
                </span>
              </div>
            )}
            {children}

            {/* Footer */}
            <footer className="pt-8 text-center text-xs text-slate-400 pb-4">
              <p>© 2026 DSR Solution Admin Panel. Seluruh hak dilindungi.</p>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
