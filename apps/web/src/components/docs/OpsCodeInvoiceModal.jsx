// ─── Dokumen → Invoice: bill approved lembur / operasional forms by code ─────
// Codes L### (lembur) and R### (operasional) come from Kontrak & Perusahaan →
// Lembur & Operasional, approved by BOTH agency and client. "Isi ke invoice"
// fills the printable invoice; "Buat invoice" records it (Tgl Kirim → due
// date + Books) and marks the forms billed. Using the M invoice number adds
// the lines to that monthly invoice (billing mode A).
import { useState } from "react";
import { api, apiCache } from "../../lib/api";
import { useToast } from "../Toast";
import AsyncButton from "../AsyncButton";

const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const inp = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white";

export default function OpsCodeInvoiceModal({ invoiceNo, date, onFill, onClose }) {
  const toast = useToast();
  const [codes, setCodes] = useState("");
  const [prev, setPrev] = useState(null);
  const [no, setNo] = useState(invoiceNo || "");
  const [sent, setSent] = useState(date || "");

  async function load() {
    setPrev(null);
    try { setPrev(await api.ops.billingLines(codes)); } catch (e) { toast.error(e.message); }
  }
  function fill() {
    onFill(prev);
    toast.success(`${prev.lines.length} baris diisi ke invoice.`);
  }
  async function issue() {
    if (!confirm(`Buat invoice ${no} untuk ${prev.codes.join(", ")} (${rp(prev.total)})? Formulir ditandai "Ditagih".`)) return;
    try {
      const r = await api.ops.billingIssue({ codes: prev.codes, invoiceNumber: no, sentDate: sent || null });
      apiCache.invalidate("orders:"); apiCache.invalidate("documents:"); apiCache.invalidate("ops:");
      onFill(prev);
      toast.success(`Invoice ${r.invoiceNumber} dibuat untuk ${r.codes.length} kode (${rp(r.total)}).`);
      onClose();
    } catch (e) { toast.error(e.message); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Tagih lembur / operasional (kode L / R)</h3>
          <button onClick={onClose} className="text-slate-400 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        <p className="text-xs text-slate-500">Masukkan kode formulir yang sudah disetujui agency dan klien, pisahkan dengan koma. Satu invoice = satu kontrak. Isi No. invoice bulanan (M) untuk menggabungkan ke tagihan bulanan.</p>
        <div className="flex gap-2">
          <input className={inp} value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="L001, L002, R001" onKeyDown={(e) => e.key === "Enter" && load()} />
          <AsyncButton onClick={load} disabled={!codes.trim()} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium cursor-pointer whitespace-nowrap">Ambil data</AsyncButton>
        </div>
        {prev && (
          <>
            <p className="text-sm"><b>{prev.contractNumber}</b> · {prev.clientName}</p>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                  <th className="px-3 py-2 text-left">Kode</th><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-left">Uraian</th>
                  <th className="px-3 py-2 text-left">Unit / driver</th><th className="px-3 py-2 text-right">Nominal</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{prev.lines.map((l) => (
                  <tr key={l.code}><td className="px-3 py-1.5 font-mono text-xs font-bold text-primary">{l.code}</td><td className="px-3 py-1.5 text-xs">{l.entryDate}</td>
                    <td className="px-3 py-1.5">{l.description}</td><td className="px-3 py-1.5 text-xs">{[l.unit, l.plate, l.driver].filter(Boolean).join(" · ") || "-"}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{rp(l.amount)}</td></tr>
                ))}</tbody>
                <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={4} className="px-3 py-2">Total</td><td className="px-3 py-2 text-right font-mono">{rp(prev.total)}</td></tr></tfoot>
              </table>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-600">No. invoice<input className={inp} value={no} onChange={(e) => setNo(e.target.value)} /></label>
              <label className="block text-xs font-semibold text-slate-600">Tgl Kirim (opsional)<input type="date" className={inp} value={sent} onChange={(e) => setSent(e.target.value)} /></label>
            </div>
            <div className="flex justify-end gap-2 flex-wrap">
              <button onClick={fill} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium cursor-pointer">Isi ke invoice (cetak saja)</button>
              <AsyncButton onClick={issue} disabled={!no.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium cursor-pointer">Buat invoice & tandai ditagih</AsyncButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
