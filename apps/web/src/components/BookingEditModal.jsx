// ─── BookingEditModal — the ONE ✏️ edit form for Rekap Order ────────────────
// Used for single orders, for each child row (9.1, 9.2) and for a multi-car
// booking header (#9). The fields are identical everywhere; a group just
// lists one vehicle card per row. No horizontal scrolling — cards stack
// vertically and fields wrap in a responsive grid.
//
//   Pelanggan (booking-level)  nama*, tipe pelanggan*, company* (if company), no. HP
//   Per kendaraan — wajib      mobil*, driver*, paket*, tujuan*, tgl mulai*, tgl selesai*
//   Per kendaraan — opsional   harga, penjemputan, inap, lembur, bailout, status, catatan
//   Invoice                    tgl kirim, tgl realisasi (editable); no. invoice,
//                              due date, status (automatic)
//
// Apply-to-all checkbox (group only, next to each shareable label on Vehicle
// #1): ticking it copies that field to every vehicle and locks the other
// inputs. All unchecked by default, so original values are never replaced
// unless the user opts in. mobil/driver are never shared.
// Save → PUT /api/orders/booking-update (atomic, scope-checked server-side).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo } from "react";
import { api, apiCache } from "../lib/api";
import { useToast } from "./Toast";
import { formatDate } from "../lib/dataFormats";
import { invoiceStatusOf, INVOICE_STATUS_CLASS, INVOICE_STATUS_KEY } from "../lib/invoiceStatus";

const PACKAGES = ["Private", "All In", "Mobil & Driver", "Lepas Kunci", "Drop"];
const STATUSES = ["pending", "confirmed", "active", "completed", "cancelled"];

const toIso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return ms < 0 ? null : Math.round(ms / 86400000) + 1;
};
const blank = (v) => v === undefined || v === null || String(v).trim() === "";

export default function BookingEditModal({ rows, cars = [], drivers = [], onClose, onSaved, t }) {
  const toast = useToast();
  const isGroup = rows.length > 1;
  const first = rows[0];

  // ─── Customer (booking-level) ─────────────────────────────────────────
  const [cust, setCust] = useState({
    customerName: first.customerName || first.customer?.name || "",
    customerType: first.customer?.customerType || "private",
    companyName: first.customer?.companyName || "",
    customerPhone: first.customer?.phone || first.customer?.whatsapp || "",
  });
  const setC = (k, v) => setCust((p) => ({ ...p, [k]: v }));

  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    Promise.allSettled([api.orders.companySuggestions(), api.companies.list("limit=500")])
      .then(([hist, regs]) => {
        const names = new Set();
        const h = hist.status === "fulfilled" ? (hist.value?.data || hist.value || []) : [];
        h.forEach((n) => n && names.add(String(n).trim()));
        const r = regs.status === "fulfilled" ? (Array.isArray(regs.value) ? regs.value : (regs.value?.data || [])) : [];
        r.forEach((c) => c?.name && names.add(String(c.name).trim()));
        setCompanies([...names].filter(Boolean).sort((a, b) => a.localeCompare(b)));
      });
  }, []);

  // ─── Vehicles ─────────────────────────────────────────────────────────
  const [items, setItems] = useState(() => rows.map((o) => ({
    orderId: o.id,
    label: o.car ? `${o.car.brand || ""} ${o.car.name || ""}`.trim() + (o.car.licensePlate ? ` (${o.car.licensePlate})` : "") : "",
    car: o.car, driver: o.driver,
    carId: o.carId ? String(o.carId) : "",
    driverId: o.driverId ? String(o.driverId) : "",
    package: o.package || "",
    destination: o.destination || "",
    pickupDate: toIso(o.pickupDate),
    returnDate: toIso(o.returnDate),
    pickupLocation: o.pickupLocation || "",
    totalPrice: o.totalPrice != null ? String(Number(o.totalPrice) || 0) : "",
    overnightNights: String(o.overnightNights ?? 0),
    overtimeHours: String(Number(o.overtimeHours ?? 0)),
    bailout: String(Number(o.bailout ?? 0)),
    status: o.status || "pending",
    notes: o.notes || "",
  })));

  // Shared-field ticks: all OFF by default so every vehicle keeps (and can
  // edit) its own value. Ticking a field copies Vehicle #1's value to all.
  const [synced, setSynced] = useState(() => new Set());
  const toggleSync = (f) => setSynced((prev) => {
    const n = new Set(prev);
    if (n.has(f)) n.delete(f); else n.add(f);
    return n;
  });
  // Effective value: synced fields read from vehicle #1.
  const val = (idx, f) => (idx > 0 && synced.has(f) ? items[0][f] : items[idx][f]);

  const carPrice = (carId) => Number(cars.find((c) => String(c.id) === String(carId))?.price || 0);
  const setItem = (idx, f, v) => setItems((prev) => prev.map((it, i) => {
    if (i !== idx) return it;
    const next = { ...it, [f]: v };
    // Auto-fill price on car pick only when the row is still unpriced.
    if (f === "carId" && v && !(Number(it.totalPrice) > 0)) {
      const days = daysBetween(val(idx, "pickupDate"), val(idx, "returnDate")) || 1;
      next.totalPrice = String(carPrice(v) * days);
    }
    return next;
  }));

  const selectableCars = cars.filter((c) => c.status !== "maintenance");
  const selectableDrivers = drivers.filter((d) => !d.status || d.status === "active");
  const carOptionsFor = (it) => (it.car && !selectableCars.some((c) => c.id === it.car.id) ? [it.car, ...selectableCars] : selectableCars);
  const driverOptionsFor = (it) => (it.driver && !selectableDrivers.some((d) => d.id === it.driver.id) ? [it.driver, ...selectableDrivers] : selectableDrivers);

  // ─── Invoices (one block per distinct invoice on these rows) ──────────
  const invoiceIds = useMemo(() => [...new Set(rows.map((r) => r.invoiceId).filter(Boolean))], [rows]);
  const [invoices, setInvoices] = useState({});      // id → invoice
  const [invForms, setInvForms] = useState({});      // id → { sentDate, paidDate }
  const [invLoading, setInvLoading] = useState(invoiceIds.length > 0);
  const [reissuingId, setReissuingId] = useState(null);
  useEffect(() => {
    if (!invoiceIds.length) return;
    Promise.allSettled(invoiceIds.map((id) => api.invoices.get(id))).then((res) => {
      const map = {}, forms = {};
      res.forEach((r) => {
        if (r.status === "fulfilled" && r.value) {
          map[r.value.id] = r.value;
          forms[r.value.id] = { sentDate: toIso(r.value.sentDate), paidDate: toIso(r.value.paidDate) };
        }
      });
      setInvoices(map); setInvForms(forms); setInvLoading(false);
    });
  }, [invoiceIds]);
  const invDirty = (inv) => {
    const f = invForms[inv.id] || {};
    return f.sentDate !== toIso(inv.sentDate) || f.paidDate !== toIso(inv.paidDate);
  };
  const invPreview = (inv) => {
    const f = invForms[inv.id] || {};
    const sent = f.sentDate || null;
    const due = sent && inv.paymentTermDays != null
      ? new Date(new Date(sent).getTime() + inv.paymentTermDays * 86400000).toISOString()
      : (sent ? inv.dueDate : null);
    return { due, status: invoiceStatusOf({ sentDate: sent, dueDate: due, paidDate: f.paidDate || null, status: val(0, "status") }) };
  };
  async function reissue(inv) {
    if (!confirm(t("invReissueConfirm"))) return;
    setReissuingId(inv.id);
    try {
      const fresh = await api.invoices.reissue(inv.id);
      setInvoices((m) => { const n = { ...m }; delete n[inv.id]; n[fresh.id] = fresh; return n; });
      setInvForms((m) => ({ ...m, [fresh.id]: { sentDate: "", paidDate: "" } }));
      apiCache.invalidate("orders:"); apiCache.invalidate("documents:");
      toast.success(t("invReissued"));
    } catch (e) { toast.error(e.message); }
    finally { setReissuingId(null); }
  }
  const rowsWithoutInvoice = rows.filter((r) => !r.invoiceId);

  // ─── Save / cancel ────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  function validate() {
    const miss = [];
    if (blank(cust.customerName)) miss.push(t("nama"));
    if (cust.customerType === "company" && blank(cust.companyName)) miss.push(t("companyName"));
    items.forEach((_, i) => {
      const lbl = isGroup ? `${t("vehicleN")} #${i + 1} ` : "";
      for (const [f, key] of [["carId", "car"], ["driverId", "driver"], ["package", "paket"], ["destination", "tujuan"], ["pickupDate", "pickupDate"], ["returnDate", "returnDate"]]) {
        if (blank(val(i, f))) miss.push(`${lbl}${t(key)}`);
      }
      const d = daysBetween(val(i, "pickupDate"), val(i, "returnDate"));
      if (val(i, "pickupDate") && val(i, "returnDate") && d == null) miss.push(`${lbl}${t("returnDate")} ≥ ${t("pickupDate")}`);
    });
    for (const inv of Object.values(invoices)) {
      const f = invForms[inv.id] || {};
      if (f.paidDate && !f.sentDate) miss.push(`${inv.invoiceNumber}: ${t("invPaidNeedsSent")}`);
    }
    return miss;
  }

  function buildPayload(force = false) {
    return {
      customer: {
        customerName: cust.customerName.trim(),
        customerType: cust.customerType,
        companyName: cust.customerType === "company" ? cust.companyName.trim() : null,
        customerPhone: cust.customerPhone.trim() || null,
      },
      items: items.map((it, i) => ({
        orderId: it.orderId,
        carId: val(i, "carId") ? Number(val(i, "carId")) : null,
        driverId: val(i, "driverId") ? Number(val(i, "driverId")) : null,
        package: val(i, "package"),
        destination: val(i, "destination"),
        pickupDate: val(i, "pickupDate"),
        returnDate: val(i, "returnDate"),
        pickupLocation: val(i, "pickupLocation"),
        totalPrice: val(i, "totalPrice") === "" ? null : Number(val(i, "totalPrice")),
        overnightNights: Number(val(i, "overnightNights")) || 0,
        overtimeHours: Number(val(i, "overtimeHours")) || 0,
        bailout: Number(val(i, "bailout")) || 0,
        status: val(i, "status"),
        notes: val(i, "notes"),
      })),
      ...(force ? { force: true } : {}),
    };
  }

  async function handleSave() {
    if (saving) return;
    const miss = validate();
    if (miss.length) { toast.error(`${t("requiredMissing")}: ${miss.join(", ")}`); return; }
    setSaving(true);
    try {
      // Invoices first — if one fails, the order edit is not applied either.
      for (const inv of Object.values(invoices)) {
        if (!invDirty(inv)) continue;
        const f = invForms[inv.id];
        await api.invoices.update(inv.id, { sentDate: f.sentDate || null, paidDate: f.paidDate || null });
      }
      try {
        await api.orders.updateBooking(buildPayload());
      } catch (err) {
        if (err?.status === 409 && err?.body?.code === "SCHEDULE_CONFLICT") {
          const list = (err.body.conflicts || []).map((c) => `• ${c}`).join("\n");
          if (!confirm(t("scheduleConflictConfirm").replace("{list}", list))) return;
          await api.orders.updateBooking(buildPayload(true));
        } else {
          throw err;
        }
      }
      apiCache.invalidate("orders:"); apiCache.invalidate("documents:");
      toast.success(`${t("bookingSaved")} — ${first.orderNumber}`);
      onSaved?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const cancellable = rows.some((r) => !["completed", "cancelled"].includes(r.status));
  async function handleCancelOrder() {
    if (!confirm(t("cancelBookingConfirm"))) return;
    setCancelling(true);
    try {
      if (isGroup) await api.orders.cancelBooking(first.orderNumber);
      else await api.orders.updateStatus(first.id, "cancelled");
      apiCache.invalidate("orders:");
      toast.success(t("bookingCancelled"));
      onSaved?.();
    } catch (e) { toast.error(e.message); }
    finally { setCancelling(false); }
  }

  // ─── Render helpers ───────────────────────────────────────────────────
  // Checkbox only (no text); tooltip explains it. Shown on Vehicle #1 of a group.
  const Label = ({ idx, f, children, req }) => (
    <div className="flex items-center gap-1.5 mb-1 h-[18px] min-w-0">
      <span className="text-[11px] font-semibold text-slate-600 truncate">{children}{req && <span className="text-red-500"> *</span>}</span>
      {isGroup && idx === 0 && f && (
        <input type="checkbox" checked={synced.has(f)} onChange={() => toggleSync(f)}
          title={t("syncAllHint")} aria-label={t("syncAllHint")}
          className="ml-auto cursor-pointer h-3.5 w-3.5 flex-shrink-0 accent-[var(--color-primary,#DC2626)]" />
      )}
    </div>
  );
  const inp = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-500";
  const locked = (idx, f) => idx > 0 && synced.has(f);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {t("editBooking")} — <span className="font-mono text-primary">{first.orderNumber}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{rows.length} {t("vehicles")} · {t("mandatoryNote")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body (vertical scroll only) */}
        <div className="p-5 space-y-5 overflow-y-auto overflow-x-hidden">
          {/* Customer */}
          <section>
            <h3 className="text-sm font-bold text-slate-800 mb-2">{t("sectionCustomer")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div><Label req>{t("nama")}</Label>
                <input className={inp} value={cust.customerName} onChange={(e) => setC("customerName", e.target.value)} /></div>
              <div><Label req>{t("customerType")}</Label>
                <select className={inp} value={cust.customerType} onChange={(e) => { setC("customerType", e.target.value); if (e.target.value === "private") setC("companyName", ""); }}>
                  <option value="private">{t("private")}</option>
                  <option value="company">{t("company")}</option>
                </select></div>
              <div><Label req={cust.customerType === "company"}>{t("companyName")}</Label>
                <input className={inp} list="bem-company-list" value={cust.companyName} disabled={cust.customerType !== "company"}
                  onChange={(e) => setC("companyName", e.target.value)} placeholder={cust.customerType === "company" ? "" : "-"} autoComplete="off" />
                <datalist id="bem-company-list">{companies.map((n) => <option key={n} value={n} />)}</datalist></div>
              <div><Label>{t("phone")}</Label>
                <input className={inp} value={cust.customerPhone} onChange={(e) => setC("customerPhone", e.target.value)} /></div>
            </div>
          </section>

          {/* Vehicles */}
          <section>
            <h3 className="text-sm font-bold text-slate-800 mb-2">{t("sectionTripVehicles")}</h3>
            <div className="space-y-3">
              {items.map((it, idx) => {
                const days = daysBetween(val(idx, "pickupDate"), val(idx, "returnDate"));
                return (
                  <div key={it.orderId} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                    {isGroup && (
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-xs font-bold text-slate-600">
                          {t("vehicleN")} #{idx + 1}{it.label && <span className="ml-2 font-normal text-slate-400">{it.label}</span>}
                        </p>
                        {idx === 0 && (
                          <span className="text-[10px] text-slate-400 inline-flex items-center gap-1">
                            <span className="inline-block h-3 w-3 border border-slate-400 rounded-sm" />= {t("syncAllHint")}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Required */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div><Label req>{t("car")}</Label>
                        <select className={inp} value={it.carId} onChange={(e) => setItem(idx, "carId", e.target.value)}>
                          <option value="">{t("noCarOpt")}</option>
                          {carOptionsFor(it).map((c) => (
                            <option key={c.id} value={c.id}>{`${c.brand || ""} ${c.name || ""}`.trim()}{c.licensePlate ? ` (${c.licensePlate})` : ""}</option>
                          ))}
                        </select></div>
                      <div><Label req>{t("driver")}</Label>
                        <select className={inp} value={it.driverId} onChange={(e) => setItem(idx, "driverId", e.target.value)}>
                          <option value="">{t("noDriverOpt")}</option>
                          {driverOptionsFor(it).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select></div>
                      <div><Label idx={idx} f="package" req>{t("paket")}</Label>
                        <input className={inp} list="bem-paket" value={val(idx, "package")} disabled={locked(idx, "package")}
                          onChange={(e) => setItem(idx, "package", e.target.value)} />
                      </div>
                      <div><Label idx={idx} f="destination" req>{t("tujuan")}</Label>
                        <input className={inp} value={val(idx, "destination")} disabled={locked(idx, "destination")}
                          onChange={(e) => setItem(idx, "destination", e.target.value)} /></div>
                      <div><Label idx={idx} f="pickupDate" req>{t("pickupDate")}</Label>
                        <input type="date" className={inp} value={val(idx, "pickupDate")} disabled={locked(idx, "pickupDate")}
                          onChange={(e) => setItem(idx, "pickupDate", e.target.value)} /></div>
                      <div><Label idx={idx} f="returnDate" req>{t("returnDate")}{days ? <span className="font-normal text-slate-400"> · {days} {t("days")}</span> : null}</Label>
                        <input type="date" className={inp} value={val(idx, "returnDate")} disabled={locked(idx, "returnDate")}
                          onChange={(e) => setItem(idx, "returnDate", e.target.value)} /></div>
                    </div>
                    {/* Optional */}
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-3 mb-1">{t("sectionOptional")}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div><Label idx={idx} f="totalPrice">{t("kontrakHarga")}</Label>
                        <input type="number" min="0" step="any" className={inp} value={val(idx, "totalPrice")} disabled={locked(idx, "totalPrice")}
                          onChange={(e) => setItem(idx, "totalPrice", e.target.value)} /></div>
                      <div><Label idx={idx} f="pickupLocation">{t("pickupLocation")}</Label>
                        <input className={inp} value={val(idx, "pickupLocation")} disabled={locked(idx, "pickupLocation")}
                          onChange={(e) => setItem(idx, "pickupLocation", e.target.value)} /></div>
                      <div><Label idx={idx} f="overnightNights">{t("inap")}</Label>
                        <input type="number" min="0" className={inp} value={val(idx, "overnightNights")} disabled={locked(idx, "overnightNights")}
                          onChange={(e) => setItem(idx, "overnightNights", e.target.value)} /></div>
                      <div><Label idx={idx} f="overtimeHours">{t("lembur")}</Label>
                        <input type="number" min="0" step="0.5" className={inp} value={val(idx, "overtimeHours")} disabled={locked(idx, "overtimeHours")}
                          onChange={(e) => setItem(idx, "overtimeHours", e.target.value)} /></div>
                      <div><Label idx={idx} f="bailout">{t("bailout")}</Label>
                        <input type="number" min="0" step="any" className={inp} value={val(idx, "bailout")} disabled={locked(idx, "bailout")}
                          onChange={(e) => setItem(idx, "bailout", e.target.value)} /></div>
                      <div><Label idx={idx} f="status">{t("status")}</Label>
                        <select className={inp} value={val(idx, "status")} disabled={locked(idx, "status")}
                          onChange={(e) => setItem(idx, "status", e.target.value)}>
                          {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
                        </select></div>
                      <div className="sm:col-span-2 lg:col-span-3"><Label idx={idx} f="notes">{t("description")}</Label>
                        <textarea rows="2" className={inp} value={val(idx, "notes")} disabled={locked(idx, "notes")}
                          onChange={(e) => setItem(idx, "notes", e.target.value)} /></div>
                    </div>
                  </div>
                );
              })}
              <datalist id="bem-paket">{PACKAGES.map((p) => <option key={p} value={p} />)}</datalist>
            </div>
          </section>

          {/* Invoice */}
          <section>
            <h3 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-primary">receipt</span>{t("invoiceSection")}
            </h3>
            {invLoading && <p className="text-xs text-slate-400">{t("loadingShort")}</p>}
            {!invLoading && Object.values(invoices).map((inv) => {
              const pv = invPreview(inv);
              const f = invForms[inv.id] || {};
              return (
                <div key={inv.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 mb-3">
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <span className="text-xs text-slate-500">
                      {inv.orderNumbers?.length > 1 && <>{t("invCovers")}: <b className="font-mono text-slate-700">{inv.orderNumbers.join(", ")}</b></>}
                    </span>
                    {pv.status && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INVOICE_STATUS_CLASS[pv.status] || ""}`}>{t(INVOICE_STATUS_KEY[pv.status])}</span>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div><Label>{t("noInvoice")} ({t("auto")})</Label>
                      <input className={`${inp} font-mono`} value={inv.invoiceNumber || ""} disabled /></div>
                    <div><Label>{t("tglKirimInvoice")}</Label>
                      <input type="date" className={inp} value={f.sentDate || ""}
                        onChange={(e) => setInvForms((m) => ({ ...m, [inv.id]: { ...m[inv.id], sentDate: e.target.value } }))} /></div>
                    <div><Label>{t("tglDueDateInvoice")} ({t("auto")})</Label>
                      <input className={inp} value={pv.due ? formatDate(pv.due) : "-"} disabled /></div>
                    <div><Label>{t("tglRealisasi")}</Label>
                      <input type="date" className={inp} value={f.paidDate || ""} disabled={!f.sentDate}
                        onChange={(e) => setInvForms((m) => ({ ...m, [inv.id]: { ...m[inv.id], paidDate: e.target.value } }))} /></div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                    <p className="text-[11px] text-slate-400">{t("invTermNote").replace("{n}", inv.paymentTermDays ?? "-")}</p>
                    {!inv.paidDate && inv.sentDate && (
                      <button type="button" onClick={() => reissue(inv)} disabled={reissuingId === inv.id}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60 cursor-pointer">
                        {reissuingId === inv.id ? t("loadingShort") : t("invReissue")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {!invLoading && rowsWithoutInvoice.length > 0 && (
              <div className="rounded-lg border border-dashed border-slate-200 p-3 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-slate-500">{t("invNoneForCodes")}</span>
                {(() => {
                  const st = invoiceStatusOf({ status: val(0, "status") });
                  return st ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INVOICE_STATUS_CLASS[st]}`}>{t(INVOICE_STATUS_KEY[st])}</span> : null;
                })()}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-slate-100 flex-shrink-0">
          <div>
            {cancellable && (
              <button type="button" onClick={handleCancelOrder} disabled={cancelling || saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 disabled:opacity-60 cursor-pointer">
                <span className="material-symbols-outlined text-[18px]">block</span>{t("cancelBookingBtn")}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50 cursor-pointer">{t("cancel")}</button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-2">
              {saving && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {saving ? t("savingShort") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
