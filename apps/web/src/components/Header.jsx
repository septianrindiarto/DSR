import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

// Public site Header. Audit M-01: pill labels and CTAs flow through t().
// Also hosts the ID/EN language toggle so anonymous visitors can switch
// language without needing to log in.

export default function Header() {
  const { user, loading } = useAuth();
  const { t, lang, toggleLanguage } = useLanguage();

  return (
    <header className="w-full bg-white border-b border-border-color sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src="/dsr-logo.png" alt="DSR Solution Logo" className="h-12 w-auto" />
            <h1 className="text-xl font-bold tracking-tight text-text-main">
              DSR <span className="text-primary">Solution</span>
            </h1>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language toggle, visible on every public page. Compact pill
                that flips between ID and EN. The actual flip happens via
                LanguageContext, so all pages re-render in the new locale. */}
            <button
              type="button"
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 h-10 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-bold uppercase tracking-wider transition-colors"
              aria-label="Switch language"
              title={lang === "id" ? "Switch to English" : "Ganti ke Bahasa Indonesia"}
            >
              <span className="material-symbols-outlined text-[16px] text-slate-400">translate</span>
              <span>{lang}</span>
            </button>

            {loading ? (
              <div className="h-10 w-24 rounded-lg bg-slate-100 animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-3">
                <span className="hidden sm:flex items-center gap-2 text-sm text-slate-600">
                  <span className="material-symbols-outlined text-[18px] text-slate-400">account_circle</span>
                  <span className="font-medium text-slate-700 max-w-[160px] truncate">
                    {user.name || user.email}
                  </span>
                </span>
                <Link
                  to="/admin/dashboard"
                  className="flex items-center justify-center gap-1.5 h-10 px-5 rounded-lg bg-primary hover:bg-primary-dark text-white text-sm font-bold transition-colors shadow-md shadow-primary/20"
                >
                  <span className="material-symbols-outlined text-[18px]">dashboard</span>
                  {t("openDashboard")}
                </Link>
              </div>
            ) : (
              <Link
                to="/admin/login"
                className="flex items-center justify-center h-10 px-6 rounded-lg bg-primary hover:bg-primary-dark text-white text-sm font-bold transition-colors shadow-md shadow-primary/20"
              >
                {t("login")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
