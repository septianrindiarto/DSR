// ─── Multi-format import/export ────────────────────────────────────────────
// One serialize/parse pair per format. Pages call serialize() to turn a JSON
// array into a downloadable file, and parse() to turn an uploaded file back
// into an array of objects.
//
// Supported formats: json, csv, txt (tab-separated), xml, xlsx
// XLSX is lazy-loaded from CDN on first use so no extra npm install is needed.

export const FORMATS = [
  { key: "xlsx", label: "Excel (.xlsx)", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", icon: "table_view" },
  { key: "csv",  label: "CSV (.csv)",    ext: "csv",  mime: "text/csv;charset=utf-8",         icon: "description" },
  { key: "json", label: "JSON (.json)",  ext: "json", mime: "application/json",                icon: "data_object" },
  { key: "xml",  label: "XML (.xml)",    ext: "xml",  mime: "application/xml",                 icon: "code" },
  { key: "txt",  label: "Text (.txt)",   ext: "txt",  mime: "text/plain;charset=utf-8",        icon: "text_snippet" },
];

export const formatByKey = (key) => FORMATS.find(f => f.key === key);
export const formatByExtension = (filename) => {
  const ext = String(filename || "").split(".").pop().toLowerCase();
  if (ext === "tsv") return formatByKey("txt");
  return FORMATS.find(f => f.ext === ext) || null;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

// Browsers infer file type from the <a download> attribute, so we hand back
// a Blob + filename and let the caller trigger the click.
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Cells in spreadsheet-y formats (csv/tsv/xlsx) need primitives, but our data
// often has nested objects (e.g. `customer: {name: "..."}`). Stringify those
// instead of dropping them; arrays JSON-stringify too.
function flattenCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return v;
}

// Union of keys across all rows — preserves first-seen order, so columns line
// up with how the data was authored even when later rows add new fields.
function collectHeaders(rows) {
  const seen = new Set();
  const headers = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); headers.push(key); }
    }
  }
  return headers;
}

// ─── CSV / TSV ─────────────────────────────────────────────────────────────

function escapeDelim(value, delim) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToDelimited(rows, delim) {
  const headers = collectHeaders(rows);
  const out = [headers.map(h => escapeDelim(h, delim)).join(delim)];
  for (const row of rows) {
    out.push(headers.map(h => escapeDelim(flattenCell(row?.[h]), delim)).join(delim));
  }
  return out.join("\r\n");
}

// Robust delimited parser — handles quoted fields, escaped quotes, CRLF/LF,
// and BOM. Returns an array of objects keyed by the header row.
export function parseDelimited(text, delim) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) { cur.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return [];
  const trim = (s) => String(s ?? "").trim();
  const headers = rows[0].map(trim);
  return rows.slice(1)
    .filter(r => r.length > 0 && r.some(v => trim(v) !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = trim(r[i]); });
      return obj;
    });
}

// CSV that auto-detects "," vs ";" — Indonesian Excel exports save with ";"
function detectCsvDelim(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const firstLine = (text.split(/\r?\n/, 1)[0]) || "";
  let stripped = "", inQ = false;
  for (const c of firstLine) {
    if (c === '"') inQ = !inQ;
    else if (!inQ) stripped += c;
  }
  return ((stripped.match(/;/g) || []).length > (stripped.match(/,/g) || []).length) ? ";" : ",";
}

// ─── XML ───────────────────────────────────────────────────────────────────
// Simple <rows><row><field>...</field></row></rows> shape. Generic enough to
// round-trip our exports and to let users hand-edit if they want.

function escapeXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Tag names can't start with digits or contain odd characters — sanitize so
// header keys like "no.urut" or "1stCol" still produce valid XML.
function safeTag(key) {
  let k = String(key || "field").replace(/[^A-Za-z0-9_-]/g, "_");
  if (!/^[A-Za-z_]/.test(k)) k = "_" + k;
  return k;
}

function rowsToXml(rows) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<rows>"];
  for (const row of rows) {
    lines.push("  <row>");
    if (row && typeof row === "object") {
      for (const key of Object.keys(row)) {
        const v = row[key];
        const tag = safeTag(key);
        const cell = v && typeof v === "object" ? JSON.stringify(v) : v;
        lines.push(`    <${tag}>${escapeXml(cell)}</${tag}>`);
      }
    }
    lines.push("  </row>");
  }
  lines.push("</rows>");
  return lines.join("\n");
}

function parseXmlRows(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const errNode = doc.querySelector("parsererror");
  if (errNode) throw new Error("File XML tidak valid: " + errNode.textContent);
  // Accept either <rows><row>… or any root containing repeated children.
  const rowEls = Array.from(doc.documentElement.children);
  return rowEls.map(rowEl => {
    const obj = {};
    for (const child of Array.from(rowEl.children)) {
      const text = child.textContent;
      // Try to JSON-parse cells that were originally nested objects/arrays —
      // export round-trips this way without forcing the user to know.
      let val = text;
      const t = (text || "").trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try { val = JSON.parse(t); } catch { /* leave as string */ }
      }
      obj[child.tagName] = val;
    }
    return obj;
  });
}

// ─── XLSX ──────────────────────────────────────────────────────────────────
// Lazy-load SheetJS from CDN on first use. Avoids an npm install for users
// who don't pick xlsx, and keeps the main bundle small.

let _xlsxLib = null;
async function loadXlsx() {
  if (_xlsxLib) return _xlsxLib;
  if (typeof window !== "undefined" && window.XLSX) {
    _xlsxLib = window.XLSX; return _xlsxLib;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat library XLSX dari CDN. Periksa koneksi internet."));
    document.head.appendChild(s);
  });
  _xlsxLib = window.XLSX;
  if (!_xlsxLib) throw new Error("Library XLSX tidak tersedia setelah dimuat.");
  return _xlsxLib;
}

async function rowsToXlsxBlob(rows) {
  const XLSX = await loadXlsx();
  const headers = collectHeaders(rows);
  const aoa = [headers, ...rows.map(r => headers.map(h => flattenCell(r?.[h])))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function parseXlsxFile(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return [];
  const ws = wb.Sheets[wsName];
  // defval:"" ensures missing cells appear as empty strings rather than
  // disappearing — keeps column alignment when downstream code expects keys.
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Serialize a JSON-array of rows into a downloadable Blob in the chosen format.
 * Returns { blob, filename } so the caller can trigger the download.
 */
export async function serialize(rows, format, baseName = "export") {
  if (!Array.isArray(rows)) throw new Error("Data harus berupa array.");
  const f = formatByKey(format);
  if (!f) throw new Error(`Format tidak dikenal: ${format}`);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${baseName}-${date}.${f.ext}`;

  let blob;
  switch (format) {
    case "json":
      blob = new Blob([JSON.stringify(rows, null, 2)], { type: f.mime });
      break;
    case "csv": {
      const text = "﻿" + rowsToDelimited(rows, ","); // BOM so Excel detects UTF-8
      blob = new Blob([text], { type: f.mime });
      break;
    }
    case "txt": {
      const text = rowsToDelimited(rows, "\t");
      blob = new Blob([text], { type: f.mime });
      break;
    }
    case "xml":
      blob = new Blob([rowsToXml(rows)], { type: f.mime });
      break;
    case "xlsx":
      blob = await rowsToXlsxBlob(rows);
      break;
    default:
      throw new Error(`Format belum didukung: ${format}`);
  }
  return { blob, filename };
}

/**
 * Parse an uploaded File into an array of objects. If `format` is omitted,
 * we infer from the file extension.
 */
export async function parse(file, format) {
  if (!file) throw new Error("Tidak ada file.");
  const f = format ? formatByKey(format) : formatByExtension(file.name);
  if (!f) throw new Error(`Tidak bisa menentukan format file: ${file.name}`);

  switch (f.key) {
    case "json": {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("File JSON harus berisi array.");
      return data;
    }
    case "csv": {
      const text = await file.text();
      const delim = detectCsvDelim(text);
      return parseDelimited(text, delim);
    }
    case "txt": {
      const text = await file.text();
      // Sniff: tab if any tabs present, otherwise fall back to CSV-style detection
      const delim = text.includes("\t") ? "\t" : detectCsvDelim(text);
      return parseDelimited(text, delim);
    }
    case "xml": {
      const text = await file.text();
      return parseXmlRows(text);
    }
    case "xlsx":
      return parseXlsxFile(file);
    default:
      throw new Error(`Format belum didukung: ${f.key}`);
  }
}

// Convenience: serialize + trigger download in one call.
export async function exportAs(rows, format, baseName) {
  const { blob, filename } = await serialize(rows, format, baseName);
  downloadBlob(filename, blob);
}

// `accept` string for <input type="file"> based on chosen format.
export function acceptForFormat(format) {
  const f = formatByKey(format);
  if (!f) return "";
  // Browsers like both extensions and MIME types in the accept list.
  const exts = f.key === "txt" ? ".txt,.tsv" : `.${f.ext}`;
  return `${exts},${f.mime.split(";")[0]}`;
}

// === Shared formatters (audit H-01) ===
// Drop-in replacements for the per-page formatPrice / formatDate copies that
// drifted across AdminFleet, AdminOrders, CarCard, CarDetail, etc. Use these
// going forward; existing duplicates can be migrated incrementally.

// Full-digit Rupiah for tables and invoices, e.g. "Rp 1.500.000".
export function formatPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Rp 0";
    return "Rp " + n.toLocaleString("id-ID");
}

// Compact Rupiah for cards and badges, e.g. "Rp 1,5jt", "Rp 50rb".
export function formatPriceShort(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Rp 0";
    if (n >= 1_000_000) {
        const m = n / 1_000_000;
        const display = m === Math.floor(m) ? String(Math.floor(m)) : m.toFixed(1).replace(".", ",");
        return "Rp" + display + "jt";
    }
    if (n >= 1000) {
        return "Rp" + Math.round(n / 1000) + "rb";
    }
    return "Rp" + n;
}

// Default locale-aware Indonesian date. Pass opts to override.
export function formatDate(value, opts) {
    if (!value) return "-";
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "-";
    const fmt = opts || { day: "numeric", month: "short", year: "numeric" };
    return d.toLocaleDateString("id-ID", fmt);
}

// "5 Jun 2026 - 7 Jun 2026"
export function formatDateRange(start, end) {
    return formatDate(start) + " - " + formatDate(end);
}

// ISO yyyy-mm-dd for <input type="date"> binding.
export function toIsoDate(value) {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
}
