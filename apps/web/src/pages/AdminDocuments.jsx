import { useState, useEffect, useMemo, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { loadPdfZip, fileSafe, downloadBlob } from "../lib/pdfZip";
import { buildInvoicePdf, imageDataUrl } from "../lib/invoicePdf";
import { useToast } from "../components/Toast";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api, apiCache, swr } from "../lib/api";
import { OpsDocForm, OpsDocTemplate } from "../components/docs/OpsDocs";
import { OPS_DOC_TYPES, OPS_LANDSCAPE, opsDefaultForm } from "../lib/opsDocs";

import AsyncButton from "../components/AsyncButton";
import FakturPanel from "../components/docs/FakturPanel";
import TaxProfileEditor from "../components/TaxProfileEditor";
import { computeInvoiceTax, taxProfileOf } from "../lib/tax";
import { dailyRatesOf, LEGACY_DAILY_RATES } from "../lib/ops";
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

// ─── Document numbering — reads the prefixes configured in
// Pengaturan → Penomoran Dokumen (localStorage "dsr:settings:numbering") so
// invoice numbers follow the user's setting, e.g. "26/DSR/INV/C086". Read
// fresh each call so changes in Settings take effect without a reload.
function loadNumbering() {
  try { return JSON.parse(localStorage.getItem("dsr:settings:numbering")) || {}; }
  catch { return {}; }
}
function invoiceNoFor(orderNumber) {
  const n = loadNumbering();
  return `${n.yearPrefix || "26"}/${n.invoicePrefix || "DSR/INV/"}${orderNumber || ""}`;
}

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
  // WIB calendar date (UTC slice gave yesterday between 00:00 and 07:00 WIB).
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
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
  // Owner 2026-11-12: invoice, kuitansi and surat pengantar come from the same
  // kode transaksi → one document set (page 1 invoice + kuitansi, page 2 surat).
  { id: "invoice", label: "Invoice + Kuitansi + Surat Pengantar", icon: "receipt_long", desc: "Hal. 1 invoice & kuitansi · Hal. 2 surat pengantar tagihan" },
  { id: "surat_jalan", label: "Surat Jalan", icon: "local_shipping", desc: "A4 landscape — bukti pemakaian mobil" },
  { id: "penawaran", label: "Surat Penawaran", icon: "request_quote", desc: "Penawaran sewa kendaraan untuk proyek" },
  { id: "perjanjian", label: "Surat Perjanjian Sewa", icon: "gavel", desc: "Kontrak legal sewa kendaraan" },
  // Kontrak bulanan: lembur & SPPD forms + rekap (invoice enclosures) — components/docs/OpsDocs.jsx
  ...OPS_DOC_TYPES,
  { id: "faktur", label: "Faktur Pajak", icon: "account_balance", desc: "Gabungkan invoice satu pembeli & masa → 1 faktur" },
];
const isOpsDoc = (t) => OPS_DOC_TYPES.some((d) => d.id === t);

// ─── Default form values per doc type ────────────────────────────────────────
function defaultForm(type) {
  const today = todayISO();
  switch (type) {
    case "invoice":
      return {
        invoiceNo: "26/DSR/INV/", letterNo: "", clientName: "", clientAddress: "",
        date: today, discount: 0, autoDisc: true, clientOrgId: null, tax: null, taxSource: null,
        withLetter: true, lampiran: "Rekap Tagihan Sewa Kendaraan",
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
        usageDate: today,                              // tgl mulai pemakaian (for the berita)
        usageEndDate: today,                           // tgl selesai pemakaian (for the berita)
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
      return isOpsDoc(type) ? opsDefaultForm() : {};
  }
}

export default function AdminDocuments() {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  // Cancelling an invoice: agency admin only (owner 2026-11-13).
  const isAgencyAdmin = user?.role === "superadmin" || (user?.accountType === "agency" && (user?.role === "admin" || user?.templateKey === "sys:agency_admin"));
  const [docType, setDocType] = useState("invoice");
  const [form, setForm] = useState(() => defaultForm("invoice"));
  // Lembur / inap rates for daily orders = agency default (Pengaturan → Lembur &
  // Perjalanan Dinas); the old fixed 50.000 / 150.000 only until it is set.
  const [dailyRates, setDailyRates] = useState({ ...LEGACY_DAILY_RATES, configured: false });
  useEffect(() => {
    swr("documents:opsDefault", () => api.ops.policyDefault(), (r) => setDailyRates(dailyRatesOf(r?.configured ? r.policy : null))).catch(() => {});
  }, []);
  // Tax profile of the invoice's client (Pengaturan → Pajak invoice) unless the
  // user changed it for this invoice (taxSource 'manual').
  useEffect(() => {
    if (docType !== "invoice" || form.taxSource === "manual") return;
    let alive = true;
    const key = `tax:resolve:${form.clientOrgId || "none"}`;
    swr(key, () => api.invoices.resolveTax(form.clientOrgId), (p) => {
      if (alive) setForm((f) => (f.taxSource === "manual" ? f : { ...f, tax: taxProfileOf(p), taxSource: "settings" }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [docType, form.clientOrgId, form.taxSource]);
  // swr stores the RAW response ({ data, total }) under its key, so a cached
  // value can be an object on the next visit — always unwrap to an array
  // (an object here crashed the page to a blank screen until a full reload).
  const [orders, setOrders] = useState(() => asList(apiCache.get("documents:orders")));
  const [selectedOrderId, setSelectedOrderId] = useState("");
  // Tier 2 multi-vehicle: the ids of EVERY order row covered by the invoice
  // currently in the form (a multi-car booking shares one code across N rows).
  // Used so "Tandai Invoice Selesai" marks the whole booking, not just the
  // single row the user happened to click.
  const [invoiceOrderIds, setInvoiceOrderIds] = useState([]);
  const [showOrderPicker, setShowOrderPicker] = useState(false);
  // Lembur / operasional forms (L### / R###) being invoiced in the current
  // form — set when one is picked from the pending list or Auto-fill.
  const [opsCodes, setOpsCodes] = useState([]);
  // Surat pengantar number per kode transaksi (owner 2026-11-13): the first
  // time a code is opened its number is reserved; later prints reuse it.
  async function ensureLetterNo(code) {
    if (!code) return;
    try {
      const r = await api.myOrg.letterNumberForCode(code);
      setForm((f) => (f.invoiceNo === invoiceNoFor(code) && !f.letterNo ? { ...f, letterNo: r.letterNumber } : f));
    } catch (e) {
      // Usually the migration zz_doc_letter_numbers hasn't run yet (503) — say so.
      toast.error("No. surat pengantar belum bisa dibuat otomatis: " + e.message);
    }
  }
  // Fill the printable invoice from approved L/R form codes.
  function fillFromOpsCodes(prev) {
    setOpsCodes(prev.codes);
    setSelectedOrderId("");
    setInvoiceOrderIds([]);
    setForm((f) => ({
      ...f,
      invoiceNo: invoiceNoFor(prev.codes[0]),
      letterNo: "",
      clientName: prev.clientName || f.clientName || "",
      clientAddress: (companies.find((c) => c.id === prev.clientOrgId)?.address) || f.clientAddress || "",
      clientOrgId: prev.clientOrgId || null,
      ...(f.taxSource === "manual" ? {} : { tax: null, taxSource: null }),
      autoDisc: false, discount: 0,
      items: prev.lines.map((l) => ({
        user: `${l.code} · ${l.description}`, driver: l.driver || "", destination: l.destination || "",
        rentDate: l.entryDate, rentReturnDate: l.returnDate || l.entryDate, unit: l.unit || l.kindLabel, plate: l.plate || "",
        lembur: 0, inap: 0, price: l.amount,
      })),
    }));
    ensureLetterNo(prev.codes[0]);
  }
  const [orderSearch, setOrderSearch] = useState("");

  // ─── Per-trip order lookup state — used by Invoice & Surat Jalan trip rows ──
  // tripLookup.index ≥ 0 → modal open and will fill that trip slot when user picks
  const [tripLookup, setTripLookup] = useState({ open: false, index: -1, search: "" });
  function openTripLookup(index) { setTripLookup({ open: true, index, search: "" }); }
  function closeTripLookup() { setTripLookup({ open: false, index: -1, search: "" }); }

  // ─── Registered-company directory ──────────────────────────────────────
  // Sourced from /api/customers?customerType=company so the registry is the
  // same data the Pelanggan page edits — no duplicate state of truth.
  const [companies, setCompanies] = useState(() => asList(apiCache.get("documents:companies")));
  const [companySugg, setCompanySugg] = useState([]); // per-user booking history names
  // Merged, de-duped company names for document autosuggest (registered orgs +
  // companies the user has booked for).
  const companyNames = useMemo(() => {
    const s = new Set();
    (companies || []).forEach((c) => c?.name && s.add(String(c.name).trim()));
    (companySugg || []).forEach((n) => n && s.add(String(n).trim()));
    return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [companies, companySugg]);
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
  const [orderPending, setPending] = useState(() => asList(apiCache.get("documents:needsInvoice")));
  const [opsPending, setOpsPending] = useState(() => asList(apiCache.get("documents:opsPending")));
  // One queue: daily orders + approved L/R forms shaped like orders (id "ops:L001").
  const pending = useMemo(() => [...orderPending, ...opsPending.map(opsAsOrder)], [orderPending, opsPending]);
  const [pendingSearch, setPendingSearch] = useState("");
  const [showPendingPanel, setShowPendingPanel] = useState(true);

  // Bulk-mark invoice — selected pending orders + modal state
  const [selectedPending, setSelectedPending] = useState(new Set());
  const [showBulkInvoiceModal, setShowBulkInvoiceModal] = useState(false);
  const [bulkInvoiceDate, setBulkInvoiceDate] = useState(todayISO());
  const [bulkInvoicePrefix, setBulkInvoicePrefix] = useState("");
  const [bulkMarking, setBulkMarking] = useState(false);
  // Bulk PDF/ZIP (owner 2026-11-12): tax for the batch, surat pengantar, progress.
  const [bulkTaxMode, setBulkTaxMode] = useState("settings");      // settings | custom
  const [bulkTax, setBulkTax] = useState(null);
  const [bulkWithLetter, setBulkWithLetter] = useState(true);
  const [bulkProgress, setBulkProgress] = useState(null);           // { i, n, code }
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkFilter, setBulkFilter] = useState("all");               // all | pending | invoiced
  const [singleConfirm, setSingleConfirm] = useState(null);          // { code, alreadyInvoiced, paid, overwrite }
  // Already-invoiced codes in Bulk: "reuse" = re-download as stored ·
  // "overwrite" = re-issue with the new tanggal & pajak (owner 2026-11-13).
  const [bulkExisting, setBulkExisting] = useState("reuse");
  const [bulkConfirmOverwrite, setBulkConfirmOverwrite] = useState(false);

  // Load orders + pending-invoice queue + sync status once. SWR keeps it fresh.
  useEffect(() => {
    swr("documents:orders", () => api.orders.list(ORDERS_QUERY), (res) => {
      setOrders(asList(res));
    }).catch(err => console.error("Failed to load orders for documents:", err));

    swr("documents:needsInvoice", () => api.sync.ordersNeedingInvoice(), (rows) => {
      setPending(Array.isArray(rows) ? rows : []);
    }).catch(err => console.error("Failed to load pending invoices:", err));
    // Approved lembur / operasional forms (L / R) waiting for an invoice.
    swr("documents:opsPending", () => api.ops.billingPending(), (rows) => {
      setOpsPending(Array.isArray(rows) ? rows : []);
    }).catch(() => setOpsPending([]));


    // Dedicated company directory for invoice address auto-fill
    swr("documents:companies", () => api.companies.list("limit=5000"), (res) => {
      setCompanies(asList(res));
    }).catch(err => console.error("Failed to load companies:", err));

    // Per-user company history — enriches the document autosuggest lists.
    api.orders.companySuggestions()
      .then((r) => setCompanySugg(r?.data || []))
      .catch(() => { /* non-fatal */ });

    // Hydrate document-numbering prefixes from the org (DB) into localStorage,
    // so invoiceNoFor() uses the company's shared config even on a device that
    // never opened Pengaturan. Falls back silently to whatever is already local.
    api.myOrg.getInfo()
      .then((info) => {
        if (info?.docNumbering && typeof info.docNumbering === "object") {
          try { localStorage.setItem("dsr:settings:numbering", JSON.stringify(info.docNumbering)); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* no org / not permitted — keep local defaults */ });
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
    if (order.opsCode) { fillFromOps(order); return; }
    setOpsCodes([]);
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

  // Deep link from Kontrak & Perusahaan (Form / List Data): ?code=M012 or L001
  // (older ?ops=L001) opens that kode transaksi in the invoice form.
  const [deepCode, setDeepCode] = useState(() => { const q = new URLSearchParams(window.location.search); return q.get("code") || q.get("ops"); });
  useEffect(() => {
    if (!deepCode) return;
    const x = opsPending.find((p) => p.code === deepCode);
    if (x) { setDeepCode(null); setDocType("invoice"); fillFromOps(opsAsOrder(x)); return; }
    const o = orders.find((r) => (r.orderNumber || "").trim() === deepCode);
    if (o) { setDeepCode(null); setDocType("invoice"); applyOrderToForm(o.id); return; }
    if (orders.length && apiCache.has("documents:opsPending")) {
      setDeepCode(null);
      toast.error(`Kode ${deepCode} belum bisa dibuat invoice (belum disetujui kedua pihak, atau tidak ditemukan).`);
    }
  }, [deepCode, opsPending, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshOpsPending() {
    api.ops.billingPending().then((rows) => { const list = Array.isArray(rows) ? rows : []; setOpsPending(list); apiCache.set("documents:opsPending", list); }).catch(() => {});
  }
  // Fill the invoice from a form code. Other ticked forms of the SAME contract
  // join it (one invoice = one contract).
  async function fillFromOps(item) {
    try { fillFromOpsCodes(await api.ops.billingLines(item.opsCode)); }
    catch (e) { toast.error(e.message); }
  }

  // After printing/saving a PDF, the user can mark this order as invoiced
  // so it disappears from the pending queue and the invoice number is recorded.
  async function markCurrentInvoiced(form) {
    if (docType === "invoice" && opsCodes.length) {
      if (!form.invoiceNo) { toast.error("No. Invoice tidak boleh kosong."); return; }
      const calc = invoiceCalc(form, dailyRates);
      try {
        const r = await api.ops.billingIssue({
          codes: opsCodes, invoiceNumber: form.invoiceNo, sentDate: form.date || null, letterNumber: form.letterNo || null,
          discount: calc.discount, ...(form.taxSource === "manual" ? { taxProfile: taxProfileOf(form.tax) } : {}),
        });
        apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); apiCache.invalidate("ops:");
        setOpsCodes([]);
        refreshOpsPending();
        toast.success(`Invoice ${r.invoiceNumber} dibuat untuk ${r.codes.join(", ")} — PDF diunduh.`);
        return true;
      } catch (err) { toast.error("PDF diunduh, tetapi invoice gagal dicatat: " + err.message); return false; }
    }
    if (docType !== "invoice" || !selectedOrderId) return false;
    // Tier 2 multi-vehicle: a multi-car invoice covers every row sharing the
    // booking code. Mark them ALL invoiced so none are left orphaned in the
    // "perlu tagihan" queue. Single-car invoices keep the original 1-row path.
    const targetIds = invoiceOrderIds.length > 0
      ? invoiceOrderIds
      : [Number(selectedOrderId)];
    // The stored invoice must equal the printed one (and the faktur pajak):
    // same discount, same tax profile. Line amounts come from the order rows.
    const calc = invoiceCalc(form, dailyRates);
    const taxPayload = { discount: calc.discount, taxProfile: form.taxSource === "manual" ? taxProfileOf(form.tax) : undefined };
    try {
      if (targetIds.length > 1) {
        await api.sync.bulkMarkInvoiceGenerated({
          ids: targetIds.map(id => ({ id, invoiceNumber: form.invoiceNo })),
          invoiceSentDate: form.date,
          invoiceLetterNumber: form.letterNo || null,
          invoicePaymentStatus: "Pending",
          ...taxPayload,
        });
      } else {
        await api.sync.markInvoiceGenerated(targetIds[0], {
          invoiceNumber: form.invoiceNo,
          invoiceSentDate: form.date,
          invoiceLetterNumber: form.letterNo || null,
          invoicePaymentStatus: "Pending",
          ...taxPayload,
        });
      }
      apiCache.invalidate("documents:");
      apiCache.invalidate("orders:");
      // Refresh the pending list
      refreshOpsPending();
      const fresh = await api.sync.ordersNeedingInvoice();
      setPending(Array.isArray(fresh) ? fresh : []);
      apiCache.set("documents:needsInvoice", fresh);
      const countMsg = targetIds.length > 1 ? ` (${targetIds.length} kendaraan)` : "";
      toast.success(`Invoice ${form.invoiceNo}${countMsg} dibuat & dicatat — PDF diunduh.`);
      return true;
    } catch (err) {
      toast.error("PDF diunduh, tetapi invoice gagal dicatat: " + err.message);
      return false;
    }
  }

  // ─── Every kode transaksi (one entry per code), newest pemakaian first ─────
  // Invoiced codes are re-downloaded with their stored data; others are new.
  const allCodes = useMemo(() => {
    const byCode = new Map();
    const seenIds = new Set();
    for (const o of [...orders, ...orderPending]) {
      if (seenIds.has(o.id) || o.status === "cancelled") continue;
      seenIds.add(o.id);
      const code = (o.orderNumber || "").trim() || `id${o.id}`;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(o);
    }
    const out = [...byCode.entries()].map(([code, rows]) => {
      rows.sort((a, b) => a.id - b.id);
      const inv = rows.find((r) => r.invoiceNumber);
      const first = rows[0];
      return {
        id: `code:${code}`, kind: "order", code, rows,
        orderNumber: code, customer: first.customer, pickupDate: first.pickupDate,
        cars: rows.map((r) => [r.car?.brand, r.car?.name].filter(Boolean).join(" ") + (r.car?.licensePlate ? ` (${r.car.licensePlate})` : "")).filter(Boolean),
        totalPrice: rows.reduce((a, r) => a + Number(r.totalPrice || 0), 0),
        invoiced: !!inv, invoiceNumber: inv?.invoiceNumber || null,
        // M code whose monthly form is not approved by both sides yet → cannot be invoiced.
        formBlocked: !inv && rows.some((r) => r.contractFormStatus && r.contractFormStatus !== "approved"),
      };
    });
    for (const x of opsPending) {
      const o = opsAsOrder(x);
      out.push({ ...o, kind: "ops", code: x.code, cars: [[o.car.brand, o.car.name].filter(Boolean).join(" ") + (o.car.licensePlate ? ` (${o.car.licensePlate})` : "")].filter((v) => v.trim()), invoiced: false });
    }
    return out.sort((a, b) => String(b.pickupDate || "").localeCompare(String(a.pickupDate || "")) || String(b.code).localeCompare(String(a.code)));
  }, [orders, orderPending, opsPending]);

  /** Stored invoice of a code → number, date, surat number, pajak, discount (for re-download). */
  async function storedInvoicePatch(rows) {
    const r0 = rows.find((r) => r.invoiceNumber) || rows[0];
    const inv = r0.invoiceId ? await api.invoices.get(r0.invoiceId).catch(() => null) : null;
    const patch = { invoiceNo: r0.invoiceNumber || inv?.invoiceNumber };
    const sent = r0.invoiceSentDate || inv?.sentDate;
    if (sent) patch.date = isoDay(sent);
    if (r0.invoiceLetterNumber || inv?.letterNumber) patch.letterNo = r0.invoiceLetterNumber || inv.letterNumber;
    if (inv?.taxProfile) { patch.tax = taxProfileOf(inv.taxProfile); patch.taxSource = "manual"; }
    if (inv) { patch.autoDisc = false; patch.discount = Number(inv.discountAmount || 0); }
    Object.defineProperty(patch, "_paid", { value: !!(inv?.paidDate || r0.invoicePaidDate), enumerable: false });
    return patch;
  }

  function refreshOrders() {
    api.orders.list(ORDERS_QUERY).then((res) => { setOrders(asList(res)); apiCache.set("documents:orders", asList(res)); }).catch(() => {});
  }

  // ─── Single Invoice (owner 2026-11-13) ────────────────────────────────────
  // One click for the code on screen: surat number (once per code, reused
  // after), vector PDF download, and the invoice recorded ("tandai selesai").
  // A code that is already invoiced is just re-downloaded (no re-recording).
  // Step 1 — the button opens a confirmation with everything that will be used.
  function runSingleInvoice() {
    if (!form.clientName || !(form.items || []).length) {
      toast.error("Pilih kode transaksi dulu — dari daftar Menunggu Invoice atau tombol \"Pilih Kode Transaksi\" di form.");
      return;
    }
    if (!form.invoiceNo) { toast.error("No. Invoice tidak boleh kosong."); return; }
    const currentOrder = orders.find((o) => String(o.id) === String(selectedOrderId)) || pending.find((o) => String(o.id) === String(selectedOrderId));
    const code = opsCodes[0] || currentOrder?.orderNumber || null;
    const rows = currentOrder ? bookingSiblings(currentOrder) : [];
    if (!currentOrder?.invoiceNumber && rows.some((r) => r.contractFormStatus && r.contractFormStatus !== "approved")) {
      toast.error(`${code}: form bulanan belum disetujui kedua pihak (Kontrak & Perusahaan → Form → Kontrak). Invoice belum bisa dibuat.`);
      return;
    }
    setSingleConfirm({
      code, alreadyInvoiced: !opsCodes.length && !!currentOrder?.invoiceNumber,
      paid: rows.some((r) => r.invoicePaidDate || r.invoicePaymentStatus === "Sebagian"), overwrite: false,
      // Contract codes (M/L/T/O): no overwrite — cancel, correct, issue again.
      contract: isContractCode(code), invoiceId: currentOrder?.invoiceId || null, invoiceNumber: currentOrder?.invoiceNumber || null,
    });
  }

  // Cancel the stored invoice of the current code (agency admin; contract codes).
  async function cancelCurrentInvoice() {
    const { invoiceId, invoiceNumber } = singleConfirm || {};
    if (!invoiceId) { toast.error("Invoice tersimpan tidak ditemukan."); return; }
    const reason = prompt(`Batalkan invoice ${invoiceNumber}? Kode-kodenya kembali "belum invoice", jurnal dibalik dan klien diberi tahu.\n\nAlasan pembatalan:`);
    if (!reason || !reason.trim()) return;
    try {
      const r = await api.invoices.cancel(invoiceId, reason.trim());
      toast.success(`Invoice ${r.invoiceNumber} dibatalkan (${(r.codes || []).join(", ")}). Koreksi datanya lalu buat invoice lagi.`);
      apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); apiCache.invalidate("ops:");
      setSingleConfirm(null);
      refreshOrders();
    } catch (e) { toast.error(e.message); }
  }

  // Step 2 — confirmed: surat number (once per code), PDF, record.
  async function confirmSingleInvoice() {
    const { code } = singleConfirm || {};
    const currentOrder = orders.find((o) => String(o.id) === String(selectedOrderId)) || pending.find((o) => String(o.id) === String(selectedOrderId));
    let f = form;
    if (f.withLetter !== false && !f.letterNo && code) {
      try {
        f = { ...f, letterNo: (await api.myOrg.letterNumberForCode(code)).letterNumber };
        setForm(f);
      } catch (e) { toast.error("No. surat pengantar gagal dibuat: " + e.message); return; }
    }
    if (!(await downloadInvoicePdf(f))) return;
    const alreadyInvoiced = !opsCodes.length && !!currentOrder?.invoiceNumber;
    // New code → record. Invoiced code → only when "timpa" is ticked (same
    // invoice number; tanggal, pajak and diskon from the form replace the stored ones).
    if (code && (!alreadyInvoiced || singleConfirm?.overwrite)) { await markCurrentInvoiced(f); refreshOrders(); }
    else toast.success(alreadyInvoiced ? `PDF ${code} diunduh (invoice tersimpan tidak diubah).` : "PDF diunduh (tanpa kode transaksi — tidak dicatat).");
    setSingleConfirm(null);
  }

  // ─── Bulk invoices → one PDF per kode transaksi, all in a .zip ────────────
  // Same builders as the single invoice (applyOrderToForm / fillFromOpsCodes)
  // so a bulk PDF equals what the preview would show for that code.
  function invoiceFormForRows(rows) {
    const order = rows[0];
    const c = order.customer || {};
    const label = c.companyName || c.name || "";
    const lookup = label ? companies.find((co) => (co.name || "").toLowerCase() === label.toLowerCase()) : null;
    return {
      ...defaultForm("invoice"),
      invoiceNo: invoiceNoFor(order.orderNumber),
      clientName: label,
      clientAddress: (lookup && lookup.address) || c.address || "",
      clientOrgId: lookup?.id || order.organizationId || null,
      // The 5 % ≥4-day discount is for daily rentals only, never contract codes (M/L/T/O/R).
      autoDisc: !isContractCode(order.orderNumber) && (order.totalDays || 1) >= 4,
      // M code: invoice date = the contract month's tanggal tagih.
      ...(order.contractInvoiceDate ? { date: order.contractInvoiceDate } : {}),
      items: rows.map(orderToInvoiceItem),
    };
  }
  function invoiceFormForOps(prev) {
    return {
      ...defaultForm("invoice"),
      invoiceNo: invoiceNoFor(prev.codes[0]),
      clientName: prev.clientName || "",
      clientAddress: (companies.find((c) => c.id === prev.clientOrgId)?.address) || "",
      clientOrgId: prev.clientOrgId || null,
      autoDisc: false,
      items: prev.lines.map((l) => ({
        user: `${l.code} · ${l.description}`, driver: l.driver || "", destination: l.destination || "",
        rentDate: l.entryDate, rentReturnDate: l.returnDate || l.entryDate, unit: l.unit || l.kindLabel, plate: l.plate || "",
        lembur: 0, inap: 0, price: l.amount,
      })),
    };
  }

  async function handleBulkZip() {
    const sel = allCodes.filter((o) => selectedPending.has(o.id));
    if (!sel.length) return;
    if (bulkTaxMode === "custom" && !bulkTax) { toast.error("Atur pajak untuk semua invoice dulu."); return; }
    setBulkMarking(true);
    const done = [];
    try {
      // One invoice per kode transaksi (all its cars); new L/R forms one per contract.
      const groups = sel.filter((x) => x.kind === "order").map((x) => ({ kind: "order", code: x.code, rows: x.rows, invoiced: x.invoiced }));
      const skippedPaid = [];
      const skippedContract = [];   // contract invoices are never overwritten
      const byContract = new Map();
      for (const o of sel.filter((x) => x.kind === "ops")) byContract.set(o.contractId, [...(byContract.get(o.contractId) || []), o.opsCode]);
      for (const codes of byContract.values()) groups.push({ kind: "ops", code: codes[0], codes, invoiced: false });

      const libs = await loadPdfZip();
      const zip = new libs.JSZip();
      const logo = await imageDataUrl(COMPANY.logoUrl).catch(() => null);

      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        setBulkProgress({ i: i + 1, n: groups.length, code: g.code });
        let form = g.kind === "order" ? invoiceFormForRows(g.rows) : invoiceFormForOps(await api.ops.billingLines(g.codes.join(",")));
        form.withLetter = bulkWithLetter;
        if (g.invoiced) {
          // Already invoiced → stored number, surat, diskon. "Timpa" replaces the
          // tanggal & pajak with the new settings (paid invoices are never changed).
          const stored = await storedInvoicePatch(g.rows);
          form = { ...form, ...stored };
          if (bulkExisting === "overwrite" && stored._paid) skippedPaid.push(g.code);
          else if (bulkExisting === "overwrite" && isContractCode(g.code)) skippedContract.push(g.code);
          else if (bulkExisting === "overwrite") {
            g.overwrite = true;
            form.date = g.rows?.[0]?.contractInvoiceDate || bulkInvoiceDate || todayISO();   // M: always tanggal tagih
            form.tax = bulkTaxMode === "custom" ? taxProfileOf(bulkTax) : taxProfileOf(await api.invoices.resolveTax(form.clientOrgId).catch(() => null));
            form.taxSource = "manual";   // send the profile explicitly so the stored one is replaced
          }
        } else {
          if (bulkInvoicePrefix) form.invoiceNo = `${bulkInvoicePrefix}-${String(i + 1).padStart(3, "0")}`;
          form.date = g.rows?.[0]?.contractInvoiceDate || bulkInvoiceDate || todayISO();   // M: always tanggal tagih
          form.tax = bulkTaxMode === "custom" ? taxProfileOf(bulkTax) : taxProfileOf(await api.invoices.resolveTax(form.clientOrgId).catch(() => null));
          form.taxSource = bulkTaxMode === "custom" ? "manual" : "settings";
        }
        // Same surat number every time this code is printed.
        if (!form.letterNo) form.letterNo = (await api.myOrg.letterNumberForCode(g.code)).letterNumber;
        const pdf = buildInvoicePdf(libs.jsPDF, invoicePdfData(form, dailyRates), { logo, company: PDF_COMPANY });
        zip.file(`${fileSafe(g.code)} - ${fileSafe(form.clientName || "invoice")}.pdf`, pdf.output("blob"));
        done.push({ g, form });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `Invoice ${bulkInvoiceDate || todayISO()} (${done.length}).zip`);

      // Record every invoice exactly as printed (number, date, surat, discount, tax).
      let ok = 0;
      const failed = [];
      const reprinted = done.filter((d) => d.g.invoiced && !d.g.overwrite).length;
      const overwritten = done.filter((d) => d.g.overwrite).length;
      for (const { g, form } of done.filter((d) => !d.g.invoiced || d.g.overwrite)) {
        const calc = invoiceCalc(form, dailyRates);
        const taxProfile = form.taxSource === "manual" ? taxProfileOf(form.tax) : undefined;
        try {
          if (g.kind === "order") {
            await api.sync.bulkMarkInvoiceGenerated({
              ids: g.rows.map((r) => ({ id: r.id, invoiceNumber: form.invoiceNo })),
              invoiceSentDate: form.date, invoiceLetterNumber: form.letterNo || null, invoicePaymentStatus: "Pending",
              discount: calc.discount, ...(taxProfile ? { taxProfile } : {}),
            });
          } else {
            await api.ops.billingIssue({ codes: g.codes, invoiceNumber: form.invoiceNo, sentDate: form.date, letterNumber: form.letterNo || null, discount: calc.discount, ...(taxProfile ? { taxProfile } : {}) });
          }
          ok++;
        } catch (e) { failed.push(`${g.code}: ${e.message}`); }
      }
      apiCache.invalidate("documents:"); apiCache.invalidate("orders:"); apiCache.invalidate("ops:");
      refreshOpsPending();
      const fresh = await api.sync.ordersNeedingInvoice();
      setPending(Array.isArray(fresh) ? fresh : []);
      refreshOrders();
      setSelectedPending(new Set());
      setShowBulkInvoiceModal(false);
      const re = (reprinted ? ` · ${reprinted} diunduh ulang` : "") + (overwritten ? ` · ${overwritten} ditimpa` : "")
        + (skippedPaid.length ? ` · ${skippedPaid.join(", ")} sudah lunas (tidak ditimpa)` : "")
        + (skippedContract.length ? ` · ${skippedContract.join(", ")} kode kontrak (tidak ditimpa — batalkan lalu buat ulang)` : "");
      if (failed.length) toast.error(`${ok - overwritten} invoice baru tercatat${re}, ${failed.length} gagal: ${failed.join("; ")}`);
      else toast.success(`.zip diunduh: ${ok - overwritten} invoice baru dibuat & dicatat${re}.`);
      setBulkConfirmOverwrite(false);
    } catch (err) {
      toast.error("Gagal membuat .zip: " + err.message);
    } finally {
      setBulkProgress(null);
      setBulkMarking(false);
    }
  }

  // When user switches doc type, reset form to that type's defaults.
  function changeDocType(next) {
    setDocType(next);
    setForm(defaultForm(next));
    setSelectedOrderId("");
    setInvoiceOrderIds([]);
    setOpsCodes([]);
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
    const pd = o.pickupDate ? isoDay(o.pickupDate) : todayISO();
    const rd = o.returnDate ? isoDay(o.returnDate) : pd;
    return {
      user: o.customerName || oc.name || "",
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
    setOpsCodes([]);
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
        invoiceNo: invoiceNoFor(order.orderNumber),
        clientName: customerLabel,
        clientAddress: addr,
        date: order.contractInvoiceDate || (order.pickupDate ? isoDay(order.pickupDate) : todayISO()),
        discount: 0,
        autoDisc: !isContractCode(order.orderNumber) && (order.totalDays || 1) >= 4,
        clientOrgId: lookup?.id || order.organizationId || null,
        tax: null, taxSource: null,
        withLetter: true, lampiran: "Rekap Tagihan Sewa Kendaraan", letterNo: "",
        items: siblings.map(orderToInvoiceItem),
      });
      const invoicedRow = siblings.find((r) => r.invoiceNumber);
      if (invoicedRow) {
        // Already invoiced: show the stored number, date, surat and pajak (re-download).
        storedInvoicePatch(siblings).then((patch) => setForm((f) => (f.items?.length === siblings.length ? { ...f, ...patch } : f)))
          .then(() => ensureLetterNo(order.orderNumber));
      } else {
        ensureLetterNo(order.orderNumber);
      }
    } else if (docType === "surat_jalan") {
      setForm({
        no: `26/DSR/SJ/${order.orderNumber || ""}`,
        clientName: c.name || "",
        clientCompany: customerLabel,
        date: order.pickupDate ? isoDay(order.pickupDate) : todayISO(),
        vehicle: car.brand && car.name ? `${car.brand} ${car.name}` : (car.name || ""),
        plate: car.licensePlate || "",
        driver: drv.name || "",
        items: [{
          user: c.name || "",
          date: order.pickupDate ? isoDay(order.pickupDate) : todayISO(),
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
        usageDate: order.pickupDate ? isoDay(order.pickupDate) : todayISO(),
        usageEndDate: order.returnDate ? isoDay(order.returnDate) : (order.pickupDate ? isoDay(order.pickupDate) : todayISO()),
        date: todayISO(),
      }));
    } else if (docType === "perjanjian") {
      setForm({
        ...defaultForm("perjanjian"),
        no: `26/DSR/PRJ/${order.orderNumber || ""}`,
        date: order.pickupDate ? isoDay(order.pickupDate) : todayISO(),
        partyB: { name: c.name || "", role: c.job || "", company: c.companyName || "", address: addr, idNumber: "" },
        vehicle: car.brand && car.name ? `${car.brand} ${car.name}` : (car.name || ""),
        plate: car.licensePlate || "",
        color: car.color || "",
        year: car.year || "",
        startDate: order.pickupDate ? isoDay(order.pickupDate) : todayISO(),
        endDate: order.returnDate ? isoDay(order.returnDate) : todayISO(),
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

  // Same vector PDF as the bulk .zip, for the invoice on screen.
  async function downloadInvoicePdf(f = form) {
    try {
      const libs = await loadPdfZip();
      const logo = await imageDataUrl(COMPANY.logoUrl).catch(() => null);
      const pdf = buildInvoicePdf(libs.jsPDF, invoicePdfData(f, dailyRates), { logo, company: PDF_COMPANY });
      const code = (f.invoiceNo || "").split("/").pop() || "invoice";
      downloadBlob(pdf.output("blob"), `${fileSafe(code)} - ${fileSafe(f.clientName || "invoice")}.pdf`);
      return true;
    } catch (e) { toast.error("Gagal membuat PDF: " + e.message); return false; }
  }

  // Apply ONE order's data to a single trip slot in the current form.
  // Used by both Invoice and Surat Jalan trip rows. Leaves other trips untouched.
  function applyOrderToTripSlot(index, orderId) {
    const order = orders.find(o => String(o.id) === String(orderId));
    if (!order || index < 0) return;
    const c = order.customer || {};
    const car = order.car || {};
    const drv = order.driver || {};
    const isoDate = order.pickupDate ? isoDay(order.pickupDate) : todayISO();
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
          rentReturnDate: order.returnDate ? isoDay(order.returnDate) : isoDate,
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
      clientOrgId: comp.id || prev.clientOrgId || null,
      ...(prev.taxSource === "manual" ? {} : { tax: null, taxSource: null }),
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
    // Declared outside try so the duplicate-name handler in catch can read it
    // (it was block-scoped before → ReferenceError on "sudah terdaftar").
    let payload = null;
    try {
      // Treat empty strings, "-", and "—" as null so they don't trip backend validators
      const clean = (s) => {
        const t = String(s || "").trim();
        return (!t || t === "-" || t === "—") ? null : t;
      };
      payload = {
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
        const dup = (fresh?.data || []).find(c => c.name?.toLowerCase() === payload?.name?.toLowerCase());
        if (dup && confirm(`"${payload?.name}" sudah ada di direktori.\nMuat data yang ada untuk diedit?`)) {
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
    // Approved L/R forms first, then orders (owner 2026-11-11: one picker).
    const all = [...opsPending.map(opsAsOrder), ...orders];
    if (!q) return all;
    return all.filter((o) => {
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
  }, [orders, opsPending, orderSearch]);

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
          {docType === "invoice" ? (
            <>
              {/* Owner 2026-11-13: two actions only. Both create the invoice,
                  the kuitansi, the surat pengantar (number once per code) and
                  record it ("tandai selesai") automatically. */}
              <button
                onClick={() => { setBulkInvoiceDate(todayISO()); setSelectedPending(new Set()); setBulkSearch(""); setBulkFilter("all"); setBulkExisting("reuse"); setBulkConfirmOverwrite(false); setShowBulkInvoiceModal(true); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 shadow-sm transition-colors cursor-pointer"
                title="Pilih beberapa kode transaksi → semua PDF dalam satu .zip, otomatis dicatat"
              >
                <span className="material-symbols-outlined text-[20px]">folder_zip</span>
                Bulk Invoice
                {pending.length > 0 && <span className="px-1.5 py-0.5 rounded bg-white/25 text-[11px] font-bold">{pending.length}</span>}
              </button>
              <AsyncButton
                onClick={runSingleInvoice}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark shadow-sm transition-colors cursor-pointer"
                title="Invoice + kuitansi + surat pengantar untuk kode transaksi di pratinjau: unduh PDF dan catat otomatis"
              >
                <span className="material-symbols-outlined text-[20px]">receipt_long</span>
                Single Invoice
                {(opsCodes[0] || orders.find((o) => String(o.id) === String(selectedOrderId))?.orderNumber) && (
                  <span className="px-1.5 py-0.5 rounded bg-white/25 text-[11px] font-bold font-mono">
                    {opsCodes[0] || orders.find((o) => String(o.id) === String(selectedOrderId))?.orderNumber}
                  </span>
                )}
              </AsyncButton>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowOrderPicker(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
                title="Auto-fill dari order yang sudah ada"
              >
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                Auto-fill dari Order
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark transition-colors shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">print</span>
                Cetak / Simpan PDF
              </button>
            </>
          )}
        </div>
      </div>


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
              {/* Search — click a code to preview it, then "Single Invoice". Several at once: "Bulk Invoice". */}
              <div className="px-4 py-2.5 bg-white flex items-center gap-3">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
                  <input
                    type="text" value={pendingSearch} onChange={(e) => setPendingSearch(e.target.value)}
                    placeholder="Cari kode transaksi, nama, mobil, plat…"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>

              </div>
              <div className="max-h-72 overflow-y-auto bg-white rounded-b-xl">
                {filteredPending.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-6">Tidak ada order yang cocok.</p>
                ) : (
                  filteredPending.map(o => (
                    <div
                      key={o.id}
                      className={`flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 last:border-b-0 ${(String(o.id) === String(selectedOrderId) || (o.opsCode && opsCodes.includes(o.opsCode))) ? "bg-primary/5" : "hover:bg-amber-50"}`}
                    >
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
                              {o.opsCode && <span className="mr-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">{o.kindLabel} · {o.contractNumber || "kontrak"}</span>}
                              {[o.car?.brand, o.car?.name].filter(Boolean).join(" ")}
                              {o.car?.licensePlate ? ` (${o.car.licensePlate})` : ""}
                              {" • "}{fmtDateID(o.pickupDate)}
                              {o.opsCode ? " • disetujui agency & klien" : <>{" • "}{o.totalDays} hari · status {o.status}</>}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-slate-700 whitespace-nowrap">{rp(o.totalPrice)}</p>
                      </button>
                    </div>
                  ))
                )}
              </div>
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

      {/* Faktur Pajak (owner 2026-11-09): its own workspace, not a printable form. */}
      {docType === "faktur" && <FakturPanel />}

      {/* Two-column working area */}
      {docType !== "faktur" && <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:block print:gap-0">
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
            {docType === "invoice" && <InvoiceForm form={form} setForm={setForm} openTripLookup={openTripLookup} openCompanyPicker={openCompanyPicker} openOrderPicker={() => setShowOrderPicker(true)} rates={dailyRates} />}
            {docType === "surat_jalan" && <SuratJalanForm form={form} setForm={setForm} openTripLookup={openTripLookup} />}
            {docType === "surat_tagihan" && <SuratTagihanForm form={form} setForm={setForm} companyNames={companyNames} openOrderPicker={() => setShowOrderPicker(true)} />}
            {docType === "penawaran" && <PenawaranForm form={form} setForm={setForm} />}
            {docType === "perjanjian" && <PerjanjianForm form={form} setForm={setForm} />}
            {isOpsDoc(docType) && <OpsDocForm docType={docType} form={form} setForm={setForm} />}
          </div>
          <p className="text-xs text-slate-500 mt-3 px-1">
            <span className="material-symbols-outlined text-[14px] align-middle">info</span>
            {" "}{docType === "invoice"
              ? "Pratinjau di kanan = isi PDF. \"Single Invoice\" membuat PDF untuk kode di pratinjau dan mencatatnya; \"Bulk Invoice\" untuk beberapa kode sekaligus (.zip)."
              : "Pratinjau di kanan sama persis dengan hasil cetak. Klik \"Cetak / Simpan PDF\" untuk menyimpan sebagai PDF lewat dialog cetak browser."}
          </p>
        </div>

        {/* Preview (right) */}
        <div className="lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 lg:p-6 overflow-x-auto print:p-0 print:bg-white print:border-0 print:rounded-none">
            <div className="flex justify-center">
              <div className="doc-preview-wrap shadow-xl print:shadow-none">
                {docType === "invoice" && <InvoiceSet form={form} rates={dailyRates} />}
                {docType === "surat_jalan" && <SuratJalanTemplate form={form} />}
                {docType === "penawaran" && <PenawaranTemplate form={form} />}
                {docType === "perjanjian" && <PerjanjianTemplate form={form} />}
                {isOpsDoc(docType) && <OpsDocTemplate docType={docType} form={form} header={<CompanyHeader compact />} />}
              </div>
              {createPortal(
                <div className="doc-print-root" aria-hidden="true">
                  {docType === "invoice" && <InvoiceSet form={form} rates={dailyRates} />}
                  {docType === "surat_jalan" && <SuratJalanTemplate form={form} />}
                  {docType === "surat_tagihan" && <SuratTagihanTemplate form={form} />}
                  {docType === "penawaran" && <PenawaranTemplate form={form} />}
                  {docType === "perjanjian" && <PerjanjianTemplate form={form} />}
                  {isOpsDoc(docType) && <OpsDocTemplate docType={docType} form={form} header={<CompanyHeader compact />} />}
                </div>,
                document.body,
              )}
            </div>
          </div>
        </div>
      </div>}

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
                  onClick={() => { if (o.opsCode) { setShowOrderPicker(false); fillFromOps(o); } else applyOrderToForm(o.id); setOrderSearch(""); }}
                  className="w-full flex items-start justify-between gap-4 px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer text-left border border-transparent hover:border-slate-200 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-primary">{o.orderNumber}{o.opsCode && <span className="ml-1.5 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{o.kindLabel} · {o.contractNumber || "kontrak"}</span>}
                      {!o.opsCode && o.invoiceNumber && <span className="ml-1.5 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">sudah invoice</span>}</p>
                    <p className="text-sm font-medium text-slate-900 truncate">{o.customer?.companyName || o.customer?.name || "-"}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {[o.car?.brand, o.car?.name].filter(Boolean).join(" ")}
                      {o.car?.licensePlate ? ` (${o.car.licensePlate})` : ""}
                      {" • "}{fmtDateID(o.pickupDate)}
                      {o.opsCode ? " • menunggu invoice" : <>{" • "}{o.totalDays} hari</>}
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
                        <AsyncButton onClick={() => deleteCompany(c)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer" title="Hapus">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </AsyncButton>
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
        /* Laid out (so the invoice fit-to-half measures) but off screen. */
        .doc-print-root { position: fixed; left: -10000px; top: 0; width: ${docType === "surat_jalan" || OPS_LANDSCAPE.has(docType) ? "297mm" : "210mm"}; background: white; }
        .doc-print-root .doc-sheet-break { border-top: 0; padding-top: 0; }
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
        .terbilang-bg { background: #ebebeb; padding: 1pt 4pt; box-sizing: border-box; }
        /* Surat pengantar on its own sheet (screen: a gap between pages). */
        .doc-sheet-break { border-top: 0.8pt dashed #555; padding-top: 2mm; }

        @media print {
          /* Set the printer paper to true A4 with the right orientation. */
          @page { size: ${docType === "surat_jalan" || OPS_LANDSCAPE.has(docType) ? "A4 landscape" : "A4 portrait"}; margin: 0; }
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Print the off-screen copy (.doc-print-root, a portal on <body>) and
             hide the app. An absolutely positioned preview only ever printed
             page 1 — that is why the surat pengantar never appeared. */
          #root { display: none !important; }
          .doc-print-root { position: static !important; left: auto !important; width: auto !important; }
          .doc-page {
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: avoid;
          }
          /* Avoid stray bottom space producing a blank second page. */
          .doc-page-a4      { min-height: 297mm; }
          .doc-page-a4-land { min-height: 210mm; }
          .doc-sheet-break  { margin-top: 0 !important; break-before: page; page-break-before: always; }
        }
      `}</style>

      {/* ── Bulk Invoice Modal (owner 2026-11-13) ───────────────────────
          Pick codes waiting for an invoice → one PDF per code in a .zip;
          every invoice is recorded and its surat number kept per code. */}
      {showBulkInvoiceModal && (() => {
        const q = bulkSearch.trim().toLowerCase();
        const list = allCodes
          .filter((o) => (bulkFilter === "pending" ? !o.invoiced : bulkFilter === "invoiced" ? o.invoiced : true))
          .filter((o) => !q || [o.code, o.customer?.companyName, o.customer?.name, ...(o.cars || []), o.contractNumber, o.invoiceNumber]
            .filter(Boolean).join(" ").toLowerCase().includes(q));
        const nNew = allCodes.filter((o) => selectedPending.has(o.id) && !o.invoiced).length;
        const invoicedSel = allCodes.filter((o) => selectedPending.has(o.id) && o.invoiced);
        const overwriting = bulkExisting === "overwrite" && invoicedSel.length > 0;
        const allOn = list.length > 0 && list.filter((o) => !o.formBlocked).every((o) => selectedPending.has(o.id));
        const toggle = (id, on) => setSelectedPending((prev) => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });
        const n = selectedPending.size;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm print:hidden" onClick={() => !bulkMarking && setShowBulkInvoiceModal(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="bg-emerald-600 px-6 py-4 flex items-center gap-3">
                <span className="material-symbols-outlined text-white text-2xl">folder_zip</span>
                <div className="flex-1">
                  <h3 className="text-white font-bold text-lg">Bulk Invoice</h3>
                  <p className="text-emerald-100 text-xs mt-0.5">Semua kode transaksi (pemakaian terbaru di atas). Yang belum ber-invoice dibuat & dicatat; yang sudah, diunduh ulang dengan data tersimpan.</p>
                </div>
                <button onClick={() => setShowBulkInvoiceModal(false)} disabled={bulkMarking} className="text-white/80 hover:text-white cursor-pointer"><span className="material-symbols-outlined">close</span></button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer shrink-0">
                      <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={allOn}
                        onChange={(e) => setSelectedPending((prev) => { const s2 = new Set(prev); list.forEach((o) => (e.target.checked && !o.formBlocked ? s2.add(o.id) : s2.delete(o.id))); return s2; })} />
                      Semua
                    </label>
                    <input value={bulkSearch} onChange={(e) => setBulkSearch(e.target.value)} placeholder="Cari kode, perusahaan, mobil, plat, kontrak…"
                      className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white" />
                    <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">{n} dipilih</span>
                  </div>
                  <div className="px-3 py-1.5 bg-white border-b border-slate-100 flex gap-1.5 text-xs">
                    {[["all", "Semua"], ["pending", "Belum invoice"], ["invoiced", "Sudah invoice"]].map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setBulkFilter(k)}
                        className={`px-2.5 py-1 rounded-full border cursor-pointer ${bulkFilter === k ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{l}</button>
                    ))}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {list.length === 0 && <p className="text-center text-xs text-slate-400 py-6">Tidak ada kode transaksi yang menunggu invoice.</p>}
                    {list.map((o) => (
                      <label key={o.id} className={`flex items-center gap-3 px-3 py-2 ${o.formBlocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${selectedPending.has(o.id) ? "bg-emerald-50/70" : "hover:bg-slate-50"}`}>
                        <input type="checkbox" className="w-4 h-4 accent-emerald-600 shrink-0" disabled={o.formBlocked} checked={selectedPending.has(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-bold text-primary">{o.code}
                            {o.opsCode && <span className="ml-1.5 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{o.kindLabel} · {o.contractNumber || "kontrak"}</span>}
                            {o.invoiced
                              ? <span className="ml-1.5 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">sudah invoice · {o.invoiceNumber}</span>
                              : o.formBlocked
                                ? <span className="ml-1.5 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">form bulanan belum disetujui</span>
                                : <span className="ml-1.5 font-sans font-semibold text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">belum invoice</span>}
                          </p>
                          <p className="text-xs text-slate-600 truncate">{fmtDateID(o.pickupDate)} · {o.customer?.companyName || o.customer?.name || "-"} · {(o.cars || []).join(", ") || "-"}</p>
                        </div>
                        <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{rp(o.totalPrice)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Tanggal Invoice</label>
                    <input type="date" value={bulkInvoiceDate} onChange={(e) => { setBulkInvoiceDate(e.target.value); setBulkConfirmOverwrite(false); }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Prefix No. Invoice <span className="font-normal text-slate-400">(opsional)</span></label>
                    <input type="text" value={bulkInvoicePrefix} onChange={(e) => setBulkInvoicePrefix(e.target.value)} placeholder="Kosong = 26/DSR/INV/<kode>"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                </div>

                {invoicedSel.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                    <p className="text-sm font-semibold text-amber-900">{invoicedSel.length} kode sudah ber-invoice: {invoicedSel.slice(0, 6).map((o) => o.code).join(", ")}{invoicedSel.length > 6 ? ", …" : ""}</p>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" name="bulkExisting" className="mt-1" checked={bulkExisting === "reuse"} onChange={() => { setBulkExisting("reuse"); setBulkConfirmOverwrite(false); }} />
                      <span>Pakai invoice tersimpan — unduh ulang saja (tanggal, pajak & nominal tidak berubah)</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" name="bulkExisting" className="mt-1" checked={bulkExisting === "overwrite"} onChange={() => setBulkExisting("overwrite")} />
                      <span>Timpa dengan pengaturan baru — tanggal & pajak di bawah menggantikan yang tersimpan; No. invoice, No. surat & diskon tetap. Invoice yang sudah lunas, masuk faktur pajak terbit, atau kode kontrak (M/L/T/O — batalkan dulu lalu buat ulang) tidak ditimpa.</span>
                    </label>
                  </div>
                )}
                <p className="text-xs text-slate-500 -mb-1">Kode M (bulanan kontrak) selalu bertanggal sesuai tanggal tagih kontrak. Tanggal, prefix dan pajak di bawah berlaku untuk kode yang <b>belum</b> ber-invoice{overwriting ? " dan untuk kode yang ditimpa (prefix tidak dipakai saat menimpa)" : ""}.</p>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Pajak invoice</p>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="bulkTax" checked={bulkTaxMode === "settings"} onChange={() => setBulkTaxMode("settings")} /> Ikuti Pengaturan → Pajak invoice (per klien)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="bulkTax" checked={bulkTaxMode === "custom"} onChange={() => { setBulkTaxMode("custom"); setBulkTax((x) => x || taxProfileOf(null)); }} /> Atur sama untuk semua invoice ini
                  </label>
                  {bulkTaxMode === "custom" && <TaxProfileEditor value={bulkTax} onChange={setBulkTax} showExample={false} />}
                  <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                    <input type="checkbox" className="accent-emerald-600" checked={bulkWithLetter} onChange={(e) => setBulkWithLetter(e.target.checked)} /> Sertakan surat pengantar (nomor tetap per kode transaksi)
                  </label>
                </div>
                {bulkProgress && <p className="text-xs text-slate-600">Membuat PDF {bulkProgress.i} / {bulkProgress.n} — <span className="font-mono">{bulkProgress.code}</span>…</p>}
              </div>

              {bulkConfirmOverwrite && overwriting && (
                <div className="mx-5 mb-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <b>Konfirmasi:</b> {invoicedSel.length} invoice tersimpan ({invoiceSel_label(invoicedSel)}) akan ditimpa dengan tanggal {fmtDateID(bulkInvoiceDate)} dan pajak {bulkTaxMode === "custom" ? taxSummary(bulkTax) : "sesuai Pengaturan per klien"}. Nominal invoice & jurnal Keuangan ikut menyesuaikan. Lanjutkan?
                </div>
              )}
              <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end">
                <button onClick={() => setShowBulkInvoiceModal(false)} disabled={bulkMarking}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">Batal</button>
                <button onClick={() => (overwriting && !bulkConfirmOverwrite ? setBulkConfirmOverwrite(true) : handleBulkZip())} disabled={bulkMarking || n === 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                  {bulkMarking && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {bulkProgress ? `PDF ${bulkProgress.i}/${bulkProgress.n}…`
                    : overwriting && bulkConfirmOverwrite ? `Ya, timpa ${invoicedSel.length} & unduh .zip`
                    : `Unduh ${n} PDF (.zip)${nNew ? ` · ${nNew} baru` : ""}${overwriting ? ` · ${invoicedSel.length} ditimpa` : ""}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Single Invoice confirmation (owner 2026-11-13) ───────────────── */}
      {singleConfirm && (() => {
        const { tax, shownSubtotal } = invoiceCalc(form, dailyRates);
        const row = (k, v, strong) => (
          <div className="flex justify-between gap-4 py-1.5 border-b border-slate-100 last:border-b-0 text-sm">
            <span className="text-slate-500">{k}</span><span className={`text-right ${strong ? "font-bold text-slate-900" : "text-slate-800"}`}>{v}</span>
          </div>
        );
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm print:hidden" onClick={() => setSingleConfirm(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="bg-primary px-6 py-4 flex items-center gap-3">
                <span className="material-symbols-outlined text-white text-2xl">receipt_long</span>
                <div>
                  <h3 className="text-white font-bold text-lg">{singleConfirm.alreadyInvoiced ? (singleConfirm.overwrite ? "Timpa invoice" : "Unduh ulang invoice") : "Buat invoice"}</h3>
                  <p className="text-white/80 text-xs mt-0.5">{singleConfirm.code ? `Kode transaksi ${singleConfirm.code}` : "Tanpa kode transaksi"}</p>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  {row("Kepada", form.clientName || "-")}
                  {row("No. Invoice", form.invoiceNo)}
                  {row("Tanggal invoice", fmtDateID(form.date))}
                  {row("No. Surat Pengantar", form.withLetter === false ? "Tidak disertakan"
                    : (form.letterNo || (singleConfirm.code ? "Dibuat otomatis (sekali per kode)" : "— (isi / Ambil Nomor di form)")))}
                  {row("Pajak", taxSummary(form.tax))}
                  {row("Sub Total", rp(shownSubtotal))}
                  {tax.discount > 0 && row("Diskon", rp(tax.discount))}
                  {tax.ppnEnabled && row(`PPN ${tax.ppnRate}%`, rp(tax.ppn))}
                  {row("TOTAL", rp(tax.total), true)}
                </div>
                {singleConfirm.alreadyInvoiced && singleConfirm.contract && (
                  <div className="text-sm rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <p>Invoice kode kontrak <b>tidak bisa ditimpa</b>. Untuk mengubah: batalkan invoice ini, koreksi datanya (form bulanan / form lembur, perjalanan dinas, operasional), lalu buat invoice lagi. Nomor invoice & surat bisa dipakai lagi.</p>
                    {singleConfirm.paid ? <p className="text-xs text-slate-500">Invoice ini sudah ada pembayaran — tidak bisa dibatalkan.</p>
                      : isAgencyAdmin ? (
                        <AsyncButton onClick={cancelCurrentInvoice} className="px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-semibold">
                          Batalkan invoice {singleConfirm.invoiceNumber}
                        </AsyncButton>
                      ) : <p className="text-xs text-slate-500">Pembatalan hanya oleh admin agency.</p>}
                  </div>
                )}
                {singleConfirm.alreadyInvoiced && !singleConfirm.contract && (
                  <label className={`flex items-start gap-2 text-sm rounded-lg border p-3 ${singleConfirm.paid ? "border-slate-200 text-slate-400" : "border-amber-200 bg-amber-50 text-amber-900 cursor-pointer"}`}>
                    <input type="checkbox" className="mt-0.5" disabled={singleConfirm.paid} checked={!!singleConfirm.overwrite}
                      onChange={(e) => setSingleConfirm((c) => ({ ...c, overwrite: e.target.checked }))} />
                    <span>{singleConfirm.paid
                      ? "Invoice ini sudah lunas — tidak bisa ditimpa, hanya unduh ulang."
                      : "Timpa invoice tersimpan dengan data form ini (tanggal, pajak & diskon). No. invoice tetap; nominal & jurnal Keuangan ikut menyesuaikan."}</span>
                  </label>
                )}
                <div className={`rounded-lg p-3 text-xs ${singleConfirm.alreadyInvoiced && !singleConfirm.overwrite ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                  {singleConfirm.alreadyInvoiced && singleConfirm.overwrite
                    ? "Setelah dikonfirmasi: invoice tersimpan DITIMPA dengan data form, lalu PDF diunduh. Pastikan form sudah direview."
                    : singleConfirm.alreadyInvoiced
                    ? "Kode ini sudah ber-invoice. PDF diunduh ulang; tidak ada yang dicatat ulang."
                    : singleConfirm.code
                      ? "Setelah dikonfirmasi: PDF diunduh dan invoice dicatat (ditandai selesai). Pastikan data di form Data Dokumen sudah direview — No. Invoice, tanggal, No. Surat dan pajak bisa diubah di sana."
                      : "PDF diunduh saja (tanpa kode transaksi, tidak dicatat)."}
                </div>
              </div>
              <div className="px-5 pb-5 flex gap-3 justify-end">
                <button onClick={() => setSingleConfirm(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">Kembali ke form</button>
                <AsyncButton onClick={confirmSingleInvoice} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark cursor-pointer">
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  {singleConfirm.alreadyInvoiced ? (singleConfirm.overwrite ? "Ya, timpa & unduh" : "Unduh PDF") : "Ya, buat & unduh"}
                </AsyncButton>
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

function Field({ label, value, onChange, type = "text", placeholder = "", options = null }) {
  const listId = useId();
  const hasOptions = Array.isArray(options) && options.length > 0;
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)} placeholder={placeholder}
        list={hasOptions ? listId : undefined}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
      {hasOptions && (
        <datalist id={listId}>
          {options.map((o, i) => <option key={i} value={o} />)}
        </datalist>
      )}
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

function InvoiceForm({ form, setForm, openTripLookup, openCompanyPicker, openOrderPicker, rates }) {
  const { t } = useLanguage();
  const [editTax, setEditTax] = useState(false);
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
      {openOrderPicker && (
        <button type="button" onClick={openOrderPicker}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-semibold hover:bg-primary/10 cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">search</span>
          Pilih Kode Transaksi
          <span className="font-normal text-xs text-slate-500">(termasuk yang sudah ter-invoice, untuk cetak ulang)</span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="No. Invoice" value={form.invoiceNo} onChange={(v) => upd({ invoiceNo: v })} />
        <Field label="Tanggal" type="date" value={form.date} onChange={(v) => upd({ date: v })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">No. Surat Pengantar <span className="font-normal text-slate-400">(tercetak di invoice & surat pengantar)</span></label>
        <div className="flex gap-2">
          <input
            value={form.letterNo ?? ""}
            onChange={(e) => upd({ letterNo: e.target.value })}
            placeholder="No.26/DSR/070 — klik Ambil Nomor"
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
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="accent-primary" checked={form.withLetter !== false} onChange={(e) => upd({ withLetter: e.target.checked })} />
            Sertakan surat pengantar (halaman 2)
          </label>
          {form.withLetter !== false && (
            <input value={form.lampiran ?? ""} onChange={(e) => upd({ lampiran: e.target.value })} placeholder="Lampiran"
              className="flex-1 min-w-[160px] px-3 py-1.5 border border-slate-200 rounded-lg text-sm" title="Lampiran (surat pengantar)" />
          )}
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
        {/* Pajak (owner 2026-11-09): profile from Pengaturan → Pajak invoice
            (per client), changeable for this invoice only. Replaces the old
            fixed 2,5 % / 2 % boxes. */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-700">{t("tx_invTax")}</span>
            <button type="button" className="text-xs font-semibold text-primary cursor-pointer" onClick={() => setEditTax((v) => !v)}>{t("tx_overrideHere")}</button>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{taxSummary(form.tax)}{form.taxSource === "settings" ? ` · ${t("tx_invTaxFrom", { src: form.clientOrgId ? t("tx_srcClient") + "/" + t("tx_srcDefault") : t("tx_srcDefault") })}` : ""}</p>
          {editTax && (
            <div className="mt-2">
              <TaxProfileEditor value={form.tax} showExample={false} onChange={(p) => upd({ tax: p, taxSource: "manual" })} />
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-2">{rates?.configured ? t("tx_rates", { ot: rp(rates.overtime), lod: rp(rates.lodging) }) : t("tx_ratesLegacy")}</p>
        </div>
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

function SuratTagihanForm({ form, setForm, companyNames = [], openOrderPicker }) {
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
      {openOrderPicker && (
        <button
          type="button"
          onClick={openOrderPicker}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-primary text-sm font-semibold hover:bg-primary/10 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
          Isi dari Kode Transaksi
        </button>
      )}
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
        <Field label="Kepada (Klien)" value={form.to} onChange={(v) => upd({ to: v })} options={companyNames} />
        <Field label="Tanggal Surat" type="date" value={form.date} onChange={(v) => upd({ date: v })} />
      </div>
      <Field label="Dari" value={form.from} onChange={(v) => upd({ from: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tgl Mulai (di berita)" type="date" value={form.usageDate} onChange={(v) => upd({ usageDate: v })} />
        <Field label="Tgl Selesai (di berita)" type="date" value={form.usageEndDate} onChange={(v) => upd({ usageEndDate: v })} />
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

// Invoice amounts (shared by the print and by "tandai invoice"):
//   line  = price + lembur jam × tarif + inap malam × tarif   (rates: Pengaturan)
//   disc  = auto 5 % when the rental is ≥ 4 days, else the manual Rp discount
//   tax   = lib/tax.js computeInvoiceTax (DPP, DPP nilai lain, PPN, PPh)
function invoiceCalc(form, rates) {
  const ot = Number(rates?.overtime ?? LEGACY_DAILY_RATES.overtime) || 0;
  const lod = Number(rates?.lodging ?? LEGACY_DAILY_RATES.lodging) || 0;
  const lines = form.items.map((it) => {
    const lemburRp = Math.round((Number(it.lembur) || 0) * ot);
    const inapRp = Math.round((Number(it.inap) || 0) * lod);
    return { lemburRp, inapRp, amount: Math.round(Number(it.price || 0)) + lemburRp + inapRp };
  });
  // Auto-discount keys off the rental LENGTH (days), not the number of cars.
  const rentalDays = Math.max(1, ...form.items.map(it => {
    const d1 = new Date(it.rentDate);
    const d2 = new Date(it.rentReturnDate);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    return Math.floor((d2 - d1) / 86_400_000) + 1;
  }));
  const auto = form.autoDisc && rentalDays >= 4;
  const itemsTotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const discount = Math.round(auto ? itemsTotal * 0.05 : Number(form.discount || 0));
  const tax = computeInvoiceTax({ amounts: lines.map((l) => l.amount), discount, profile: form.tax });
  // PREVIEW ONLY (owner 2026-11-12): a tax added to the bill (profile "Ditambahkan
  // ke tagihan") is shown inside each row's Total and the Sub Total instead of
  // its own row. Its amount (tax.added) is spread over the rows so they sum
  // exactly; Sub Total − Disc + PPN = TOTAL stays equal to the stored invoice.
  const share = spread(tax.added, lines.map((l) => l.amount));
  return {
    lines: lines.map((l, i) => ({ ...l, total: l.amount + share[i] })),
    discount, tax, shownSubtotal: tax.subtotal + tax.added,
  };
}

/** Split `amount` over `weights` (largest remainder) so the parts sum exactly. */
function spread(amount, weights) {
  const total = weights.reduce((a, w) => a + w, 0);
  if (!amount || !total) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const out = exact.map(Math.floor);
  let left = amount - out.reduce((a, x) => a + x, 0);
  exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
  return out;
}

const asList = (v) => (Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : []);
const invoiceSel_label = (list) => list.slice(0, 5).map((o) => o.invoiceNumber || o.code).join(", ") + (list.length > 5 ? ", …" : "");
// Dokumen loads every kode transaksi, newest tanggal pemakaian first (Bulk
// Invoice lists invoiced codes too, for re-download — owner 2026-11-13).
const ORDERS_QUERY = "limit=1000&sortBy=pickupDate&sortOrder=desc";
const isoDay = (d) => (d ? new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : "");
const isContractCode = (code) => /^[MLTOR]\d/.test(String(code || "").trim());

// Approved L/R form → the shape the pending list / picker render.
function opsAsOrder(x) {
  return {
    id: `ops:${x.code}`, opsCode: x.code, orderNumber: x.code, kindLabel: x.kindLabel,
    contractId: x.contractId, contractNumber: x.contractNumber, clientOrgId: x.clientOrgId,
    customer: { companyName: x.clientName }, car: { brand: x.carBrand, name: x.carName, licensePlate: x.plate },
    driver: { name: x.driverName }, pickupDate: x.entryDate, totalDays: 1, status: "approved", totalPrice: x.amount,
  };
}

/** Fixed-height box that scales its content down when it doesn't fit. */
function FitBox({ height, children }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return undefined;
    const fit = () => {
      const need = i.scrollHeight, avail = o.clientHeight;
      // 2 % head-room so the signature never touches the dashed line.
      const next = need > avail * 0.98 && need > 0 ? (avail * 0.98) / need : 1;
      setScale((prev) => (Math.abs(prev - next) < 0.002 ? prev : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} style={{ height, flexShrink: 0, overflow: "hidden" }}>
      <div ref={inner} style={{ display: "flex", flexDirection: "column", transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top center" }}>{children}</div>
    </div>
  );
}

/** Surat pengantar data taken from the invoice (same kode transaksi). */
function letterFormFromInvoice(form) {
  const starts = form.items.map((it) => it.rentDate).filter(Boolean).sort();
  const ends = form.items.map((it) => it.rentReturnDate || it.rentDate).filter(Boolean).sort();
  return {
    ...defaultForm("surat_tagihan"),
    letterNo: form.letterNo || "",
    to: form.clientName || "",
    lampiran: form.lampiran || "Rekap Tagihan Sewa Kendaraan",
    usageDate: starts[0] || form.date,
    usageEndDate: ends[ends.length - 1] || starts[0] || form.date,
    date: form.date,
  };
}

/** Page 1 invoice + kuitansi; page 2 (own sheet) surat pengantar tagihan. */
function InvoiceSet({ form, rates }) {
  return (
    <>
      <InvoiceTemplate form={form} rates={rates} />
      {form.withLetter !== false && (
        // Screen: right below the kuitansi (dashed line, no blank page).
        // Print: its own A4 sheet (.doc-sheet-break).
        <div className="doc-sheet-break bg-white" style={{ width: "210mm" }}>
          <SuratTagihanTemplate form={letterFormFromInvoice(form)} />
        </div>
      )}
    </>
  );
}

const PDF_COMPANY = { name: COMPANY.name, addr: COMPANY.addr, phone: COMPANY.phone2, brand: COMPANY.brand, signatory: COMPANY.signatory };

function beritaText(f) {
  return `Bersama ini Kami sampaikan rekap tagihan atas pemakaian pada tanggal ${fmtDateRange(f.usageDate, f.usageEndDate)}. ` +
    `Pembayaran atas tagihan tersebut hendaknya ditransfer ke rek. ${f.bankAccount || "-"} an. ${f.bankHolder || "-"} ` +
    `pada Bank ${f.bankName || "-"} dan harap memberikan Notifikasi pembayaran pada email ${f.email || "-"} ` +
    `atau WA di ${f.wa || "-"}`;
}

function untukPembayaranText(form) {
  return form.items.length > 0
    ? `Sewa Kendaraan roda 4 include driver, tol, parkir, BBM dengan unit ${form.items.map(it => `${it.unit} ${it.plate}`).join(", ")} tanggal ${fmtDateRange(form.items[0].rentDate, form.items[0].rentReturnDate)} tujuan ${form.items[0].destination}`
    : "Sewa Kendaraan Roda 4";
}

/** Everything lib/invoicePdf.js draws — from the SAME calculation as the preview. */
function invoicePdfData(form, rates) {
  const { lines, tax, shownSubtotal } = invoiceCalc(form, rates);
  const letter = form.withLetter !== false ? letterFormFromInvoice(form) : null;
  return {
    invoiceNo: form.invoiceNo, letterNo: form.letterNo || "", clientName: form.clientName || "-",
    clientAddress: form.clientAddress || "-", dateText: fmtDateID(form.date),
    rows: form.items.map((it, i) => {
      const jam = Number(it.lembur) || 0, hari = Number(it.inap) || 0;
      return {
        no: String(i + 1), user: it.user || "-", driver: it.driver || "-", dest: it.destination || "-",
        date: fmtDateRange(it.rentDate, it.rentReturnDate) || "-",
        unit: it.unit ? [it.unit, it.plate].filter(Boolean) : "-",
        lembur: jam > 0 ? [`${jam} Jam`, rp(lines[i].lemburRp)] : "-",
        inap: hari > 0 ? [`${hari} Hari`, rp(lines[i].inapRp)] : "-",
        total: rp(lines[i].total),
      };
    }),
    totals: [
      { label: "Sub Total (IDR)", value: rp(shownSubtotal) },
      { label: "Disc", value: tax.discount > 0 ? rp(tax.discount) : "Rp0" },
      ...(tax.ppnEnabled ? [{ label: `PPN ${tax.ppnRate}%`, value: rp(tax.ppn) }] : []),
      { label: "TOTAL (IDR)", value: rp(tax.total), bold: true },
    ],
    terbilang: terbilang(tax.total), untukPembayaran: untukPembayaranText(form), nominal: `${rp(tax.total)},00`,
    letter: letter && {
      letterNo: letter.letterNo, to: letter.to || "-", from: letter.from, lampiran: letter.lampiran,
      berita: beritaText(letter), dateText: fmtDateID(letter.date),
    },
  };
}

function taxSummary(p) {
  const x = taxProfileOf(p);
  const parts = [x.ppn.enabled ? `PPN ${x.ppn.rate}%${x.ppn.base === "nilai_lain" ? " × DPP 11/12" : ""}` : "Tanpa PPN"];
  if (x.pph.mode === "withheld") parts.push(`${x.pph.label} ${x.pph.rate}% dipotong klien`);
  if (x.pph.mode === "added") parts.push(`${x.pph.label} ${x.pph.rate}% ditambahkan`);
  return parts.join(" · ");
}

function InvoiceTemplate({ form, rates }) {
  const { lines, tax, shownSubtotal } = invoiceCalc(form, rates);
  const grand = tax.total;
  // Approval/signature date follows the editable "Tanggal" field (form.date),
  // which defaults to the order's tanggal pemakaian (pickup date) and can be
  // changed to any date. Both the invoice and the kuitansi signature use it.
  const signatureDateStr = fmtDateID(form.date);

  return (
    <div data-pdf-page className="doc-page doc-page-a4" style={{ display: "flex", flexDirection: "column", height: "297mm", boxSizing: "border-box", overflow: "hidden" }}>

      {/* ── TOP HALF — Invoice ────────────────────────────────── */}
      {/* Sizes to its content (min ~half page) so the signature is never
          clipped when a booking has 3+ line items. Was `flex:1 overflow:hidden`
          which truncated the signatory once the table exceeded half the page. */}
      {/* Fixed height: the dashed line always sits at the A4 midpoint (12 mm
          padding + 136.5 mm = 148.5 mm). Many rows are scaled down to fit
          instead of pushing the line down (owner 2026-11-12). */}
      <FitBox height="136.5mm">
        <CompanyHeader />

        {/* Optional company letter number (top-left), only when reserved. */}
        {form.letterNo && <div style={{ fontSize: "7.5pt", marginTop: "2.5mm", lineHeight: 1 }}>{form.letterNo}</div>}

        <div style={{ textAlign: "center", marginTop: form.letterNo ? "0.5mm" : "4mm" }}>
          <div style={{ fontSize: "18pt", fontWeight: "bold" }}>INVOICE</div>
          <div style={{ fontSize: "7pt", marginTop: "1mm" }}>{form.invoiceNo}</div>
        </div>

        <div style={{ marginTop: "5.5mm", fontSize: "8pt" }}>
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
              const { lemburRp, inapRp, total: lineTotal } = lines[i];
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
                  <td style={{ textAlign: "right" }}>{rp(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: "4mm", fontSize: "8pt", textAlign: "right" }}>
          {/* Preview rows (owner 2026-11-11/12): Sub Total = Σ row totals (harga +
              added tax when the profile adds it); PPN only when used; no DPP
              rows; one TOTAL shared with the kuitansi. */}
          {[
            ["Sub Total (IDR)", rp(shownSubtotal)],
            ["Disc", tax.discount > 0 ? rp(tax.discount) : "Rp0"],
            ...(tax.ppnEnabled ? [[`PPN ${tax.ppnRate}%`, rp(tax.ppn)]] : []),
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "flex-end", gap: "10mm", marginBottom: "1mm" }}>
              <span>{k}</span><span style={{ minWidth: "30mm", textAlign: "right" }}>{v}</span>
            </div>
          ))}
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
      </FitBox>

      {/* ── Dashed divider — exact A4 midpoint ───────────────── */}
      <div style={{ borderTop: "0.8pt dashed #555", flexShrink: 0 }} />

      {/* ── BOTTOM HALF — Kuitansi ───────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, paddingTop: "5mm" }}>
        <CompanyHeader compact />
        <div style={{ marginTop: "4.5mm", fontSize: "7pt" }}>No. {form.invoiceNo}</div>

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
              {untukPembayaranText(form)}
            </div>
          </div>
        </div>

        <div style={{ marginTop: "5mm", display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: "9.5pt" }}>
          <div>
            <div style={{ fontWeight: "bold", display: "flex", gap: "5mm" }}>
              <span>Nominal :</span>
              <span style={{ fontStyle: "italic", fontWeight: "bold", borderBottom: "0.8pt solid #000", paddingBottom: "0.6mm", display: "inline-block", lineHeight: 1.2 }}>{rp(grand)},00</span>
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
  const berita = beritaText(form);

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
      <div style={{ fontSize: "7.5pt", marginTop: "3.5mm" }}>{form.letterNo || "No. ........./DSR/........."}</div>

      {/* Title */}
      <div style={{ textAlign: "center", fontSize: "12pt", fontWeight: "bold", margin: "1.5mm 0 4.5mm" }}>
        SURAT PENGANTAR TAGIHAN
      </div>

      {/* Meta block */}
      {metaRow("Kepada", form.to)}
      {metaRow("Dari", form.from)}
      {metaRow("Lampiran", form.lampiran)}

      {/* Berita — body sits inline in the value cell, aligned with the label. */}
      <div style={{ display: "flex", marginTop: "1mm" }}>
        <div style={{ width: "20mm", fontWeight: "bold" }}>Berita</div>
        <div style={{ width: "3mm" }}>:</div>
        <div style={{ flex: 1, textAlign: "justify", lineHeight: 1.5 }}>{berita}</div>
      </div>

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
