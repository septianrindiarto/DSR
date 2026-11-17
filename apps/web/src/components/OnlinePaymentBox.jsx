// ─── OnlinePaymentBox — Xendit payment link for one invoice (agency side) ───
// Create / reuse the active link, copy it, share via WhatsApp/email, and (dev
// mock mode) simulate a payment. A paid link records the payment itself —
// the invoice panel refreshes through onPaid().
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./Toast";
import { useLanguage } from "../context/LanguageContext";

const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;
const fmt = (d) => (d ? new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

export default function OnlinePaymentBox({ invoice, onPaid }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api.invoices.paymentLinks(invoice.id).then((r) => setLinks(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => {
    api.payments.status().then(setCfg).catch(() => setCfg({ enabled: false }));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);
  if (!cfg?.enabled || invoice.paidDate || invoice.isCancelled) return null;
  const active = links.find((l) => l.status === "pending" && (!l.expiresAt || new Date(l.expiresAt) > new Date()));
  const lastPaid = links.find((l) => l.status === "paid");

  async function create() {
    setBusy(true);
    try { await api.invoices.createPaymentLink(invoice.id); await load(); toast.success(t("pay_linkCreated")); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function simulate(l) {
    setBusy(true);
    try { await api.payments.simulate(l.id); toast.success(t("pay_simulated")); await load(); onPaid?.(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  const copy = (url) => navigator.clipboard?.writeText(url).then(() => toast.success(t("pay_copied")));
  const waText = (l) => encodeURIComponent(t("pay_waText", { no: invoice.invoiceNumber, amount: rp(l.amount), url: l.url }));

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-bold text-blue-900 inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">qr_code_2</span>{t("pay_title")}
          {cfg.mock && <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px]">{t("pay_mock")}</span>}
        </span>
        {!invoice.sentDate ? <span className="text-slate-500">{t("payNeedsSent")}</span> : (
          <button type="button" onClick={create} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 cursor-pointer">
            {active ? t("pay_newLink") : t("pay_createLink")}
          </button>
        )}
      </div>
      {active && (
        <div className="mt-2 space-y-1.5">
          <p className="text-slate-700">{t("pay_activeInfo", { amount: rp(active.amount), until: fmt(active.expiresAt) })}</p>
          {active.url ? (
            <div className="flex gap-1.5 flex-wrap">
              <input readOnly value={active.url} className="flex-1 min-w-[220px] px-2 py-1.5 border border-slate-200 rounded bg-white font-mono" />
              <button type="button" onClick={() => copy(active.url)} className="px-2 py-1.5 rounded border border-slate-200 bg-white cursor-pointer">{t("pay_copy")}</button>
              <a href={`https://wa.me/?text=${waText(active)}`} target="_blank" rel="noreferrer" className="px-2 py-1.5 rounded border border-emerald-200 bg-white text-emerald-700">WhatsApp</a>
            </div>
          ) : cfg.mock && (
            <button type="button" onClick={() => simulate(active)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white font-medium cursor-pointer disabled:opacity-60">{t("pay_simulate")}</button>
          )}
        </div>
      )}
      {lastPaid && <p className="mt-2 text-emerald-700">{t("pay_lastPaid", { amount: rp(lastPaid.paidAmount), at: fmt(lastPaid.paidAt), channel: lastPaid.channel || "-" })}</p>}
    </div>
  );
}
