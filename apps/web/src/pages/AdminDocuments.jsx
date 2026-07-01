import { useState, useEffect, useMemo } from "react";
import { useToast } from "../components/Toast";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";

// ─── Company constants — match the existing Python invoice generator ─────────
const COMPANY = {
  name: "AKOMODASI & RENTAL MOBIL",
  addr: "Jl. Kiara Sari V No. 1 Bandung",
  phone1: "Tlp: 082237578244 / 081322978843",
  phone2: "Tlp: 082219812530 / 081322978843",
  signatory: "Septian Rindiarto",
  brand: "DSR",
  // Wider 2.70:1 invoice logo (matches the Python ReportLab generator)
  logoUrl: "/dsr-logo-invoice.png",
  // Payment details used by Surat Pengantar Tagihan (editable per-document).
  bankAccount: "7751108277",
  bankName: "BCA",
  bankHolder: "Septian Rindiarto",
  email: "dsrjayakarya@gmail.com",
  wa: "082219812530",
};

// ─── Indonesian number to words (terbilang) — ported from Python ─────────────
const SATUAN = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan"];
const BELASAN = ["Sepuluh", "Sebelas", "Dua Belas", "Tiga Belas", "Empat Belas",
  "Lima Belas", "Enam Belas", "Tujuh Belas", "Delapan Belas", "Sembilan Belas"];

function _ratusan(n) {
  if (n === 0) return "";
  if (n < 10) return SATUAN[n];
  if (n < 20) return BELASAN[n - 10];
  if (n < 100) {
    const r = n % 10;
    return SATUAN[Math.floor(n / 10)] + " Puluh" + (r ? " " + SATUAN[r] : "");
  }
  const r = n % 100;
  const pre = Math.floor(n / 100) === 1 ? "Se" : SATUAN[Math.floor(n / 100)] + " ";
  return pre + "Ratus" + (r ? " " + _ratusan(r) : "");
}
function _convert(n) {
  if (n === 0) return "";
  if (n < 1000) return _ratusan(n);
  if (n < 1_000_000) {
    const r = n % 1000;
    const pre = Math.floor(n / 1000) === 1 ? "Se" : _ratusan(Math.floor(n / 1000)) + " ";
    return pre + "Ribu" + (r ? " " + _convert(r) : "");
  }
  if (n < 1_000_000_000) {
    const r = n % 1_000_000;
    return _ratusan(Math.floor(n / 1_000_000)) + " Juta" + (r ? " " + _convert(r) : "");
  }
  const r = n % 1_000_000_000;
  return _ratusan(Math.floor(n / 1_000_000_000)) + " Milyar" + (r ? " " + _convert(r) : "");
}
function terbilang(amount) {
  const n = Math.round(Number(amount || 0));
  if (n === 0) return "Nol Rupiah";
  return _convert(n).trim() + " Rupiah";
}

// ─── Formatting helpers ──────────────────────────────────────────────────────
const rp = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function fmtDateID(d) {
  if (!d) return "";
  const dt = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  return `${dt.getDate()} ${MONTHS_ID[dt.getMonth()]} ${dt.getFullYear()}`;
}
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
/** "14 s/d 15 April 2026", or just "14 April 2026" when same day / no return */
function fmtDateRange(from, to) {
  if (!from) return "-";
  if (!to || from === to) return fmtDateID(from);
  const d1 = new Date(from), d2 = new Date(to);
  if (d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()) {
    return `${d1.getDate()} s/d ${fmtDateID(to)}`;
  }
  return `${fmtDateID(from)} s/d ${fmtDateID(to)}`;
}

// ─── Template persistence (localStorage) ─────────────────────────────────────
const TEMPLATE_STORAGE_KEY = "dsr:doc-templates:v1";

function loadTemplatesAll() {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}
function persistTemplatesAll(all) {
  try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

// ─── Document type catalog ───────────────────────────────────────────────────
const DOC_TYPES = [
  { id: "invoice", label: "Invoice (Tagihan + Kuitansi)", icon: "receipt_long", desc: "A4 portrait — invoice di atas, kuitansi di bawah" },
  { id: "surat_jalan", label: "Surat Jalan", icon: "local_shipping", desc: "A4 landscape — bukti pemakaian mobil" },
  { id: "surat_tagihan", label: "Surat Pengantar Tagihan", icon: "request_quote", desc: "Surat pengantar rekap tagihan ke klien" },
  { id: "penawaran", label: "Surat Penawaran", icon: "request_quote", desc: "Penawaran sewa kendaraan untuk proyek" },
  { id: "perjanjian", label: "Surat Perjanjian Sewa", icon: "gavel", desc: "Kontrak legal sewa kendaraan" },
];

// ─── Default form values per doc type ────────────────────────────────────────
function defaultForm(type) {
  const today = todayISO();
  switch (type) {
    case "invoice":
      return {
        invoiceNo: "26/DSR/INV/", letterNo: "", clientName: "", clientAddress: "",
        date: today, discount: 0, autoDisc: true, pajakRate: 0,
        items: [{ user: "", driver: "", destination: "", rentDate: today, rentReturnDate: today, unit: "", plate: "", lembur: 0, inap: 0, price: 0 }],
      };
    case "surat_jalan":
      return {
        no: "26/DSR/SJ/", clientName: "", clientCompany: "",
        date: today, vehicle: "", plate: "", driver: "",
        items: [{ user: "", date: today, destination: "", days: 1, startTime: "", endTime: "" }],
      };
    case "surat_tagihan":
      return {
        letterNo: "",                                  // No.YY/DSR/NNN — reserve via the button
        to: "",                                        // Kepada (client company)
        from: 'Rental Mobil "DSR"',                    // Dari
        lampiran: "Rekap Tagihan Sewa Kendaraan",      // Lampiran
        usageDate: today,                              // tanggal pemakaian (for the berita)
        date: today,                                   // tanggal surat
        bankAccount: COMPANY.bankAccount,
        bankName: COMPANY.bankName,
        bankHolder: COMPANY.bankHolder,
        email: COMPANY.email,
        wa: COMPANY.wa,
      };
    case "penawaran":
      return {
        no: "26/DSR/PNW/", to: "", attn: "", subject: "Penawaran Sewa Kendaraan",
        date: today, intro: "Bersama surat ini kami sampaikan penawaran harga sewa kendaraan untuk kebutuhan perusahaan Bapak/Ibu sebagai berikut:",
        closing: "Demikian penawaran ini kami sampaikan. Atas perhatian dan kerjasamanya kami ucapkan terima kasih.",
        items: [{ unit: "", duration: "1 hari", include: "Driver, BBM, Tol, Parkir", price: 0 }],
      };
    case "perjanjian":
      return {
        no: "26/DSR/PRJ/", date: today,
        partyA: { name: COMPANY.signatory, role: "Direktur DSR Renta", address: COMPANY.addr },
        partyB: { name: "", role: "", company: "", address: "", idNumber: "" },
        vehicle: "", plate: "", color: "", year: "",
        startDate: today, endDate: today, dailyRate: 0, totalDays: 1, deposit: 0,
      };
    default:
      return {};
  }
}

export default function AdminDocuments() {
  const { t } = useLanguage();
  const toast = useToast();
  const [docType, setDocType] = useState("invoice");
  const [form, setForm] = useState(() => defaultForm("invoice"));
  const [orders, setOrders] = useState(() => apiCache.get("documents:orders") || []);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  // Tier 2 multi-vehicle: the ids of EVERY order row covered by the invoice
  // currently in the form (a multi-car booking shares one code across N rows).
  // Used so "Tandai Invoice Selesai" marks the whole booking, not just the
  // single row the user happened to click.
  const [invoiceOrderIds, setInvoiceOrderIds] = useState([]);
  const [showOrderPicker, setShowOrderPicker] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");

  // ─── Per-trip order lookup state — used by Invoice & Surat Jalan trip rows ──
  // tripLookup.index ≥ 0 → modal open and will fill that trip slot when user picks
  const [tripLookup, setTripLookup] = useState({ open: false, index: -1, search: "" });
  function openTripLookup(index) { setTripLookup({ open: true, index, search: "" }); }
  function closeTripLookup() { setTripLookup({ open: false, index: -1, search: "" }); }

  // ─── Registered-company directory ──────────────────────────────────────
  // Sourced from /api/customers?customerType=company so the registry is the
  // same data the Pelanggan page edits — no duplicate state of truth.
  const [companies, setCompanies] = useState(() => apiCache.get("documents:companies") || []);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  // companyForm modes: null = list view, "new" = add form, <id> = edit form
  const [companyEditMode, setCompanyEditMode] = useState(null);
  const [companyForm, setCompanyForm] = useState({ name: "", address: "", phone: "", email: "" });
  const [companySaving, setCompanySaving] = useState(false);

  // Templates state — saved blueprints per doc type, persisted in localStorage
  const [templates, setTemplates] = useState(() => loadTemplatesAll());
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");

  // Pending-invoice queue — orders that meet criteria for invoice generation
  const [pending, setPending] = useState(() => apiCache.get("documents:needsInvoice") || []);
  const [pendingSearch, setPendingSearch] = useState("");
  const [showPendingPanel, setShowPendingPanel] = useState(true);
  const [syncStatus, setSyncStatus] = useState(() => apiCache.get("sync:status") || null);
  const [syncing, setSyncing] = useState(false);

  // Bulk-mark invoice — selected pending orders + modal state
  const [selectedPending, setSelectedPending] = useState(new Set());
  const [showBulkInvoiceModal, setShowBulkInvoiceModal] = useState(false);
  const [bulkInvoiceDate, setBulkInvoiceDate] = useState(todayISO());
  const [bulkInvoicePrefix, setBulkInvoicePrefix] = useState("");
  const [bulkMarking, setBulkMarking] = useState(false);

  // Load orders + pending-invoice queue + sync status once. SWR keeps it fresh.
  useEffect(() => {
    swr("documents:orders", () => api.orders.list("limit=200&sortOrder=desc"), (res) => {
      setOrders(res?.data || []);
      apiCache.set("documents:orders", res?.data || []);
    }).catch(err => console.error("Failed to load orders for documents:", err));

    swr("documents:needsInvoice", () => api.sync.ordersNeedingInvoice(), (rows) => {
      setPending(Array.isArray(rows) ? rows : []);
    }).catch(err => console.error("Failed to load pending invoices:", err));

    swr("sync:status", () => api.sync.status(), (s) => setSyncStatus(s))
      .catch(err => console.error("Failed to load sync status:", err));

    // Dedicated company directory for invoice address auto-fill
    swr("documents:companies", () => api.companies.list("limit=5000"), (res) => {
      setCompanies(res?.data || []);
    }).catch(err => console.error("Failed to load companies:", err));
  }, []);

  // Filter the pending list by search term
  const filteredPending = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter((o) => {
      const parts = [
        o.orderNumber, o.customer?.name, o.customer?.companyName,
        o.car?.brand, o.car?.name, o.car?.licensePlate,
        o.driver?.name, o.destination, fmtDateID(o.pickupDate),
        rp(o.totalPrice),
      ];
      return parts.filter(Boolean).join("  ").toLowerCase().includes(q);
    });
  }, [pending, pendingSearch]);

  // One-click invoice from a pending order — applies the order to the form,
  // switches the doc type to invoice if needed, and scrolls the preview into view.
  function autoInvoiceFromPending(order) {
    if (docType !== "invoice") {
      setDocType("invoice");
      setForm(defaultForm("invoice"));
    }
    // Reuse the existing applyOrderToForm path by faking the in-memory orders
    // map so the order appears regardless of the orders list pagination
    const idx = orders.findIndex(o => o.id === order.id);
    if (idx === -1) {
      // not in main orders cache — pre-load it before applying
      const merged = [order, ...orders];
      setOrders(merged);
      apiCache.set("documents:orders", merged);
      // give state a tick to update, then apply
      setTimeout(() => applyOrderToForm(order.id), 0);
    } else {
      applyOrderToForm(order.id);
    }
  }

  // After printing/saving a PDF, the user can mark this order as invoiced
  // so it disappears from the pending queue and the invoice number is recorded.
  async function markCurrentInvoiced() {
    if (docType !== "invoice" || !selectedOrderId) {
      toast.error("Tidak ada order yang sedang dipilih.");
      return;
    }
    if (!form.invoiceNo) { toast.error("No. Invoice tidak boleh kosong."); return; }
    // Tier 2 multi-vehicle: a multi-car invoice covers every row sharing the
    // booking code. Mark them ALL invoiced so none are left orphaned in the
    // "perlu tagihan" queue. Single-car invoices keep the original 1-row path.
    const targetIds = invoiceOrderIds.length > 0
      ? invoiceOrderIds
      : [Number(selectedOrderId)];
    try {
      if (targetIds.length > 1) {
        await api.sync.bulkMarkInvoiceGenerated({
          ids: targetIds.map(id => ({ id, invoiceNumber: form.invoiceNo })),
          invoiceSentDate: form.date,
          invoicePaymentStatus: "Pending",
        });
      } else {
        await api.sync.markInvoiceGenerated(targetIds[0], {
          invoiceNumber: form.invoiceNo,
          invoiceSentDate: form.date,
          invoicePaymentStatus: "Pending",
        });
      }
      apiCache.invalidate("documents:");
      apiCache.invalidate("orders:");
      // Refresh the pending list
      const fresh = await api.sync.ordersNeedingInvoice();
      setPending(Array.isArray(fresh) ? fresh : []);
      apiCache.set("documents:needsInvoice", fresh);
      const countMsg = targetIds.length > 1 ? ` (${targetIds.length} kendaraan)` : "";
      toast.success(`Invoice ${form.invoiceNo}${countMsg} tersimpan ke order. Dihapus dari antrian "perlu tagihan".`);
    } catch (err) {
      toast.error("Gagal menyimpan: " + err.message);
    }
  }

  async function handleBulkMark() {
    if (!selectedPending.size) return;
    setBulkMarking(true);
    try {
      const ids = [...selectedPending].map((id, idx) => {
        const order = pending.find(o => o.id === id);
        const suffix = String(idx + 1).padStart(3, "0");
        const invNo = bulkInvoicePrefix
          ? `${bulkInvoicePrefix}-${suffix}`
          : null;
        return { id, invoiceNumber: invNo };
      });
      const res = await api.sync.bulkMarkInvoiceGenerated({
        ids,
        invoiceSentDate: bulkInvoiceDate,
        invoicePaymentStatus: "Pending",
      });
      apiCache.invalidate("documents:");
      apiCache.invalidate("orders:");
      const fresh = await api.sync.ordersNeedingInvoice();
      setPending(Array.isArray(fresh) ? fresh : []);
      apiCache.set("documents:needsInvoice", fresh);
      setSelectedPending(new Set());
      setShowBulkInvoiceModal(false);
      toast.success(`${res.updated} order berhasil ditandai invoice selesai.`);
    } catch (err) {
      toast.error("Gagal: " + err.message);
    } finally {
      setBulkMarking(false);
    }
  }

  // Trigger a manual Rekap.xlsx → DB sync from the page
  async function triggerSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const { ok, summary } = await api.sync.runRekap();
      const msg = ok
        ? `Sync ${summary.status}: orders +${summary.ordersInserted}/~${summary.ordersUpdated}, customers +${summary.customersInserted}, drivers +${summary.driversInserted}, cars +${summary.carsInserted}.`
        : `Sync GAGAL — ${(summary.errors || []).slice(0, 3).map(e => e.message).join(" / ")}`;
      toast.info(msg);
      apiCache.invalidate("documents:");
      apiCache.invalidate("orders:");
      apiCache.invalidate("sync:");
      const [orders2, pending2, status2] = await Promise.all([
        api.orders.list("limit=200&sortOrder=desc"),
        api.sync.ordersNeedingInvoice(),
        api.sync.status(),
      ]);
      setOrders(orders2?.data || []);
      setPending(Array.isArray(pending2) ? pending2 : []);
      setSyncStatus(status2);
    } catch (err) {
      toast.error("Sync error: " + err.message);
    } finally {
      setSyncing(false);
    }
  }

  // When user switches doc type, reset form to that type's defaults.
  function changeDocType(next) {
    setDocType(next);
    setForm(defaultForm(next));
    setSelectedOrderId("");
    setInvoiceOrderIds([]);
  }

  // Tier 2 multi-vehicle: every order row that shares this booking's code,
  // including the picked one. A multi-car booking writes N rows under one
  // orderNumber, so an invoice for it must list every car as its own line.
  // Rows with no code (or a unique code) resolve to just themselves. Sorted
  // by id so line numbering is deterministic regardless of which row was
  // clicked.
  function bookingSiblings(order) {
    const code = (order?.orderNumber || "").trim();
    if (!code) return [order];
    const byId = new Map();
    // Search both the orders cache and the pending-invoice queue so a booking
    // surfaced only from "perlu tagihan" still resolves all of its cars.
    for (const o of [...orders, ...pending]) {
      if ((o.orderNumber || "").trim() === code) byId.set(o.id, o);
    }
    byId.set(order.id, order); // ensure the picked row is present
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }

  // Build one invoice line item from an order row.
  function orderToInvoiceItem(o) {
    const oc = o.customer || {};
    const ocar = o.car || {};
    const odrv = o.driver || {};
    const pd = o.pickupDate ? new Date(o.pickupDate).toISOString().slice(0, 10) : todayISO();
    const rd = o.returnDate ? new Date(o.returnDate).toISOString().slice(0, 10) : pd;
    return {
      user: oc.name || "",
      driver: odrv.name || "",
      destination: o.destination || "",
      rentDate: pd,
      rentReturnDate: rd,
      unit: ocar.brand && ocar.name ? `${ocar.brand} ${ocar.name}` : (ocar.name || ""),
      plate: ocar.licensePlate || "",
      lembur: Number(o.overtimeHours || 0),
      inap: Number(o.overnightNights || 0),
      price: Number(o.totalPrice || 0),
    };
  }

  // Pull data from a selected order into the current form (fills relevant fields)
  function applyOrderToForm(orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order) return;
    setSelectedOrderId(orderId);
    setInvoiceOrderIds([order.id]); // overridden below for multi-car invoices
    const c = order.customer || {};
    const car = order.car || {};
    const drv = order.driver || {};
    const customerLabel = c.companyName || c.name || "";
    // Address auto-fill chain: lookup the customer's company name in the
    // dedicated `companies` directory first; fall back to the customer's own
    // address, then empty. This matches the user's flow:
    //   pick Kode Transaksi → name fills → address resolved from companies table.
    const lookup = customerLabel
      ? companies.find(co => (co.name || "").toLowerCase() === customerLabel.toLowerCase())
      : null;
    const addr = (lookup && lookup.address) || c.address || "";

    if (docType === "invoice") {
      // Multi-car booking → one line per car. Single bookings collapse to a
      // 1-element array, identical to the old behaviour.
      const siblings = bookingSiblings(order);
      setInvoiceOrderIds(siblings.map(o => o.id));
      setForm({
        invoiceNo: `26/DSR/INV/${order.orderNumber || ""}`,
        clientName: customerLabel,
        clientAddress: addr,
        date: order.pickupDate ? new Date(order.pickupDate).toISOString().slice(0, 10) : todayISO(),
        discount: 0,
        autoDisc: (order.totalDays || 1) >= 4,
        pajakRate: 0,
        items: siblings.map(orderToInvoiceItem),
      });
    } else if (docType === "surat_jalan") {
      setForm({
        no: `26/DSR/SJ/${order.orderNumber || ""}`,
        clientName: c.name || "",
        clientCompany: customerLabel,
        date: order.pickupDate ? new Date(order.pickupDate).toISOString().slice(0, 10) : todayISO(),
        vehicle: car.brand && car.name ? `${car.brand} ${car.name}` : (car.name || ""),
        plate: car.licensePlate || "",
        driver: drv.name || "",
        items: [{
          user: c.name || "",
          date: order.pickupDate ? new Date(order.pickupDate).toISOString().slice(0, 10) : todayISO(),
          destination: order.destination || "",
          days: Number(order.totalDays || 1),
          startTime: "",
          endTime: "",
        }],
      });
    } else if (docType === "surat_tagihan") {
      setForm(prev => ({
        ...defaultForm("surat_tagihan"),
        ...prev,                                       // keep a reserved letterNo if already taken
        to: customerLabel,
        usageDate: order.pickupDate ? new Date(order.pickupDate).toISOString().slice(0, 10) : todayISO(),
        date: todayISO(),
      }));
    } else if (docType === "perjanjian") {
      setForm({
        ...defaultForm("perjanjian"),
        no: `26/DSR/PRJ/${order.orderNumber || ""}`,
        date: order.pickupDate ? new Date(order.pickupDate).toISOString().slice(0, 10) : todayISO(),
        partyB: { name: c.name || "", role: c.job || "", company: c.companyName || "", address: addr, idNumber: "" },
        vehicle: car.brand && car.name ? `${car.brand} ${car.name}` : (car.name || ""),
        plate: car.licensePlate || "",
        color: car.color || "",
        year: car.year || "",
        startDate: order.pickupDate ? new Date(order.pickupDate).toISOString().slice(0, 10) : todayISO(),
        endDate: order.returnDate ? new Date(order.returnDate).toISOString().slice(0, 10) : todayISO(),
        dailyRate: Number(order.dailyRate || 0),
        totalDays: Number(order.totalDays || 1),
        deposit: Number(order.bailout || 0),
      });
    }
    setShowOrderPicker(false);
  }

  function handlePrint() {
    window.print();
  }

  // Apply ONE order's data to a single trip slot in the current form.
  // Used by both Invoice and Surat Jalan trip rows. Leaves other trips untouched.
  function applyOrderToTripSlot(index, orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order || index < 0) return;
    const c = order.customer || {};
    const car = order.car || {};
    const drv = order.driver || {};
    const isoDate = order.pickupDate ? new Date(order.pickupDate).toISOString().slice(0, 10) : todayISO();
    const unitName = car.brand && car.name ? `${car.brand} ${car.name}` : (car.name || "");

    setForm(prev => {
      const items = (prev.items || []).slice();
      const cur = items[index] || {};
      if (docType === "invoice") {
        items[index] = {
          ...cur,
          user: c.name || cur.user || "",
          driver: drv.name || cur.driver || "",
          destination: order.destination || cur.destination || "",
          rentDate: isoDate,
          rentReturnDate: order.returnDate ? new Date(order.returnDate).toISOString().slice(0, 10) : isoDate,
          unit: unitName || cur.unit || "",
          plate: car.licensePlate || cur.plate || "",
          lembur: Number(order.overtimeHours || 0),
          inap: Number(order.overnightNights || 0),
          price: Number(order.totalPrice || 0),
        };
      } else if (docType === "surat_jalan") {
        items[index] = {
          ...cur,
          user: c.name || cur.user || "",
          date: isoDate,
          destination: order.destination || cur.destination || "",
          days: Number(order.totalDays || 1),
          startTime: cur.startTime || "",
          endTime: cur.endTime || "",
        };
        // Surat Jalan also has shared vehicle/driver fields at the top level —
        // backfill them only if currently empty so we don't clobber user edits.
        const patch = {};
        if (!prev.vehicle && unitName) patch.vehicle = unitName;
        if (!prev.plate && car.licensePlate) patch.plate = car.licensePlate;
        if (!prev.driver && drv.name) patch.driver = drv.name;
        if (!prev.clientName && (c.companyName || c.name)) patch.clientName = c.name || "";
        if (!prev.clientCompany && c.companyName) patch.clientCompany = c.companyName;
        return { ...prev, ...patch, items };
      }
      return { ...prev, items };
    });
    closeTripLookup();
  }

  // ─── Company picker actions ──────────────────────────────────────────────
  function openCompanyPicker() {
    setCompanyEditMode(null);
    setCompanySearch("");
    setShowCompanyPicker(true);
  }
  function closeCompanyPicker() {
    setShowCompanyPicker(false);
    setCompanyEditMode(null);
    setCompanyForm({ name: "", address: "", phone: "", email: "" });
  }
  function applyCompany(comp) {
    setForm(prev => ({
      ...prev,
      clientName: comp.name || prev.clientName,
      clientAddress: comp.address || prev.clientAddress,
    }));
    closeCompanyPicker();
  }
  function startAddCompany() {
    setCompanyForm({ name: "", address: "", phone: "", email: "" });
    setCompanyEditMode("new");
  }
  function startEditCompany(comp) {
    setCompanyForm({
      name: comp.name || "",
      address: comp.address || "",
      phone: comp.phone || "",
      email: comp.email || "",
    });
    setCompanyEditMode(comp.id);
  }
  async function saveCompany() {
    if (!companyForm.name.trim()) { toast.error("Nama perusahaan wajib diisi."); return; }
    setCompanySaving(true);
    try {
      // Treat empty strings, "-", and "—" as null so they don't trip backend validators
      const clean = (s) => {
        const t = String(s || "").trim();
        return (!t || t === "-" || t === "—") ? null : t;
      };
      const payload = {
        name: companyForm.name.trim(),
        address: clean(companyForm.address),
        phone: clean(companyForm.phone),
        email: clean(companyForm.email),
      };
      // Drop email if it looks invalid — saves a user from getting a confusing 422
      if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
        const ok = confirm(`"${payload.email}" tidak terlihat seperti email yang valid.\nLanjutkan tanpa email?`);
        if (!ok) { setCompanySaving(false); return; }
        payload.email = null;
      }
      if (companyEditMode === "new") {
        await api.companies.create(payload);
      } else {
        await api.companies.update(companyEditMode, payload);
      }
      apiCache.invalidate("documents:companies");
      const fresh = await api.companies.list("limit=5000");
      setCompanies(fresh?.data || []);
      apiCache.set("documents:companies", fresh);
      setCompanyEditMode(null);
      setCompanyForm({ name: "", address: "", phone: "", email: "" });
    } catch (err) {
      // Friendly handling for "already exists" — let user jump to edit it
      if (/sudah terdaftar/i.test(err.message)) {
        const fresh = await api.companies.list("limit=5000");
        setCompanies(fresh?.data || []);
        apiCache.set("documents:companies", fresh);
        const dup = (fresh?.data || []).find(c => c.name?.toLowerCase() === payload.name.toLowerCase());
        if (dup && confirm(`"${payload.name}" sudah ada di direktori.\nMuat data yang ada untuk diedit?`)) {
          startEditCompany(dup);
          setCompanySaving(false);
          return;
        }
      }
      toast.error("Gagal menyimpan: " + err.message);
    } finally {
      setCompanySaving(false);
    }
  }
  async function deleteCompany(comp) {
    if (!confirm(`Hapus "${comp.name}" dari direktori perusahaan?`)) return;
    try {
      await api.companies.delete(comp.id);
      apiCache.invalidate("documents:companies");
      const fresh = await api.companies.list("limit=5000");
      setCompanies(fresh?.data || []);
      apiCache.set("documents:companies", fresh);
    } catch (err) {
      toast.error("Gagal menghapus: " + err.message);
    }
  }

  // Filtered company list for the picker
  const filteredCompanies = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(c =>
      [c.name, c.address, c.phone, c.email].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [companies, companySearch]);

  // Filtered orders for the trip-lookup modal (uses its own search state)
  const filteredTripOrders = useMemo(() => {
    const q = tripLookup.search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const parts = [
        o.orderNumber,
        o.customer?.name, o.customer?.companyName, o.customer?.phone,
        o.car?.brand, o.car?.name, o.car?.licensePlate,
        o.driver?.name,
        o.package, o.destination,
        fmtDateID(o.pickupDate),
      ];
      return parts.filter(Boolean).join("  ").toLowerCase().includes(q);
    });
  }, [orders, tripLookup.search]);

  // Client-side haystack search across the order list — same pattern as Rekap Order.
  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const parts = [
        o.orderNumber,
        o.customer?.name, o.customer?.companyName, o.customer?.phone, o.customer?.whatsapp, o.customer?.email,
        o.car?.brand, o.car?.name, o.car?.licensePlate,
        o.driver?.name, o.driver?.phone,
        o.package, o.destination,
        fmtDateID(o.pickupDate), fmtDateID(o.returnDate),
        String(o.totalDays ?? ""),
        String(o.totalPrice ?? ""), rp(o.totalPrice),
        o.status,
      ];
      return parts.filter(Boolean).join("  ").toLowerCase().includes(q);
    });
  }, [orders, orderSearch]);

  // ─── Template helpers ────────────────────────────────────────────────────
  const currentTemplates = templates[docType] || [];

  function saveCurrentAsTemplate(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const all = { ...templates };
    const list = (all[docType] || []).slice();
    list.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
      form: JSON.parse(JSON.stringify(form)), // deep clone
    });
    all[docType] = list;
    setTemplates(all);
    persistTemplatesAll(all);
    setNewTemplateName("");
    setShowSaveTemplateModal(false);
  }

  function loadTemplate(tpl) {
    setForm(JSON.parse(JSON.stringify(tpl.form)));
    setShowTemplatesModal(false);
  }

  function deleteTemplate(id) {
    if (!confirm("Hapus template ini?")) return;
    const all = { ...templates };
    all[docType] = (all[docType] || []).filter(t => t.id !== id);
    setTemplates(all);
    persistTemplatesAll(all);
  }

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("documents")}</h1>
          <p className="text-slate-500 text-sm mt-1">Buat tagihan, surat jalan, surat pengantar tagihan, penawaran & perjanjian sewa</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title="Tarik ulang data dari Rekap 2026.xlsx (Google Drive sync)"
          >
            {syncing
              ? <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              : <span className="material-symbols-outlined text-[18px]">cloud_sync</span>}
            {syncing ? "Sync…" : "Sync Rekap"}
          </button>
          <button
            onClick={() => setShowOrderPicker(true)}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
            title="Auto-fill dari order yang sudah ada"
          >
            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            Auto-fill dari Order
          </button>
          {docType === "invoice" && selectedOrderId && (() => {
            const currentOrder = orders.find(o => String(o.id) === String(selectedOrderId));
            return (
              <button
                onClick={markCurrentInvoiced}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors cursor-pointer"
                title={`Tandai order ${currentOrder?.orderNumber || selectedOrderId} sebagai selesai invoice`}
              >
                <span className="material-symbols-outlined text-[18px]">verified</span>
                Tandai Selesai
                {currentOrder?.orderNumber && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800 text-[11px] font-bold font-mono">
                    {currentOrder.orderNumber}
                  </span>
                )}
              </button>
            );
          })()}
          {docType === "invoice" && selectedPending.size > 0 && (
            <button
              onClick={() => { setBulkInvoiceDate(todayISO()); setShowBulkInvoiceModal(true); }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">done_all</span>
              Tandai Terpilih
              <span className="px-1.5 py-0.5 rounded bg-white/25 text-white text-[11px] font-bold">{selectedPending.size}</span>
            </button>
          )}
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark transition-colors shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">print</span>
            Cetak / Simpan PDF
          </button>
        </div>
      </div>

      {/* Sync status strip — last sync time, file freshness, counts */}
      {syncStatus && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs print:hidden">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${syncStatus.file?.exists ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="text-slate-500">File Rekap:</span>
            <span className="font-medium text-slate-700 truncate max-w-[300px]" title={syncStatus.file?.path}>
              {syncStatus.file?.exists ? `${(syncStatus.file.size / 1024).toFixed(0)} KB` : "tidak ditemukan"}
            </span>
          </div>
          {syncStatus.file?.mtime && (
            <div className="text-slate-500">Diperbarui: <span className="text-slate-700 font-medium">{fmtDateID(syncStatus.file.mtime)}</span></div>
          )}
          {syncStatus.lastSync && (
            <div className="text-slate-500">
              Sync terakhir: <span className="text-slate-700 font-medium">{fmtDateID(syncStatus.lastSync.createdAt)}</span>
              {" "}<span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${syncStatus.lastSync.status === "success" ? "bg-emerald-100 text-emerald-700" :
                syncStatus.lastSync.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                }`}>{syncStatus.lastSync.status}</span>
            </div>
          )}
          {syncStatus.counts && (
            <div className="text-slate-500">
              Order: <b className="text-slate-700">{syncStatus.counts.total_orders}</b>{" "}
              (web {syncStatus.counts.web_orders} · rekap {syncStatus.counts.rekap_orders}) ·
              {" "}Belum invoice: <b className="text-amber-700">{syncStatus.counts.pending_invoice}</b>
            </div>
          )}
        </div>
      )}

      {/* Pending-invoice panel — collapsible, only shows when there's data and Invoice doctype is active */}
      {docType === "invoice" && pending.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 print:hidden">
          <button
            onClick={() => setShowPendingPanel(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-amber-50 rounded-t-xl"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-600 text-[20px]">pending_actions</span>
              <span className="font-bold text-slate-900">Order Menunggu Invoice</span>
              <span className="bg-amber-200 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded">{pending.length}</span>
            </div>
            <span className="material-symbols-outlined text-slate-400">{showPendingPanel ? "expand_less" : "expand_more"}</span>
          </button>
          {showPendingPanel && (
            <div className="border-t border-amber-200">
              {/* Search + select-all bar */}
              <div className="px-4 py-2.5 bg-white flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer shrink-0" title="Pilih semua yang ditampilkan">
                  <input
                    type="checkbox"
                    checked={filteredPending.length > 0 && filteredPending.every(o => selectedPending.has(o.id))}
                    onChange={e => {
                      const next = new Set(selectedPending);
                      filteredPending.forEach(o => e.target.checked ? next.add(o.id) : next.delete(o.id));
                      setSelectedPending(next);
                    }}
                    className="w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer"
                  />
                  <span className="text-xs text-slate-500 whitespace-nowrap">Semua</span>
                </label>
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
                  <input
                    type="text" value={pendingSearch} onChange={(e) => setPendingSearch(e.target.value)}
                    placeholder="Cari kode transaksi, nama, mobil, plat…"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                {selectedPending.size > 0 && (
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg whitespace-nowrap">
                    {selectedPending.size} dipilih
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto bg-white rounded-b-xl">
                {filteredPending.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-6">Tidak ada order yang cocok.</p>
                ) : (
                  filteredPending.map(o => (
                    <div
                      key={o.id}
                      className={`flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 last:border-b-0 ${selectedPending.has(o.id) ? "bg-emerald-50/60" : "hover:bg-amber-50"}`}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={selectedPending.has(o.id)}
                        onChange={e => {
                          const next = new Set(selectedPending);
                          e.target.checked ? next.add(o.id) : next.delete(o.id);
                          setSelectedPending(next);
                        }}
                        className="w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer shrink-0"
                      />
                      {/* Row content — click to auto-fill form */}
                      <button
                        onClick={() => autoInvoiceFromPending(o)}
                        className="flex-1 flex items-center justify-between gap-3 text-left cursor-pointer min-w-0"
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          <span className="material-symbols-outlined text-amber-500 text-[18px] shrink-0">arrow_circle_right</span>
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-bold text-primary">{o.orderNumber}</p>
                            <p className="text-sm font-medium text-slate-900 truncate">{o.customer?.companyName || o.customer?.name || "-"}</p>
                            <p className="text-xs text-slate-500 truncate">
                              {[o.car?.brand, o.car?.name].filter(Boolean).join(" ")}
                              {o.car?.licensePlate ? ` (${o.car.licensePlate})` : ""}
                              {" • "}{fmtDateID(o.pickupDate)}
                              {" • "}{o.totalDays} hari · status {o.status}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-slate-700 whitespace-nowrap">{rp(o.totalPrice)}</p>
                      </button>
                    </div>
                  ))
                )}
              </div>
              {/* Bulk action footer */}
              {selectedPending.size > 0 && (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between gap-3 rounded-b-xl">
                  <p className="text-xs text-amber-800 font-medium">
                    <b>{selectedPending.size}</b> order dipilih untuk ditandai invoice selesai
                  </p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedPending(new Set())}
                      className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer px-2 py-1 rounded hover:bg-white">
                      Batalkan
                    </button>
                    <button
                      onClick={() => { setBulkInvoiceDate(todayISO()); setShowBulkInvoiceModal(true); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">done_all</span>
                      Tandai Invoice Selesai ({selectedPending.size})
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Document type picker */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 print:hidden">
        {DOC_TYPES.map(d => (
          <button
            key={d.id}
            onClick={() => changeDocType(d.id)}
            className={`flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all cursor-pointer ${docType === d.id
              ? "bg-primary/5 border-primary shadow-sm"
              : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
              }`}
          >
            <div className={`p-2 rounded-lg ${docType === d.id ? "bg-primary text-white" : "bg-slate-100 text-slate-600"}`}>
              <span className="material-symbols-outlined text-[22px]">{d.icon}</span>
            </div>
            <div>
              <p className={`text-sm font-bold ${docType === d.id ? "text-primary" : "text-slate-900"}`}>{d.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{d.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Two-column working area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:block print:gap-0">
        {/* Form (left) */}
        <div className="lg:col-span-5 print:hidden">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Data Dokumen</h2>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowTemplatesModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 cursor-pointer"
                  title="Muat template yang tersimpan"
                >
                  <span className="material-symbols-outlined text-[16px]">bookmark</span>
                  Muat Template
                  {currentTemplates.length > 0 && (
                    <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded ml-1">{currentTemplates.length}</span>
                  )}
                </button>
                <button
                  onClick={() => setShowSaveTemplateModal(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:opacity-90 cursor-pointer"
                  title="Simpan form ini sebagai template"
                >
                  <span className="material-symbols-outlined text-[16px]">bookmark_add</span>
                  Simpan sebagai Template
                </button>
              </div>
            </div>
            {docType === "invoice" && <InvoiceForm form={form} setForm={setForm} openTripLookup={openTripLookup} openCompanyPicker={openCompanyPicker} />}
            {docType === "surat_jalan" && <SuratJalanForm form={form} setForm={setForm} openTripLookup={openTripLookup} />}
            {docType === "surat_tagihan" && <SuratTagihanForm form={form} setForm={setForm} />}
            {docType === "penawaran" && <PenawaranForm form={form} setForm={setForm} />}
            {docType === "perjanjian" && <PerjanjianForm form={form} setForm={setForm} />}
          </div>
          <p className="text-xs text-slate-500 mt-3 px-1">
            <span className="material-symbols-outlined text-[14px] align-middle">info</span>
            {" "}Pratinjau di kanan sama persis dengan hasil cetak. Klik "Cetak / Simpan PDF" untuk menyimpan sebagai PDF lewat dialog cetak browser.
          </p>
        </div>

        {/* Preview (right) */}
        <div className="lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 lg:p-6 overflow-x-auto print:p-0 print:bg-white print:border-0 print:rounded-none">
            <div className="flex justify-center">
              <div className="doc-preview-wrap shadow-xl print:shadow-none">
                {docType === "invoice" && <InvoiceTemplate form={form} />}
                {docType === "surat_jalan" && <SuratJalanTemplate form={form} />}
                {docType === "surat_tagihan" && <SuratTagihanTemplate form={form} />}
                {docType === "penawaran" && <PenawaranTemplate form={form} />}
                {docType === "perjanjian" && <PerjanjianTemplate form={form} />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Order picker modal — with haystack search bar */}
      {showOrderPicker && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden" onClick={() => { setShowOrderPicker(false); setOrderSearch(""); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Pilih Order untuk Auto-Fill</h2>
              <button onClick={() => { setShowOrderPicker(false); setOrderSearch(""); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
                <input
                  autoFocus
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Cari kode transaksi, nama, mobil, plat, tanggal, dll.…"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                />
              </div>
              <p className="text-xs text-slate-400 mt-2">{filteredOrders.length} dari {orders.length} order</p>
            </div>
            <div className="overflow-y-auto p-3">
              {orders.length === 0 && <p className="text-center text-slate-400 py-8">Tidak ada order tersedia.</p>}
              {orders.length > 0 && filteredOrders.length === 0 && (
                <p className="text-center text-slate-400 py-8">Tidak ada order yang cocok dengan pencarian.</p>
              )}
              {filteredOrders.map(o => (
                <button
                  key={o.id}
                  onClick={() => { applyOrderToForm(o.id); setOrderSearch(""); }}
                  className="w-full flex items-start justify-between gap-4 px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer text-left border border-transparent hover:border-slate-200 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-primary">{o.orderNumber}</p>
                    <p className="text-sm font-medium text-slate-900 truncate">{o.customer?.companyName || o.customer?.name || "-"}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {[o.car?.brand, o.car?.name].filter(Boolean).join(" ")}
                      {o.car?.licensePlate ? ` (${o.car.licensePlate})` : ""}
                      {" • "}{fmtDateID(o.pickupDate)}
                      {" • "}{o.totalDays} hari
                    </p>
                  </div>
                  <p className="text-sm font-bold text-slate-700 whitespace-nowrap">{rp(o.totalPrice)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Trip lookup modal — fills ONE trip slot from a selected Kode Transaksi */}
      {tripLookup.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden" onClick={closeTripLookup}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Isi Trip #{tripLookup.index + 1} dari Order</h2>
                <p className="text-xs text-slate-500 mt-0.5">Pilih Kode Transaksi — semua kolom trip ini akan otomatis terisi.</p>
              </div>
              <button onClick={closeTripLookup} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
                <input
                  autoFocus
                  type="text"
                  value={tripLookup.search}
                  onChange={(e) => setTripLookup(s => ({ ...s, search: e.target.value }))}
                  placeholder="Cari kode transaksi, nama, mobil, plat, tanggal…"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                />
              </div>
              <p className="text-xs text-slate-400 mt-2">{filteredTripOrders.length} dari {orders.length} order</p>
            </div>
            <div className="overflow-y-auto p-3">
              {orders.length === 0 && <p className="text-center text-slate-400 py-8">Tidak ada order tersedia.</p>}
              {orders.length > 0 && filteredTripOrders.length === 0 && (
                <p className="text-center text-slate-400 py-8">Tidak ada order yang cocok dengan pencarian.</p>
              )}
              {filteredTripOrders.map(o => (
                <button
                  key={o.id}
                  onClick={() => applyOrderToTripSlot(tripLookup.index, o.id)}
                  className="w-full flex items-start justify-between gap-4 px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer text-left border border-transparent hover:border-slate-200 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-primary">{o.orderNumber}</p>
                    <p className="text-sm font-medium text-slate-900 truncate">{o.customer?.companyName || o.customer?.name || "-"}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {[o.car?.brand, o.car?.name].filter(Boolean).join(" ")}
                      {o.car?.licensePlate ? ` (${o.car.licensePlate})` : ""}
                      {" • "}{fmtDateID(o.pickupDate)}
                      {" • "}{o.totalDays} hari
                    </p>
                  </div>
                  <p className="text-sm font-bold text-slate-700 whitespace-nowrap">{rp(o.totalPrice)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Company picker — registered company directory for invoice address auto-fill */}
      {showCompanyPicker && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden" onClick={closeCompanyPicker}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {companyEditMode === "new" ? "Tambah Perusahaan Baru" : companyEditMode ? "Edit Perusahaan" : "Pilih Perusahaan Terdaftar"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {companyEditMode === null
                    ? `${companies.length} perusahaan terdaftar — pilih untuk mengisi nama + alamat invoice otomatis`
                    : "Disimpan ke direktori perusahaan (terpisah dari daftar Pelanggan)"}
                </p>
              </div>
              <button onClick={closeCompanyPicker} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {companyEditMode === null ? (
              // ─── List view ────────────────────────────────────────────
              <>
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
                    <input
                      autoFocus
                      type="text"
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      placeholder="Cari nama, alamat…"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                  </div>
                  <button
                    onClick={startAddCompany}
                    className="flex items-center gap-1 px-3 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer whitespace-nowrap"
                  >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Tambah
                  </button>
                </div>
                <div className="overflow-y-auto p-3">
                  {companies.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">Belum ada perusahaan terdaftar. Klik "Tambah" untuk mulai mengisi.</p>}
                  {companies.length > 0 && filteredCompanies.length === 0 && (
                    <p className="text-center text-slate-400 py-8 text-sm">Tidak ada perusahaan yang cocok dengan pencarian.</p>
                  )}
                  {filteredCompanies.map(c => (
                    <div
                      key={c.id}
                      className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
                    >
                      <button onClick={() => applyCompany(c)} className="flex-1 min-w-0 text-left cursor-pointer">
                        <p className="text-sm font-bold text-slate-900 truncate">{c.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{c.address || <span className="italic text-slate-400">Tanpa alamat</span>}</p>
                        {(c.phone || c.email) && (
                          <p className="text-xs text-slate-400 mt-1">
                            {c.phone}{c.phone && c.email ? " · " : ""}{c.email}
                          </p>
                        )}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => startEditCompany(c)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer" title="Edit">
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button onClick={() => deleteCompany(c)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer" title="Hapus">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              // ─── Add / Edit form ──────────────────────────────────────
              <>
                <div className="p-5 space-y-3 overflow-y-auto">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Perusahaan *</label>
                    <input
                      autoFocus
                      type="text"
                      value={companyForm.name}
                      onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                      placeholder="cth. PT. My Icon Technology"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Alamat</label>
                    <textarea
                      value={companyForm.address}
                      onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                      rows={3}
                      placeholder="Alamat lengkap"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-y"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Telepon</label>
                      <input
                        type="tel"
                        value={companyForm.phone}
                        onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                      <input
                        type="email"
                        value={companyForm.email}
                        onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50">
                  <button
                    onClick={() => { setCompanyEditMode(null); setCompanyForm({ name: "", address: "", phone: "", email: "" }); }}
                    className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-white cursor-pointer"
                  >
                    Kembali
                  </button>
                  <button
                    onClick={saveCompany}
                    disabled={companySaving || !companyForm.name.trim()}
                    className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {companySaving ? "Menyimpan..." : "Simpan"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Templates modal — list saved templates for the current doc type */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden" onClick={() => setShowTemplatesModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Template — {DOC_TYPES.find(d => d.id === docType)?.label}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{currentTemplates.length} template tersimpan</p>
              </div>
              <button onClick={() => setShowTemplatesModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="overflow-y-auto p-3">
              {currentTemplates.length === 0 && (
                <div className="text-center py-12">
                  <span className="material-symbols-outlined text-4xl text-slate-300 mb-2 block">bookmark</span>
                  <p className="text-sm text-slate-400">Belum ada template untuk tipe dokumen ini.</p>
                  <p className="text-xs text-slate-400 mt-1">Klik "Simpan sebagai Template" pada form untuk menyimpan blueprint pertama.</p>
                </div>
              )}
              {currentTemplates.map(tpl => (
                <div key={tpl.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{tpl.name}</p>
                    <p className="text-xs text-slate-400">Disimpan {fmtDateID(tpl.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => loadTemplate(tpl)} className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:opacity-90 cursor-pointer">Muat</button>
                    <button onClick={() => deleteTemplate(tpl.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer" title="Hapus">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Save template modal — quick name prompt */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden" onClick={() => { setShowSaveTemplateModal(false); setNewTemplateName(""); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Simpan Template</h2>
              <button onClick={() => { setShowSaveTemplateModal(false); setNewTemplateName(""); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500">Nilai form saat ini akan disimpan sebagai template <b>{DOC_TYPES.find(d => d.id === docType)?.label}</b>.</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Template *</label>
                <input
                  autoFocus
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrentAsTemplate(newTemplateName); }}
                  placeholder="cth. Invoice Standar Korporat"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-slate-100 bg-slate-50">
              <button onClick={() => { setShowSaveTemplateModal(false); setNewTemplateName(""); }} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-white cursor-pointer">Batal</button>
              <button onClick={() => saveCurrentAsTemplate(newTemplateName)} disabled={!newTemplateName.trim()} className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* Print-specific CSS — true A4 sizing, with orientation matching the active doc type */}
      <style>{`
        .doc-preview-wrap { background: white; }
        .doc-page {
          background: white;
          color: black;
          font-family: Helvetica, Arial, sans-serif;
          padding: 12mm 15mm;
          box-sizing: border-box;
          /* Anchor for native chrome rendering — colors & backgrounds must print */
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        /* True A4 dimensions in mm. min-height keeps the visual proof but doesn't force a 2nd page unless real content overflows. */
        .doc-page-a4      { width: 210mm; min-height: 297mm; }
        .doc-page-a4-land { width: 297mm; min-height: 210mm; padding: 10mm 15mm; }
        .doc-page-receipt { width: 210mm; min-height: 100mm; }
        /* Surat Pengantar Tagihan — fits within ~1/4 of an A4 sheet (≈74mm). */
        .doc-page-quarter { width: 210mm; min-height: 74mm; padding: 8mm 15mm; }
        .doc-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        .doc-table th, .doc-table td { border: 0.5pt solid #000; padding: 4pt 5pt; vertical-align: middle; }
        .doc-table th { background: #1f4f77; color: white; font-weight: bold; text-align: center; font-size: 9pt; }
        .doc-table.no-fill th { background: white; color: black; }
        .terbilang-bg { background: #ebebeb; padding: 1pt 4pt; }

        @media print {
          /* Set the printer paper to true A4 with the right orientation. */
          @page { size: ${docType === "surat_jalan" ? "A4 landscape" : "A4 portrait"}; margin: 0; }
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Hide everything, then re-show the document only. */
          body * { visibility: hidden !important; }
          .doc-preview-wrap, .doc-preview-wrap * { visibility: visible !important; }
          .doc-preview-wrap {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .doc-page {
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: avoid;
          }
          /* Avoid stray bottom space producing a blank second page. */
          .doc-page-a4      { min-height: 297mm; }
          .doc-page-a4-land { min-height: 210mm; }
        }
      `}</style>

      {/* ── Bulk Invoice Modal ──────────────────────────────────────── */}
      {showBulkInvoiceModal && (() => {
        const selectedOrders = pending.filter(o => selectedPending.has(o.id));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm print:hidden">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
              {/* Header */}
              <div className="bg-emerald-600 px-6 py-4 flex items-center gap-3">
                <span className="material-symbols-outlined text-white text-2xl">done_all</span>
                <div>
                  <h3 className="text-white font-bold text-lg">Tandai Invoice Selesai</h3>
                  <p className="text-emerald-100 text-xs mt-0.5">{selectedOrders.length} order akan ditandai</p>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {/* Order list */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Kode Transaksi yang akan ditandai selesai</p>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                    {selectedOrders.map(o => (
                      <div key={o.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="material-symbols-outlined text-emerald-500 text-[16px] shrink-0">check_circle</span>
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-bold text-primary">{o.orderNumber}</p>
                            <p className="text-xs text-slate-500 truncate">{o.customer?.companyName || o.customer?.name || "-"}</p>
                          </div>
                        </div>
                        <p className="text-xs font-bold text-slate-700 whitespace-nowrap shrink-0">{rp(o.totalPrice)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Invoice number prefix */}
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Prefix No. Invoice <span className="font-normal text-slate-400">(opsional)</span>
                  </label>
                  <input
                    type="text"
                    value={bulkInvoicePrefix}
                    onChange={e => setBulkInvoicePrefix(e.target.value)}
                    placeholder="cth: 26/DSR/INV → akan jadi 26/DSR/INV-001, 002, …"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
                  />
                  <p className="text-xs text-slate-400 mt-1">Kosongkan jika nomor invoice akan diisi manual nanti.</p>
                </div>

                {/* Invoice date */}
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Tanggal Invoice</label>
                  <input
                    type="date"
                    value={bulkInvoiceDate}
                    onChange={e => setBulkInvoiceDate(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 pb-6 flex gap-3 justify-end">
                <button
                  onClick={() => setShowBulkInvoiceModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
                >Batal</button>
                <button
                  onClick={handleBulkMark}
                  disabled={bulkMarking}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                >
                  {bulkMarking && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {bulkMarking ? "Menyimpan..." : `Tandai ${selectedOrders.length} Order Selesai`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </AdminLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Form components — one per doc type
// ═══════════════════════════════════════════════════════════════════════════════

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
    </div>
  );
}
function TextArea({ label, value, onChange, rows = 3 }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={rows}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-y" />
    </div>
  );
}

function InvoiceForm({ form, setForm, openTripLookup, openCompanyPicker }) {
  const toast = useToast();
  const [reservingLetter, setReservingLetter] = useState(false);
  const upd = (patch) => setForm({ ...form, ...patch });

  // Optional company letter number for invoices (same counter as Surat
  // Pengantar Tagihan). Most invoices don't need one, so it's opt-in.
  async function reserveLetterNo() {
    setReservingLetter(true);
    try {
      const res = await api.myOrg.nextLetterNumber();
      upd({ letterNo: res.letterNumber });
      toast.success(`Nomor surat ${res.letterNumber} diambil.`);
    } catch (e) {
      toast.error("Gagal mengambil nomor surat: " + e.message);
    } finally {
      setReservingLetter(false);
    }
  }
  const updItem = (i, patch) => {
    const items = form.items.slice();
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  };
  const addItem = () => setForm({ ...form, items: [...form.items, { user: "", driver: "", destination: "", rentDate: todayISO(), rentReturnDate: todayISO(), unit: "", plate: "", lembur: 0, inap: 0, price: 0 }] });
  // "Add and lookup": append a blank trip then immediately open the picker for it
  const addAndLookup = () => {
    const items = [...form.items, { user: "", driver: "", destination: "", rentDate: todayISO(), rentReturnDate: todayISO(), unit: "", plate: "", lembur: 0, inap: 0, price: 0 }];
    setForm({ ...form, items });
    if (openTripLookup) openTripLookup(items.length - 1);
  };
  const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="No. Invoice" value={form.invoiceNo} onChange={(v) => upd({ invoiceNo: v })} />
        <Field label="Tanggal" type="date" value={form.date} onChange={(v) => upd({ date: v })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">No. Surat <span className="font-normal text-slate-400">(opsional)</span></label>
        <div className="flex gap-2">
          <input
            value={form.letterNo ?? ""}
            onChange={(e) => upd({ letterNo: e.target.value })}
            placeholder="No.26/DSR/070 — kosongkan jika tidak perlu"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
          />
          <button
            type="button"
            onClick={reserveLetterNo}
            disabled={reservingLetter}
            className="px-3 py-2 rounded-lg bg-white border border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            {reservingLetter ? "..." : "Ambil Nomor"}
          </button>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-slate-600">Nama / Perusahaan</label>
          {openCompanyPicker && (
            <button
              type="button"
              onClick={openCompanyPicker}
              className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline cursor-pointer"
              title="Pilih dari perusahaan terdaftar (alamat akan terisi otomatis)"
            >
              <span className="material-symbols-outlined text-[14px]">domain</span>
              Pilih Perusahaan
            </button>
          )}
        </div>
        <input
          type="text"
          value={form.clientName ?? ""}
          onChange={(e) => upd({ clientName: e.target.value })}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
        />
      </div>
      <TextArea label="Alamat" value={form.clientAddress} onChange={(v) => upd({ clientAddress: v })} rows={2} />
      <div className="border-t border-slate-100 pt-3 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-bold text-slate-700 uppercase">Daftar Trip / Item</p>
          <div className="flex items-center gap-2">
            {openTripLookup && (
              <button onClick={addAndLookup} type="button" className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline cursor-pointer" title="Tambah trip dan langsung pilih dari Rekap Order">
                <span className="material-symbols-outlined text-[14px]">search</span>
                + Tambah dari Order
              </button>
            )}
            <button onClick={addItem} type="button" className="text-xs text-primary font-medium hover:underline cursor-pointer">+ Tambah Trip</button>
          </div>
        </div>
        {form.items.map((it, i) => (
          <div key={i} className="bg-slate-50 rounded-lg p-3 space-y-2 border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Trip #{i + 1}</span>
              <div className="flex items-center gap-2">
                {openTripLookup && (
                  <button
                    onClick={() => openTripLookup(i)}
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline cursor-pointer"
                    title="Isi dari Kode Transaksi yang ada di Rekap Order"
                  >
                    <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                    Isi dari Order
                  </button>
                )}
                {form.items.length > 1 && (
                  <button onClick={() => removeItem(i)} type="button" className="text-xs text-red-500 hover:underline cursor-pointer">Hapus</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="User" value={it.user} onChange={(v) => updItem(i, { user: v })} />
              <Field label="Driver" value={it.driver} onChange={(v) => updItem(i, { driver: v })} />
              <Field label="Tujuan" value={it.destination} onChange={(v) => updItem(i, { destination: v })} />
              <Field label="Tgl Mulai" type="date" value={it.rentDate} onChange={(v) => updItem(i, { rentDate: v })} />
              <Field label="Tgl Selesai" type="date" value={it.rentReturnDate || it.rentDate} onChange={(v) => updItem(i, { rentReturnDate: v })} />
              <Field label="Unit (Mobil)" value={it.unit} onChange={(v) => updItem(i, { unit: v })} />
              <Field label="Plat" value={it.plate} onChange={(v) => updItem(i, { plate: v })} />
              <Field label="Lembur" type="number" value={it.lembur} onChange={(v) => updItem(i, { lembur: v })} />
              <Field label="Inap" type="number" value={it.inap} onChange={(v) => updItem(i, { inap: v })} />
              <div className="col-span-2">
                <Field label="Harga (Rp)" type="number" value={it.price} onChange={(v) => updItem(i, { price: v })} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.autoDisc} onChange={(e) => upd({ autoDisc: e.target.checked })} className="accent-primary" />
          <span className="text-slate-700">Diskon otomatis 5% bila ≥4 hari sewa</span>
        </label>
        {!form.autoDisc && (
          <div className="mt-2"><Field label="Diskon manual (Rp)" type="number" value={form.discount} onChange={(v) => upd({ discount: v })} /></div>
        )}
        {/* Pajak — only one at a time. Clicking the same one again unchecks it. */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Number(form.pajakRate) === 2.5}
            onChange={(e) => upd({ pajakRate: e.target.checked ? 2.5 : 0 })}
            className="accent-primary"
          />
          <span className="text-slate-700">Pajak 2.5%</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Number(form.pajakRate) === 2}
            onChange={(e) => upd({ pajakRate: e.target.checked ? 2 : 0 })}
            className="accent-primary"
          />
          <span className="text-slate-700">Pajak 2%</span>
        </label>
      </div>
    </>
  );
}

function SuratJalanForm({ form, setForm, openTripLookup }) {
  const upd = (patch) => setForm({ ...form, ...patch });
  const updItem = (i, patch) => {
    const items = form.items.slice();
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  };
  const addItem = () => setForm({ ...form, items: [...form.items, { user: "", date: todayISO(), destination: "", days: 1, startTime: "", endTime: "" }] });
  const addAndLookup = () => {
    const items = [...form.items, { user: "", date: todayISO(), destination: "", days: 1, startTime: "", endTime: "" }];
    setForm({ ...form, items });
    if (openTripLookup) openTripLookup(items.length - 1);
  };
  const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="No. Surat" value={form.no} onChange={(v) => upd({ no: v })} />
        <Field label="Tanggal" type="date" value={form.date} onChange={(v) => upd({ date: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nama" value={form.clientName} onChange={(v) => upd({ clientName: v })} />
        <Field label="Perusahaan" value={form.clientCompany} onChange={(v) => upd({ clientCompany: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kendaraan" value={form.vehicle} onChange={(v) => upd({ vehicle: v })} />
        <Field label="No. Polisi" value={form.plate} onChange={(v) => upd({ plate: v })} />
      </div>
      <Field label="Pengemudi (pisahkan dengan koma jika lebih dari satu)" value={form.driver} onChange={(v) => upd({ driver: v })} />
      <div className="border-t border-slate-100 pt-3 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-bold text-slate-700 uppercase">Trip Detail</p>
          <div className="flex items-center gap-2">
            {openTripLookup && (
              <button onClick={addAndLookup} type="button" className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline cursor-pointer" title="Tambah trip dan langsung pilih dari Rekap Order">
                <span className="material-symbols-outlined text-[14px]">search</span>
                + Tambah dari Order
              </button>
            )}
            <button onClick={addItem} type="button" className="text-xs text-primary font-medium hover:underline cursor-pointer">+ Tambah Trip</button>
          </div>
        </div>
        {form.items.map((it, i) => (
          <div key={i} className="bg-slate-50 rounded-lg p-3 space-y-2 border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Trip #{i + 1}</span>
              <div className="flex items-center gap-2">
                {openTripLookup && (
                  <button
                    onClick={() => openTripLookup(i)}
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline cursor-pointer"
                    title="Isi dari Kode Transaksi yang ada di Rekap Order"
                  >
                    <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                    Isi dari Order
                  </button>
                )}
                {form.items.length > 1 && (
                  <button onClick={() => removeItem(i)} type="button" className="text-xs text-red-500 hover:underline cursor-pointer">Hapus</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="User" value={it.user} onChange={(v) => updItem(i, { user: v })} />
              <Field label="Tanggal" type="date" value={it.date} onChange={(v) => updItem(i, { date: v })} />
              <Field label="Tujuan" value={it.destination} onChange={(v) => updItem(i, { destination: v })} />
              <Field label="Jumlah Hari" type="number" value={it.days} onChange={(v) => updItem(i, { days: v })} />
              <Field label="Mulai (jam)" value={it.startTime} onChange={(v) => updItem(i, { startTime: v })} placeholder="08:00" />
              <Field label="Selesai (jam)" value={it.endTime} onChange={(v) => updItem(i, { endTime: v })} placeholder="17:00" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SuratTagihanForm({ form, setForm }) {
  const toast = useToast();
  const [reserving, setReserving] = useState(false);
  const upd = (patch) => setForm({ ...form, ...patch });

  // Reserve the next company-wide letter number from the backend counter.
  async function reserveNumber() {
    setReserving(true);
    try {
      const res = await api.myOrg.nextLetterNumber();
      upd({ letterNo: res.letterNumber });
      toast.success(`Nomor surat ${res.letterNumber} diambil.`);
    } catch (e) {
      toast.error("Gagal mengambil nomor surat: " + e.message);
    } finally {
      setReserving(false);
    }
  }

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">No. Surat</label>
        <div className="flex gap-2">
          <input
            value={form.letterNo ?? ""}
            onChange={(e) => upd({ letterNo: e.target.value })}
            placeholder="No.26/DSR/070"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
          />
          <button
            type="button"
            onClick={reserveNumber}
            disabled={reserving}
            className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            {reserving ? "..." : "Ambil Nomor"}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">Nomor urut surat perusahaan — otomatis &amp; berurutan, berlaku lintas jenis dokumen.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Kepada (Klien)" value={form.to} onChange={(v) => upd({ to: v })} />
        <Field label="Tanggal Surat" type="date" value={form.date} onChange={(v) => upd({ date: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dari" value={form.from} onChange={(v) => upd({ from: v })} />
        <Field label="Tgl Pemakaian (di berita)" type="date" value={form.usageDate} onChange={(v) => upd({ usageDate: v })} />
      </div>
      <Field label="Lampiran" value={form.lampiran} onChange={(v) => upd({ lampiran: v })} />

      <div className="grid grid-cols-3 gap-3">
        <Field label="No. Rekening" value={form.bankAccount} onChange={(v) => upd({ bankAccount: v })} />
        <Field label="Bank" value={form.bankName} onChange={(v) => upd({ bankName: v })} />
        <Field label="a.n." value={form.bankHolder} onChange={(v) => upd({ bankHolder: v })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email Notifikasi" value={form.email} onChange={(v) => upd({ email: v })} />
        <Field label="WA Notifikasi" value={form.wa} onChange={(v) => upd({ wa: v })} />
      </div>
    </>
  );
}

function PenawaranForm({ form, setForm }) {
  const upd = (patch) => setForm({ ...form, ...patch });
  const updItem = (i, patch) => {
    const items = form.items.slice();
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  };
  const addItem = () => setForm({ ...form, items: [...form.items, { unit: "", duration: "1 hari", include: "Driver, BBM, Tol, Parkir", price: 0 }] });
  const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="No. Surat" value={form.no} onChange={(v) => upd({ no: v })} />
        <Field label="Tanggal" type="date" value={form.date} onChange={(v) => upd({ date: v })} />
      </div>
      <Field label="Kepada Yth." value={form.to} onChange={(v) => upd({ to: v })} placeholder="Nama Perusahaan / Klien" />
      <Field label="Up." value={form.attn} onChange={(v) => upd({ attn: v })} placeholder="Bagian / Kontak" />
      <Field label="Perihal" value={form.subject} onChange={(v) => upd({ subject: v })} />
      <TextArea label="Pembuka" value={form.intro} onChange={(v) => upd({ intro: v })} rows={3} />
      <div className="border-t border-slate-100 pt-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700 uppercase">Item Penawaran</p>
          <button onClick={addItem} type="button" className="text-xs text-primary font-medium hover:underline cursor-pointer">+ Tambah Item</button>
        </div>
        {form.items.map((it, i) => (
          <div key={i} className="bg-slate-50 rounded-lg p-3 space-y-2 border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Item #{i + 1}</span>
              {form.items.length > 1 && (
                <button onClick={() => removeItem(i)} type="button" className="text-xs text-red-500 hover:underline cursor-pointer">Hapus</button>
              )}
            </div>
            <Field label="Unit / Mobil" value={it.unit} onChange={(v) => updItem(i, { unit: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Durasi" value={it.duration} onChange={(v) => updItem(i, { duration: v })} />
              <Field label="Harga (Rp)" type="number" value={it.price} onChange={(v) => updItem(i, { price: v })} />
            </div>
            <Field label="Include" value={it.include} onChange={(v) => updItem(i, { include: v })} />
          </div>
        ))}
      </div>
      <TextArea label="Penutup" value={form.closing} onChange={(v) => upd({ closing: v })} rows={3} />
    </>
  );
}

function PerjanjianForm({ form, setForm }) {
  const upd = (patch) => setForm({ ...form, ...patch });
  const updPartyB = (patch) => setForm({ ...form, partyB: { ...form.partyB, ...patch } });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="No. Perjanjian" value={form.no} onChange={(v) => upd({ no: v })} />
        <Field label="Tanggal" type="date" value={form.date} onChange={(v) => upd({ date: v })} />
      </div>
      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs font-bold text-slate-700 uppercase mb-2">Pihak Penyewa</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nama Lengkap" value={form.partyB.name} onChange={(v) => updPartyB({ name: v })} />
          <Field label="No. KTP / Identitas" value={form.partyB.idNumber} onChange={(v) => updPartyB({ idNumber: v })} />
          <Field label="Pekerjaan" value={form.partyB.role} onChange={(v) => updPartyB({ role: v })} />
          <Field label="Perusahaan" value={form.partyB.company} onChange={(v) => updPartyB({ company: v })} />
        </div>
        <div className="mt-2"><TextArea label="Alamat Penyewa" value={form.partyB.address} onChange={(v) => updPartyB({ address: v })} rows={2} /></div>
      </div>
      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs font-bold text-slate-700 uppercase mb-2">Detail Kendaraan</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kendaraan" value={form.vehicle} onChange={(v) => upd({ vehicle: v })} />
          <Field label="No. Polisi" value={form.plate} onChange={(v) => upd({ plate: v })} />
          <Field label="Warna" value={form.color} onChange={(v) => upd({ color: v })} />
          <Field label="Tahun" value={form.year} onChange={(v) => upd({ year: v })} />
        </div>
      </div>
      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs font-bold text-slate-700 uppercase mb-2">Periode & Biaya</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mulai Sewa" type="date" value={form.startDate} onChange={(v) => upd({ startDate: v })} />
          <Field label="Selesai Sewa" type="date" value={form.endDate} onChange={(v) => upd({ endDate: v })} />
          <Field label="Tarif Harian (Rp)" type="number" value={form.dailyRate} onChange={(v) => upd({ dailyRate: v })} />
          <Field label="Total Hari" type="number" value={form.totalDays} onChange={(v) => upd({ totalDays: v })} />
          <div className="col-span-2"><Field label="Jaminan / Deposit (Rp)" type="number" value={form.deposit} onChange={(v) => upd({ deposit: v })} /></div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Document templates — these render the WYSIWYG preview AND the print output
// ═══════════════════════════════════════════════════════════════════════════════

function CompanyHeader({ compact = false }) {
  // Logo file is 515×191 → 2.696:1. Sizing the box to match exactly so it
  // fills the slot edge-to-edge instead of getting letterboxed.
  const logoH = compact ? "15mm" : "17mm";
  const logoW = compact ? "40.5mm" : "45.8mm"; // height × 2.696
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5mm" }}>
      <img
        src={COMPANY.logoUrl}
        alt="DSR"
        style={{ width: logoW, height: logoH, objectFit: "contain", display: "block" }}
      />
      <div>
        <div style={{ fontSize: compact ? "13pt" : "14pt", fontWeight: "bold", lineHeight: 1.15 }}>{COMPANY.name}</div>
        <div style={{ fontSize: "9pt", lineHeight: 1.4 }}>{COMPANY.addr}</div>
        <div style={{ fontSize: "9pt", lineHeight: 1.4 }}>{COMPANY.phone2}</div>
      </div>
    </div>
  );
}

function InvoiceTemplate({ form }) {
  const itemsTotal = form.items.reduce((s, it) =>
    s + Number(it.price || 0) + Number(it.lembur || 0) * 50_000 + Number(it.inap || 0) * 150_000, 0);
  // Pajak (2.5% or 2%, mutually exclusive) is folded INTO the displayed Sub Total
  // so the preview keeps the same three-row layout (Sub Total / Disc / TOTAL).
  const pajakAmount = itemsTotal * (Number(form.pajakRate || 0) / 100);
  const subTotal = itemsTotal + pajakAmount;
  // Auto-discount keys off the rental LENGTH (days), not the number of cars.
  // Derive the longest rental span across line items from their date ranges
  // so a multi-car booking (N items, same trip dates) doesn't falsely trip
  // the 4-day threshold via item count. Falls back to 1 day when unparseable.
  const rentalDays = Math.max(1, ...form.items.map(it => {
    const d1 = new Date(it.rentDate);
    const d2 = new Date(it.rentReturnDate);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    return Math.floor((d2 - d1) / 86_400_000) + 1;
  }));
  const auto = form.autoDisc && rentalDays >= 4;
  const disc = auto ? subTotal * 0.05 : Number(form.discount || 0);
  const grand = subTotal - disc;
  const dateStr = fmtDateID(form.date);
  // Signature date always reflects the day the invoice is being signed/printed,
  // not the invoice's transaction date.
  const signatureDateStr = fmtDateID(new Date());

  return (
    <div className="doc-page doc-page-a4" style={{ display: "flex", flexDirection: "column", height: "297mm", boxSizing: "border-box" }}>

      {/* ── TOP HALF — Invoice ────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <CompanyHeader />

        {/* Optional company letter number (top-left), only when reserved. */}
        {form.letterNo && <div style={{ fontSize: "7.5pt", marginTop: "2mm" }}>{form.letterNo}</div>}

        <div style={{ textAlign: "center", marginTop: "4mm" }}>
          <div style={{ fontSize: "18pt", fontWeight: "bold" }}>INVOICE</div>
          <div style={{ fontSize: "7pt", marginTop: "1mm" }}>{form.invoiceNo}</div>
        </div>

        <div style={{ marginTop: "4mm", fontSize: "8pt" }}>
          <div style={{ display: "flex", marginBottom: "1.5mm" }}>
            <div style={{ width: "22mm", fontWeight: "bold" }}>Nama</div>
            <div style={{ width: "4mm" }}>:</div>
            <div style={{ flex: 1 }}>{form.clientName || "-"}</div>
          </div>
          <div style={{ display: "flex" }}>
            <div style={{ width: "22mm", fontWeight: "bold" }}>Alamat</div>
            <div style={{ width: "4mm" }}>:</div>
            <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{form.clientAddress || "-"}</div>
          </div>
        </div>

        <table className="doc-table no-fill" style={{ marginTop: "4mm", textAlign: "center", fontSize: "7.5pt" }}>
          <thead>
            <tr>
              <th style={{ width: "7mm" }}>No.</th>
              <th>Nama User</th>
              <th>Nama Driver</th>
              <th>Tujuan</th>
              <th>Tgl Pemakaian</th>
              <th>Unit</th>
              <th style={{ width: "20mm" }}>Lembur</th>
              <th style={{ width: "20mm" }}>Inap</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {form.items.map((it, i) => {
              const lemburJam = Number(it.lembur) || 0;
              const inapHari = Number(it.inap) || 0;
              const lemburRp = lemburJam * 50_000;
              const inapRp = inapHari * 150_000;
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{it.user || "-"}</td>
                  <td>{it.driver || "-"}</td>
                  <td>{it.destination || "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDateRange(it.rentDate, it.rentReturnDate) || "-"}</td>
                  <td>{it.unit ? <>{it.unit}<br />{it.plate}</> : "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {lemburJam > 0 ? <>{lemburJam} Jam<br />{rp(lemburRp)}</> : "-"}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {inapHari > 0 ? <>{inapHari} Hari<br />{rp(inapRp)}</> : "-"}
                  </td>
                  <td style={{ textAlign: "right" }}>{rp((Number(it.price || 0) + lemburRp + inapRp) * (1 + Number(form.pajakRate || 0) / 100))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: "4mm", fontSize: "8pt", textAlign: "right" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10mm", marginBottom: "1mm" }}>
            <span>Sub Total (IDR)</span><span style={{ minWidth: "30mm", textAlign: "right" }}>{rp(subTotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10mm", marginBottom: "1mm" }}>
            <span>Disc</span><span style={{ minWidth: "30mm", textAlign: "right" }}>{disc > 0 ? rp(disc) : "Rp0"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10mm", fontWeight: "bold" }}>
            <span>TOTAL (IDR)</span><span style={{ minWidth: "30mm", textAlign: "right" }}>{rp(grand)}</span>
          </div>
        </div>

        {/* Signature */}
        <div style={{ marginTop: "4mm", fontSize: "8pt", textAlign: "right" }}>
          <div>Bandung, {signatureDateStr}</div>
          <div>{COMPANY.brand}</div>
          <div style={{ height: "14mm" }} />
          <div style={{ borderTop: "0.5pt solid #000", display: "inline-block", paddingTop: "1mm", minWidth: "40mm" }}>( {COMPANY.signatory} )</div>
        </div>
      </div>

      {/* ── Dashed divider — exact A4 midpoint ───────────────── */}
      <div style={{ borderTop: "0.8pt dashed #555", flexShrink: 0 }} />

      {/* ── BOTTOM HALF — Kuitansi ───────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, paddingTop: "5mm" }}>
        <CompanyHeader compact />
        <div style={{ marginTop: "3mm", fontSize: "7pt" }}>No. {form.invoiceNo}</div>

        <div style={{ marginTop: "4mm", fontSize: "9.5pt" }}>
          <div style={{ display: "flex", marginBottom: "3mm" }}>
            <div style={{ width: "38mm", fontWeight: "bold" }}>Sudah Terima Dari</div>
            <div style={{ width: "5mm" }}>:</div>
            <div style={{ flex: 1, fontWeight: "bold" }}>{form.clientName || "-"}</div>
          </div>
          <div style={{ display: "flex", marginBottom: "3mm" }}>
            <div style={{ width: "38mm", fontWeight: "bold" }}>Terbilang</div>
            <div style={{ width: "5mm" }}>:</div>
            <div style={{ flex: 1 }}>
              <span className="terbilang-bg" style={{ fontStyle: "italic", display: "inline-block", width: "100%" }}>{terbilang(grand)}</span>
            </div>
          </div>
          <div style={{ display: "flex", marginBottom: "4mm" }}>
            <div style={{ width: "38mm", fontWeight: "bold" }}>Untuk Pembayaran</div>
            <div style={{ width: "5mm" }}>:</div>
            <div style={{ flex: 1 }}>
              {form.items.length > 0 ? (
                `Sewa Kendaraan roda 4 include driver, tol, parkir, BBM dengan unit ${form.items.map(it => `${it.unit} ${it.plate}`).join(", ")} tanggal ${fmtDateRange(form.items[0].rentDate, form.items[0].rentReturnDate)} tujuan ${form.items[0].destination}`
              ) : "Sewa Kendaraan Roda 4"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: "5mm", display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: "9.5pt" }}>
          <div>
            <div style={{ fontWeight: "bold", display: "flex", gap: "5mm" }}>
              <span>Nominal :</span>
              <span style={{ fontStyle: "italic", fontWeight: "bold", borderBottom: "0.8pt solid #000" }}>{rp(grand)},00</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>Bandung, {signatureDateStr}</div>
            <div>{COMPANY.brand}</div>
            <div style={{ height: "16mm" }} />
            <div style={{ borderTop: "0.5pt solid #000", display: "inline-block", paddingTop: "1mm", minWidth: "40mm" }}>( {COMPANY.signatory} )</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuratJalanTemplate({ form }) {
  const drivers = (form.driver || "").split(",").map(s => s.trim()).filter(Boolean);
  return (
    <div className="doc-page doc-page-a4-land">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <CompanyHeader />
        <div style={{ fontSize: "20pt", fontWeight: "bold", textAlign: "center", flex: 1 }}>Bukti Pemakaian Mobil</div>
        <div style={{ fontSize: "9pt", textAlign: "right" }}>
          <div>No. {form.no}</div>
          <div>Tanggal: {fmtDateID(form.date)}</div>
        </div>
      </div>

      <table className="doc-table" style={{ marginTop: "8mm", textAlign: "center" }}>
        <thead>
          <tr>
            <th rowSpan={2}>Nama</th>
            <th rowSpan={2}>Perusahaan</th>
            <th rowSpan={2}>Tanggal</th>
            <th colSpan={2}>Waktu Pemakaian</th>
            <th rowSpan={2}>Jml Hari / Jam</th>
            <th rowSpan={2}>Keterangan / Tujuan</th>
          </tr>
          <tr>
            <th>Mulai</th>
            <th>Selesai</th>
          </tr>
        </thead>
        <tbody>
          {form.items.map((it, i) => (
            <tr key={i}>
              <td>{it.user || "-"}</td>
              <td>{form.clientCompany || "-"}</td>
              <td>{fmtDateID(it.date)}</td>
              <td>{it.startTime || "-"}</td>
              <td>{it.endTime || "-"}</td>
              <td>{it.days} Hari</td>
              <td style={{ textTransform: "uppercase" }}>{it.destination || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "8mm", fontSize: "10pt" }}>
        {[
          { lbl: "Kendaraan", val: form.vehicle ? `T. ${form.vehicle.toUpperCase()}` : "-" },
          { lbl: "No. Pol", val: form.plate || "-" },
          { lbl: "Pengemudi", val: drivers.length ? drivers.join(" + ") : "-" },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", marginBottom: "2mm" }}>
            <div style={{ width: "28mm", fontWeight: "bold" }}>{row.lbl}</div>
            <div style={{ width: "4mm" }}>:</div>
            <div style={{ flex: 1 }}>{row.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-around", marginTop: "16mm", gap: "10mm" }}>
        {["DSR Renta", "Driver", "User"].map((label) => (
          <div key={label} style={{ width: "55mm", height: "28mm", border: "0.5pt solid #000", padding: "3mm", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "9pt", fontWeight: "bold" }}>{label}</div>
            <div style={{ borderTop: "0.3pt solid #000", width: "75%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SuratTagihanTemplate({ form }) {
  // Berita body — mirrors the standard billing-transmittal wording, with the
  // usage date and payment details interpolated from the form.
  const berita = `Bersama ini Kami sampaikan rekap tagihan atas pemakaian pada tanggal ${fmtDateID(form.usageDate)}. ` +
    `Pembayaran atas tagihan tersebut hendaknya ditransfer ke rek. ${form.bankAccount || "-"} an. ${form.bankHolder || "-"} ` +
    `pada Bank ${form.bankName || "-"} dan harap memberikan Notifikasi pembayaran pada email ${form.email || "-"} ` +
    `atau WA di ${form.wa || "-"}`;

  const metaRow = (label, value) => (
    <div style={{ display: "flex", marginBottom: "1mm" }}>
      <div style={{ width: "20mm", fontWeight: "bold" }}>{label}</div>
      <div style={{ width: "3mm" }}>:</div>
      <div style={{ flex: 1 }}>{value || "-"}</div>
    </div>
  );

  return (
    <div className="doc-page doc-page-quarter" style={{ fontSize: "8.5pt", lineHeight: 1.4 }}>
      {/* Header — same company header as the other documents */}
      <CompanyHeader compact />

      {/* Company letter number (top-left, distinct from any invoice number) */}
      <div style={{ fontSize: "7.5pt", marginTop: "2.5mm" }}>{form.letterNo || "No. ........./DSR/........."}</div>

      {/* Title */}
      <div style={{ textAlign: "center", fontSize: "12pt", fontWeight: "bold", textDecoration: "underline", margin: "1.5mm 0 3mm" }}>
        SURAT PENGANTAR TAGIHAN
      </div>

      {/* Meta block */}
      {metaRow("Kepada", form.to)}
      {metaRow("Dari", form.from)}
      {metaRow("Lampiran", form.lampiran)}

      {/* Berita */}
      <div style={{ display: "flex", marginTop: "1mm" }}>
        <div style={{ width: "20mm", fontWeight: "bold" }}>Berita</div>
        <div style={{ width: "3mm" }}>:</div>
        <div style={{ flex: 1 }} />
      </div>
      <div style={{ textAlign: "justify", marginTop: "1mm", marginLeft: "23mm", lineHeight: 1.5 }}>{berita}</div>

      {/* Signatures */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "7mm" }}>
        <div>
          <div>Yang Menerima</div>
          <div>{form.to || "-"}</div>
          <div style={{ height: "11mm" }} />
          <div>(..............................)</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>Bandung, {fmtDateID(form.date)}</div>
          <div>{COMPANY.brand}</div>
          <div style={{ height: "11mm" }} />
          <div>( {COMPANY.signatory} )</div>
        </div>
      </div>
    </div>
  );
}

function PenawaranTemplate({ form }) {
  const total = form.items.reduce((s, it) => s + Number(it.price || 0), 0);
  return (
    <div className="doc-page doc-page-a4">
      <CompanyHeader />

      <div style={{ marginTop: "8mm", fontSize: "10pt" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <div>No. {form.no}</div>
            <div>Hal: {form.subject}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>Bandung, {fmtDateID(form.date)}</div>
          </div>
        </div>

        <div style={{ marginTop: "8mm" }}>
          <div>Kepada Yth.</div>
          <div style={{ fontWeight: "bold" }}>{form.to || "-"}</div>
          {form.attn && <div>Up. {form.attn}</div>}
        </div>

        <div style={{ marginTop: "5mm" }}>Dengan hormat,</div>
        <p style={{ marginTop: "3mm", textAlign: "justify" }}>{form.intro}</p>

        <table className="doc-table" style={{ marginTop: "5mm" }}>
          <thead>
            <tr>
              <th style={{ width: "10mm" }}>No.</th>
              <th>Unit / Mobil</th>
              <th style={{ width: "30mm" }}>Durasi</th>
              <th>Include</th>
              <th style={{ width: "35mm" }}>Harga</th>
            </tr>
          </thead>
          <tbody>
            {form.items.map((it, i) => (
              <tr key={i}>
                <td style={{ textAlign: "center" }}>{i + 1}</td>
                <td>{it.unit || "-"}</td>
                <td>{it.duration || "-"}</td>
                <td>{it.include || "-"}</td>
                <td style={{ textAlign: "right" }}>{rp(it.price)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} style={{ fontWeight: "bold", textAlign: "right" }}>TOTAL</td>
              <td style={{ fontWeight: "bold", textAlign: "right" }}>{rp(total)}</td>
            </tr>
          </tbody>
        </table>

        <p style={{ marginTop: "8mm", textAlign: "justify" }}>{form.closing}</p>

        <div style={{ marginTop: "10mm", textAlign: "right" }}>
          <div>Hormat kami,</div>
          <div style={{ fontWeight: "bold" }}>{COMPANY.brand}</div>
          <div style={{ height: "18mm" }} />
          <div style={{ borderTop: "0.5pt solid #000", display: "inline-block", paddingTop: "1mm", minWidth: "40mm" }}>( {COMPANY.signatory} )</div>
        </div>
      </div>
    </div>
  );
}

function PerjanjianTemplate({ form }) {
  const total = Number(form.dailyRate || 0) * Number(form.totalDays || 0);
  return (
    <div className="doc-page doc-page-a4">
      <CompanyHeader />

      <div style={{ marginTop: "8mm", textAlign: "center" }}>
        <div style={{ fontSize: "14pt", fontWeight: "bold", textDecoration: "underline" }}>SURAT PERJANJIAN SEWA KENDARAAN</div>
        <div style={{ fontSize: "9pt", marginTop: "1mm" }}>No. {form.no}</div>
      </div>

      <div style={{ marginTop: "6mm", fontSize: "10pt", textAlign: "justify", lineHeight: 1.6 }}>
        <p>
          Pada hari ini, <b>{fmtDateID(form.date)}</b>, telah dibuat dan disepakati Surat Perjanjian Sewa Kendaraan
          (selanjutnya disebut "Perjanjian") oleh dan antara:
        </p>

        <div style={{ marginTop: "3mm" }}>
          <p><b>I. PIHAK PERTAMA</b></p>
          <div style={{ paddingLeft: "5mm" }}>
            <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Nama</div>: {form.partyA.name}</div>
            <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Jabatan</div>: {form.partyA.role}</div>
            <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Alamat</div>: {form.partyA.address}</div>
          </div>
          <p style={{ marginTop: "1mm" }}>Selanjutnya disebut sebagai <b>PIHAK PERTAMA / PEMILIK KENDARAAN</b>.</p>
        </div>

        <div style={{ marginTop: "3mm" }}>
          <p><b>II. PIHAK KEDUA</b></p>
          <div style={{ paddingLeft: "5mm" }}>
            <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Nama</div>: {form.partyB.name || "-"}</div>
            <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>No. Identitas</div>: {form.partyB.idNumber || "-"}</div>
            <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Pekerjaan</div>: {form.partyB.role || "-"}</div>
            {form.partyB.company && <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Perusahaan</div>: {form.partyB.company}</div>}
            <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Alamat</div>: {form.partyB.address || "-"}</div>
          </div>
          <p style={{ marginTop: "1mm" }}>Selanjutnya disebut sebagai <b>PIHAK KEDUA / PENYEWA</b>.</p>
        </div>

        <p style={{ marginTop: "3mm" }}>
          Kedua belah pihak sepakat untuk mengadakan perjanjian sewa-menyewa kendaraan dengan ketentuan dan syarat sebagai berikut:
        </p>

        <p style={{ marginTop: "3mm" }}><b>Pasal 1 — Objek Sewa</b></p>
        <div style={{ paddingLeft: "5mm" }}>
          <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Kendaraan</div>: {form.vehicle || "-"}</div>
          <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>No. Polisi</div>: {form.plate || "-"}</div>
          <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Warna</div>: {form.color || "-"}</div>
          <div style={{ display: "flex" }}><div style={{ width: "30mm" }}>Tahun</div>: {form.year || "-"}</div>
        </div>

        <p style={{ marginTop: "3mm" }}><b>Pasal 2 — Jangka Waktu Sewa</b></p>
        <p style={{ paddingLeft: "5mm" }}>
          Sewa berlaku terhitung sejak <b>{fmtDateID(form.startDate)}</b> sampai dengan <b>{fmtDateID(form.endDate)}</b>,
          dengan total durasi <b>{form.totalDays} hari</b>.
        </p>

        <p style={{ marginTop: "3mm" }}><b>Pasal 3 — Biaya Sewa &amp; Jaminan</b></p>
        <div style={{ paddingLeft: "5mm" }}>
          <div>Tarif harian: <b>{rp(form.dailyRate)}</b></div>
          <div>Total biaya sewa: <b>{rp(total)}</b></div>
          <div>Jaminan / deposit: <b>{rp(form.deposit)}</b></div>
        </div>

        <p style={{ marginTop: "3mm" }}><b>Pasal 4 — Kewajiban Penyewa</b></p>
        <ol style={{ paddingLeft: "10mm", marginTop: "1mm" }}>
          <li>Menggunakan kendaraan dengan baik dan bertanggung jawab.</li>
          <li>Mengembalikan kendaraan pada waktu yang telah disepakati.</li>
          <li>Menanggung seluruh biaya BBM, tol, dan parkir selama masa sewa.</li>
          <li>Bertanggung jawab penuh atas segala pelanggaran lalu lintas.</li>
        </ol>

        <p style={{ marginTop: "3mm" }}><b>Pasal 5 — Penutup</b></p>
        <p style={{ paddingLeft: "5mm" }}>
          Perjanjian ini dibuat dalam rangkap dua bermaterai cukup, masing-masing memiliki kekuatan hukum yang sama
          dan ditandatangani oleh kedua belah pihak dalam keadaan sadar tanpa adanya tekanan dari pihak manapun.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-around", marginTop: "10mm", fontSize: "10pt" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: "bold" }}>PIHAK PERTAMA</div>
          <div style={{ height: "22mm" }} />
          <div style={{ borderTop: "0.5pt solid #000", paddingTop: "1mm", minWidth: "55mm" }}>( {form.partyA.name} )</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: "bold" }}>PIHAK KEDUA</div>
          <div style={{ height: "22mm" }} />
          <div style={{ borderTop: "0.5pt solid #000", paddingTop: "1mm", minWidth: "55mm" }}>( {form.partyB.name} )</div>
        </div>
      </div>
    </div>
  );
}
