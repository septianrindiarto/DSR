import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";

const statusColors = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-700",
};

export default function AdminDashboard() {
  const { t } = useLanguage();
  // Hydrate every block from cache so the dashboard renders on the FIRST paint
  const [stats, setStats] = useState(() => apiCache.get("dashboard:stats") || null);
  const [recentOrders, setRecentOrders] = useState(() => apiCache.get("dashboard:recent:8") || []);
  const [customerStats, setCustomerStats] = useState(() => apiCache.get("customers:stats") || null);
  const [driverStats, setDriverStats] = useState(() => apiCache.get("drivers:stats") || null);
  const [weekSchedule, setWeekSchedule] = useState(() => apiCache.get("schedule:week") || null);
  const [widgets, setWidgets] = useState(() => apiCache.get("dashboard:prefs") || null);
  const [loading, setLoading] = useState(() => !apiCache.has("dashboard:stats"));
  const [showWidgetModal, setShowWidgetModal] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  function loadDashboard() {
    // Each panel refreshes independently — slow ones don't block fast ones.
    swr("dashboard:stats", () => api.dashboard.stats(), (s) => { setStats(s); setLoading(false); })
      .catch(err => { console.error("Failed to load stats:", err); setLoading(false); });
    swr("dashboard:recent:8", () => api.dashboard.recentOrders(8), (o) => setRecentOrders(o || []))
      .catch(err => console.error("Failed to load recent orders:", err));
    swr("dashboard:prefs", () => api.dashboard.getPrefs(), (p) => setWidgets(p))
      .catch(err => console.error("Failed to load prefs:", err));
    swr("customers:stats", () => api.customers.stats().catch(() => null), (s) => setCustomerStats(s))
      .catch(() => { /* ignore */ });
    swr("drivers:stats", () => api.drivers.stats().catch(() => null), (s) => setDriverStats(s))
      .catch(() => { /* ignore */ });
    swr("schedule:week", () => api.schedule.get().catch(() => null), (s) => setWeekSchedule(s))
      .catch(() => { /* ignore */ });
  }

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

  const formatPrice = (p) => `Rp ${Number(p || 0).toLocaleString("id-ID")}`;
  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";

  const isWidgetEnabled = (id) => {
    if (!widgets) return true;
    const w = widgets.find((w) => w.id === id);
    return w ? w.enabled : true;
  };

  // No full-page spinner gate — each widget renders progressively from cache.

  return (
    <AdminLayout>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("dashboard")}</h1>
          <p className="text-slate-500 text-sm mt-1">
            Ringkasan data dan aktivitas terbaru
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isWidgetEnabled("total_cars") && (
          <StatCard
            icon="directions_car"
            label={t("totalCars")}
            value={stats?.totalCars || 0}
            sub={`${stats?.availableCars || 0} ${t("available")}`}
            color="bg-blue-500"
          />
        )}
        {isWidgetEnabled("pending_orders") && (
          <StatCard
            icon="pending_actions"
            label={t("pendingOrders")}
            value={stats?.pendingOrders || 0}
            sub={`${stats?.activeOrders || 0} ${t("active")}`}
            color="bg-amber-500"
          />
        )}
        {isWidgetEnabled("monthly_orders") && (
          <StatCard
            icon="calendar_month"
            label={t("monthlyOrders")}
            value={stats?.monthlyOrders || 0}
            sub={`${stats?.totalOrders || 0} total`}
            color="bg-green-500"
          />
        )}
        {isWidgetEnabled("revenue") && (
          <StatCard
            icon="payments"
            label={t("revenue")}
            value={formatPrice(stats?.totalRevenue)}
            sub={`${formatPrice(stats?.monthlyRevenue)} bulan ini`}
            color="bg-primary"
            isPrice
          />
        )}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Orders */}
        {isWidgetEnabled("recent_orders") && (
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">{t("recentOrders")}</h2>
              <Link to="/admin/orders" className="text-primary text-sm font-medium hover:underline">
                Lihat Semua →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">{t("orderNumber")}</th>
                    <th className="px-5 py-3 text-left font-semibold">{t("customer")}</th>
                    <th className="px-5 py-3 text-left font-semibold">{t("car")}</th>
                    <th className="px-5 py-3 text-left font-semibold">{t("totalPrice")}</th>
                    <th className="px-5 py-3 text-left font-semibold">{t("status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs font-bold text-primary">
                        {order.orderNumber}
                      </td>
                      <td className="px-5 py-3 text-slate-700">{order.customer?.name || "-"}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {order.car?.brand} {order.car?.name}
                      </td>
                      <td className="px-5 py-3 font-semibold text-slate-700">
                        {formatPrice(order.totalPrice)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[order.status]}`}>
                          {t(order.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {recentOrders.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">{t("noData")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Fleet Status */}
        {isWidgetEnabled("fleet_status") && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-bold text-slate-900 mb-4">{t("fleetStatus")}</h2>
            <div className="space-y-4">
              <FleetBar label={t("available")} value={stats?.availableCars || 0} total={stats?.totalCars || 1} color="bg-green-500" />
              <FleetBar label={t("rented")} value={stats?.rentedCars || 0} total={stats?.totalCars || 1} color="bg-blue-500" />
              <FleetBar label={t("inMaintenance")} value={stats?.maintenanceCars || 0} total={stats?.totalCars || 1} color="bg-amber-500" />
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Menu Cepat</h3>
              {[
                { icon: "directions_car", label: t("fleet"), path: "/admin/fleet" },
                { icon: "receipt_long", label: t("orderRecap"), path: "/admin/orders" },
                { icon: "group", label: t("customers"), path: "/admin/customers" },
                { icon: "badge", label: t("drivers"), path: "/admin/drivers" },
                { icon: "calendar_month", label: t("schedule"), path: "/admin/schedule" },
                { icon: "analytics", label: t("analytics"), path: "/admin/analytics" },
              ].map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 text-slate-600 hover:text-primary transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                  {item.label}
                  <span className="material-symbols-outlined ml-auto text-[16px] text-slate-300">chevron_right</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Secondary Widgets: Pelanggan / Driver / Jadwal Minggu Ini */}
      {(isWidgetEnabled("customer_summary") || isWidgetEnabled("driver_summary") || isWidgetEnabled("schedule_preview")) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {isWidgetEnabled("customer_summary") && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900">{t("customers")}</h2>
                <Link to="/admin/customers" className="text-primary text-sm font-medium hover:underline">
                  {t("details")} →
                </Link>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-purple-500 text-white p-3 rounded-xl">
                  <span className="material-symbols-outlined text-[24px]">group</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Total {t("customers")}</p>
                  <p className="text-2xl font-bold text-slate-900">{customerStats?.total ?? stats?.totalCustomers ?? 0}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <SummaryRow label={t("private")} value={customerStats?.private ?? 0} dot="bg-blue-500" />
                <SummaryRow label={t("company")} value={customerStats?.company ?? 0} dot="bg-emerald-500" />
                <SummaryRow label={t("vip")} value={customerStats?.vip ?? 0} dot="bg-amber-500" />
                <SummaryRow label={t("inactive")} value={customerStats?.inactive ?? 0} dot="bg-slate-400" />
              </div>
            </div>
          )}

          {isWidgetEnabled("driver_summary") && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900">{t("drivers")}</h2>
                <Link to="/admin/drivers" className="text-primary text-sm font-medium hover:underline">
                  {t("details")} →
                </Link>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-cyan-500 text-white p-3 rounded-xl">
                  <span className="material-symbols-outlined text-[24px]">badge</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Total Driver</p>
                  <p className="text-2xl font-bold text-slate-900">{driverStats?.total ?? stats?.totalDrivers ?? 0}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <SummaryRow label={t("active")} value={driverStats?.active ?? 0} dot="bg-green-500" />
                <SummaryRow label={t("inactive")} value={driverStats?.inactive ?? 0} dot="bg-slate-400" />
                <SummaryRow label={t("suspended")} value={driverStats?.suspended ?? 0} dot="bg-red-500" />
              </div>
            </div>
          )}

          {isWidgetEnabled("schedule_preview") && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900">{t("schedule")} — {t("weekView")}</h2>
                <Link to="/admin/schedule" className="text-primary text-sm font-medium hover:underline">
                  {t("details")} →
                </Link>
              </div>
              <SchedulePreview schedule={weekSchedule} t={t} formatDate={formatDate} />
            </div>
          )}
        </div>
      )}

      {/* Widget Customization Modal */}
      {showWidgetModal && widgets && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowWidgetModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">{t("customizeWidgets")}</h2>
              <button onClick={() => setShowWidgetModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-3">
              {(widgets || []).map((widget) => (
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
              ))}
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

function StatCard({ icon, label, value, sub, color, isPrice }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-start gap-4">
      <div className={`${color} text-white p-3 rounded-xl`}>
        <span className="material-symbols-outlined text-[24px]">{icon}</span>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className={`text-xl font-bold text-slate-900 mt-1 ${isPrice ? 'text-base' : ''}`}>{value}</p>
        <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

function FleetBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-600">{label}</span>
        <span className="font-bold text-slate-700">{value}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, dot }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-50">
      <span className="flex items-center gap-2 text-slate-600">
        <span className={`w-2 h-2 rounded-full ${dot}`}></span>
        {label}
      </span>
      <span className="font-bold text-slate-800">{value}</span>
    </div>
  );
}

function SchedulePreview({ schedule, t, formatDate }) {
  // Flatten bookings across all cars and pick the soonest 5 within the week
  const items = (schedule?.data || [])
    .flatMap((carRow) =>
      (carRow.bookings || []).map((b) => ({
        car: carRow.car,
        order: b,
        customer: b.customer,
      }))
    )
    .sort((a, b) => new Date(a.order.pickupDate) - new Date(b.order.pickupDate))
    .slice(0, 5);

  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400 text-sm">
        <span className="material-symbols-outlined text-4xl text-slate-200 mb-2 block">event_available</span>
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <Link
          key={it.order.id}
          to={`/admin/orders?search=${encodeURIComponent(it.order.orderNumber)}`}
          className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-100 hover:bg-slate-50 hover:border-primary/30 transition-colors cursor-pointer"
        >
          <div className="flex flex-col items-center justify-center w-10 h-10 bg-primary/10 text-primary rounded-lg">
            <span className="text-[10px] font-semibold uppercase">{new Date(it.order.pickupDate).toLocaleDateString("id-ID", { month: "short" })}</span>
            <span className="text-sm font-bold leading-none">{new Date(it.order.pickupDate).getDate()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">
              {it.car?.brand} {it.car?.name}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {it.customer?.name || "-"} • {formatDate(it.order.returnDate)}
            </p>
          </div>
          <span className="font-mono text-[10px] font-bold text-primary">{it.order.orderNumber}</span>
        </Link>
      ))}
    </div>
  );
}
