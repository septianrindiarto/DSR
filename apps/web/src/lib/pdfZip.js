// ─── PDF + ZIP helpers for Dokumen bulk invoices (owner 2026-11-12) ─────────
// Libraries are loaded lazily from cdnjs on first use (same pattern as the
// XLSX export in dataFormats.js) so the main bundle stays small:
//   jsPDF 2.5.1 · JSZip 3.10.1
// PDFs are DRAWN with real text (lib/invoicePdf.js) — no screenshots, so they
// are as sharp as a browser print (owner feedback 2026-11-13).

const LIBS = {
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true; s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat library PDF/ZIP dari CDN. Periksa koneksi internet."));
    document.head.appendChild(s);
  });
}

let _libs = null;
export async function loadPdfZip() {
  if (_libs) return _libs;
  if (!window.jspdf) await loadScript(LIBS.jspdf);
  if (!window.JSZip) await loadScript(LIBS.jszip);
  if (!window.jspdf?.jsPDF || !window.JSZip) throw new Error("Library PDF/ZIP tidak tersedia.");
  _libs = { jsPDF: window.jspdf.jsPDF, JSZip: window.JSZip };
  return _libs;
}

/** Safe file name part. */
export const fileSafe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
