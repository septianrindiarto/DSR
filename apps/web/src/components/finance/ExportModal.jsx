import { useState } from "react";

export default function ExportModal({ onClose, periodParams }) {
  const [report, setReport] = useState("journal");
  const [format, setFormat] = useState("csv");
  const [loading, setLoading] = useState(false);

  const REPORTS = [
    { value: "journal", label: "Jurnal Umum" },
    { value: "ledger", label: "Buku Besar" },
    { value: "trial-balance", label: "Neraca Saldo" },
    { value: "income-statement", label: "Laba Rugi" },
    { value: "cash-flow", label: "Arus Kas" },
    { value: "balance-sheet", label: "Neraca" },
  ];

  async function handleExport() {
    setLoading(true);
    try {
      const base = "http://localhost:5000";
      let url;
      if (report === "journal") {
        url = `${base}/api/journal/export?format=${format}&${periodParams}`;
      } else {
        url = `${base}/api/journal/reports/${report}?${periodParams}`;
      }
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Export gagal");

      if (format === "csv" && report === "journal") {
        const text = await res.text();
        const blob = new Blob([text], { type: "text/csv" });
        downloadBlob(blob, `${report}.csv`);
      } else {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        downloadBlob(blob, `${report}.json`);
      }
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Export Laporan</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Pilih Laporan</label>
            <select value={report} onChange={e => setReport(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
              {REPORTS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Format</label>
            <div className="flex gap-2">
              {["csv", "json"].map(f => (
                <button key={f} onClick={() => setFormat(f)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border cursor-pointer transition-colors ${
                    format === f ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}>{f.toUpperCase()}</button>
              ))}
            </div>
            {report !== "journal" && format === "csv" && (
              <p className="text-xs text-amber-600 mt-1">* CSV hanya tersedia untuk Jurnal Umum. Laporan lain akan diekspor sebagai JSON.</p>
            )}
          </div>
        </div>
        <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">Batal</button>
          <button onClick={handleExport} disabled={loading} className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
            {loading ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
