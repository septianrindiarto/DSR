import { useState, useEffect, useMemo } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";

// ─── Month labels (1..12) — leading blank so we can index by 1..12 directly.
const MONTHS_ID = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// Top-5 chart palette — uses brand red as the lead contributor color.
const BAR_COLORS = ["bg-primary", "bg-blue-500", "bg-amber-500", "bg-emerald-500", "bg-violet-500"];

export default function AdminAnalytics() {
  const { t } = useLanguage();

  // Hydrate from cache so the panels render on first paint.
  const [orders, setOrders] = useState(() => apiCache.get("analytics:allOrders")?.data || []);
  const [cars, setCars] = useState(() => apiCache.get("analytics:allCars")?.data || []);
  const [loading, setLoading] = useState(() => !apiCache.has("analytics:allOrders"));

  useEffect(() => {
    // Pull every order; aggregation happens on the client. Limit is intentionally
    // high to cover full-year + previous-year history without paging.
    swr("analytics:allOrders", () => api.orders.list("limit=10000"), (data) => {
      setOrders(Array.isArray(data?.data) ? data.data : []);
      setLoading(false);
    }).catch((err) => { console.error("Failed to load orders:", err); setLoading(false); });

    // Cars are joined client-side to look up `car.price` per order. Needed
    // because not every orders endpoint embeds the full car object.
    swr("analytics:allCars", () => api.cars.list("limit=5000"), (data) => {
      setCars(Array.isArray(data?.data) ? data.data : []);
    }).catch((err) => console.error("Failed to load cars:", err));
  }, []);

  // carId → car.price lookup, falls back to 0 when the car was deleted.
  const carPriceById = useMemo(() => {
    const m = new Map();
    for (const c of cars) m.set(c.id, Number(c.price || 0));
    return m;
  }, [cars]);

  // ─── Build a fixed 5-month window ending at the current month ───────────
  // Example: if today is May 2026 → [May 2026, Apr 2026, Mar 2026, Feb 2026, Jan 2026].
  // If today is March 2026   → [Mar 2026, Feb 2026, Jan 2026, Dec 2025, Nov 2025].
  // The "last year" panel mirrors these months one year earlier.
  const monthWindow = useMemo(() => {
    const now = new Date();
    const win = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      win.push({ year: d.getFullYear(), month: d.getMonth() + 1 }); // month: 1..12
    }
    return win; // newest first
  }, []);

  const headerYear = monthWindow[0].year;
  const headerLastYear = headerYear - 1;

  // ─── Aggregate orders into the fixed 5-month window ─────────────────────
  // Omset = Σ order.totalPrice                 (actual contract value).
  // Net   = Σ (car.price × order.totalDays)    (per-unit rate × rented days).
  //         Example: Avanza Rp415.000 × 2 hari = Rp830.000 per order;
  //                  10 order Avanza @ 2 hari = 10 × 2 × 415.000 = Rp8.300.000.
  // car.price is resolved by joining order.carId against the cars list, with
  // order.car.price (when embedded) or order.unitPrice as fallbacks.
  // totalDays falls back to 1 when missing/zero so a one-off entry still nets
  // a full day instead of disappearing silently.
  const yearData = useMemo(() => {
    const blank = () => ({ totalOrder: 0, totalDays: 0, omset: 0, net: 0 });

    // key = `${year}-${month}` — one bucket per requested cell.
    const cells = new Map();
    for (const { year, month } of monthWindow) {
      cells.set(`${year}-${month}`, blank());
      cells.set(`${year - 1}-${month}`, blank());
    }

    const resolveCarPrice = (o) => {
      const lookup = carPriceById.get(o.carId ?? o.car?.id);
      if (lookup != null) return lookup;
      if (o.car?.price != null) return Number(o.car.price);
      if (o.unitPrice != null) return Number(o.unitPrice);
      return 0;
    };

    for (const o of orders) {
      const raw = o.pickupDate || o.createdAt;
      if (!raw) continue;
      const d = new Date(raw);
      if (isNaN(d.getTime())) continue;

      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const row = cells.get(key);
      if (!row) continue; // outside window

      const days = Math.max(1, Number(o.totalDays || 0));
      row.totalOrder += 1;
      row.totalDays += days;
      row.omset += Number(o.totalPrice || 0);
      row.net += resolveCarPrice(o) * days;
    }

    const buildPanel = (yearOffset) => {
      const rows = monthWindow.map(({ year, month }) => {
        const y = year + yearOffset;
        const r = cells.get(`${y}-${month}`) || blank();
        return { monthLabel: `${MONTHS_ID[month]} ${y}`, ...r };
      });
      const totals = rows.reduce(
        (acc, r) => ({
          totalOrder: acc.totalOrder + r.totalOrder,
          totalDays: acc.totalDays + r.totalDays,
          omset: acc.omset + r.omset,
          net: acc.net + r.net,
        }),
        { totalOrder: 0, totalDays: 0, omset: 0, net: 0 }
      );
      return { rows, totals };
    };

    return { current: buildPanel(0), last: buildPanel(-1) };
  }, [orders, monthWindow, carPriceById]);

  // ─── Top 5 contributors (by omset) ────────────────────────────────────────
  // All non-corporate orders collapse into a SINGLE bucket regardless of how
  // the source data labeled them. An order counts as private when ANY of the
  // following is true:
  //   • customer.customerType === "private"
  //   • customer.companyName is empty
  //   • customer.companyName, lowercased, matches "private" or "pribadi"
  // The bucket is displayed with the i18n label t("private") so the wording
  // matches the active language ("Pribadi" in id, "Private" in en).
  const PRIVATE_KEY = "__private__";
  const contributors = useMemo(() => {
    const bucket = new Map();
    let grandTotal = 0;

    for (const o of orders) {
      const rawCompany = (o.customer?.companyName || "").trim();
      const companyLower = rawCompany.toLowerCase();
      const isPrivate =
        o.customer?.customerType === "private" ||
        !rawCompany ||
        companyLower === "private" ||
        companyLower === "pribadi";
      const key = isPrivate ? PRIVATE_KEY : rawCompany;
      const omset = Number(o.totalPrice || 0);
      bucket.set(key, (bucket.get(key) || 0) + omset);
      grandTotal += omset;
    }

    const list = Array.from(bucket.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, value]) => ({
        name: key === PRIVATE_KEY ? t("private") : key,
        value,
        pct: grandTotal > 0 ? (value / grandTotal) * 100 : 0,
      }));

    return { list, grandTotal };
  }, [orders, t]);

  const fmt = (n) => Number(n || 0).toLocaleString("id-ID");

  return (
    <AdminLayout>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("analytics")}</h1>
        <p className="text-slate-500 text-sm mt-1">{t("yoyComparisonSubtitle")}</p>
      </div>

      {/* ─── Insight 1 — YoY comparison table (landscape, side-by-side) ──── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">{t("yoyComparison")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{headerYear} vs {headerLastYear} — 5 bulan terakhir</p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">trending_up</span>
        </div>

        <div className="overflow-x-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <YoYTable
              year={headerYear}
              rows={yearData.current.rows}
              totals={yearData.current.totals}
              t={t}
              fmt={fmt}
              loading={loading}
              accent="primary"
            />
            <div className="border-t lg:border-t-0 lg:border-l border-slate-200">
              <YoYTable
                year={headerLastYear}
                rows={yearData.last.rows}
                totals={yearData.last.totals}
                t={t}
                fmt={fmt}
                loading={loading}
                accent="slate"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Insight 2 — Top 5 contributors (percentage) ──────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">{t("topContributors")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t("topContributorsSubtitle")}</p>
          </div>
          <span className="material-symbols-outlined text-primary text-[24px]">leaderboard</span>
        </div>

        <div className="p-5">
          {contributors.list.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">{t("noData")}</p>
          ) : (
            <div className="space-y-4">
              {contributors.list.map((c, i) => (
                <div key={c.name} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="h-6 w-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="font-medium text-slate-800 truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-slate-500 font-mono">Rp{fmt(c.value)}</span>
                      <span className="text-sm font-bold text-slate-900 w-14 text-right">
                        {c.pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${BAR_COLORS[i % BAR_COLORS.length]} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.max(c.pct, 1.5)}%` }}
                    />
                  </div>
                </div>
              ))}

              {/* Footer summary */}
              <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {t("total")} omset 5 kontributor teratas:&nbsp;
                  <b className="text-slate-700">
                    Rp{fmt(contributors.list.reduce((s, c) => s + c.value, 0))}
                  </b>
                </span>
                <span>
                  {(contributors.list.reduce((s, c) => s + c.pct, 0)).toFixed(1)}% dari total
                </span>
              </div>
            </div>
          )}
        </div>
      </section>
    </AdminLayout>
  );
}

// ─── Sub-component: one year's table ──────────────────────────────────────
function YoYTable({ year, rows, totals, t, fmt, loading, accent }) {
  const accentRing = accent === "primary"
    ? "bg-primary/5 text-primary"
    : "bg-slate-100 text-slate-600";

  return (
    <div>
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded ${accentRing}`}>
          {year}
        </span>
        <span className="text-xs text-slate-500">{rows.length} bulan</span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="bg-white border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
            <th className="text-left font-semibold px-5 py-2.5">{t("month")}</th>
            <th className="text-right font-semibold px-3 py-2.5">Total Order</th>
            <th className="text-right font-semibold px-3 py-2.5">{t("sumDays")}</th>
            <th className="text-right font-semibold px-3 py-2.5">{t("omset")}</th>
            <th className="text-right font-semibold px-5 py-2.5">{t("net")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-slate-400 text-sm">
                {loading ? "Memuat..." : t("noData")}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.monthLabel} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-5 py-2.5 font-medium text-slate-800 whitespace-nowrap">{r.monthLabel}</td>
                <td className="px-3 py-2.5 text-right text-slate-700 font-mono">{fmt(r.totalOrder)}</td>
                <td className="px-3 py-2.5 text-right text-slate-700 font-mono">{fmt(r.totalDays)}</td>
                <td className="px-3 py-2.5 text-right text-slate-700 font-mono">{fmt(r.omset)}</td>
                <td className="px-5 py-2.5 text-right text-slate-900 font-mono font-semibold">{fmt(r.net)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 border-t-2 border-slate-300 font-bold text-slate-900">
            <td className="px-5 py-3">{t("total")}</td>
            <td className="px-3 py-3 text-right font-mono">{fmt(totals.totalOrder)}</td>
            <td className="px-3 py-3 text-right font-mono">{fmt(totals.totalDays)}</td>
            <td className="px-3 py-3 text-right font-mono">{fmt(totals.omset)}</td>
            <td className="px-5 py-3 text-right font-mono">{fmt(totals.net)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
