import { useState, useEffect } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";

const API_BASE = 'http://localhost:5000';
const carImgSrc = (url) => url?.startsWith('/uploads') ? `${API_BASE}${url}` : url;

export default function AdminAnalytics() {
  const { t } = useLanguage();
  // Hydrate every panel from cache so all of them render on first paint.
  const [kpis, setKpis] = useState(() => apiCache.get("analytics:kpis") || null);
  const [trends, setTrends] = useState(() => apiCache.get("analytics:trends") || []);
  const [topCars, setTopCars] = useState(() => apiCache.get("analytics:topCars:5") || []);
  const [categories, setCategories] = useState(() => apiCache.get("analytics:categories") || []);
  const [topCustomers, setTopCustomers] = useState(() => apiCache.get("analytics:customers") || []);
  const [loading, setLoading] = useState(() => !apiCache.has("analytics:kpis"));

  useEffect(() => { loadAnalytics(); }, []);

  function loadAnalytics() {
    // Each panel refreshes independently — slow ones don't block fast ones.
    swr("analytics:kpis", () => api.analytics.kpis(), (k) => { setKpis(k); setLoading(false); })
      .catch(err => { console.error("Failed to load kpis:", err); setLoading(false); });
    swr("analytics:trends", () => api.analytics.trends(), (d) => setTrends(Array.isArray(d) ? d : []))
      .catch(err => console.error("Failed to load trends:", err));
    swr("analytics:topCars:5", () => api.analytics.topCars(5), (d) => setTopCars(Array.isArray(d) ? d : []))
      .catch(err => console.error("Failed to load top cars:", err));
    swr("analytics:categories", () => api.analytics.categories(), (d) => setCategories(Array.isArray(d) ? d : []))
      .catch(err => console.error("Failed to load categories:", err));
    swr("analytics:customers", () => api.analytics.customers(), (d) => setTopCustomers(Array.isArray(d) ? d : []))
      .catch(err => console.error("Failed to load customers:", err));
  }

  const formatPrice = (p) => `Rp ${Number(p || 0).toLocaleString("id-ID")}`;
  const formatShortPrice = (p) => {
    const n = Number(p || 0);
    if (n >= 1000000) return `Rp${(n / 1000000).toFixed(1)}jt`;
    if (n >= 1000) return `Rp${(n / 1000).toFixed(0)}rb`;
    return `Rp${n}`;
  };

  // No full-page spinner gate — each panel renders progressively from cache.

  const maxTrendOrders = trends.length > 0 ? Math.max(...trends.map(t => Number(t.total_orders || 0)), 1) : 1;
  const maxTrendRevenue = trends.length > 0 ? Math.max(...trends.map(t => Number(t.revenue || 0)), 1) : 1;

  return (
    <AdminLayout>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("analytics")}</h1>
        <p className="text-slate-500 text-sm mt-1">Analisis data pemesanan, pendapatan, dan pelanggan</p>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Total Order", value: kpis.total_orders || 0, icon: "receipt_long", color: "bg-blue-500" },
            { label: t("completed"), value: kpis.completed_orders || 0, icon: "check_circle", color: "bg-green-500" },
            { label: t("cancelled"), value: kpis.cancelled_orders || 0, icon: "cancel", color: "bg-red-500" },
            { label: t("revenue"), value: formatShortPrice(kpis.total_revenue), icon: "payments", color: "bg-primary" },
            { label: t("avgRentalDays"), value: `${Number(kpis.avg_rental_days || 0).toFixed(1)} hari`, icon: "schedule", color: "bg-amber-500" },
            { label: t("avgOrderValue"), value: formatShortPrice(kpis.avg_order_value), icon: "trending_up", color: "bg-purple-500" },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className={`${kpi.color} text-white p-2 rounded-lg w-fit mb-3`}>
                <span className="material-symbols-outlined text-[20px]">{kpi.icon}</span>
              </div>
              <p className="text-xs text-slate-500 font-medium">{kpi.label}</p>
              <p className="text-lg font-bold text-slate-900 mt-0.5">{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Booking Trends (Bar Chart) */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-bold text-slate-900 mb-4">{t("bookingTrends")}</h2>
          {trends.length > 0 ? (
            <div className="space-y-2">
              {trends.map((item) => (
                <div key={item.month} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 shrink-0 font-mono">{item.month}</span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-6 bg-slate-50 rounded overflow-hidden">
                      <div
                        className="h-full bg-primary/80 rounded flex items-center pl-2"
                        style={{ width: `${(Number(item.total_orders) / maxTrendOrders) * 100}%`, minWidth: '24px' }}
                      >
                        <span className="text-[10px] font-bold text-white">{item.total_orders}</span>
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 w-20 text-right">{formatShortPrice(item.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-400 text-sm text-center py-8">{t("noData")}</p>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-bold text-slate-900 mb-4">{t("categoryBreakdown")}</h2>
          {categories.length > 0 ? (
            <div className="space-y-3">
              {categories.map((cat, i) => {
                const maxBooking = Math.max(...categories.map(c => Number(c.booking_count || 0)), 1);
                const colors = ["bg-primary", "bg-blue-500", "bg-green-500", "bg-amber-500", "bg-purple-500"];
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700 font-medium">{cat.type} <span className="text-slate-400">({cat.category})</span></span>
                      <span className="text-slate-600 font-bold">{cat.booking_count} order</span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${colors[i % colors.length]} rounded-full`} style={{ width: `${(Number(cat.booking_count) / maxBooking) * 100}%` }}></div>
                    </div>
                    <p className="text-xs text-slate-400">{formatPrice(cat.total_revenue)}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-400 text-sm text-center py-8">{t("noData")}</p>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Cars */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-5 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">{t("topCars")}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {topCars.map((car, i) => (
              <div key={car.id} className="flex items-center gap-4 px-5 py-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">
                  #{i + 1}
                </div>
                <img src={carImgSrc(car.image)} alt={car.name} className="h-10 w-14 rounded object-cover" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{car.brand} {car.name}</p>
                  <p className="text-xs text-slate-400">{car.type} • {car.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{car.booking_count}x</p>
                  <p className="text-xs text-slate-400">{formatShortPrice(car.total_revenue)}</p>
                </div>
              </div>
            ))}
            {topCars.length === 0 && (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">{t("noData")}</div>
            )}
          </div>
        </div>

        {/* Top Customers */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-5 border-b border-slate-100">
            <h2 className="font-bold text-slate-900">{t("customerAnalytics")}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {topCustomers.slice(0, 10).map((cust, i) => (
              <div key={cust.id} className="flex items-center gap-4 px-5 py-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                  {cust.name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{cust.name}</p>
                  <p className="text-xs text-slate-400">
                    {cust.customer_type === "company" ? "🏢 " : "👤 "}
                    {cust.status?.toUpperCase()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{cust.total_orders || 0} order</p>
                  <p className="text-xs text-slate-400">{formatShortPrice(cust.total_spent)}</p>
                </div>
              </div>
            ))}
            {topCustomers.length === 0 && (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">{t("noData")}</div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
