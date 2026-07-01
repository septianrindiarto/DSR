import { useState, useEffect, useMemo } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../components/Toast";
import { api, apiCache, swr } from "../lib/api";
import { formatDate, formatPrice } from "../lib/dataFormats";

// ─── /admin/claim-orders ─────────────────────────────────────────────────────
// Stage 2 — replaces the old "Permintaan Akses" tab. Lists OPEN (unclaimed)
// bookings the admin may take. Claiming makes the admin/agency responsible for
// fulfilment (and, for an agency, ties the client to that agency). Admin+ only.
export default function AdminClaimOrders() {
  const { t } = useLanguage();
  const toast = useToast();
  const [rows, setRows] = useState(() => apiCache.get("orders:claimable")?.data || []);
  const [loading, setLoading] = useState(() => !apiCache.has("orders:claimable"));
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState(() => new Set()); // selected order codes
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => { load(); }, []);

  function load() {
    swr("orders:claimable", () => api.orders.claimable(), (data) => {
      setRows(Array.isArray(data?.data) ? data.data : []);
      setLoading(false);
    }).catch((err) => { console.error("Failed to load claimable orders:", err); setLoading(false); });
  }

  // Group flat order rows into bookings by shared order code.
  const bookings = useMemo(() => {
    const map = new Map();
    const seq = [];
    for (const o of rows) {
      const key = (o.orderNumber || "").trim() || `id:${o.id}`;
      if (!map.has(key)) { map.set(key, []); seq.push(key); }
      map.get(key).push(o);
    }
    return seq.map((k) => {
      const g = map.get(k);
      const head = g[0];
      return {
        orderNumber: head.orderNumber,
        customerName: head.customerName,
        customer: head.customer,
        pickupDate: head.pickupDate,
        returnDate: head.returnDate,
        total: g.reduce((s, o) => s + Number(o.totalPrice || 0), 0),
        count: g.length,
      };
    });
  }, [rows]);

  async function handleClaim(orderNumber) {
    if (!orderNumber) return;
    setBusy(orderNumber);
    try {
      const res = await api.orders.claimBooking(orderNumber);
      apiCache.invalidate("orders:");
      load();
      toast.success(`Booking ${orderNumber} diklaim (${res?.claimed ?? 0} kendaraan).`);
    } catch (err) {
      toast.error(err.message || "Gagal klaim order.");
    } finally {
      setBusy("");
    }
  }

  // ── Bulk selection helpers ──────────────────────────────────────────────
  const allCodes = useMemo(() => bookings.map((b) => b.orderNumber).filter(Boolean), [bookings]);
  const allSelected = allCodes.length > 0 && allCodes.every((c) => selected.has(c));

  function toggleOne(code) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allCodes));
  }

  async function handleBulkClaim() {
    const codes = allCodes.filter((c) => selected.has(c));
    if (codes.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api.orders.claimBookingsBulk(codes);
      apiCache.invalidate("orders:");
      setSelected(new Set());
      load();
      toast.success(`${res?.bookings ?? 0} booking diklaim (${res?.vehicles ?? 0} kendaraan).`);
    } catch (err) {
      toast.error(err.message || "Gagal klaim massal.");
    } finally {
      setBulkBusy(false);
    }
  }

  // Drop selections that are no longer claimable (e.g. after a reload).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(allCodes);
      const next = new Set([...prev].filter((c) => valid.has(c)));
      return next.size === prev.size ? prev : next;
    });
  }, [allCodes]);

  return (
    <AdminLayout>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("claimOrders")}</h1>
        <p className="text-slate-500 text-sm mt-1">
          Order terbuka yang belum ditangani. Klaim untuk menjadi penanggung jawab layanan.
        </p>
      </div>

      {/* Bulk action bar — shows when one or more bookings are selected. */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 mt-4 px-4 py-3 rounded-xl bg-primary/10 border border-primary/30">
          <span className="text-sm font-medium text-slate-700">
            {selected.size} booking terpilih
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
            >
              Batal pilih
            </button>
            <button
              onClick={handleBulkClaim}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">how_to_reg</span>
              {bulkBusy ? "..." : `Klaim ${selected.size} terpilih`}
            </button>
          </div>
        </div>
      )}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-center font-semibold w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={loading || allCodes.length === 0}
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                    aria-label="Pilih semua"
                  />
                </th>
                <th className="px-5 py-3 text-left font-semibold">{t("kodeTransaksi") || "Kode"}</th>
                <th className="px-5 py-3 text-left font-semibold">{t("nama")}</th>
                <th className="px-5 py-3 text-left font-semibold">{t("pickupDate")}</th>
                <th className="px-3 py-3 text-center font-semibold">{t("car")}</th>
                <th className="px-5 py-3 text-right font-semibold">{t("kontrakHarga")}</th>
                <th className="px-5 py-3 text-center font-semibold">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    {t("loading")}
                  </span>
                </td></tr>
              )}
              {!loading && bookings.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400">{t("noData")}</td></tr>
              )}
              {bookings.map((b) => (
                <tr key={b.orderNumber} className={`hover:bg-slate-50/60 transition-colors ${selected.has(b.orderNumber) ? "bg-primary/5" : ""}`}>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(b.orderNumber)}
                      onChange={() => toggleOne(b.orderNumber)}
                      className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                      aria-label={`Pilih ${b.orderNumber}`}
                    />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs font-bold text-primary">{b.orderNumber}</td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{b.customerName || b.customer?.name || "-"}</p>
                    <p className="text-xs text-slate-400">{b.customer?.companyName || (b.customer?.customerType === "private" ? "Private" : "-")}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-600 text-xs whitespace-nowrap">
                    {formatDate(b.pickupDate)} – {formatDate(b.returnDate)}
                  </td>
                  <td className="px-3 py-3 text-center text-slate-600">{b.count}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-700 tabular-nums">{formatPrice(b.total)}</td>
                  <td className="px-5 py-3 text-center">
                    <button
                      onClick={() => handleClaim(b.orderNumber)}
                      disabled={busy === b.orderNumber}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">how_to_reg</span>
                      {busy === b.orderNumber ? "..." : t("claim")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}
