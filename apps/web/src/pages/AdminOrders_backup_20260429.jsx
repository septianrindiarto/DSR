import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";
import TablePagination, { usePagination } from "../components/TablePagination";

const statusColors = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-700",
};

// ─── Column Definitions ─────────────────────────────────────────────
// Each column maps to a backend field and knows how to render its cell
// align: header always centered; cell uses this — "right" for numbers, "left" for text.
const COLUMN_DEFS = [
  { key: "no",            labelKey: "no_",            minWidth:  50, sortable: false, align: "right" },
  { key: "kodeTransaksi", labelKey: "kodeTransaksi", minWidth: 120, sortable: true, sortField: "orderNumber",  align: "left" },
  { key: "nama",          labelKey: "nama",          minWidth: 160, sortable: false, align: "left" },
  { key: "companyName",   labelKey: "companyName",   minWidth: 160, sortable: false, align: "left" },
  { key: "paket",         labelKey: "paket",         minWidth: 120, sortable: true, sortField: "package",      align: "left" },
  { key: "pickupDate",    labelKey: "pickupDate",    minWidth: 130, sortable: true, sortField: "pickupDate",   align: "left" },
  { key: "returnDate",    labelKey: "returnDate",    minWidth: 130, sortable: true, sortField: "returnDate",   align: "left" },
  { key: "jumlahHari",    labelKey: "jumlahHari",    minWidth:  90, sortable: true, sortField: "totalDays",    align: "right" },
  { key: "mobil",         labelKey: "car",           minWidth: 160, sortable: false, align: "left" },
  { key: "plat",          labelKey: "plat",          minWidth: 100, sortable: false, align: "left" },
  { key: "driver",        labelKey: "driver",        minWidth: 140, sortable: false, align: "left" },
  { key: "kontrakHarga",  labelKey: "kontrakHarga",  minWidth: 140, sortable: true, sortField: "totalPrice",   align: "right" },
  { key: "tujuan",        labelKey: "tujuan",        minWidth: 140, sortable: true, sortField: "destination",  align: "left" },
  { key: "inap",          labelKey: "inap",          minWidth:  70, sortable: false, align: "right" },
  { key: "lembur",        labelKey: "lembur",        minWidth:  80, sortable: false, align: "right" },
  { key: "status",        labelKey: "status",        minWidth: 120, sortable: true, sortField: "status",       align: "left" },
  { key: "bailout",       labelKey: "bailout",       minWidth: 120, sortable: true, sortField: "bailout",      align: "right" },
];

const ALL_COLUMN_KEYS = COLUMN_DEFS.map(c => c.key);
const COLUMN_STORAGE_KEY = "dsr:orders:visibleColumns:v1";

function loadVisibleColumns() {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return ALL_COLUMN_KEYS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ALL_COLUMN_KEYS;
    // Keep only valid keys, in the canonical order
    return ALL_COLUMN_KEYS.filter(k => parsed.includes(k));
  } catch {
    return ALL_COLUMN_KEYS;
  }
}

// ─── CSV helpers ────────────────────────────────────────────────────
function toCsv(rows, headers) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const headerRow = headers.map(h => esc(h.label)).join(",");
  const dataRows = rows.map(r => headers.map(h => esc(r[h.key])).join(","));
  return [headerRow, ...dataRows].join("\r\n");
}

function parseCsv(text) {
  // Strip UTF-8 BOM that Excel-saved CSVs carry
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Auto-detect separator — Indonesian Excel exports with `;`, US with `,`.
  // Sniff the header line outside of quotes.
  const firstLine = (text.split(/\r?\n/, 1)[0]) || "";
  let stripped = "", inQ = false;
  for (const c of firstLine) {
    if (c === '"') inQ = !inQ;
    else if (!inQ) stripped += c;
  }
  const semis = (stripped.match(/;/g) || []).length;
  const commas = (stripped.match(/,/g) || []).length;
  const sep = semis > commas ? ";" : ",";

  // Robust CSV parser handling quoted fields + escaped quotes
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === sep) { cur.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else { field += c; }
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return [];
  // Trim every cell — Excel CSVs often leave " 475.000 " kind of padding
  const trim = (s) => String(s ?? "").trim();
  const headers = rows[0].map(trim);
  return rows.slice(1).filter(r => r.length > 0 && r.some(v => trim(v) !== "")).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = trim(r[i]); });
    return obj;
  });
}

// ─── Indonesian-CSV value normalization ──────────────────────────────────────
// Converts the raw cells from a Rekap-style CSV (Indonesian formatted) into
// the plain JSON shape the /api/orders/data/import endpoint expects.

const ID_MONTHS = {
  januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
  juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
};

function normalizeImportDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "-") return null;

  // ISO already (YYYY-MM-DD or full ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;

  // DD/MM/YYYY  or  DD/MM/YY  or  DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) {
    const d = m1[1].padStart(2, "0"), mo = m1[2].padStart(2, "0");
    let y = m1[3]; if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo}-${d}`;
  }

  // "7 September 1993"
  const m2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m2) {
    const mo = ID_MONTHS[m2[2].toLowerCase()];
    if (mo !== undefined) {
      return `${m2[3]}-${String(mo + 1).padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
    }
  }

  // Fall back to JS Date — covers anything else readable
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function normalizeImportNumber(raw) {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).trim();
  if (!s || s === "-") return 0;
  // Strip "Rp", spaces, and Indonesian thousand separators (".")
  // Keep digits, comma (decimal), and minus.
  const cleaned = s.replace(/rp/gi, "").replace(/\s+/g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_ALIASES = {
  done: "completed", selesai: "completed", complete: "completed", completed: "completed",
  pending: "pending", menunggu: "pending",
  confirmed: "confirmed", konfirmasi: "confirmed", dikonfirmasi: "confirmed",
  active: "active", aktif: "active", berjalan: "active",
  cancelled: "cancelled", canceled: "cancelled", batal: "cancelled", dibatalkan: "cancelled",
};

function normalizeImportStatus(raw) {
  if (!raw) return "pending";
  const k = String(raw).trim().toLowerCase();
  return STATUS_ALIASES[k] || "pending";
}

function downloadFile(filename, content, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminOrders() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("pickupDate");
  const [sortOrder, setSortOrder] = useState("desc");
  // Hydrate synchronously from the in-memory cache so the table renders
  // on the FIRST paint when the user navigates back to this tab. The
  // background fetch in loadOrders() will replace it with fresh data.
  const cacheKey = useMemo(
    () => `orders:list:${statusFilter}:${sortBy}:${sortOrder}`,
    [statusFilter, sortBy, sortOrder]
  );
  const [orders, setOrders] = useState(() => apiCache.get(cacheKey)?.data || []);
  const [stats, setStats] = useState(() => apiCache.get("orders:stats") || null);
  const [loading, setLoading] = useState(() => !apiCache.has(cacheKey));
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Drivers + cars are only needed when a modal opens — load them lazily.
  const [drivers, setDrivers] = useState(() => apiCache.get("drivers:available") || []);
  const [cars, setCars] = useState(() => apiCache.get("cars:list:limit=200")?.data || []);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(loadVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const columnPickerRef = useRef(null);

  // Re-fetch only on filter/sort changes — not on every keystroke
  useEffect(() => { loadOrders(); }, [statusFilter, sortBy, sortOrder]);

  // Keep ?search= in URL in sync with the search input
  useEffect(() => {
    const current = searchParams.get("search") || "";
    if (search !== current) {
      const next = new URLSearchParams(searchParams);
      if (search) next.set("search", search);
      else next.delete("search");
      setSearchParams(next, { replace: true });
    }
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to URL changes (e.g. when navigated to from Schedule)
  useEffect(() => {
    const fromUrl = searchParams.get("search") || "";
    if (fromUrl !== search) setSearch(fromUrl);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns)); } catch { /* ignore */ }
  }, [visibleColumns]);

  // Close column picker when clicking outside
  useEffect(() => {
    if (!showColumnPicker) return;
    function handleClickOutside(e) {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target)) {
        setShowColumnPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showColumnPicker]);

  async function loadOrders() {
    // NOTE: search is intentionally applied on the client (see filteredOrders
    // below) so it matches the rendered Indonesian labels — including
    // translated status, formatted dates/prices, etc. The server only
    // handles status filter + sort + pagination.
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    // Pagination is done client-side now so a single fetch covers ALL rows.
    // Search + sort + paginate locally → instant feedback, search hits every record.
    params.set("limit", "5000");
    const listKey = `orders:list:${statusFilter}:${sortBy}:${sortOrder}`;

    // Stale-while-revalidate: render whatever's cached IMMEDIATELY, then
    // refresh in the background. Two independent endpoints fire in parallel.
    swr(listKey, () => api.orders.list(params.toString()), (data) => {
      setOrders(data?.data || []);
      setLoading(false);
    }).catch(err => { console.error("Failed to load orders:", err); setLoading(false); });

    swr("orders:stats", () => api.orders.stats(), (s) => setStats(s))
      .catch(err => console.error("Failed to load order stats:", err));
  }

  // Lazy-load drivers + cars on first modal open instead of blocking the
  // page on initial paint. Most visits to this tab never open the modal.
  async function ensureDriversAndCars() {
    if (drivers.length === 0) {
      swr("drivers:available", () => api.drivers.available(), (d) => setDrivers(d || []))
        .catch(err => console.error("Failed to load drivers:", err));
    }
    if (cars.length === 0) {
      swr("cars:list:limit=200", () => api.cars.list("limit=200"), (c) => setCars(c?.data || []))
        .catch(err => console.error("Failed to load cars:", err));
    }
  }

  // Helper — drop cached order list/stats so the next loadOrders() refetch is fresh.
  function invalidateOrders() {
    apiCache.invalidate("orders:");
  }

  async function handleStatusChange(orderId, newStatus) {
    try {
      await api.orders.updateStatus(orderId, newStatus);
      invalidateOrders();
      loadOrders();
      setSelectedOrder(null);
    } catch (error) { alert(error.message); }
  }

  async function handleAssignDriver(orderId, driverId) {
    try {
      await api.orders.assignDriver(orderId, driverId);
      invalidateOrders();
      loadOrders();
    } catch (error) { alert(error.message); }
  }

  async function handleSendConfirmation(orderId) {
    try {
      const result = await api.orders.sendConfirmation(orderId);
      if (result?.url) window.open(result.url, "_blank");
      invalidateOrders();
      loadOrders();
    } catch (error) { alert(error.message); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.orders.remove(deleteTarget.id);
      setDeleteTarget(null);
      invalidateOrders();
      loadOrders();
    } catch (error) { alert(error.message); }
  }

  async function handleEditSave(payload) {
    try {
      await api.orders.update(editOrder.id, payload);
      setEditOrder(null);
      invalidateOrders();
      loadOrders();
    } catch (error) { alert(error.message); }
  }

  async function handleCreateSave(payload) {
    try {
      await api.orders.create(payload);
      setCreatingOrder(false);
      invalidateOrders();
      loadOrders();
    } catch (error) { alert(error.message); }
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
  const formatDate = (d) => d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
  const formatDateRange = (a, b) => `${formatDate(a)} - ${formatDate(b)}`;

  // Render cell content for a given column key
  function renderCell(col, order, rowIndex) {
    switch (col.key) {
      case "no": return <span className="text-slate-500">{rowIndex + 1}</span>;
      case "kodeTransaksi": return <span className="font-mono text-xs font-bold text-primary">{order.orderNumber}</span>;
      case "nama": return (
        <div>
          <p className="font-medium text-slate-900">{order.customer?.name || "-"}</p>
          <p className="text-xs text-slate-400">{order.customer?.phone || ""}</p>
        </div>
      );
      case "companyName": return <span className="text-slate-700">{order.customer?.companyName || (order.customer?.customerType === "private" ? "Private" : "-")}</span>;
      case "paket": return <span className="text-slate-700">{order.package || "-"}</span>;
      case "tglPemakaian": return <span className="text-slate-600 text-xs">{formatDateRange(order.pickupDate, order.returnDate)}</span>;
      case "jumlahHari": return <span className="text-slate-600">{order.totalDays}</span>;
      case "mobil": return (
        <p className="text-slate-700 text-xs font-medium">
          {order.car ? `${order.car.brand || ""} ${order.car.name || ""}`.trim() : "-"}
        </p>
      );
      case "plat": return <span className="text-slate-700 font-mono text-xs">{order.car?.licensePlate || "-"}</span>;
      case "driver": return <span className="text-slate-700">{order.driver?.name || "-"}</span>;
      case "kontrakHarga": return <span className="font-semibold text-slate-700">{formatPrice(order.totalPrice)}</span>;
      case "tujuan": return <span className="text-slate-700">{order.destination || "-"}</span>;
      case "inap": return <span className="text-slate-600">{Number(order.overnightNights || 0) || "-"}</span>;
      case "lembur": return <span className="text-slate-600">{Number(order.overtimeHours || 0) || "-"}</span>;
      case "status": return <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[order.status]}`}>{t(order.status)}</span>;
      case "bailout": return <span className="text-slate-700">{Number(order.bailout || 0) > 0 ? formatPrice(order.bailout) : "-"}</span>;
      default: return null;
    }
  }

  const visibleCols = useMemo(() => COLUMN_DEFS.filter(c => visibleColumns.includes(c.key)), [visibleColumns]);

  // ─── Client-side search ──────────────────────────────────────────────
  // Build a flat string of every value the user can SEE on the row, then
  // substring-match against the search term. Because we use t() for
  // translations and the same formatters the cells use, searches like
  // "selesai", "dikonfirmasi", "perusahaan", "Rp 2.500.000", or even
  // "26 Apr" all work naturally.
  function buildHaystack(order) {
    const parts = [
      order.orderNumber,
      order.customer?.name,
      order.customer?.companyName,
      order.customer?.phone,
      order.customer?.whatsapp,
      order.customer?.email,
      order.customer?.customerType ? t(order.customer.customerType) : "",
      order.customer?.customerType, // raw enum too, just in case
      order.car?.brand,
      order.car?.name,
      order.car?.licensePlate,
      order.driver?.name,
      order.driver?.phone,
      order.package,
      order.destination,
      order.pickupLocation,
      order.notes,
      formatDate(order.pickupDate),
      formatDate(order.returnDate),
      formatDateRange(order.pickupDate, order.returnDate),
      String(order.totalDays ?? ""),
      formatPrice(order.totalPrice),
      formatPrice(order.dailyRate),
      String(order.overnightNights ?? ""),
      String(order.overtimeHours ?? ""),
      Number(order.bailout || 0) > 0 ? formatPrice(order.bailout) : "",
      order.status ? t(order.status) : "",
      order.status, // raw enum too
    ];
    return parts.filter(Boolean).join(" \u0001 ").toLowerCase();
  }

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(o => buildHaystack(o).includes(q));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, search]);

  // Pagination — auto-resets to page 1 when search/filter/sort change
  const { page, setPage, pageSize, setPageSize, paged: pagedOrders } = usePagination(filteredOrders, {
    storageKey: "dsr:orders:pageSize",
    deps: [search, statusFilter, sortBy, sortOrder],
  });

  // ─── Export (CSV) ─────────────────────────────────────────────────
  async function handleExport() {
    try {
      const data = await api.orders.exportData();
      const headers = COLUMN_DEFS.map(c => ({ key: c.key, label: t(c.labelKey) }));
      // Map server export rows to renderable values per column
      const rows = data.map((r, idx) => ({
        no: idx + 1,
        kodeTransaksi: r.kodeTransaksi,
        nama: r.nama,
        companyName: r.companyName,
        paket: r.paket,
        tglPemakaian: r.tglPemakaian ? new Date(r.tglPemakaian).toLocaleDateString("id-ID") : "",
        jumlahHari: r.jumlahHari,
        mobil: r.mobil,
        plat: r.plat,
        driver: r.driver,
        kontrakHarga: r.kontrakHarga,
        tujuan: r.tujuan,
        inap: r.inap,
        lembur: r.lembur,
        status: r.status,
        bailout: r.bailout,
      }));
      const csv = toCsv(rows, headers);
      // Prepend BOM so Excel correctly detects UTF-8
      downloadFile(`rekap-order-${new Date().toISOString().slice(0, 10)}.csv`, "\ufeff" + csv);
    } catch (error) { alert(error.message); }
  }

  // ─── Import (CSV) ─────────────────────────────────────────────────
  async function handleImportFile(file) {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);

      // Map CSV headers → server keys. We normalize header strings (lowercase,
      // strip whitespace and "/") so " No.", "No.", "no", "no_" all match.
      const headerKey = (h) => String(h || "").toLowerCase().replace(/[\s./_-]+/g, "");
      const aliases = {
        // Order fields
        kodetransaksi: "kodeTransaksi", transactioncode: "kodeTransaksi",
        nama: "nama", namauser: "nama", name: "nama",
        companyname: "companyName", perusahaan: "companyName",
        paket: "paket", package: "paket",
        tglpemakaian: "tglPemakaian", tanggalpemakaian: "tglPemakaian", tanggal: "tglPemakaian", usagedate: "tglPemakaian",
        jumlahhari: "jumlahHari", days: "jumlahHari", totalhari: "jumlahHari", totaldays: "jumlahHari",
        mobil: "mobil", car: "mobil", unit: "mobil",
        plat: "plat", plate: "plat", licenseplate: "plat", nopol: "plat",
        driver: "driver",
        kontrakharga: "kontrakHarga", contractprice: "kontrakHarga", harga: "kontrakHarga",
        tujuan: "tujuan", destination: "tujuan",
        inap: "inap", inapsppd: "inap", overnight: "inap",
        lembur: "lembur", overtime: "lembur",
        status: "status",
        bailout: "bailout", jaminan: "bailout",
      };
      // Per-key value cleaners so we hand the backend numbers/dates/enums
      const normalize = (key, raw) => {
        const v = (raw === undefined || raw === null) ? "" : String(raw).trim();
        if (v === "" || v === "-") {
          if (key === "kontrakHarga" || key === "bailout" || key === "lembur" || key === "inap") return 0;
          if (key === "jumlahHari") return 1;
          return null;
        }
        switch (key) {
          case "tglPemakaian": return normalizeImportDate(v);
          case "kontrakHarga":
          case "bailout":
          case "lembur":
          case "inap":
          case "jumlahHari":
            return normalizeImportNumber(v);
          case "status": return normalizeImportStatus(v);
          default: return v;
        }
      };

      const normalized = rows.map(row => {
        const mapped = {};
        for (const [csvHeader, val] of Object.entries(row)) {
          const key = aliases[headerKey(csvHeader)];
          if (!key) continue; // ignore unrecognized columns
          mapped[key] = normalize(key, val);
        }
        return mapped;
      });

      // Drop rows that have no name AND no order code — they're noise / blanks
      const filtered = normalized.filter(r => r.nama || r.kodeTransaksi);

      if (filtered.length === 0) {
        alert(`${t("importFailed")}: tidak ada baris valid terbaca dari CSV. Pastikan separator (";"  atau ",") dan kolom header sesuai.`);
        return;
      }

      const result = await api.orders.importData(filtered);
      const errLines = (result.errors || []).slice(0, 5).join("\n");
      const tail = errLines ? `\n\nContoh error:\n${errLines}` : "";
      alert(`Impor selesai: ${result.imported} ok, ${result.skipped} skipped${tail}`);
      apiCache.invalidate("orders:");
      loadOrders();
    } catch (error) {
      alert(`${t("importFailed")}: ${error.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // No full-page spinner gate — page renders immediately. Empty-state row
  // in the table body covers the brief moment before the first fetch returns.

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("orderRecap")}</h1>
          <p className="text-slate-500 text-sm mt-1">Kelola semua pesanan sewa mobil</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            accept=".csv,text/csv"
            ref={fileInputRef}
            onChange={(e) => handleImportFile(e.target.files?.[0])}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="px-3 py-2 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">file_upload</span>
            {importing ? "..." : t("import")}
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-2 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">file_download</span>
            {t("export")}
          </button>
          <button
            onClick={() => { ensureDriversAndCars(); setCreatingOrder(true); }}
            className="px-3 py-2 text-sm bg-primary text-white rounded-lg hover:opacity-90 cursor-pointer flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t("addOrder")}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: t("all"), value: stats.total, color: "bg-slate-500", key: "all" },
            { label: t("pending"), value: stats.pending, color: "bg-amber-500", key: "pending" },
            { label: t("confirmed"), value: stats.confirmed, color: "bg-blue-500", key: "confirmed" },
            { label: t("active"), value: stats.active, color: "bg-green-500", key: "active" },
            { label: t("completed"), value: stats.completed, color: "bg-slate-400", key: "completed" },
            { label: t("cancelled"), value: stats.cancelled, color: "bg-red-500", key: "cancelled" },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${statusFilter === s.key ? "border-primary bg-primary/5" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className={`${s.color} h-1.5 w-8 rounded-full mb-2`}></div>
              <p className="text-xs text-slate-500 font-medium">{s.label}</p>
              <p className="text-lg font-bold text-slate-900">{s.value}</p>
            </button>
          ))}
        </div>
      )}

      {/* Search + Columns */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari di semua kolom (order, pelanggan, mobil, plat, paket, tujuan, status, dll.)…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none"
          />
        </div>
        <div className="relative" ref={columnPickerRef}>
          <button
            onClick={() => setShowColumnPicker(v => !v)}
            className="px-3 py-2.5 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">view_column</span>
            {t("columns")}
          </button>
          {showColumnPicker && (
            <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-30 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-700">{t("showColumns")}</p>
                <button
                  onClick={() => setVisibleColumns(ALL_COLUMN_KEYS)}
                  className="text-xs text-primary hover:underline cursor-pointer"
                >
                  {t("resetColumns")}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1">
                {COLUMN_DEFS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(col.key)}
                      onChange={(e) => {
                        setVisibleColumns(prev =>
                          e.target.checked
                            ? ALL_COLUMN_KEYS.filter(k => prev.includes(k) || k === col.key)
                            : prev.filter(k => k !== col.key)
                        );
                      }}
                      className="cursor-pointer"
                    />
                    <span className="text-sm text-slate-700">{t(col.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky pagination — stays in view while scrolling the table */}
      {filteredOrders.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalCount={orders.length}
          filteredCount={filteredOrders.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                {visibleCols.map(col => (
                  <th
                    key={col.key}
                    onClick={col.sortable ? () => handleSort(col.sortField || col.key) : undefined}
                    className={`px-3 py-3 font-semibold text-center ${col.sortable ? "cursor-pointer select-none" : ""}`}
                    style={{ minWidth: col.minWidth }}
                  >
                    <span className="inline-flex items-center justify-center gap-1 align-middle">
                      {t(col.labelKey)}
                      {col.sortable && <SortIcon field={col.sortField || col.key} />}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-3 text-center font-semibold" style={{ minWidth: 140 }}>{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedOrders.map((order, idx) => (
                <tr key={order.id} className="hover:bg-slate-50/60 transition-colors">
                  {visibleCols.map(col => {
                    // Headers always centered; cells align by data type:
                    //   right → numbers (line up digits), left → text (anchor for reading)
                    const alignCls = col.align === "right" ? "text-right tabular-nums"
                                   : col.align === "left"  ? "text-left"
                                   : "text-center";
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-3 align-middle ${alignCls}`}
                      >
                        {renderCell(col, order, (page - 1) * pageSize + idx)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-center align-middle">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => { ensureDriversAndCars(); setSelectedOrder(order); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer" title={t("details")}>
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                      </button>
                      <button onClick={() => { ensureDriversAndCars(); setEditOrder(order); }} className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 cursor-pointer" title={t("edit")}>
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button onClick={() => setDeleteTarget(order)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer" title={t("delete")}>
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr><td colSpan={visibleCols.length + 1} className="px-5 py-12 text-center text-slate-400">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                      {t("loading") || "Memuat..."}
                    </span>
                  ) : t("noData")}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

      {/* Detail Modal */}
      {selectedOrder && (
        <DetailModal
          order={selectedOrder}
          drivers={drivers}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={handleStatusChange}
          onAssignDriver={handleAssignDriver}
          onSendWhatsApp={handleSendConfirmation}
          t={t}
          formatDate={formatDate}
          formatPrice={formatPrice}
          statusColors={statusColors}
        />
      )}

      {/* Edit Modal */}
      {editOrder && (
        <EditModal
          order={editOrder}
          onClose={() => setEditOrder(null)}
          onSave={handleEditSave}
          t={t}
        />
      )}

      {/* Create Modal */}
      {creatingOrder && (
        <EditModal
          isNew
          order={null}
          cars={cars}
          drivers={drivers}
          onClose={() => setCreatingOrder(false)}
          onSave={handleCreateSave}
          t={t}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-red-600">warning</span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">{t("deleteOrder")}</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                {t("confirmDelete")} <span className="font-mono font-bold text-primary">{deleteTarget.orderNumber}</span>
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">
                  {t("cancel")}
                </button>
                <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 cursor-pointer">
                  {t("delete")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

// ─── Detail Modal (existing flow preserved) ──────────────────────────
function DetailModal({ order, drivers, onClose, onStatusChange, onAssignDriver, onSendWhatsApp, t, formatDate, formatPrice, statusColors }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Order {order.orderNumber}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label={t("nama")} value={order.customer?.name || "-"} />
            <InfoRow label={t("companyName")} value={order.customer?.companyName || "-"} />
            <InfoRow label={t("phone")} value={order.customer?.phone || "-"} />
            <InfoRow label={t("paket")} value={order.package || "-"} />
            <InfoRow label={t("car")} value={`${order.car?.brand || ""} ${order.car?.name || ""}`.trim() || "-"} />
            <InfoRow label={t("plat")} value={order.car?.licensePlate || "-"} />
            <InfoRow label={t("status")} value={<span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusColors[order.status]}`}>{t(order.status)}</span>} />
            <InfoRow label={t("driver")} value={order.driver?.name || "Belum ditugaskan"} />
            <InfoRow label={t("pickupDate")} value={formatDate(order.pickupDate)} />
            <InfoRow label={t("returnDate")} value={formatDate(order.returnDate)} />
            <InfoRow label={t("jumlahHari")} value={`${order.totalDays} hari`} />
            <InfoRow label={t("kontrakHarga")} value={formatPrice(order.totalPrice)} />
            <InfoRow label={t("tujuan")} value={order.destination || "-"} />
            <InfoRow label={t("inap")} value={Number(order.overnightNights || 0) || "-"} />
            <InfoRow label={t("lembur")} value={Number(order.overtimeHours || 0) || "-"} />
            <InfoRow label={t("bailout")} value={Number(order.bailout || 0) > 0 ? formatPrice(order.bailout) : "-"} />
          </div>

          {(order.status === "confirmed" || order.status === "active") && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("assignDriver")}</label>
              <select
                value={order.driverId || ""}
                onChange={(e) => onAssignDriver(order.id, parseInt(e.target.value))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer"
              >
                <option value="">-- Pilih Driver --</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.phone})</option>)}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {order.status === "pending" && (
              <button onClick={() => onStatusChange(order.id, "confirmed")} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 cursor-pointer flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                {t("confirmOrder")}
              </button>
            )}
            {order.status === "confirmed" && (
              <>
                <button onClick={() => onStatusChange(order.id, "active")} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer">
                  Mulai Sewa
                </button>
                <button onClick={() => onSendWhatsApp(order.id)} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 cursor-pointer flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">chat</span>
                  {t("sendWhatsApp")}
                </button>
              </>
            )}
            {order.status === "active" && (
              <button onClick={() => onStatusChange(order.id, "completed")} className="flex-1 py-2.5 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700 cursor-pointer">
                Selesai
              </button>
            )}
            {(order.status === "pending" || order.status === "confirmed") && (
              <button onClick={() => onStatusChange(order.id, "cancelled")} className="py-2.5 px-4 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 cursor-pointer">
                {t("cancelOrder")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edit / Create Modal ────────────────────────────────────────────
function EditModal({ order, isNew = false, cars = [], drivers = [], onClose, onSave, t }) {
  const toIso = (d) => d ? new Date(d).toISOString().slice(0, 10) : "";
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    customerName: order?.customer?.name || "",
    companyName: order?.customer?.companyName || "",
    customerType: order?.customer?.customerType || "private",
    customerPhone: order?.customer?.phone || "",
    customerEmail: order?.customer?.email || "",
    carId: order?.carId || "",
    driverId: order?.driverId || "",
    package: order?.package || "",
    pickupDate: toIso(order?.pickupDate) || (isNew ? today : ""),
    returnDate: toIso(order?.returnDate) || (isNew ? today : ""),
    totalDays: order?.totalDays || 1,
    destination: order?.destination || "",
    totalPrice: order?.totalPrice || 0,
    overnightNights: order?.overnightNights || 0,
    overtimeHours: order?.overtimeHours || 0,
    bailout: order?.bailout || 0,
    status: order?.status || "pending",
    notes: order?.notes || "",
  });

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // Auto-compute jumlahHari when dates change in create mode
  useEffect(() => {
    if (!isNew) return;
    if (!form.pickupDate || !form.returnDate) return;
    const a = new Date(form.pickupDate);
    const b = new Date(form.returnDate);
    const ms = b.getTime() - a.getTime();
    const days = Math.max(1, Math.round(ms / 86400000) + 1);
    setForm(prev => ({ ...prev, totalDays: days }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.pickupDate, form.returnDate]);

  function handleSubmit(e) {
    e.preventDefault();
    const payload = { ...form };
    payload.totalDays = Number(payload.totalDays);
    payload.overnightNights = Number(payload.overnightNights);
    payload.overtimeHours = Number(payload.overtimeHours);
    payload.totalPrice = Number(payload.totalPrice);
    payload.bailout = Number(payload.bailout);
    if (isNew) {
      payload.carId = payload.carId ? Number(payload.carId) : null;
      payload.driverId = payload.driverId ? Number(payload.driverId) : null;
      if (!payload.carId) { alert("Mobil wajib dipilih"); return; }
      if (!payload.customerName) { alert("Nama wajib diisi"); return; }
    }
    onSave(payload);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            {isNew ? t("newOrder") : `${t("editOrder")} — ${order?.orderNumber || ""}`}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t("nama")}><input className="input" value={form.customerName} onChange={e => set("customerName", e.target.value)} required={isNew} /></Field>
            <Field label={t("companyName")}><input className="input" value={form.companyName} onChange={e => set("companyName", e.target.value)} /></Field>
            <Field label={t("customerType")}>
              <select className="input" value={form.customerType} onChange={e => set("customerType", e.target.value)}>
                <option value="private">{t("private")}</option>
                <option value="company">{t("company")}</option>
              </select>
            </Field>
            <Field label={t("phone")}><input className="input" value={form.customerPhone} onChange={e => set("customerPhone", e.target.value)} /></Field>
            {isNew && (
              <>
                <Field label={t("email")}><input type="email" className="input" value={form.customerEmail} onChange={e => set("customerEmail", e.target.value)} /></Field>
                <Field label={t("car")}>
                  <select className="input" value={form.carId} onChange={e => set("carId", e.target.value)} required>
                    <option value="">-- Pilih Mobil --</option>
                    {cars.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.brand} {c.name} {c.licensePlate ? `(${c.licensePlate})` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("driver")}>
                  <select className="input" value={form.driverId} onChange={e => set("driverId", e.target.value)}>
                    <option value="">-- Tanpa Driver --</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <Field label={t("paket")}>
              <input className="input" list="paket-options" value={form.package} onChange={e => set("package", e.target.value)} placeholder="Private / All In / Mobil & Driver" />
              <datalist id="paket-options">
                <option value="Private" />
                <option value="All In" />
                <option value="Mobil & Driver" />
                <option value="Lepas Kunci" />
                <option value="Drop" />
              </datalist>
            </Field>
            <Field label={t("tujuan")}><input className="input" value={form.destination} onChange={e => set("destination", e.target.value)} /></Field>
            <Field label={t("pickupDate")}><input type="date" className="input" value={form.pickupDate} onChange={e => set("pickupDate", e.target.value)} required={isNew} /></Field>
            <Field label={t("returnDate")}><input type="date" className="input" value={form.returnDate} onChange={e => set("returnDate", e.target.value)} required={isNew} /></Field>
            <Field label={t("jumlahHari")}><input type="number" min="1" className="input" value={form.totalDays} onChange={e => set("totalDays", e.target.value)} /></Field>
            <Field label={t("kontrakHarga")}><input type="number" min="0" step="any" className="input" value={form.totalPrice} onChange={e => set("totalPrice", e.target.value)} /></Field>
            <Field label={t("inap")}><input type="number" min="0" className="input" value={form.overnightNights} onChange={e => set("overnightNights", e.target.value)} /></Field>
            <Field label={t("lembur")}><input type="number" min="0" step="0.5" className="input" value={form.overtimeHours} onChange={e => set("overtimeHours", e.target.value)} /></Field>
            <Field label={t("bailout")}><input type="number" min="0" step="any" className="input" value={form.bailout} onChange={e => set("bailout", e.target.value)} /></Field>
            <Field label={t("status")}>
              <select className="input" value={form.status} onChange={e => set("status", e.target.value)}>
                <option value="pending">{t("pending")}</option>
                <option value="confirmed">{t("confirmed")}</option>
                <option value="active">{t("active")}</option>
                <option value="completed">{t("completed")}</option>
                <option value="cancelled">{t("cancelled")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("description")}>
            <textarea className="input" rows="2" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">
              {t("cancel")}
            </button>
            <button type="submit" className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">
              {isNew ? t("create") : t("save")}
            </button>
          </div>
        </form>
        <style>{`
          .input { width:100%; padding:0.5rem 0.75rem; border:1px solid rgb(226,232,240); border-radius:0.5rem; font-size:0.875rem; background:white; outline:none; }
          .input:focus { border-color:var(--color-primary,#DC2626); box-shadow:0 0 0 1px var(--color-primary,#DC2626); }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      {children}
    </div>
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
