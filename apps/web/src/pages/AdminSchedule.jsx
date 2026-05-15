import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";

const API_BASE = "http://localhost:5000";
const carImgSrc = (url) => (url?.startsWith("/uploads") ? `${API_BASE}${url}` : url);

const statusColors = {
  confirmed: "#3B82F6",
  active: "#22C55E",
  pending: "#F59E0B",
  completed: "#64748B",
};

export default function AdminSchedule() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState("month");
  // Build a cache key derived from the visible window so flipping back to a
  // previously-viewed month re-renders instantly from cache.
  const cacheKey = `schedule:${view}:${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`;
  const [schedule, setSchedule] = useState(() => apiCache.get(cacheKey)?.data || []);
  const [loading, setLoading] = useState(() => !apiCache.has(cacheKey));
  const [loadError, setLoadError] = useState(null);

  useEffect(() => { loadSchedule(); }, [currentDate, view]);

  function getDateRange() {
    const d = new Date(currentDate);
    if (view === "week") {
      const day = d.getDay();
      const start = new Date(d);
      start.setDate(d.getDate() - day + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    } else {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
  }

  function loadSchedule() {
    const { start, end } = getDateRange();
    const params = new URLSearchParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    const key = `schedule:${view}:${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`;
    setLoadError(null);
    swr(key, () => api.schedule.get(params.toString()), (result) => {
      setSchedule(result?.data || []);
      setLoading(false);
    }).catch(err => {
      console.error("Failed to load schedule:", err);
      setLoadError(err?.message || "Gagal memuat jadwal. Coba refresh halaman.");
      setLoading(false);
    });
  }

  function navigateDate(direction) {
    const d = new Date(currentDate);
    if (view === "week") d.setDate(d.getDate() + direction * 7);
    else d.setMonth(d.getMonth() + direction);
    setCurrentDate(d);
  }

  function goToday() { setCurrentDate(new Date()); }

  function getDaysInRange() {
    const { start, end } = getDateRange();
    const days = [];
    const d = new Date(start);
    while (d <= end) {
      days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  const days = getDaysInRange();
  const formatDateShort = (d) => d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric" });
  const formatMonthYear = (d) => d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  function isBookingOnDay(booking, day) {
    const start = new Date(booking.pickupDate);
    const end = new Date(booking.returnDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    const d = new Date(day);
    d.setHours(12, 0, 0, 0);
    return d >= start && d <= end;
  }

  function isMaintenanceOnDay(maint, day) {
    const d = new Date(maint.scheduledDate);
    return d.toDateString() === day.toDateString();
  }

  const isToday = (d) => d.toDateString() === new Date().toDateString();

  // Backend already filters to eligible cars only (cars with order history).
  // No additional client-side filtering needed.
  const filteredSchedule = schedule;

  // No full-page spinner gate — calendar grid renders immediately.

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("schedule")}</h1>
          <p className="text-slate-500 text-sm mt-1">Timeline pemesanan dan perawatan armada</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            <button onClick={() => setView("week")} className={`px-3 py-2 text-sm cursor-pointer ${view === "week" ? "bg-primary text-white" : "bg-white text-slate-500"}`}>{t("weekView")}</button>
            <button onClick={() => setView("month")} className={`px-3 py-2 text-sm cursor-pointer ${view === "month" ? "bg-primary text-white" : "bg-white text-slate-500"}`}>{t("monthView")}</button>
          </div>
        </div>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <button onClick={() => navigateDate(-1)} className="p-2 hover:bg-slate-100 rounded-lg cursor-pointer">
          <span className="material-symbols-outlined text-slate-600">chevron_left</span>
        </button>
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-slate-900">{formatMonthYear(currentDate)}</h2>
          <button onClick={goToday} className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg font-medium hover:bg-primary/20 cursor-pointer">{t("today")}</button>
        </div>
        <button onClick={() => navigateDate(1)} className="p-2 hover:bg-slate-100 rounded-lg cursor-pointer">
          <span className="material-symbols-outlined text-slate-600">chevron_right</span>
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-blue-500"></div> {t("confirmed")}</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-green-500"></div> {t("active")}</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-amber-500"></div> {t("pending")}</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-slate-500"></div> {t("completed")}</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-red-400"></div> {t("maintenance")}</div>
      </div>

      {/* Load-error banner */}
      {loadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
          <span className="material-symbols-outlined text-red-500 text-[20px] mt-0.5">error</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">Gagal memuat jadwal mobil</p>
            <p className="text-xs text-red-600 mt-0.5">{loadError}</p>
            <p className="text-xs text-red-500 mt-1">
              Jalankan migrasi database di terminal:{" "}
              <code className="bg-red-100 px-1 rounded font-mono">cd apps/api &amp;&amp; npm run migrate -- orders_full</code>
            </p>
          </div>
          <button onClick={() => { setLoadError(null); loadSchedule(); }} className="text-red-400 hover:text-red-600 cursor-pointer" title="Coba lagi">
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>
        </div>
      )}

      {/* Schedule Grid */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-4 py-3 text-left text-slate-500 font-semibold border-r border-slate-200 min-w-[180px] sticky left-0 bg-slate-50 z-10">
                  {t("car")}
                </th>
                {days.map((day) => (
                  <th key={day.toISOString()} className={`px-1 py-3 text-center font-medium min-w-[80px] ${isToday(day) ? "bg-primary/10 text-primary" : "text-slate-500"}`}>
                    {formatDateShort(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSchedule.map(({ car, bookings, maintenance: maint }) => (
                <tr key={car ? car.id : "__unassigned__"} className="border-t border-slate-100 hover:bg-slate-50/40">
                  <td className="px-4 py-3 border-r border-slate-200 sticky left-0 bg-white z-10">
                    {car ? (
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-semibold text-slate-900 text-xs">{car.brand} {car.name}</p>
                          <p className="text-[10px] text-slate-400">{car.licensePlate || car.type}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-12 rounded bg-slate-100 flex items-center justify-center">
                          <span className="material-symbols-outlined text-slate-400 text-base">directions_car</span>
                        </div>
                        <div>
                          <p className="font-semibold text-slate-400 text-xs italic">Tanpa Mobil</p>
                          <p className="text-[10px] text-slate-300">Belum ditugaskan</p>
                        </div>
                      </div>
                    )}
                  </td>
                  {days.map((day) => {
                    const dayBookings = bookings.filter(b => isBookingOnDay(b, day));
                    const maintItem = maint.find(m => isMaintenanceOnDay(m, day));

                    return (
                      <td key={day.toISOString()} className={`px-0.5 py-1 align-top ${isToday(day) ? "bg-primary/5" : ""}`}>
                        <div className="flex flex-col gap-0.5">
                          {dayBookings.map(booking => (
                            <button
                              key={booking.id}
                              onClick={() => navigate(`/admin/orders?search=${encodeURIComponent(booking.orderNumber)}`)}
                              className="w-full px-1 py-1.5 rounded text-[10px] font-medium text-white cursor-pointer hover:opacity-80 transition-opacity leading-tight"
                              style={{ backgroundColor: statusColors[booking.status] || "#6B7280" }}
                              title={`${booking.customer?.name || "Customer"} — ${booking.orderNumber}`}
                            >
                              {booking.customer?.name?.split(" ")[0] || "—"}
                            </button>
                          ))}
                          {maintItem && (
                            <div className="w-full px-1 py-1.5 rounded text-[10px] font-medium bg-red-400 text-white leading-tight" title={maintItem.description}>
                              🔧
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filteredSchedule.length === 0 && (
                <tr><td colSpan={days.length + 1} className="px-5 py-12 text-center text-slate-400">{t("noData")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
