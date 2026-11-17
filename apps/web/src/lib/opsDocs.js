// Dokumen → lembur & SPPD document types (see components/docs/OpsDocs.jsx).
export const OPS_DOC_TYPES = [
  { id: "spkl", label: "Form Lembur", icon: "schedule", desc: "Surat perintah + laporan hasil kerja lembur" },
  { id: "sppd", label: "Form Perjalanan Dinas", icon: "flight_takeoff", desc: "Surat perintah perjalanan dinas" },
  { id: "rekap_lembur", label: "Rekap Lembur", icon: "more_time", desc: "Lampiran invoice — upah lembur per driver" },
  { id: "rekap_sppd", label: "Rekap Perjalanan Dinas", icon: "luggage", desc: "Lampiran invoice — A4 landscape" },
];
export const OPS_LANDSCAPE = new Set(["rekap_sppd"]);

const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
export function opsDefaultForm() {
  return { contractId: "", period: todayISO().slice(0, 7), recapId: "", entryId: "", onlyApproved: false, city: "", date: todayISO(), invoiceNo: "", loaded: null };
}
