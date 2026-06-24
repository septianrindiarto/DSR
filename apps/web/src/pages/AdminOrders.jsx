import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useToast } from "../components/Toast";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api, apiCache, swr } from "../lib/api";
import TablePagination, { usePagination } from "../components/TablePagination";
import SharedImportModal from "../components/SharedImportModal";
import SharedExportModal from "../components/SharedExportModal";
import { exportAs, formatPrice, formatDate, formatDateRange } from "../lib/dataFormats";

const statusColors = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-100 text-red-700",
};

// ─── Column Definitions ─────────────────────────────────────────────
// Each column maps to a backend field and knows how to render its cell.
// align: header always centered; cell uses this — "right" for numbers,
// "left" for text.
//
// We carry TWO column orderings:
//   • COLUMN_DEFS         — full agency view (legacy default, still used as
//                           the master catalog for the column picker).
//   • CLIENT_COLUMN_KEYS  — the 20-column order requested for client view
//                           (matches the screenshot the user supplied):
//                           kodeTransaksi(Kode), nama, companyName, mobil,
//                           driver, pickupDate, returnDate, jumlahHari,
//                           kontrakHarga, status, tujuan, pickupLocation,
//                           paket, notes, createdBy, invoiceNumber,
//                           invoiceSentDate, invoiceDueDate,
//                           invoicePaidDate, invoicePaymentStatus.
const COLUMN_DEFS = [
  { key: "no", labelKey: "no_", minWidth: 50, sortable: false, align: "right" },
  { key: "kodeTransaksi", labelKey: "kodeTransaksi", minWidth: 120, sortable: true, sortField: "orderNumber", align: "left" },
  { key: "nama", labelKey: "nama", minWidth: 160, sortable: false, align: "left" },
  { key: "companyName", labelKey: "companyName", minWidth: 160, sortable: false, align: "left" },
  { key: "paket", labelKey: "paket", minWidth: 120, sortable: true, sortField: "package", align: "left" },
  { key: "pickupDate", labelKey: "pickupDate", minWidth: 130, sortable: true, sortField: "pickupDate", align: "left" },
  { key: "returnDate", labelKey: "returnDate", minWidth: 130, sortable: true, sortField: "returnDate", align: "left" },
  { key: "jumlahHari", labelKey: "jumlahHari", minWidth: 90, sortable: true, sortField: "totalDays", align: "right" },
  { key: "mobil", labelKey: "car", minWidth: 160, sortable: false, align: "left" },
  { key: "plat", labelKey: "plat", minWidth: 100, sortable: false, align: "left" },
  { key: "driver", labelKey: "driver", minWidth: 140, sortable: false, align: "left" },
  { key: "kontrakHarga", labelKey: "kontrakHarga", minWidth: 140, sortable: true, sortField: "totalPrice", align: "right" },
  { key: "tujuan", labelKey: "tujuan", minWidth: 140, sortable: true, sortField: "destination", align: "left" },
  { key: "pickupLocation", labelKey: "pickupLocation", minWidth: 140, sortable: false, align: "left" },
  { key: "inap", labelKey: "inap", minWidth: 70, sortable: false, align: "right" },
  { key: "lembur", labelKey: "lembur", minWidth: 80, sortable: false, align: "right" },
  { key: "status", labelKey: "status", minWidth: 120, sortable: true, sortField: "status", align: "left" },
  { key: "bailout", labelKey: "bailout", minWidth: 120, sortable: true, sortField: "bailout", align: "right" },
  { key: "notes", labelKey: "keterangan", minWidth: 200, sortable: false, align: "left" },
  { key: "createdBy", labelKey: "createdBy", minWidth: 140, sortable: false, align: "left" },
  { key: "invoiceNumber", labelKey: "noInvoice", minWidth: 140, sortable: false, align: "left" },
  { key: "invoiceSentDate", labelKey: "tglKirimInvoice", minWidth: 140, sortable: false, align: "left" },
  { key: "invoiceDueDate", labelKey: "tglDueDateInvoice", minWidth: 150, sortable: false, align: "left" },
  { key: "invoicePaidDate", labelKey: "tglRealisasi", minWidth: 130, sortable: false, align: "left" },
  { key: "invoicePaymentStatus", labelKey: "statusInvoice", minWidth: 130, sortable: false, align: "left" },
];

const ALL_COLUMN_KEYS = COLUMN_DEFS.map(c => c.key);
const COLUMN_STORAGE_KEY = "dsr:orders:visibleColumns:v1";
const CLIENT_COLUMN_STORAGE_KEY = "dsr:orders:visibleColumns:client:v1";

// Order the client view shows by default (matches the screenshot the user
// supplied; "no" row-counter omitted since the screenshot listed business
// fields only and the row-counter is implicit).
const CLIENT_COLUMN_KEYS = [
  "kodeTransaksi",
  "nama",
  "companyName",
  "mobil",
  "driver",
  "pickupDate",
  "returnDate",
  "jumlahHari",
  "kontrakHarga",
  "status",
  "tujuan",
  "pickupLocation",
  "paket",
  "notes",
  "createdBy",
  "invoiceNumber",
  "invoiceSentDate",
  "invoiceDueDate",
  "invoicePaidDate",
  "invoicePaymentStatus",
];

function loadVisibleColumns(isClient = false) {
  // Use a SEPARATE storage key for the client view so toggling between an
  // agency account and a client account on the same machine doesn't blow
  // each other's column preferences away. Defaults differ by view type:
  //   • client → the 20-column screenshot ordering
  //   • agency → the legacy full catalog (every key in COLUMN_DEFS)
  const storageKey = isClient ? CLIENT_COLUMN_STORAGE_KEY : COLUMN_STORAGE_KEY;
  const defaults = isClient ? CLIENT_COLUMN_KEYS : ALL_COLUMN_KEYS;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;

    // ─── Schema migration: tglPemakaian → pickupDate + returnDate ─────────
    // Older saved layouts stored a single "tglPemakaian" column. Now that
    // we render two separate date columns, replace it with both so users
    // don't lose visibility on dates after the column split.
    let migrated = parsed.slice();
    if (migrated.includes("tglPemakaian")) {
      const pos = migrated.indexOf("tglPemakaian");
      migrated.splice(pos, 1, "pickupDate", "returnDate");
    }
    // If the layout was saved before pickupDate/returnDate existed but the
    // user never had tglPemakaian (custom hidden), still ensure both new
    // date columns are at least available — append them if missing.
    if (!migrated.includes("pickupDate")) migrated.push("pickupDate");
    if (!migrated.includes("returnDate")) migrated.push("returnDate");

    // Preserve user-defined ORDER for the client view (so they can re-order
    // columns in the picker later); for agency, keep canonical order.
    if (isClient) {
      const valid = new Set(ALL_COLUMN_KEYS);
      return migrated.filter(k => valid.has(k));
    }
    return ALL_COLUMN_KEYS.filter(k => migrated.includes(k));
  } catch {
    return defaults;
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

  // Handle two-component numeric dates: A/B/YY or A/B/YYYY
  // Excel exports dates in M/D/YYYY (US format); Indonesian files use D/M/YYYY.
  // Detect format direction: whichever component exceeds 12 cannot be the month.
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) {
    let a = parseInt(m1[1], 10);   // first  numeric component
    let b = parseInt(m1[2], 10);   // second numeric component
    let y = m1[3];
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;

    let month, day;
    if (b > 12) {
      // Second component cannot be a month → MM/DD format (Excel/US)
      month = a; day = b;
    } else if (a > 12) {
      // First component cannot be a month → DD/MM format (Indonesian)
      day = a; month = b;
    } else {
      // Both ≤ 12 — ambiguous. Let JS Date decide (it uses MM/DD for "/" strings,
      // matching Excel's default export format which is what most uploads come from).
      const jsDate = new Date(s);
      return isNaN(jsDate.getTime()) ? null : jsDate.toISOString().slice(0, 10);
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  const toast = useToast();
  const { user } = useAuth();
  // Client accounts (both `client` admin and plain `client` users, plus the
  // legacy `client_admin`/`client` roles) see a different default column set —
  // the 20 columns specified in the screenshot. Agency users keep the legacy
  // full catalog. The check mirrors the one used by EditModal below for the
  // company-name dropdown so behaviour stays consistent across the page.
  const isClient =
    user?.accountType === 'client' ||
    user?.role === 'client' || user?.role === 'client_admin';
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
  const [visibleColumns, setVisibleColumns] = useState(() => loadVisibleColumns(isClient));
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const columnPickerRef = useRef(null);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Tier 2 multi-vehicle: which booking groups (by orderNumber) are expanded.
  // A Set of orderNumbers; absence = collapsed. Multi-car bookings collapse
  // to one summary row by default to keep the Rekap compact.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (code) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });
  // Tier 2: per-car driver assignment + whole-booking cancel target the rows
  // of one booking group. Each holds the group object (or null when closed).
  // Multi-car booking row controls: one "Action" form (car + driver + price),
  // plus cancel and delete for the whole booking.
  const [manageBookingTarget, setManageBookingTarget] = useState(null);
  const [cancelBookingTarget, setCancelBookingTarget] = useState(null);
  const [deleteBookingTarget, setDeleteBookingTarget] = useState(null);

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
    // Write to the storage key matching the caller's view. Storing the two
    // sets under separate keys is what keeps a developer toggling between an
    // agency seed account and a client test account from corrupting either
    // layout.
    const storageKey = isClient ? CLIENT_COLUMN_STORAGE_KEY : COLUMN_STORAGE_KEY;
    try { localStorage.setItem(storageKey, JSON.stringify(visibleColumns)); } catch { /* ignore */ }
  }, [visibleColumns, isClient]);

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
    setLoadError(null);
    swr(listKey, () => api.orders.list(params.toString()), (data) => {
      setOrders(data?.data || []);
      setLoading(false);
    }).catch(err => {
      console.error("Failed to load orders:", err);
      setLoadError(err?.message || "Gagal memuat data pesanan. Coba refresh halaman.");
      setLoading(false);
    });

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
    } catch (error) { toast.error(error.message); }
  }

  async function handleAssignDriver(orderId, driverId) {
    try {
      await api.orders.assignDriver(orderId, driverId);
      invalidateOrders();
      loadOrders();
    } catch (error) { toast.error(error.message); }
  }

  async function handleSendConfirmation(orderId) {
    try {
      const result = await api.orders.sendConfirmation(orderId);
      if (result?.url) window.open(result.url, "_blank");
      invalidateOrders();
      loadOrders();
    } catch (error) { toast.error(error.message); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.orders.remove(deleteTarget.id);
      setDeleteTarget(null);
      invalidateOrders();
      loadOrders();
    } catch (error) { toast.error(error.message); }
  }

  async function handleEditSave(payload) {
    try {
      await api.orders.update(editOrder.id, payload);
      setEditOrder(null);
      invalidateOrders();
      loadOrders();
    } catch (error) { toast.error(error.message); }
  }

  async function handleCreateSave(payload) {
    try {
      await api.orders.create(payload);
      setCreatingOrder(false);
      invalidateOrders();
      loadOrders();
    } catch (error) { toast.error(error.message); }
  }

  // Tier 2: save the combined "Action" form — car + driver + price per row.
  async function handleManageBookingSave(items) {
    try {
      const res = await api.orders.updateBookingItems(items);
      setManageBookingTarget(null);
      invalidateOrders();
      loadOrders();
      toast.success(`Booking diperbarui (${res?.updated ?? items.length} kendaraan).`);
    } catch (error) { toast.error(error.message); }
  }

  // Tier 2: delete an entire booking (all cars sharing the order code).
  async function handleDeleteBooking() {
    if (!deleteBookingTarget) return;
    try {
      const res = await api.orders.removeBooking(deleteBookingTarget.orderNumber);
      setDeleteBookingTarget(null);
      invalidateOrders();
      loadOrders();
      toast.success(`Booking ${deleteBookingTarget.orderNumber} dihapus (${res?.deleted ?? 0} kendaraan).`);
    } catch (error) { toast.error(error.message); }
  }

  // Tier 2: cancel an entire booking (all cars sharing the order code).
  async function handleCancelBooking() {
    if (!cancelBookingTarget) return;
    try {
      const res = await api.orders.cancelBooking(cancelBookingTarget.orderNumber);
      setCancelBookingTarget(null);
      invalidateOrders();
      loadOrders();
      toast.success(`Booking ${cancelBookingTarget.orderNumber} dibatalkan (${res?.cancelled ?? 0} kendaraan).`);
    } catch (error) { toast.error(error.message); }
  }

  function handleSort(field) {
    if (sortBy === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortOrder("asc"); }
  }

  function SortIcon({ field }) {
    if (sortBy !== field) return <span className="material-symbols-outlined text-[14px] text-slate-300 ml-1">unfold_more</span>;
    return <span className="material-symbols-outlined text-[14px] text-primary ml-1">{sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}</span>;
  }

  // Audit M-R2: formatPrice / formatDate / formatDateRange now imported
  // from lib/dataFormats.js (shared with CarCard, AdminFleet, exports).


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
      case "pickupDate": return <span className="text-slate-600 text-xs">{formatDate(order.pickupDate)}</span>;
      case "returnDate": return <span className="text-slate-600 text-xs">{formatDate(order.returnDate)}</span>;
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
      case "pickupLocation": return <span className="text-slate-700">{order.pickupLocation || "-"}</span>;
      case "inap": return <span className="text-slate-600">{Number(order.overnightNights || 0) || "-"}</span>;
      case "lembur": return <span className="text-slate-600">{Number(order.overtimeHours || 0) || "-"}</span>;
      case "status": return <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[order.status]}`}>{t(order.status)}</span>;
      case "bailout": return <span className="text-slate-700">{Number(order.bailout || 0) > 0 ? formatPrice(order.bailout) : "-"}</span>;
      case "notes": return (
        <span className="text-slate-700 text-xs line-clamp-2" title={order.notes || ""}>
          {order.notes || "-"}
        </span>
      );
      // The backend stores createdBy as a user id (FK to user.id). The
      // orders list endpoint doesn't currently join the creator row, so we
      // surface the raw id — sufficient for the rekap audit, and the
      // join can be added later without changing this UI contract.
      case "createdBy": return <span className="text-slate-600 text-xs font-mono">{order.createdBy || "-"}</span>;
      case "invoiceNumber": return <span className="text-slate-700 font-mono text-xs">{order.invoiceNumber || "-"}</span>;
      case "invoiceSentDate": return <span className="text-slate-600 text-xs">{formatDate(order.invoiceSentDate)}</span>;
      case "invoiceDueDate": return <span className="text-slate-600 text-xs">{formatDate(order.invoiceDueDate)}</span>;
      case "invoicePaidDate": return <span className="text-slate-600 text-xs">{formatDate(order.invoicePaidDate)}</span>;
      case "invoicePaymentStatus": {
        const s = (order.invoicePaymentStatus || "").toLowerCase();
        const cls = s === "paid" ? "bg-emerald-100 text-emerald-700"
          : s === "pending" ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600";
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{order.invoicePaymentStatus || "-"}</span>;
      }
      default: return null;
    }
  }

  // Render a cell for a multi-car booking's collapsed SUMMARY row.
  //   • kodeTransaksi carries the expand/collapse toggle + "N mobil" badge
  //   • numeric add-on columns (price, bailout, inap, lembur) are summed
  //   • per-car columns (mobil, plat, driver) collapse to a count / dash
  //   • columns that vary across cars (paket) show "Beragam" when they differ
  //   • everything else is shared across the booking → read off the first row
  function renderGroupCell(col, group, rowIndex) {
    const rows = group.rows;
    const first = rows[0];
    const sum = (sel) => rows.reduce((acc, r) => acc + Number(sel(r) || 0), 0);
    const allSame = (sel) => {
      const v = rows.map(r => (sel(r) ?? "").toString().trim());
      return v.every(x => x === v[0]) ? v[0] : null;
    };
    const expanded = expandedGroups.has(group.orderNumber);

    switch (col.key) {
      case "no":
        return <span className="text-slate-500 font-medium">{rowIndex + 1}</span>;
      case "kodeTransaksi":
        return (
          <button
            type="button"
            onClick={() => toggleGroup(group.orderNumber)}
            className="inline-flex items-center gap-1.5 cursor-pointer group/btn"
            title={expanded ? "Tutup rincian" : "Lihat rincian kendaraan"}
          >
            <span className={`material-symbols-outlined text-[18px] text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}>
              chevron_right
            </span>
            <span className="font-mono text-xs font-bold text-primary group-hover/btn:underline">{group.orderNumber}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold whitespace-nowrap">
              {rows.length} mobil
            </span>
          </button>
        );
      case "mobil":
        return <span className="text-slate-500 text-xs italic">{rows.length} kendaraan</span>;
      case "plat":
      case "driver":
        return <span className="text-slate-400">—</span>;
      case "kontrakHarga":
        return <span className="font-bold text-slate-800">{formatPrice(sum(r => r.totalPrice))}</span>;
      case "bailout": {
        const total = sum(r => r.bailout);
        return <span className="text-slate-700">{total > 0 ? formatPrice(total) : "-"}</span>;
      }
      case "inap": {
        const total = sum(r => r.overnightNights);
        return <span className="text-slate-600">{total || "-"}</span>;
      }
      case "lembur": {
        const total = sum(r => r.overtimeHours);
        return <span className="text-slate-600">{total || "-"}</span>;
      }
      case "paket": {
        const same = allSame(r => r.package);
        return <span className="text-slate-700">{same ? (same || "-") : "Beragam"}</span>;
      }
      case "status": {
        const same = allSame(r => r.status);
        if (same) return <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[same]}`}>{t(same)}</span>;
        return <span className="text-slate-500 text-xs italic">Campuran</span>;
      }
      // Shared trip-level fields — identical across every car in the booking.
      default:
        return renderCell(col, first, rowIndex);
    }
  }

  // The per-row action buttons (view / edit / delete). Shared by single rows
  // and the per-car child rows of a multi-car booking.
  function renderActionsCell(order) {
    return (
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
    );
  }

  // Render one data row. Used for standalone bookings AND for the per-car
  // child rows revealed under a multi-car summary. Child rows are indented
  // and show a connector glyph in the code column instead of repeating the
  // shared booking code.
  function renderDataRow(order, displayIndex, opts = {}) {
    const { isChild = false, childLabel = null } = opts;
    return (
      <tr
        key={order.id}
        className={`transition-colors ${isChild ? "bg-slate-50/30 hover:bg-slate-100/50" : "hover:bg-slate-50/60"}`}
      >
        {visibleCols.map(col => {
          const alignCls = col.align === "right" ? "text-right tabular-nums"
            : col.align === "left" ? "text-left"
              : "text-center";
          let content;
          if (isChild && col.key === "no") {
            content = <span className="text-slate-300 text-xs">{childLabel}</span>;
          } else if (isChild && col.key === "kodeTransaksi") {
            content = (
              <span className="inline-flex items-center gap-1 pl-4 text-slate-400">
                <span className="material-symbols-outlined text-[16px]">subdirectory_arrow_right</span>
              </span>
            );
          } else {
            content = renderCell(col, order, displayIndex);
          }
          return (
            <td key={col.key} className={`px-3 py-3 align-middle ${alignCls}`}>
              {content}
            </td>
          );
        })}
        {renderActionsCell(order)}
      </tr>
    );
  }

  // Header label — supports both translated (labelKey) and literal (label)
  // columns. Literal labels are used for the new client-view columns whose
  // Indonesian names aren't part of the shared i18n bundle yet.
  const colLabel = (col) => col.labelKey ? t(col.labelKey) : (col.label || col.key);

  // Visible columns rendered in the order the user (or the default seed) put
  // them in. For clients this preserves the screenshot ordering. For agency
  // it preserves canonical COLUMN_DEFS order because their default was
  // ALL_COLUMN_KEYS which is itself canonical.
  const visibleCols = useMemo(() => {
    const byKey = new Map(COLUMN_DEFS.map(c => [c.key, c]));
    return visibleColumns.map(k => byKey.get(k)).filter(Boolean);
  }, [visibleColumns]);

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

  // ─── Tier 2 multi-vehicle grouping ───────────────────────────────────
  // Rows sharing an orderNumber are one booking (e.g. C073 across 3 cars).
  // We group them so the Rekap shows ONE summary row per booking that
  // expands to reveal the per-car child rows. Rows without a code, or a
  // code that appears only once, are their own single-row "group" and
  // render exactly like before. Grouping is by code regardless of sort
  // order, so a multi-car booking stays together even when the list is
  // sorted by a per-car field like price.
  const groupedOrders = useMemo(() => {
    const map = new Map();
    const seq = [];
    for (const o of filteredOrders) {
      const code = (o.orderNumber || "").trim();
      const key = code ? `code:${code}` : `id:${o.id}`;
      if (!map.has(key)) { map.set(key, []); seq.push(key); }
      map.get(key).push(o);
    }
    return seq.map(key => {
      const rows = map.get(key);
      return {
        key,
        orderNumber: rows[0].orderNumber,
        rows,
        isGroup: rows.length > 1,
      };
    });
  }, [filteredOrders]);

  // Unfiltered booking count (for the "terfilter dari N" pagination label).
  const totalGroupCount = useMemo(() => {
    const codes = new Set();
    let singles = 0;
    for (const o of orders) {
      const code = (o.orderNumber || "").trim();
      if (code) codes.add(code); else singles++;
    }
    return codes.size + singles;
  }, [orders]);

  // Pagination operates on BOOKINGS (groups), not individual rows, so a
  // multi-car booking never splits across a page boundary.
  const { page, setPage, pageSize, setPageSize, paged: pagedGroups } = usePagination(groupedOrders, {
    storageKey: "dsr:orders:pageSize",
    deps: [search, statusFilter, sortBy, sortOrder],
  });

  // ─── Export (CSV) ─────────────────────────────────────────────────
  async function runExport(format) {
    try {
      const data = await api.orders.exportData();
      // Canonical keys (kodeTransaksi, nama, \u2026) flow into every export
      // format. ISO dates make spreadsheet imports/exports unambiguous; the
      // importer below also accepts dd/mm/yyyy from hand-edited files.
      const rows = data.map((r, idx) => ({
        no: idx + 1,
        kodeTransaksi: r.kodeTransaksi,
        nama: r.nama,
        companyName: r.companyName,
        paket: r.paket,
        pickupDate: r.pickupDate ? new Date(r.pickupDate).toISOString().slice(0, 10) : "",
        returnDate: r.returnDate ? new Date(r.returnDate).toISOString().slice(0, 10) : "",
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
      await exportAs(rows, format, "rekap-order");
    } catch (error) { toast.error("Export gagal: " + error.message); }
  }

  // ─── Import ────────────────────────────────────────────────────────
  // Receives pre-parsed rows from SharedImportModal. Handles field-mapping
  // and normalization before sending to the API.
  async function handleImportFile(rows) {
    // Map CSV headers → server keys. We normalize header strings (lowercase,
    // strip whitespace and "/") so " No.", "No.", "no", "no_" all match.
    const headerKey = (h) => String(h || "").toLowerCase().replace(/[\s./_-]+/g, "");
    const aliases = {
      kodetransaksi: "kodeTransaksi", transactioncode: "kodeTransaksi",
      nama: "nama", namauser: "nama", name: "nama",
      companyname: "companyName", perusahaan: "companyName",
      paket: "paket", package: "paket",
      pickupdate: "pickupDate", tanggalpemakaian: "pickupDate", tanggalambil: "pickupDate",
      tglpemakaian: "pickupDate", tanggalmulai: "pickupDate", usagedate: "pickupDate",
      returndate: "returnDate", tanggalkembali: "returnDate", tanggalselesai: "returnDate",
      tglselesai: "returnDate", tglkembali: "returnDate",
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
        case "pickupDate":
        case "returnDate": return normalizeImportDate(v);
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
      throw new Error("Tidak ada baris valid terbaca. Pastikan kolom header sesuai (kodeTransaksi, nama, paket, dll.).");
    }

    const result = await api.orders.importData(filtered);
    apiCache.invalidate("orders:");
    loadOrders();
    return { imported: result.imported ?? 0, skipped: result.skipped ?? 0, errors: result.errors };
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
          {/* Export on the left, Import on the right */}
          <button
            onClick={() => setShowExport(true)}
            className="px-3 py-2 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">file_download</span>
            {t("export")}
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-2 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">file_upload</span>
            {t("import")}
          </button>
          {/* "Tambah Rekap" is now CLIENT-HIDDEN only.
              Clients book from the Dashboard (logged-in) or Landing (public)
              now, so they don't need this button. Agency users keep the
              create flow exactly as it was before so internal staff can
              still add orders directly from Rekap Order when needed. */}
          {!isClient && (
            <button
              onClick={() => { ensureDriversAndCars(); setCreatingOrder(true); }}
              className="px-3 py-2 text-sm bg-primary text-white rounded-lg hover:opacity-90 cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t("addOrder")}
            </button>
          )}
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

      {/* Load-error banner */}
      {loadError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
          <span className="material-symbols-outlined text-red-500 text-[20px] mt-0.5">error</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">Gagal memuat data pesanan</p>
            <p className="text-xs text-red-600 mt-0.5">{loadError}</p>
            <p className="text-xs text-red-500 mt-1">
              Kemungkinan besar database belum memiliki kolom terbaru. Jalankan perintah berikut di terminal:{" "}
              <code className="bg-red-100 px-1 rounded font-mono">cd apps/api &amp;&amp; npm run migrate -- orders_full</code>
            </p>
          </div>
          <button onClick={() => { setLoadError(null); loadOrders(); }} className="text-red-400 hover:text-red-600 cursor-pointer" title="Coba lagi">
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>
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
                  onClick={() => setVisibleColumns(isClient ? CLIENT_COLUMN_KEYS : ALL_COLUMN_KEYS)}
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
                        setVisibleColumns(prev => {
                          if (e.target.checked) {
                            // Insert in canonical (catalog) order so the picker
                            // doesn't jumble the column layout when re-enabling
                            // a previously hidden column.
                            return ALL_COLUMN_KEYS.filter(k => prev.includes(k) || k === col.key);
                          }
                          return prev.filter(k => k !== col.key);
                        });
                      }}
                      className="cursor-pointer"
                    />
                    <span className="text-sm text-slate-700">{colLabel(col)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky pagination — stays in view while scrolling the table */}
      {groupedOrders.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalCount={totalGroupCount}
          filteredCount={groupedOrders.length}
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
                      {colLabel(col)}
                      {col.sortable && <SortIcon field={col.sortField || col.key} />}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-3 text-center font-semibold" style={{ minWidth: 140 }}>{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedGroups.map((group, gIdx) => {
                const displayIndex = (page - 1) * pageSize + gIdx;

                // Standalone booking (1 car or no shared code) → normal row.
                if (!group.isGroup) {
                  return renderDataRow(group.rows[0], displayIndex);
                }

                // Multi-car booking → a clickable summary row that expands
                // into one child row per car.
                const expanded = expandedGroups.has(group.orderNumber);
                return (
                  <Fragment key={group.key}>
                    <tr
                      className="bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer"
                      onClick={() => toggleGroup(group.orderNumber)}
                    >
                      {visibleCols.map(col => {
                        const alignCls = col.align === "right" ? "text-right tabular-nums"
                          : col.align === "left" ? "text-left"
                            : "text-center";
                        return (
                          <td key={col.key} className={`px-3 py-3 align-middle ${alignCls}`}>
                            {renderGroupCell(col, group, displayIndex)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-center align-middle">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); ensureDriversAndCars(); setManageBookingTarget(group); }}
                            className="px-2 py-1 rounded-lg hover:bg-primary/10 text-primary cursor-pointer inline-flex items-center gap-1 text-xs font-medium"
                            title="Atur unit, driver, dan harga"
                          >
                            <span className="material-symbols-outlined text-[18px]">tune</span>
                            Action
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setCancelBookingTarget(group); }}
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 cursor-pointer"
                            title="Batalkan seluruh booking"
                          >
                            <span className="material-symbols-outlined text-[18px]">block</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteBookingTarget(group); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer"
                            title="Hapus seluruh booking"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && group.rows.map((order, cIdx) =>
                      renderDataRow(order, displayIndex, {
                        isChild: true,
                        childLabel: `${displayIndex + 1}.${cIdx + 1}`,
                      })
                    )}
                  </Fragment>
                );
              })}
              {groupedOrders.length === 0 && (
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
          cars={cars}
          drivers={drivers}
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

      {/* Tier 2: Combined "Action" form — set car, driver, price per vehicle */}
      {manageBookingTarget && (
        <ManageBookingModal
          group={manageBookingTarget}
          cars={cars}
          drivers={drivers}
          onClose={() => setManageBookingTarget(null)}
          onSave={handleManageBookingSave}
        />
      )}

      {/* Tier 2: Delete whole booking confirm */}
      {deleteBookingTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteBookingTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-red-600">delete</span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">Hapus Booking</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Hapus permanen seluruh booking <span className="font-mono font-bold text-primary">{deleteBookingTarget.orderNumber}</span>
                {" "}({deleteBookingTarget.rows.length} kendaraan)? Tindakan ini tidak dapat dibatalkan.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteBookingTarget(null)} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">
                  {t("cancel")}
                </button>
                <button onClick={handleDeleteBooking} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 cursor-pointer">
                  {t("delete")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tier 2: Cancel whole booking confirm */}
      {cancelBookingTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setCancelBookingTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <span className="material-symbols-outlined text-red-600">block</span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">Batalkan Booking</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Batalkan seluruh booking <span className="font-mono font-bold text-primary">{cancelBookingTarget.orderNumber}</span>
                {" "}({cancelBookingTarget.rows.length} kendaraan)? Baris yang sudah selesai tidak terpengaruh.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setCancelBookingTarget(null)} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">
                  Kembali
                </button>
                <button onClick={handleCancelBooking} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 cursor-pointer">
                  Batalkan Semua
                </button>
              </div>
            </div>
          </div>
        </div>
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

      {showExport && (
        <SharedExportModal
          title="Export Data Order"
          exportFn={runExport}
          onClose={() => setShowExport(false)}
        />
      )}
      {showImport && (
        <SharedImportModal
          title="Import Data Order"
          hint="Kolom: kodeTransaksi, nama, companyName, paket, pickupDate, returnDate, jumlahHari, mobil, plat, driver, kontrakHarga, tujuan, inap, lembur, status, bailout"
          importFn={handleImportFile}
          onClose={() => setShowImport(false)}
          onSuccess={() => {}}
        />
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

// ─── Tier 2: Manage Booking Modal — the "Action" form ────────────────
// One form for a multi-vehicle booking: each car row gets a unit (fleet car)
// dropdown, a driver dropdown, and a price input. Saved together in one call.
// Picking a unit auto-fills the price from the unit's daily rate × rental days
// when the price field is still empty/zero, but never overwrites a price the
// admin has already typed.
function ManageBookingModal({ group, cars = [], drivers = [], onClose, onSave }) {
  const totalDays = Number(group.rows[0]?.totalDays || 1) || 1;
  const carPrice = (carId) => {
    const c = cars.find(x => String(x.id) === String(carId));
    return c ? Number(c.price || 0) : 0;
  };

  // Only offer usable units/drivers: cars not in maintenance, drivers that are
  // active. The currently-assigned unit/driver of a row is always kept in its
  // own dropdown (even if it later went to maintenance / inactive) so an
  // existing assignment never disappears from view.
  const selectableCars = cars.filter(c => c.status !== "maintenance");
  const selectableDrivers = drivers.filter(d => !d.status || d.status === "active");
  const carOptionsFor = (o) => {
    const cur = o.car;
    return (cur && !selectableCars.some(c => c.id === cur.id)) ? [cur, ...selectableCars] : selectableCars;
  };
  const driverOptionsFor = (o) => {
    const cur = o.driver;
    return (cur && !selectableDrivers.some(d => d.id === cur.id)) ? [cur, ...selectableDrivers] : selectableDrivers;
  };

  const [rows, setRows] = useState(() =>
    group.rows.map(o => ({
      orderId: o.id,
      carId: o.carId || "",
      driverId: o.driverId || "",
      totalPrice: o.totalPrice != null ? String(Number(o.totalPrice) || 0) : "",
    }))
  );

  const setRow = (orderId, patch) =>
    setRows(prev => prev.map(r => r.orderId === orderId ? { ...r, ...patch } : r));

  const onCarChange = (orderId, carId) => {
    setRows(prev => prev.map(r => {
      if (r.orderId !== orderId) return r;
      const next = { ...r, carId };
      // Auto-fill price only when it's currently blank/zero.
      const cur = Number(r.totalPrice || 0);
      if (carId && !(cur > 0)) {
        next.totalPrice = String(carPrice(carId) * totalDays);
      }
      return next;
    }));
  };

  // Requested category parsed from the row notes, to guide unit selection.
  const requestedCategory = (notes) => {
    const m = /Permintaan Kendaraan:\s*([^\n(]+)/i.exec(notes || "");
    return m ? m[1].trim() : "";
  };

  function handleSave() {
    onSave(rows.map(r => ({
      orderId: r.orderId,
      carId: r.carId ? Number(r.carId) : null,
      driverId: r.driverId ? Number(r.driverId) : null,
      totalPrice: r.totalPrice === "" ? null : Number(r.totalPrice) || 0,
    })));
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Atur Booking — <span className="font-mono text-primary">{group.orderNumber}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{group.rows.length} kendaraan · {totalDays} hari</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {group.rows.map((o, i) => {
            const r = rows.find(x => x.orderId === o.id);
            const cat = requestedCategory(o.notes);
            return (
              <div key={o.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                <p className="text-xs font-bold text-slate-600 mb-2">
                  Kendaraan #{i + 1}
                  {cat && <span className="ml-2 font-normal text-slate-400">Permintaan: {cat}</span>}
                  {o.destination && <span className="ml-2 font-normal text-slate-400">· {o.destination}</span>}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Unit / Mobil</label>
                    <select
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm cursor-pointer"
                      value={r?.carId || ""}
                      onChange={e => onCarChange(o.id, e.target.value)}
                    >
                      <option value="">-- Tanpa unit --</option>
                      {carOptionsFor(o).map(c => (
                        <option key={c.id} value={c.id}>
                          {`${c.brand || ""} ${c.name || ""}`.trim()}{c.licensePlate ? ` (${c.licensePlate})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Driver</label>
                    <select
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm cursor-pointer"
                      value={r?.driverId || ""}
                      onChange={e => setRow(o.id, { driverId: e.target.value })}
                    >
                      <option value="">-- Tanpa driver --</option>
                      {driverOptionsFor(o).map(d => (
                        <option key={d.id} value={d.id}>{d.name}{d.phone ? ` (${d.phone})` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Harga (Rp)</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      value={r?.totalPrice ?? ""}
                      onChange={e => setRow(o.id, { totalPrice: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 justify-end p-5 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">
            Batal
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer">
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit / Create Modal ────────────────────────────────────────────
function EditModal({ order, isNew = false, cars = [], drivers = [], onClose, onSave, t }) {
  const toast = useToast();
  const toIso = (d) => d ? new Date(d).toISOString().slice(0, 10) : "";
  const today = new Date().toISOString().slice(0, 10);
  const { user } = useAuth();
  // Client users (account_type='client' OR legacy client/client_admin roles)
  // are restricted to booking under THEIR own company. Agency users still see
  // the full address-book list so they can pick any registered customer.
  const isClient =
    user?.accountType === 'client' ||
    user?.role === 'client' || user?.role === 'client_admin';
  const [companies, setCompanies] = useState([]);

  // Fetch company list once on mount. Scope depends on caller's accountType:
  //   • Client → only their own org's company name (single option)
  //   • Agency → the existing companies address book (all)
  useEffect(() => {
    if (isClient) {
      if (!user?.organizationId) return;
      api.myOrg.getInfo()
        .then((info) => {
          if (info?.name) setCompanies([{ id: info.id, name: info.name }]);
        })
        .catch((err) => console.error("Failed to load org for company dropdown:", err));
      return;
    }
    api.companies.list("limit=500").then(res => {
      const rows = Array.isArray(res) ? res : (res?.data || []);
      setCompanies(rows);
    }).catch(() => {});
  }, [isClient, user?.organizationId]);

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
    // carId / driverId need numeric coercion in BOTH create and edit modes —
    // otherwise the orders.update call sends "" or string IDs and the FK
    // column ends up unchanged.
    payload.carId = payload.carId ? Number(payload.carId) : null;
    payload.driverId = payload.driverId ? Number(payload.driverId) : null;
    if (isNew) {
      if (!payload.carId) { toast.error("Mobil wajib dipilih"); return; }
      if (!payload.customerName) { toast.error("Nama wajib diisi"); return; }
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
            <Field label={t("companyName")}>
              {form.customerType === "company" ? (
                isClient ? (
                  // Client users can only book under their own org. Render as
                  // a select with the org name(s) tied to their account.
                  <select
                    className="input"
                    value={form.companyName}
                    onChange={e => set("companyName", e.target.value)}
                  >
                    <option value="">-- Pilih Perusahaan --</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  // Agency users keep the existing autocomplete + free-text
                  // entry so they can add new companies on the fly.
                  <div className="relative">
                    <input
                      list="company-list"
                      className="input pr-8"
                      value={form.companyName}
                      onChange={e => set("companyName", e.target.value)}
                      placeholder="Pilih atau ketik nama perusahaan..."
                      autoComplete="off"
                    />
                    <datalist id="company-list">
                      {companies.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </datalist>
                    {form.companyName && (
                      <button type="button" onClick={() => set("companyName", "")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    )}
                  </div>
                )
              ) : (
                <input className="input" value={form.companyName} onChange={e => set("companyName", e.target.value)} placeholder="-" />
              )}
            </Field>
            <Field label={t("customerType")}>
              <select className="input" value={form.customerType} onChange={e => {
                set("customerType", e.target.value);
                if (e.target.value === "private") set("companyName", "");
              }}>
                <option value="private">{t("private")}</option>
                <option value="company">{t("company")}</option>
              </select>
            </Field>
            <Field label={t("phone")}><input className="input" value={form.customerPhone} onChange={e => set("customerPhone", e.target.value)} /></Field>
            {isNew && (
              <Field label={t("email")}><input type="email" className="input" value={form.customerEmail} onChange={e => set("customerEmail", e.target.value)} /></Field>
            )}
            <Field label={t("car")}>
              <select className="input" value={form.carId} onChange={e => set("carId", e.target.value)} required={isNew}>
                <option value="">{isNew ? "-- Pilih Mobil --" : "-- Tanpa Mobil --"}</option>
                {cars
                  .filter(c =>
                    c.status === "available" ||
                    (!isNew && form.carId && String(c.id) === String(form.carId))
                  )
                  .map(c => {
                    const isCurrent = !isNew && form.carId && String(c.id) === String(form.carId);
                    const showStatusHint = isCurrent && c.status !== "available";
                    return (
                      <option key={c.id} value={c.id}>
                        {c.brand} {c.name} {c.licensePlate ? `(${c.licensePlate})` : ""}
                        {showStatusHint ? ` - ${c.status}` : ""}
                      </option>
                    );
                  })}
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
