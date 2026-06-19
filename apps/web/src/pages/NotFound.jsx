import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

// NotFound page: rendered by the catch-all <Route path="*"> in App.jsx.
// Closes audit C-02 (no catch-all route blanked the page on any mistyped
// URL). The CTA branches on auth state so a logged-in user goes back to
// their dashboard and an anonymous visitor returns to the public homepage.

export default function NotFound() {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const target = user ? "/admin/dashboard" : "/";
  const targetLabel = user ? t('backToDashboard') : t('backToHome');

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f5f5] px-4 py-12">
      <div className="w-full max-w-md text-center bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
        <div className="inline-flex items-center justify-center size-16 rounded-full bg-primary/10 text-primary mb-5">
          <span className="material-symbols-outlined text-3xl">explore_off</span>
        </div>
        <p className="text-5xl font-black text-slate-900 mb-2">404</p>
        <h1 className="text-xl font-bold text-slate-900 mb-2">{t('pageNotFound')}</h1>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          {t('pageNotFoundDesc')}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            to={target}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors"
          >
            <span className="material-symbols-outlined text-base">home</span>
            {loading ? t('loading') : targetLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
