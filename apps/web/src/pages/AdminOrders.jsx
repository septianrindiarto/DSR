import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useToast } from "../components/Toast";
import { useSearchParams, Link } from "react-router-dom";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api, apiCache, swr } from "../lib/api";
import TablePagination, { usePagination } from "../components/TablePagination";
import SharedImportModal from "../components/SharedImportModal";
import SharedExportModal from "../components/SharedExportModal";
import { exportAs, formatPrice, formatDate, formatDateRange } from "../lib/dataFormats";
import { invoiceStatusOf, INVOICE_STATUS_CLASS, INVOICE_STATUS_KEY } from "../lib/invoiceStatus";
import BookingEditModal from "../components/BookingEditModal";
import InlineEdit from "../components/InlineEdit";
import { can } from "../lib/permissions";

import AsyncButton from "../components/AsyncButton";
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
  // Mapping columns (owner 2026-11-09): surat pengantar, faktur pajak, kontrak.
  // Empty ("-") when the code has none.
  { key: "invoiceLetterNumber", labelKey: "rk_letterNo", minWidth: 150, sortable: false, align: "left" },
  { key: "fakturNsfp", labelKey: "rk_faktur", minWidth: 160, sortable: false, align: "left" },
  { key: "contractNumber", labelKey: "rk_contract", minWidth: 140, sortable: false, align: "left" },
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
  "invoiceLetterNumber",
  "fakturNsfp",
  "contractNumber",
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
    // 2026-11-09: new mapping columns appear once for saved layouts; after
    // that the user's choice (hide/show) is kept.
    const ADDED_FLAG = `${storageKey}:added:2026-11-09`;
    if (!localStorage.getItem(ADDED_FLAG)) {
      for (const k of ["invoiceLetterNumber", "fakturNsfp", "contractNumber"]) if (!migrated.includes(k)) migrated.push(k);
      localStorage.setItem(ADDED_FLAG, "1");
    }

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

// ─── Rekap.xlsx-format export helpers ────────────────────────────────────────
// Reproduce the source spreadsheet's column layout + value patterns exactly.
const REKAP_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const _pad2 = (n) => String(n).padStart(2, "0");
// Single day → "08/01/2026"; same-month range → "07 s/d 08 Januari 2026";
// cross-month range → "1 Desember 2025 s/d 1 Januari 2026".
function rekapUsageDate(startISO, endISO) {
  const s = startISO ? new Date(startISO) : null;
  if (!s || isNaN(s.getTime())) return "";
  const e = endISO ? new Date(endISO) : null;
  if (!e || isNaN(e.getTime()) || s.getTime() === e.getTime()) {
    return `${_pad2(s.getDate())}/${_pad2(s.getMonth() + 1)}/${s.getFullYear()}`;
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${_pad2(s.getDate())} s/d ${_pad2(e.getDate())} ${REKAP_MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  }
  const full = (d) => `${d.getDate()} ${REKAP_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${full(s)} s/d ${full(e)}`;
}
// "Toyota Avanza" → "Avanza" (drop the brand so it reads like the source).
function rekapModel(mobil) {
  const m = String(mobil || "").trim();
  if (!m) return "";
  const parts = m.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : m;
}
const rekapRp = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;   // Rp1.630.000
const rekapNum = (n) => Number(n || 0).toLocaleString("id-ID");          // 850.000
function rekapStatus(s) {
  const map = { completed: "Done", cancelled: "Cancelled", active: "On Going", confirmed: "Confirmed", pending: "Pending" };
  const k = String(s || "").toLowerCase();
  return map[k] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
}
// Single date → "08/01/2026", or "-" when empty.
function rekapDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return `${_pad2(d.getDate())}/${_pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
// Build the Rekap-format export rows (shared by agency Export + client download).
// Collapses identical units within a booking into one line with a Jumlah count.
// `includeKontrak` = false for client downloads (Kontrak Harga is hidden from clients).
function buildRekapExportRows(data, { includeKontrak = true } = {}) {
  const groups = new Map();
  const order = [];
  for (const r of data || []) {
    const key = `${r.kodeTransaksi}||${rekapModel(r.mobil)}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(r);
  }
  return order.map((key, idx) => {
    const g = groups.get(key);
    const r = g[0];
    const sum = (f) => g.reduce((a, x) => a + Number(x[f] || 0), 0);
    const distinct = (f) => [...new Set(g.map(x => String(x[f] ?? "").trim()).filter(Boolean))].join(", ");
    const inap = sum("inap"), lembur = sum("lembur");
    return {
      "No": idx + 1,
      "Kode Transaksi": r.kodeTransaksi || "",
      "Nama": r.nama || "",
      "Company Name": r.companyName || "Private",
      "Pusat Biaya": distinct("pusatBiaya"),
      "Paket": r.paket || "",
      "Tgl Pemakaian": rekapUsageDate(r.tglPemakaian, r.tglSelesai),
      "Jumlah": g.length,
      "Mobil": rekapModel(r.mobil),
      "Plat": distinct("plat"),
      "Driver": distinct("driver"),
      // Sum across the grouped units (Jumlah) → e.g. 2 × 815.000 = Rp1.630.000.
      ...(includeKontrak ? { "Kontrak Harga": rekapRp(sum("kontrakHarga")) } : {}),
      "Tujuan": distinct("tujuan"),
      "Inap": inap > 0 ? inap : "-",
      "Lembur": lembur > 0 ? lembur : "-",
      "Status": rekapStatus(r.status),
      "No. Invoice": r.invoiceNumber || "-",
      "No. Surat Pengantar": r.invoiceLetterNumber || "-",
      "No. Faktur Pajak": r.noFakturPajak || r.fakturNsfp || "-",
      "Kontrak": r.kontrak || r.contractNumber || "-",
      "Tgl Kirim Invoice": rekapDate(r.invoiceSentDate),
      "Due Date": rekapDate(r.invoiceDueDate),
      "Tgl Realisasi": rekapDate(r.invoicePaidDate),
      // Derived status (backend export already derives it; recompute so the
      // client download path, which may carry raw rows, matches).
      "Status Invoice": invoiceStatusOf({
        invoiceSentDate: r.invoiceSentDate, invoiceDueDate: r.invoiceDueDate,
        invoicePaidDate: r.invoicePaidDate, invoicePaymentStatus: r.invoicePaymentStatus, status: r.status,
      }) || "-",
    };
  });
}

export default function AdminOrders() {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  // Client accounts (both `client` admin and plain `client` users, plus the
  // legacy `client_admin`/`client` roles) see a different default column set —
  // the 20 columns specified in the screenshot. Agency users keep the legacy
  // full catalog. Clients are read-only on this page (no create/edit/delete).
  const isClient =
    user?.accountType === 'client' ||
    user?.role === 'client' || user?.role === 'client_admin';
  // RBAC v2 — action-level permissions (server enforces the same).
  const canEdit = !isClient && can(user, "orders", "edit");
  const canDelete = !isClient && can(user, "orders", "delete");
  const canCreate = !isClient && can(user, "orders", "create");
  const canExport = can(user, "orders", "export");
  // Clients book from the Dashboard booking form (approval / cost centre /
  // corporate price live there); this shortcut makes that discoverable.
  const canClientBook = isClient && can(user, "orders", "create");
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
  // Phase C — client ratings (one per booking).
  const [reviewed, setReviewed] = useState(() => new Set());
  const [rateTarget, setRateTarget] = useState(null);
  useEffect(() => {
    if (!isClient) return;
    api.marketplace.mine().then((r) => setReviewed(new Set(r?.orderNumbers || []))).catch(() => {});
  }, [isClient]);
  // 👁 on a multi-vehicle booking → booking detail (all vehicles).
  const [selectedGroup, setSelectedGroup] = useState(null);
  // Rows opened in the unified ✏️ form: [order] for a single/child row, or
  // all rows of a booking for a group header. null = closed.
  const [editRows, setEditRows] = useState(null);
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
  // Whole-booking delete target (group object or null). Editing and cancelling
  // a booking now live inside the unified ✏️ form (BookingEditModal).
  const [deleteBookingTarget, setDeleteBookingTarget] = useState(null);

  // Re-fetch only on filter/sort changes — not on every keystroke
  useEffect(() => { loadOrders(); }, [statusFilter, sortBy, sortOrder]);
  // Inline ✏️ selects (Mobil / Driver) need their option lists ready.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isClient) ensureDriversAndCars(); }, [isClient]);

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
      setLoadError(err?.message || t("ordersLoadFailedHint"));
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


  // Tier 2: delete an entire booking (all cars sharing the order code).
  async function handleDeleteBooking() {
    if (!deleteBookingTarget) return;
    try {
      const res = await api.orders.removeBooking(deleteBookingTarget.orderNumber);
      setDeleteBookingTarget(null);
      invalidateOrders();
      loadOrders();
      toast.success(t("bookingDeletedMsg").replace("{code}", deleteBookingTarget.orderNumber).replace("{n}", res?.deleted ?? 0));
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
          <p className="font-medium text-slate-900">{order.customerName || order.customer?.name || "-"}</p>
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
      case "status":
        // Corporate portal: the client's own approval comes before the agency.
        if (order.clientApprovalStatus === "waiting") return <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-amber-100 text-amber-700">{t("approvalWaiting")}</span>;
        if (order.clientApprovalStatus === "rejected") return <span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-red-100 text-red-700">{t("approvalRejected")}</span>;
        return <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[order.status]}`}>{t(order.status)}</span>;
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
      case "invoiceLetterNumber": return <span className="text-slate-700 font-mono text-xs">{order.invoiceLetterNumber || "-"}</span>;
      case "fakturNsfp": return <span className="text-slate-700 font-mono text-xs">{order.fakturNsfp || (order.fakturId ? t("rk_fakturDraft") : "-")}</span>;
      case "contractNumber": return <span className="text-slate-700 font-mono text-xs">{order.contractNumber || "-"}</span>;
      case "invoiceSentDate": return <span className="text-slate-600 text-xs">{formatDate(order.invoiceSentDate)}</span>;
      case "invoiceDueDate": return <span className="text-slate-600 text-xs">{formatDate(order.invoiceDueDate)}</span>;
      case "invoicePaidDate": return <span className="text-slate-600 text-xs">{formatDate(order.invoicePaidDate)}</span>;
      case "invoicePaymentStatus": {
        // Derived: Belum Dikirim / Pending / Overdue / Paid.
        const st = invoiceStatusOf(order);
        if (!st) return <span className="text-slate-400 text-xs">-</span>;
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${INVOICE_STATUS_CLASS[st] || ""}`}>{t(INVOICE_STATUS_KEY[st])}</span>;
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
            onClick={(e) => { e.stopPropagation(); toggleGroup(group.orderNumber); }}
            className="inline-flex items-center gap-1.5 cursor-pointer group/btn"
            title={expanded ? t("hideDetails") : t("viewDetails")}
          >
            <span className={`material-symbols-outlined text-[18px] text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}>
              chevron_right
            </span>
            <span className="font-mono text-xs font-bold text-primary group-hover/btn:underline">{group.orderNumber}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold whitespace-nowrap">
              {rows.length} {t("carsShort")}
            </span>
          </button>
        );
      case "mobil":
        return <span className="text-slate-500 text-xs italic">{rows.length} {t("vehicles")}</span>;
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
        return <span className="text-slate-700">{same ? (same || "-") : t("mixedValues")}</span>;
      }
      case "status": {
        const same = allSame(r => r.status);
        if (same) return <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[same]}`}>{t(same)}</span>;
        return <span className="text-slate-500 text-xs italic">{t("mixedStatus")}</span>;
      }
      // Shared trip-level fields — identical across every car in the booking.
      default:
        return renderCell(col, first, rowIndex);
    }
  }

  // Group header: only shared (identical) values can be edited for all
  // vehicles at once. Sums (harga, inap, lembur, bailout) and per-unit
  // columns (mobil, driver, plat) are edited on the expanded rows instead.
  const GROUP_EDITABLE = new Set(["nama", "companyName", "paket", "pickupDate", "returnDate", "tujuan", "pickupLocation", "status", "notes", "invoiceSentDate", "invoicePaidDate"]);
  function sameAcross(rows, key) {
    const cfgs = rows.map((r) => editCfg(key, r));
    if (cfgs.some((c) => !c)) return false;
    return cfgs.every((c) => String(c.value ?? "") === String(cfgs[0].value ?? ""));
  }

  // ─── Inline (hover ✏️) editing ─────────────────────────────────────────
  // Column → editable field. Columns NOT listed here are auto-filled and stay
  // read-only: No., Kode Transaksi, Jumlah Hari, Plat, Dibuat Oleh,
  // No. Invoice, Due Date, Status Invoice.
  const PACKAGE_LIST = ["Private", "All In", "Mobil & Driver", "Lepas Kunci", "Drop"];
  const companyList = useMemo(() => [...new Set(orders.map((o) => o.customer?.companyName).filter(Boolean))].sort(), [orders]);
  const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  function editCfg(key, order) {
    switch (key) {
      case "nama": return { field: "customerName", type: "text", value: order.customerName || order.customer?.name || "", booking: true };
      case "companyName": return { field: "companyName", type: "text", value: order.customer?.companyName || "", list: companyList, booking: true };
      case "paket": return { field: "package", type: "text", value: order.package || "", list: PACKAGE_LIST };
      case "pickupDate": return { field: "pickupDate", type: "date", value: isoDay(order.pickupDate) };
      case "returnDate": return { field: "returnDate", type: "date", value: isoDay(order.returnDate) };
      case "mobil": {
        const opts = cars.filter((c) => c.status !== "maintenance" || c.id === order.carId);
        if (order.car && !opts.some((c) => c.id === order.car.id)) opts.unshift(order.car);
        return { field: "carId", type: "select", value: order.carId ? String(order.carId) : "", num: true,
          options: [{ value: "", label: "-- Pilih Mobil --" }, ...opts.map((c) => ({ value: String(c.id), label: `${c.brand || ""} ${c.name || ""}`.trim() + (c.licensePlate ? ` (${c.licensePlate})` : "") }))] };
      }
      case "driver": {
        const opts = drivers.filter((d) => !d.status || d.status === "active" || d.id === order.driverId);
        if (order.driver && !opts.some((d) => d.id === order.driver.id)) opts.unshift(order.driver);
        return { field: "driverId", type: "select", value: order.driverId ? String(order.driverId) : "", num: true,
          options: [{ value: "", label: "-- Pilih Driver --" }, ...opts.map((d) => ({ value: String(d.id), label: d.name }))] };
      }
      case "kontrakHarga": return { field: "totalPrice", type: "number", value: Number(order.totalPrice || 0), align: "right" };
      case "tujuan": return { field: "destination", type: "text", value: order.destination || "" };
      case "pickupLocation": return { field: "pickupLocation", type: "text", value: order.pickupLocation || "" };
      case "inap": return { field: "overnightNights", type: "number", value: Number(order.overnightNights || 0), align: "right" };
      case "lembur": return { field: "overtimeHours", type: "number", value: Number(order.overtimeHours || 0), align: "right" };
      case "bailout": return { field: "bailout", type: "number", value: Number(order.bailout || 0), align: "right" };
      case "status": return { field: "status", type: "select", value: order.status,
        options: ["pending", "confirmed", "active", "completed", "cancelled"].map((v) => ({ value: v, label: t(v) })) };
      case "notes": return { field: "notes", type: "textarea", value: order.notes || "" };
      case "invoiceSentDate": return order.invoiceId ? { field: "invoiceSentDate", type: "date", value: isoDay(order.invoiceSentDate), invoice: true } : null;
      case "invoicePaidDate": return order.invoiceId ? { field: "invoicePaidDate", type: "date", value: isoDay(order.invoicePaidDate), invoice: true } : null;
      default: return null;
    }
  }

  async function saveField(rowsToEdit, cfg, raw) {
    const value = cfg.num ? (raw ? Number(raw) : null) : raw;
    const body = {
      orderIds: rowsToEdit.map((r) => r.id), field: cfg.field, value,
      ...(rowsToEdit.length === 1 && rowsToEdit[0].updatedAt ? { expectedUpdatedAt: new Date(rowsToEdit[0].updatedAt).toISOString() } : {}),
    };
    try {
      try {
        await api.orders.updateField(body);
      } catch (err) {
        if (err?.status === 409 && err?.body?.code === "SCHEDULE_CONFLICT") {
          const list = (err.body.conflicts || []).map((c) => `• ${c}`).join("\n");
          if (!confirm(t("scheduleConflictConfirm").replace("{list}", list))) throw err;
          await api.orders.updateField({ ...body, force: true });
        } else throw err;
      }
      toast.success(t("inlineSaved"));
      invalidateOrders(); apiCache.invalidate("documents:");
      loadOrders();
    } catch (err) {
      if (err?.status === 409 && err?.body?.code === "STALE") { invalidateOrders(); loadOrders(); }
      if (!(err?.status === 409 && err?.body?.code === "SCHEDULE_CONFLICT")) toast.error(err.message);
      throw err; // keeps the editor open
    }
  }

  // ─── Row edit: every editable column of ONE row at once, one Simpan ───
  // rowEdit = { id, draft: { colKey: value } }. Saved through
  // PUT /api/orders/fields in a single transaction (never half-saved).
  const [rowEdit, setRowEdit] = useState(null);
  function startRowEdit(order) {
    ensureDriversAndCars();
    const draft = {};
    for (const col of visibleCols) {
      const cfg = editCfg(col.key, order);
      if (cfg) draft[col.key] = cfg.value ?? "";
    }
    setRowEdit({ id: order.id, draft });
  }
  const cancelRowEdit = () => setRowEdit(null);
  async function saveRowEdit(order) {
    if (!rowEdit || rowEdit.id !== order.id) return;
    const bookingRows = orders.filter((o) => o.orderNumber === order.orderNumber);
    const changes = [];
    let sharedTouched = false;
    for (const [key, draftVal] of Object.entries(rowEdit.draft)) {
      const cfg = editCfg(key, order);
      if (!cfg || String(draftVal ?? "") === String(cfg.value ?? "")) continue;
      const value = cfg.num ? (draftVal === "" ? null : Number(draftVal))
        : cfg.type === "number" ? (draftVal === "" ? null : Number(draftVal))
        : (draftVal === "" ? null : draftVal);
      const ids = cfg.booking && bookingRows.length > 1 ? bookingRows.map((r) => r.id) : [order.id];
      if (ids.length > 1) sharedTouched = true;
      changes.push({ orderIds: ids, field: cfg.field, value });
    }
    if (!changes.length) { setRowEdit(null); return; }
    if (sharedTouched && !confirm(t("inlineApplyAll").replace("{n}", bookingRows.length))) return;
    const body = { changes, ...(order.updatedAt ? { expectedUpdatedAt: new Date(order.updatedAt).toISOString() } : {}) };
    try {
      try {
        await api.orders.updateFields(body);
      } catch (err) {
        if (err?.status === 409 && err?.body?.code === "SCHEDULE_CONFLICT") {
          const list = (err.body.conflicts || []).map((c) => `• ${c}`).join("\n");
          if (!confirm(t("scheduleConflictConfirm").replace("{list}", list))) return;
          await api.orders.updateFields({ ...body, force: true });
        } else throw err;
      }
      toast.success(t("rowEditSaved").replace("{n}", changes.length));
      setRowEdit(null);
      invalidateOrders(); apiCache.invalidate("documents:");
      loadOrders();
    } catch (err) {
      if (err?.status === 409 && err?.body?.code === "STALE") { setRowEdit(null); invalidateOrders(); loadOrders(); }
      toast.error(err.message);
    }
  }
  function rowEditInput(col, order) {
    const cfg = editCfg(col.key, order);
    if (!cfg) return null;
    const v = rowEdit.draft[col.key] ?? "";
    const setV = (val) => setRowEdit((r) => (r ? { ...r, draft: { ...r.draft, [col.key]: val } } : r));
    const changed = String(v) !== String(cfg.value ?? "");
    const cls = `w-full min-w-[90px] px-2 py-1 text-xs border rounded-md bg-white focus:outline-none focus:border-primary ${changed ? "border-amber-400 bg-amber-50" : "border-slate-200"} ${cfg.align === "right" ? "text-right" : ""}`;
    const onKey = (e) => {
      if (e.key === "Escape") cancelRowEdit();
      if (e.key === "Enter" && cfg.type !== "textarea") { e.preventDefault(); saveRowEdit(order); }
    };
    if (cfg.type === "select") {
      return <select value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey} className={cls}>{cfg.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    }
    const listId = cfg.list ? `rowedit-${col.key}` : undefined;
    return (
      <>
        <input type={cfg.type === "textarea" ? "text" : cfg.type} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey}
          list={listId} className={cls} />
        {listId && <datalist id={listId}>{cfg.list.map((x) => <option key={x} value={x} />)}</datalist>}
      </>
    );
  }

  // Wrap a rendered cell with the hover editor when the column is editable.
  function withInline(col, content, rowsToEdit) {
    if (!canEdit) return content;
    if (rowEdit && rowsToEdit.length === 1 && rowsToEdit[0].id === rowEdit.id) {
      return rowEditInput(col, rowsToEdit[0]) ?? content;
    }
    const cfg = editCfg(col.key, rowsToEdit[0]);
    if (!cfg) return content;
    const n = rowsToEdit.length;
    // Booking-level customer fields apply to every row with the same code.
    const bookingRows = cfg.booking ? orders.filter((o) => o.orderNumber === rowsToEdit[0].orderNumber) : null;
    const target = bookingRows && bookingRows.length > 1 ? bookingRows : rowsToEdit;
    const confirmText = target.length > 1 ? t("inlineApplyAll").replace("{n}", target.length) : (cfg.invoice ? t("inlineInvoiceNote") : undefined);
    return (
      <InlineEdit value={cfg.value} display={content} type={cfg.type} options={cfg.options} list={cfg.list}
        align={cfg.align || col.align} confirm={confirmText} title={n > 1 ? t("inlineEditAll") : t("edit")}
        onSave={(v) => saveField(target, cfg, v)} />
    );
  }

  // The per-row action buttons (view / edit / delete). Shared by single rows
  // and the per-car child rows of a multi-car booking.
  // Client: rate a completed booking (one rating per booking code).
  function renderRateButton(orderNumber, rows) {
    if (!rows.some((r) => r.status === "completed")) return null;
    if (reviewed.has(orderNumber)) return <span className="text-xs text-amber-600" title={t("rated")}>★ {t("rated")}</span>;
    return (
      <button onClick={(e) => { e.stopPropagation(); setRateTarget(orderNumber); }} className="px-2 py-1 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50 cursor-pointer">
        ★ {t("rateOrder")}
      </button>
    );
  }

  function renderActionsCell(order, isChild = false) {
    // Client accounts (any client role) are read-only: only "Beri nilai".
    if (isClient) return <td className="px-3 py-3 text-center align-middle">{!isChild && renderRateButton(order.orderNumber, [order])}</td>;
    return (
      <td className="px-3 py-3 text-center align-middle">
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => { ensureDriversAndCars(); setSelectedOrder(order); }} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer" title={t("details")}>
            <span className="material-symbols-outlined text-[18px]">visibility</span>
          </button>
          {canEdit && rowEdit?.id === order.id ? (
            <>
              <AsyncButton onClick={() => saveRowEdit(order)} className="px-2 py-1 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer" title={t("rowEditSave")}>
                {t("save")}
              </AsyncButton>
              <button onClick={cancelRowEdit} className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-xs cursor-pointer" title="Esc">{t("cancel")}</button>
            </>
          ) : canEdit && (
            <>
              <button onClick={() => startRowEdit(order)} disabled={!!rowEdit} className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title={t("rowEdit")}>
                <span className="material-symbols-outlined text-[18px]">edit_note</span>
              </button>
              <button onClick={() => { ensureDriversAndCars(); setEditRows([order]); }} className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 cursor-pointer" title={t("edit")}>
                <span className="material-symbols-outlined text-[18px]">edit</span>
              </button>
            </>
          )}
          {canDelete && (
            <button onClick={() => setDeleteTarget(order)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer" title={t("delete")}>
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          )}
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
        className={`transition-colors ${rowEdit?.id === order.id ? "bg-amber-50/60 ring-1 ring-inset ring-amber-300" : isChild ? "bg-slate-50/30 hover:bg-slate-100/50" : "hover:bg-slate-50/60"}`}
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
            content = withInline(col, renderCell(col, order, displayIndex), [order]);
          }
          return (
            <td key={col.key} className={`px-3 py-3 align-middle ${alignCls}`}>
              {content}
            </td>
          );
        })}
        {renderActionsCell(order, isChild)}
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
  // Columns clients must never see (even if an old saved layout included them):
  // bailout, overtime (lembur), overnight (inap), contract price (kontrak harga),
  // and created-by (dibuat oleh).
  const CLIENT_HIDDEN_COLS = ["bailout", "lembur", "inap", "kontrakHarga", "createdBy"];
  const visibleCols = useMemo(() => {
    const byKey = new Map(COLUMN_DEFS.map(c => [c.key, c]));
    return visibleColumns
      .map(k => byKey.get(k))
      .filter(Boolean)
      .filter(c => !(isClient && CLIENT_HIDDEN_COLS.includes(c.key)));
  }, [visibleColumns, isClient]);

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
      const rows = buildRekapExportRows(data);
      await exportAs(rows, format, "rekap-order");
    } catch (error) { toast.error(`${t("exportFailed")}: ${error.message}`); }
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
      throw new Error(t("importNoValidRows"));
    }

    const result = await api.orders.importData(filtered);
    apiCache.invalidate("orders:");
    loadOrders();
    return { imported: result.imported ?? 0, skipped: result.skipped ?? 0, errors: result.errors };
  }

  // Client-only one-click download: pulls the caller's orders (already
  // org-scoped server-side), applies the CURRENT status + search filters, and
  // saves a CSV. No modal, no import — clients just grab their filtered rekap.
  async function handleClientDownload() {
    try {
      const data = await api.orders.exportData();
      let raw = Array.isArray(data) ? data : [];
      if (statusFilter && statusFilter !== "all") {
        raw = raw.filter(r => String(r.status || "").toLowerCase() === statusFilter);
      }
      const q = search.trim().toLowerCase();
      if (q) raw = raw.filter(r => JSON.stringify(r).toLowerCase().includes(q));
      // Same Rekap-format columns as the agency Export.
      const rows = buildRekapExportRows(raw, { includeKontrak: false });
      if (rows.length === 0) { toast.error(t("noDataToDownload")); return; }
      const headers = Object.keys(rows[0]);
      const cell = (v) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [headers.join(","), ...rows.map(r => headers.map(h => cell(r[h])).join(","))].join("\n");
      downloadFile(`rekap-order-${Date.now()}.csv`, "﻿" + csv);
      toast.success(`${rows.length} baris diunduh.`);
    } catch (e) {
      toast.error(e.message || t("downloadFailed"));
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
          <p className="text-slate-500 text-sm mt-1">{t("ordersPageSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Agency: full Export + Import. Client: one-click Download Rekap
              (current filters), no import, no modal. */}
          {isClient ? (canExport && (
            <AsyncButton
              onClick={handleClientDownload}
              className="px-3 py-2 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">file_download</span>
              {t("downloadRecap")}
            </AsyncButton>
          )) : (
            <>
              {canExport && <button
                onClick={() => setShowExport(true)}
                className="px-3 py-2 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">file_download</span>
                {t("export")}
              </button>}
              {canCreate && <button
                onClick={() => setShowImport(true)}
                className="px-3 py-2 text-sm bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">file_upload</span>
                {t("import")}
              </button>}
            </>
          )}
          {/* "Tambah Rekap" is now CLIENT-HIDDEN only.
              Clients book from the Dashboard (logged-in) or Landing (public)
              now, so they don't need this button. Agency users keep the
              create flow exactly as it was before so internal staff can
              still add orders directly from Rekap Order when needed. */}
          {canClientBook && (
            <Link
              to="/admin/dashboard#booking"
              className="px-3 py-2 text-sm bg-primary text-white rounded-lg hover:opacity-90 cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t("clientBookNow")}
            </Link>
          )}
          {canCreate && (
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
            <p className="text-sm font-semibold text-red-700">{t("ordersLoadFailed")}</p>
            <p className="text-xs text-red-600 mt-0.5">{loadError}</p>
            <p className="text-xs text-red-500 mt-1">
              Kemungkinan besar database belum memiliki kolom terbaru. Jalankan perintah berikut di terminal:{" "}
              <code className="bg-red-100 px-1 rounded font-mono">cd apps/api &amp;&amp; npm run migrate</code>
            </p>
          </div>
          <button onClick={() => { setLoadError(null); loadOrders(); }} className="text-red-400 hover:text-red-600 cursor-pointer" title={t("retry")}>
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
            placeholder={t("ordersSearchPlaceholder")}
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
                {COLUMN_DEFS.filter(col => !(isClient && CLIENT_HIDDEN_COLS.includes(col.key))).map(col => (
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
                <th className="px-3 py-3 text-center font-semibold" style={{ minWidth: isClient ? 100 : 140 }}>{isClient ? t("rating") : t("actions")}</th>
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
                            {GROUP_EDITABLE.has(col.key) && sameAcross(group.rows, col.key)
                              ? withInline(col, renderGroupCell(col, group, displayIndex), group.rows)
                              : renderGroupCell(col, group, displayIndex)}
                          </td>
                        );
                      })}
                      {isClient && <td className="px-3 py-3 text-center align-middle">{renderRateButton(group.orderNumber, group.rows)}</td>}
                      {!isClient && (
                      <td className="px-3 py-3 text-center align-middle">
                        {/* Same three buttons as every other row. 👁 opens the
                            booking detail (all vehicles); ✏️ opens the unified
                            form with ALL vehicles. Row click still expands. */}
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedGroup(group); }}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer"
                            title={t("viewDetails")}
                          >
                            <span className="material-symbols-outlined text-[18px]">visibility</span>
                          </button>
                          {canEdit && (
                          <button
                            onClick={(e) => { e.stopPropagation(); ensureDriversAndCars(); setEditRows(group.rows); }}
                            className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 cursor-pointer"
                            title={t("edit")}
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          )}
                          {canDelete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteBookingTarget(group); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer"
                            title={t("delete")}
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                          )}
                        </div>
                      </td>
                      )}
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
                      {t("loading")}
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

      {rateTarget && (
        <RateModal orderNumber={rateTarget} t={t} onClose={() => setRateTarget(null)}
          onDone={() => { setReviewed((s) => new Set([...s, rateTarget])); setRateTarget(null); }} />
      )}

      {selectedGroup && (
        <BookingDetailModal
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          onEdit={canEdit ? () => { const rows = selectedGroup.rows; setSelectedGroup(null); ensureDriversAndCars(); setEditRows(rows); } : null}
          onViewVehicle={(o) => { setSelectedGroup(null); ensureDriversAndCars(); setSelectedOrder(o); }}
          t={t}
          formatDate={formatDate}
          formatPrice={formatPrice}
          statusColors={statusColors}
        />
      )}

      {/* Unified edit form — single order, child row, or whole booking */}
      {editRows && (
        <BookingEditModal
          rows={editRows}
          cars={cars}
          drivers={drivers}
          onClose={() => setEditRows(null)}
          onSaved={() => { setEditRows(null); invalidateOrders(); loadOrders(); }}
          t={t}
        />
      )}

      {/* Create Modal — same unified form, create mode */}
      {creatingOrder && (
        <BookingEditModal
          isNew
          cars={cars}
          drivers={drivers}
          onClose={() => setCreatingOrder(false)}
          onSaved={() => { setCreatingOrder(false); invalidateOrders(); loadOrders(); }}
          t={t}
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
                <h3 className="text-lg font-bold text-slate-900">{t("deleteBookingTitle")}</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                {t("deleteBookingBody1")} <span className="font-mono font-bold text-primary">{deleteBookingTarget.orderNumber}</span>
                {" "}({deleteBookingTarget.rows.length} {t("vehicles")})? {t("cannotUndo")}
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteBookingTarget(null)} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">
                  {t("cancel")}
                </button>
                <AsyncButton onClick={handleDeleteBooking} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 cursor-pointer">
                  {t("delete")}
                </AsyncButton>
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
                <AsyncButton onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 cursor-pointer">
                  {t("delete")}
                </AsyncButton>
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

          <TripPanel orderId={order.id} t={t} formatPrice={formatPrice} />

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

// ─── Booking detail (multi-vehicle) ─────────────────────────────────────
// Shared booking info once, then one line per vehicle. Status/driver actions
// stay per vehicle (open a vehicle → the single-order DetailModal) or in ✏️.
function BookingDetailModal({ group, onClose, onEdit, onViewVehicle, t, formatDate, formatPrice, statusColors }) {
  const rows = group.rows;
  const first = rows[0] || {};
  const total = rows.reduce((a, r) => a + Number(r.totalPrice || 0), 0);
  const same = (sel) => { const v = rows.map((r) => String(sel(r) ?? "")); return v.every((x) => x === v[0]) ? v[0] : null; };
  const pickup = same((r) => r.pickupDate);
  const ret = same((r) => r.returnDate);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">
            Order {group.orderNumber}
            <span className="ml-2 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold align-middle">{rows.length} {t("vehicles")}</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <InfoRow label={t("nama")} value={first.customer?.name || "-"} />
            <InfoRow label={t("companyName")} value={first.customer?.companyName || "-"} />
            <InfoRow label={t("phone")} value={first.customer?.phone || "-"} />
            <InfoRow label={t("pickupDate")} value={pickup ? formatDate(pickup) : "—"} />
            <InfoRow label={t("returnDate")} value={ret ? formatDate(ret) : "—"} />
            <InfoRow label={t("kontrakHarga")} value={<span className="font-bold">{formatPrice(total)}</span>} />
          </div>
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">{t("car")}</th>
                  <th className="px-3 py-2 text-left">{t("plat")}</th>
                  <th className="px-3 py-2 text-left">{t("driver")}</th>
                  <th className="px-3 py-2 text-left">{t("tujuan")}</th>
                  <th className="px-3 py-2 text-center">{t("status")}</th>
                  <th className="px-3 py-2 text-right">{t("kontrakHarga")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((o, i) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2">{`${o.car?.brand || ""} ${o.car?.name || ""}`.trim() || "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{o.car?.licensePlate || "-"}</td>
                    <td className="px-3 py-2">{o.driver?.name || "-"}</td>
                    <td className="px-3 py-2">{o.destination || "-"}</td>
                    <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusColors[o.status] || ""}`}>{t(o.status)}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPrice(o.totalPrice)}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => onViewVehicle(o)} className="p-1 rounded hover:bg-blue-50 text-blue-600 cursor-pointer" title={t("details")}>
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {onEdit && (
            <div className="flex justify-end">
              <button onClick={onEdit} className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 cursor-pointer inline-flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">edit</span>{t("edit")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Client rating (Phase C) ─────────────────────────────────────────────────
function RateModal({ orderNumber, onClose, onDone, t }) {
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try { await api.marketplace.rate(orderNumber, rating, comment); toast.success(t("rateThanks")); onDone(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-slate-900">{t("rateOrder")} · <span className="font-mono text-primary">{orderNumber}</span></h3>
        <div className="flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} className={`text-3xl cursor-pointer ${n <= rating ? "text-amber-400" : "text-slate-300"}`}>★</button>
          ))}
        </div>
        <textarea className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm h-24" placeholder={t("rateCommentPh")} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border text-sm cursor-pointer">{t("cancel")}</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium cursor-pointer disabled:opacity-50">{t("rateSend")}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Driver trip log (from the driver app) ──────────────────────────────────
function TripPanel({ orderId, t, formatPrice }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.orders.trip(orderId).then(setD).catch(() => setD({ trip: null, expenses: [] })); }, [orderId]);
  if (!d || (!d.trip && !d.expenses?.length)) return null;
  const tr = d.trip;
  const when = (x) => (x ? new Date(x).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
  const photos = (phase, n) => Array.from({ length: n || 0 }, (_, i) => (
    <AsyncButton key={`${phase}${i}`} type="button" onClick={() => api.orders.openTripPhoto(orderId, phase, i)} className="text-blue-600 hover:underline cursor-pointer">📷{i + 1}</AsyncButton>
  ));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
      <p className="font-bold text-slate-700">{t("drv_tripLog")}</p>
      {tr && <>
        <p>{t("drv_started")}: <b>{when(tr.startedAt)}</b> · {tr.startOdometer ?? "-"} km · BBM {tr.startFuel ?? "-"}/8 {photos("start", tr.startPhotos)}</p>
        {tr.endedAt && <p>{t("drv_finished")}: <b>{when(tr.endedAt)}</b> · {tr.endOdometer ?? "-"} km · BBM {tr.endFuel ?? "-"}/8 {photos("end", tr.endPhotos)}</p>}
        {tr.km != null && <p>{t("drv_distance")}: <b>{tr.km} km</b>{Number(tr.overtimeHoursSuggested) > 0 && <> · <span className="text-amber-700">{t("drv_overtimeSuggest", { n: tr.overtimeHoursSuggested })}</span></>}</p>}
        {tr.notes && <p className="text-slate-500 whitespace-pre-line">{tr.notes}</p>}
      </>}
      {d.expenses?.length > 0 && (
        <p>{t("drv_expenses")}: {d.expenses.map((x) => (
          <AsyncButton key={x.id} type="button" onClick={() => api.orders.openExpenseReceipt(orderId, x.id).catch(() => {})} className="mr-2 hover:underline cursor-pointer">{t(`drv_exp_${x.type}`)} {formatPrice(x.amount)}</AsyncButton>
        ))}</p>
      )}
    </div>
  );
}

// Create + edit forms live in components/BookingEditModal.jsx.

function InfoRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-900">{typeof value === 'string' ? value : value}</p>
    </div>
  );
}
