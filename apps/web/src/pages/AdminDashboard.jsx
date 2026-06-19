import { useState, useEffect } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";
import DashboardBookingForm from "../components/DashboardBookingForm";

// ─── Page intentionally stripped to scaffold ──────────────────────────────
// Per request: every dashboard widget (KPI cards, Recent Orders, Fleet Status,
// Customer/Driver/Schedule summaries) has been removed. The "Customize Widgets"
// button + modal + preferences plumbing are kept intact so that re-introduced
// widgets later can plug into the existing toggle system without rebuilding it.
//
// To add a new widget later:
//   1. Append it to the prefs list returned by api.dashboard.getPrefs().
//   2. Render its block here gated by `isWidgetEnabled("<widget_id>")`.
//   3. If it needs its own data, add a swr() call in loadDashboard().

export default function AdminDashboard() {
  const { t } = useLanguage();

  // Widget prefs — drives the modal's checkbox list. Hydrate from cache so the
  // page renders immediately when the user revisits.
  const [widgets, setWidgets] = useState(() => apiCache.get("dashboard:prefs") || null);
  const [showWidgetModal, setShowWidgetModal] = useState(false);

  useEffect(() => {
    // Only the widget-preferences fetch survives. Add resource-specific swr()
    // calls here when re-introducing a widget that needs backend data.
    swr("dashboard:prefs", () => api.dashboard.getPrefs(), (p) => setWidgets(p))
      .catch(err => console.error("Failed to load prefs:", err));
  }, []);

  async function saveWidgets(newWidgets) {
    setWidgets(newWidgets);
    try {
      await api.dashboard.savePrefs(newWidgets);
    } catch (error) {
      console.error("Failed to save preferences:", error);
    }
  }

  function toggleWidget(widgetId) {
    if (!widgets) return;
    const updated = widgets.map((w) =>
      w.id === widgetId ? { ...w, enabled: !w.enabled } : w
    );
    saveWidgets(updated);
  }

  // Kept for future widget gating — currently unused but referenced by the
  // pattern future widgets will follow.
  // eslint-disable-next-line no-unused-vars
  const isWidgetEnabled = (id) => {
    if (!widgets) return true;
    const w = widgets.find((w) => w.id === id);
    return w ? w.enabled : true;
  };

  return (
    <AdminLayout>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("dashboard")}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {t('dashboardSubtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowWidgetModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          {t("customizeWidgets")}
        </button>
      </div>

      {/* Primary action — booking form. This replaced the old "Tambah Rekap"
          button inside Rekap Order so the booking entry-point is now front
          and center on the Dashboard for both client admins and client users. */}
      <DashboardBookingForm />

      {/* Empty state — placeholder for future widgets */}
      <div className="bg-white rounded-xl border border-dashed border-slate-300 shadow-sm py-12 px-6 text-center">
        <span className="material-symbols-outlined text-[40px] text-slate-300 mb-2 block">
          dashboard_customize
        </span>
        <h2 className="text-base font-bold text-slate-700">{t('widgetsComingSoon')}</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          {t('widgetsComingSoonDesc').replace('{btn}', t('customizeWidgets'))}
        </p>
      </div>

      {/* Widget Customization Modal — kept intact */}
      {showWidgetModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowWidgetModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">{t("customizeWidgets")}</h2>
              <button onClick={() => setShowWidgetModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-3">
              {widgets && widgets.length > 0 ? (
                widgets.map((widget) => (
                  <label
                    key={widget.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={widget.enabled}
                      onChange={() => toggleWidget(widget.id)}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="text-sm font-medium text-slate-700">{widget.label}</span>
                  </label>
                ))
              ) : (
                <p className="text-sm text-slate-400 text-center py-6">
                  {t('noWidgetsConfigurable')}
                </p>
              )}
            </div>
            <button
              onClick={() => setShowWidgetModal(false)}
              className="w-full mt-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark transition-colors cursor-pointer"
            >
              {t("save")}
            </button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
