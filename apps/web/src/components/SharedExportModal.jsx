import { useState } from "react";
import { useToast } from "./Toast";

const EXPORT_FORMATS = [
  { key: "xlsx", label: "Excel (.xlsx)", ext: "xlsx", icon: "table_view",    desc: "Buka langsung di Microsoft Excel" },
  { key: "csv",  label: "CSV (.csv)",    ext: "csv",  icon: "description",   desc: "Kompatibel dengan semua spreadsheet" },
  { key: "json", label: "JSON (.json)",  ext: "json", icon: "data_object",   desc: "Untuk keperluan integrasi / developer" },
];

/**
 * Generic export modal — follows the Finance ExportModal pattern.
 *
 * Props:
 *   title      — Modal heading, e.g. "Export Data Pelanggan"
 *   exportFn   — async (format: string) => void
 *                  Receives the chosen format key ("xlsx"|"csv"|"json").
 *                  Caller is responsible for fetching data, serializing, and downloading.
 *   onClose    — Close the modal
 */
export default function SharedExportModal({ title = "Export Data", exportFn, onClose }) {
  const toast = useToast();
  const [format, setFormat] = useState("xlsx");
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      await exportFn(format);
      onClose();
    } catch (err) {
      toast.error("Export gagal: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Pilih format file untuk diunduh</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Format picker */}
        <div className="p-5 space-y-2">
          {EXPORT_FORMATS.map(f => {
            const checked = format === f.key;
            return (
              <label
                key={f.key}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  checked
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={f.key}
                  checked={checked}
                  onChange={() => setFormat(f.key)}
                  className="cursor-pointer"
                />
                <span className={`material-symbols-outlined text-[22px] ${checked ? "text-primary" : "text-slate-400"}`}>
                  {f.icon}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium text-slate-800">{f.label}</span>
                  <span className="block text-xs text-slate-500">{f.desc}</span>
                </span>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-slate-200 bg-white rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Batal
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">file_download</span>
                Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
