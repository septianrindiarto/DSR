// Invoice status — derived, mirrors apps/api/src/services/invoice.service.js.
//   Belum Dikirim  order finished, invoice not sent
//   Pending        sent, unpaid, within payment term
//   Overdue        sent, unpaid, past due date
//   Paid           Tgl Realisasi filled
// Accepts an order row (invoiceSentDate/…) or an invoice record (sentDate/…).
export function invoiceStatusOf(x, now = new Date()) {
  if (!x) return null;
  if (x.isCancelled) return "Dibatalkan";
  const sent = x.sentDate ?? x.invoiceSentDate;
  const due = x.dueDate ?? x.invoiceDueDate;
  const paid = x.paidDate ?? x.invoicePaidDate;
  // Legacy rows synced from Rekap.xlsx may carry "Paid" without a date.
  if (paid || String(x.invoicePaymentStatus || "").toLowerCase() === "paid") return "Paid";
  if (sent) {
    if (due && new Date(due).getTime() < now.getTime()) return "Overdue";
    return "Pending";
  }
  const st = x.orderStatus ?? x.status;
  if (st === "completed") return "Belum Dikirim";
  return null;
}

export const INVOICE_STATUS_CLASS = {
  Paid: "bg-emerald-100 text-emerald-700",
  Pending: "bg-amber-100 text-amber-700",
  Overdue: "bg-red-100 text-red-700",
  "Belum Dikirim": "bg-slate-100 text-slate-600",
  Dibatalkan: "bg-slate-100 text-slate-400 line-through",
};

// i18n key per status (labels live in id.js / en.js).
export const INVOICE_STATUS_KEY = {
  Paid: "invStatusPaid",
  Pending: "invStatusPending",
  Overdue: "invStatusOverdue",
  "Belum Dikirim": "invStatusNotSent",
  Dibatalkan: "invStatusCancelled",
};
