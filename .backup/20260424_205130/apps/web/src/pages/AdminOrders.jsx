import { useState, useEffect } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api } from "../lib/api";

const statusColors = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-700",
};

export default function AdminOrders() {
  const { t } = useLanguage();
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [drivers, setDrivers] = useState([]);

  useEffect(() => { loadOrders(); }, [search, statusFilter, sortBy, sortOrder]);

  async function loadOrders() {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      params.set("limit", "50");

      const [data, statsData, driversData] = await Promise.all([
        api.orders.list(params.toString()),
        api.orders.stats(),
        api.drivers.available(),
      ]);
      setOrders(data.data || []);
      setStats(statsData);
      setDrivers(driversData);
    } catch (error) {
      console.error("Failed to load orders:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(orderId, newStatus) {
    try {
      await api.orders.updateStatus(orderId, newStatus);
      loadOrders();
      setSelectedOrder(null);
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleAssignDriver(orderId, driverId) {
    try {
      await api.orders.assignDriver(orderId, driverId);
      loadOrders();
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleSendConfirmation(orderId) {
    try {
      const result = await api.orders.sendConfirmation(orderId);
      if (result?.url) {
        window.open(result.url, "_blank");
      }
      loadOrders();
    } catch (error) {
      alert(error.message);
    }
  }

  function handleSort(field) {
    if (sortBy === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortOrder("asc"); }
  }

  function SortIcon({ field }) {
    if (sortBy !== field) return <span className="material-symbols-outlined text-[14px] text-slate-300 ml-1">unfold_more</span>;
    return <span className="material-symbols-outlined text-[14px] text-primary ml-1">{sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}</span>;
  }

  const formatPrice = (p) => `Rp ${Number(p || 0).toLocaleString("id-ID")}`;
  const formatDate = (d) => d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "-";

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("orderRecap")}</h1>
        <p className="text-slate-500 text-sm mt-1">Kelola semua pesanan sewa mobil</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: t("all"), value: stats.total, color: "bg-slate-500" },
            { label: t("pending"), value: stats.pending, color: "bg-amber-500" },
            { label: t("confirmed"), value: stats.confirmed, color: "bg-blue-500" },
            { label: t("active"), value: stats.active, color: "bg-green-500" },
            { label: t("completed"), value: stats.completed, color: "bg-slate-400" },
            { label: t("cancelled"), value: stats.cancelled, color: "bg-red-500" },
          ].map(s => (
            <button key={s.label} onClick={() => setStatusFilter(s.label === t("all") ? "all" : Object.keys(statusColors).find(k => t(k) === s.label) || "all")}
              className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${statusFilter === "all" && s.label === t("all") ? "border-primary bg-primary/5" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className={`${s.color} h-1.5 w-8 rounded-full mb-2`}></div>
              <p className="text-xs text-slate-500 font-medium">{s.label}</p>
              <p className="text-lg font-bold text-slate-900">{s.value}</p>
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari no. order, nama pelanggan, atau mobil..."
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => handleSort("orderNumber")}>{t("orderNumber")} <SortIcon field="orderNumber" /></th>
                <th className="px-4 py-3 text-left font-semibold">{t("customer")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("car")}</th>
                <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => handleSort("pickupDate")}>{t("pickupDate")} <SortIcon field="pickupDate" /></th>
                <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => handleSort("totalDays")}>{t("totalDays")} <SortIcon field="totalDays" /></th>
                <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => handleSort("totalPrice")}>{t("totalPrice")} <SortIcon field="totalPrice" /></th>
                <th className="px-4 py-3 text-left font-semibold cursor-pointer select-none" onClick={() => handleSort("status")}>{t("status")} <SortIcon field="status" /></th>
                <th className="px-4 py-3 text-right font-semibold">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map(order => (
                <tr key={order.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-primary">{order.orderNumber}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{order.customer?.name || "-"}</p>
                    <p className="text-xs text-slate-400">{order.customer?.phone || ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {order.car?.image && <img src={order.car.image} alt="" className="h-8 w-12 rounded object-cover" />}
                      <div>
                        <p className="text-slate-700 text-xs font-medium">{order.car?.brand} {order.car?.name}</p>
                        <p className="text-[10px] text-slate-400">{order.car?.licensePlate || ""}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{formatDate(order.pickupDate)} - {formatDate(order.returnDate)}</td>
                  <td className="px-4 py-3 text-slate-600">{order.totalDays} hari</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{formatPrice(order.totalPrice)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[order.status]}`}>{t(order.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setSelectedOrder(order)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer" title={t("details")}>
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                      </button>
                      {order.status === "pending" && (
                        <button onClick={() => handleStatusChange(order.id, "confirmed")} className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 cursor-pointer" title={t("confirmOrder")}>
                          <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        </button>
                      )}
                      {order.status === "confirmed" && (
                        <button onClick={() => handleSendConfirmation(order.id)} className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 cursor-pointer" title={t("sendWhatsApp")}>
                          <span className="material-symbols-outlined text-[18px]">chat</span>
                        </button>
                      )}
                      {(order.status === "pending" || order.status === "confirmed") && (
                        <button onClick={() => handleStatusChange(order.id, "cancelled")} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer" title={t("cancelOrder")}>
                          <span className="material-symbols-outlined text-[18px]">cancel</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-400">{t("noData")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedOrder(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Order {selectedOrder.orderNumber}</h2>
              <button onClick={() => setSelectedOrder(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <InfoRow label={t("customer")} value={selectedOrder.customer?.name || "-"} />
                <InfoRow label={t("phone")} value={selectedOrder.customer?.phone || "-"} />
                <InfoRow label={t("car")} value={`${selectedOrder.car?.brand} ${selectedOrder.car?.name}`} />
                <InfoRow label={t("status")} value={<span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusColors[selectedOrder.status]}`}>{t(selectedOrder.status)}</span>} />
                <InfoRow label={t("pickupDate")} value={formatDate(selectedOrder.pickupDate)} />
                <InfoRow label={t("returnDate")} value={formatDate(selectedOrder.returnDate)} />
                <InfoRow label={t("totalDays")} value={`${selectedOrder.totalDays} hari`} />
                <InfoRow label={t("totalPrice")} value={formatPrice(selectedOrder.totalPrice)} />
                <InfoRow label={t("driver")} value={selectedOrder.driver?.name || "Belum ditugaskan"} />
              </div>

              {/* Assign Driver */}
              {(selectedOrder.status === "confirmed" || selectedOrder.status === "active") && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t("assignDriver")}</label>
                  <select
                    value={selectedOrder.driverId || ""}
                    onChange={(e) => handleAssignDriver(selectedOrder.id, parseInt(e.target.value))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer"
                  >
                    <option value="">-- Pilih Driver --</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.phone})</option>)}
                  </select>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                {selectedOrder.status === "pending" && (
                  <button onClick={() => handleStatusChange(selectedOrder.id, "confirmed")}
                    className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 cursor-pointer flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    {t("confirmOrder")}
                  </button>
                )}
                {selectedOrder.status === "confirmed" && (
                  <>
                    <button onClick={() => handleStatusChange(selectedOrder.id, "active")}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer">
                      Mulai Sewa
                    </button>
                    <button onClick={() => handleSendConfirmation(selectedOrder.id)}
                      className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 cursor-pointer flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">chat</span>
                      {t("sendWhatsApp")}
                    </button>
                  </>
                )}
                {selectedOrder.status === "active" && (
                  <button onClick={() => handleStatusChange(selectedOrder.id, "completed")}
                    className="flex-1 py-2.5 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 cursor-pointer">
                    Selesai
                  </button>
                )}
                {(selectedOrder.status === "pending" || selectedOrder.status === "confirmed") && (
                  <button onClick={() => handleStatusChange(selectedOrder.id, "cancelled")}
                    className="py-2.5 px-4 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 cursor-pointer">
                    {t("cancelOrder")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-900">{typeof value === 'string' ? value : value}</p>
    </div>
  );
}
