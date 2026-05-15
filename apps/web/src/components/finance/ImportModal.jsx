import { useState } from "react";
import { api } from "../../lib/api";

const XLSX_CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = XLSX_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Gagal memuat pustaka Excel. Periksa koneksi internet."));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

/** Parse an Indonesian-formatted number string.
 *  Handles: "Rp625.000" → "625000", "Rp4.125.000,50" → "4125000.50",
 *  plain integers/decimals pass through unchanged.
 */
function parseIdNumber(raw) {
  if (!raw) return "0";
  let v = raw.replace(/^Rp/i, "").trim();
  if (!v) return "0";
  // If comma is present it is the decimal separator (Indonesian/Dutch style)
  if (v.includes(",")) {
    v = v.replace(/\./g, "").replace(",", ".");
  } else {
    // All dots are thousand separators — strip them
    v = v.replace(/\./g, "");
  }
  const clean = v.replace(/[^0-9.-]/g, "");
  return clean || "0";
}

function parseCSV(text) {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.trim().split("\n");
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ""));

  return lines.slice(1).map(line => {
    if (!line.trim()) return null;
    // Quoted-field aware split
    const vals = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; continue; }
      if (line[i] === sep[0] && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += line[i];
    }
    vals.push(cur.trim());

    const obj = {};
    headers.forEach((h, i) => {
      const key = h.toLowerCase().trim();
      if (key === "tanggal" || key === "date") obj.tanggal = vals[i];
      else if (key === "bulan" || key === "month" || key === "bln") obj.bulan = vals[i];
      else if (key === "deskripsi" || key === "description") obj.deskripsi = vals[i];
      else if (key === "kategori" || key === "category") obj.kategori = vals[i];
      else if (key === "debit") obj.debit = parseIdNumber(vals[i]);
      else if (key === "kredit" || key === "credit") obj.kredit = parseIdNumber(vals[i]);
      else if (key === "referensi" || key === "reference" || key === "ref") obj.referensi = vals[i];
    });
    return obj;
  }).filter(r => r && (r.tanggal || r.date) && (r.deskripsi || r.description));
}

async function parseXlsx(file) {
  const XLSX = await loadXlsx();
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });

  return raw.map(r => {
    const get = (...keys) => {
      for (const k of keys) {
        const match = Object.keys(r).find(rk => rk.toLowerCase().trim() === k.toLowerCase());
        if (match !== undefined && r[match] !== "") return r[match];
      }
      return "";
    };
    const debitRaw = get("debit");
    const kreditRaw = get("kredit", "credit");
    const tanggalRaw = get("tanggal", "date");

    let tanggal = "";
    if (tanggalRaw instanceof Date) {
      tanggal = tanggalRaw.toISOString().split("T")[0];
    } else if (typeof tanggalRaw === "number") {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(tanggalRaw);
      tanggal = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    } else {
      tanggal = String(tanggalRaw);
    }

    return {
      tanggal,
      bulan: get("bulan", "month"),
      deskripsi: get("deskripsi", "description"),
      kategori: get("kategori", "category"),
      debit: typeof debitRaw === "number" ? String(debitRaw) : String(debitRaw).replace(/[^0-9.-]/g, "") || "0",
      kredit: typeof kreditRaw === "number" ? String(kreditRaw) : String(kreditRaw).replace(/[^0-9.-]/g, "") || "0",
      referensi: get("referensi", "reference", "ref"),
    };
  }).filter(r => r.tanggal && r.deskripsi);
}

async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "json") {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  if (ext === "xlsx" || ext === "xls") {
    return parseXlsx(file);
  }
  // csv / txt / tsv
  const text = await file.text();
  return parseCSV(text);
}

function calcBalance(rows) {
  let debit = 0, credit = 0;
  for (const r of rows) {
    debit += Number((r.debit || "0").toString().replace(/[^0-9.-]/g, "")) || 0;
    credit += Number((r.kredit || r.credit || "0").toString().replace(/[^0-9.-]/g, "")) || 0;
  }
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 };
}

export default function ImportModal({ onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState(null);
  const [balanceInfo, setBalanceInfo] = useState(null);

  const fmt = v => Number(v || 0).toLocaleString("id-ID");

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setParsing(true);
    try {
      const parsed = await parseFile(f);
      setRows(parsed);
      setBalanceInfo(calcBalance(parsed));
    } catch (err) {
      setResult({ error: `Gagal membaca file: ${err.message}` });
      setRows([]);
      setBalanceInfo(null);
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!file || !rows.length) return;
    setLoading(true);
    try {
      const mapped = rows.map(r => ({
        tanggal: r.tanggal || r.entryDate || r.date,
        bulan: r.bulan || r.month,
        deskripsi: r.deskripsi || r.description,
        kategori: r.kategori || r.category,
        debit: r.debit,
        kredit: r.kredit || r.credit,
        referensi: r.referensi || r.reference || r.ref,
      }));

      const res = await api.journal.import(mapped);
      setResult(res);
      if (res.imported > 0) setTimeout(() => { onSuccess?.(); onClose(); }, 1800);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  }

  const preview = rows.slice(0, 8);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Import Data Jurnal</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Format info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
            <p className="font-semibold mb-1">Format yang didukung: CSV, XLSX (Excel), JSON, TXT</p>
            <p>Kolom wajib: <b>Tanggal, Deskripsi, Kategori</b>. Opsional: Bulan, Debit, Kredit, Referensi</p>
            <p className="mt-1 text-blue-600">Tip: untuk entri double-entry yang seimbang, pastikan jumlah total Debit = total Kredit.</p>
          </div>

          {/* File picker */}
          <label className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
            <span className="material-symbols-outlined text-slate-400 text-[32px] mb-2">cloud_upload</span>
            <span className="text-sm text-slate-500 font-medium">
              {parsing ? "Membaca file..." : file ? file.name : "Klik untuk pilih file"}
            </span>
            <span className="text-xs text-slate-400 mt-1">CSV, XLSX, JSON, TXT</span>
            <input type="file" onChange={handleFile} className="hidden" accept=".csv,.json,.xlsx,.xls,.txt" />
          </label>

          {/* Balance indicator */}
          {balanceInfo && rows.length > 0 && (
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${
              balanceInfo.balanced
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-amber-50 border-amber-300 text-amber-800"
            }`}>
              <span className="material-symbols-outlined text-[20px]">
                {balanceInfo.balanced ? "check_circle" : "warning"}
              </span>
              <div className="flex-1 text-xs">
                <p className="font-semibold">
                  {balanceInfo.balanced ? "Jurnal Seimbang ✓" : "Jurnal Tidak Seimbang ⚠"}
                </p>
                <p className="mt-0.5">
                  Total Debit: <b>Rp{fmt(balanceInfo.debit)}</b> —
                  Total Kredit: <b>Rp{fmt(balanceInfo.credit)}</b>
                  {!balanceInfo.balanced && (
                    <span className="ml-1 text-amber-700 font-medium">
                      (Selisih: Rp{fmt(Math.abs(balanceInfo.debit - balanceInfo.credit))})
                    </span>
                  )}
                </p>
                {!balanceInfo.balanced && (
                  <p className="mt-1 text-amber-700">Data akan tetap diimport, namun pastikan kolom Debit dan Kredit sudah benar.</p>
                )}
              </div>
            </div>
          )}

          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">
                Preview ({preview.length} dari {rows.length} baris)
              </p>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-slate-500 border-b">
                    <th className="px-3 py-2 text-left">Tanggal</th>
                    <th className="px-3 py-2 text-left">Deskripsi</th>
                    <th className="px-3 py-2 text-left">Kategori</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Kredit</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 whitespace-nowrap">{r.tanggal}</td>
                        <td className="px-3 py-1.5 max-w-[160px] truncate">{r.deskripsi || r.description}</td>
                        <td className="px-3 py-1.5">{r.kategori || r.category}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmt(r.debit)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmt(r.kredit || r.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {rows.length > 8 && (
                    <tfoot><tr>
                      <td colSpan={5} className="px-3 py-2 text-center text-xs text-slate-400 bg-slate-50">
                        + {rows.length - 8} baris lainnya tidak ditampilkan
                      </td>
                    </tr></tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`p-4 rounded-lg text-sm ${result.error ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
              {result.error ? (
                <p className="font-medium">{result.error}</p>
              ) : (
                <div>
                  <p className="font-semibold">Import selesai: {result.imported} berhasil{result.skipped ? `, ${result.skipped} dilewati` : ""}.</p>
                  {result.balanceWarning && (
                    <p className="mt-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                      {result.balanceWarning}
                    </p>
                  )}
                  {result.skipped > 0 && result.errors?.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs cursor-pointer text-slate-500">Lihat detail entri yang dilewati</summary>
                      <ul className="mt-1 text-xs text-slate-600 space-y-0.5 pl-3">
                        {result.errors.slice(0, 5).map((e, i) => (
                          <li key={i}>• {e.reason}</li>
                        ))}
                        {result.errors.length > 5 && <li>... dan {result.errors.length - 5} lainnya</li>}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
            Batal
          </button>
          <button onClick={handleImport}
            disabled={!file || !rows.length || loading || parsing}
            className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer flex items-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {loading ? "Mengimport..." : `Import ${rows.length} Baris`}
          </button>
        </div>
      </div>
    </div>
  );
}
