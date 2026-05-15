import { useState } from "react";
import { parse } from "../lib/dataFormats";

/**
 * Generic import modal — follows the Finance ImportModal pattern.
 *
 * Props:
 *   title      — Modal heading, e.g. "Import Data Pelanggan"
 *   hint       — Short description of expected columns / format
 *   importFn   — async (parsedRows: object[]) => { imported: number, skipped?: number, errors?: any[] }
 *                  Receives fully-parsed rows. Caller handles field-mapping + API call.
 *   onClose    — Close the modal
 *   onSuccess  — Called after a successful import (refresh data, show toast, etc.)
 */
export default function SharedImportModal({ title = "Import Data", hint, importFn, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState(null);

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setParsing(true);
    try {
      const parsed = await parse(f); // auto-detects format from extension
      setRows(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      setResult({ error: `Gagal membaca file: ${err.message}` });
      setRows([]);
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!rows.length) return;
    setLoading(true);
    try {
      const res = await importFn(rows);
      setResult(res);
      if ((res?.imported ?? 0) > 0) {
        setTimeout(() => { onSuccess?.(); onClose(); }, 1800);
      }
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  }

  // Preview: first 8 rows, up to 6 columns
  const preview = rows.slice(0, 8);
  const previewCols = preview.length > 0 ? Object.keys(preview[0]).slice(0, 6) : [];
  const extraCols = preview.length > 0 ? Math.max(0, Object.keys(preview[0]).length - 6) : 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Format hint */}
          {hint && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              <p className="font-semibold mb-0.5">Format yang didukung: XLSX (Excel), CSV, JSON, XML, TXT</p>
              <p>{hint}</p>
            </div>
          )}

          {/* File picker */}
          <label className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
            <span className="material-symbols-outlined text-slate-400 text-[32px] mb-2">cloud_upload</span>
            <span className="text-sm text-slate-500 font-medium">
              {parsing ? "Membaca file..." : file ? file.name : "Klik untuk pilih file"}
            </span>
            <span className="text-xs text-slate-400 mt-1">XLSX, CSV, JSON, XML, TXT</span>
            <input
              type="file"
              onChange={handleFile}
              className="hidden"
              accept=".csv,.json,.xlsx,.xls,.txt,.tsv,.xml"
            />
          </label>

          {/* Preview table */}
          {preview.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">
                Preview ({preview.length} dari {rows.length} baris)
              </p>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 border-b">
                      {previewCols.map(col => (
                        <th key={col} className="px-3 py-2 text-left font-medium whitespace-nowrap">{col}</th>
                      ))}
                      {extraCols > 0 && (
                        <th className="px-3 py-2 text-left text-slate-400 whitespace-nowrap">+{extraCols} kolom</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/40">
                        {previewCols.map(col => (
                          <td key={col} className="px-3 py-1.5 max-w-[140px] truncate text-slate-700">
                            {String(r[col] ?? "")}
                          </td>
                        ))}
                        {extraCols > 0 && <td className="px-3 py-1.5 text-slate-400">…</td>}
                      </tr>
                    ))}
                  </tbody>
                  {rows.length > 8 && (
                    <tfoot>
                      <tr>
                        <td
                          colSpan={previewCols.length + (extraCols > 0 ? 1 : 0)}
                          className="px-3 py-2 text-center text-xs text-slate-400 bg-slate-50"
                        >
                          + {rows.length - 8} baris lainnya tidak ditampilkan
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`p-4 rounded-lg text-sm ${
              result.error
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-green-50 text-green-700 border border-green-200"
            }`}>
              {result.error ? (
                <p className="font-medium">{result.error}</p>
              ) : (
                <div>
                  <p className="font-semibold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    Import selesai: {result.imported} berhasil
                    {result.skipped ? `, ${result.skipped} dilewati` : ""}
                  </p>
                  {result.skipped > 0 && result.errors?.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs cursor-pointer text-slate-500">
                        Lihat detail entri yang dilewati
                      </summary>
                      <ul className="mt-1 text-xs text-slate-600 space-y-0.5 pl-3">
                        {result.errors.slice(0, 5).map((e, i) => (
                          <li key={i}>• {typeof e === "string" ? e : (e.reason || e.message || JSON.stringify(e))}</li>
                        ))}
                        {result.errors.length > 5 && (
                          <li className="text-slate-400">... dan {result.errors.length - 5} lainnya</li>
                        )}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Batal
          </button>
          <button
            onClick={handleImport}
            disabled={!file || !rows.length || loading || parsing}
            className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {loading ? "Mengimport..." : `Import ${rows.length} Baris`}
          </button>
        </div>
      </div>
    </div>
  );
}
