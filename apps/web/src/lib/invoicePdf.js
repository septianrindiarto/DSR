// ─── Vector PDF for Invoice + Kuitansi + Surat Pengantar (owner 2026-11-13) ──
// Draws the same layout as the Dokumen preview (reference: C146_Tagihan.pdf,
// printed from Chrome) directly with jsPDF — real text and thin uniform lines,
// no screenshots — so bulk PDFs are as sharp as a browser print.
//
//   page 1  top half   : invoice (fixed: the dashed line is ALWAYS at 148.5 mm;
//                        many rows → smaller table font / padding, never cut)
//           bottom half: kuitansi
//   page 2             : surat pengantar tagihan (optional)
//
// Pure: everything it needs comes in `data` (built by AdminDocuments from the
// same invoiceCalc as the preview); `logo` is a PNG data URL.

const PAGE_W = 210;
const L = 15;                 // left margin (mm)
const R = 195;                // right edge
const W = R - L;
const MID = 148.5;            // dashed line
const TOP_LIMIT = MID - 2.5;  // invoice content must end above this
const PT = 0.3528;            // 1 pt in mm

// Column widths (mm) — proportions of the reference print, total = 180.
const COLS = [
  { key: "no", title: "No.", w: 9 },
  { key: "user", title: "Nama User", w: 19 },
  { key: "driver", title: "Nama Driver", w: 20 },
  { key: "dest", title: "Tujuan", w: 16 },
  { key: "date", title: "Tgl Pemakaian", w: 30 },
  { key: "unit", title: "Unit", w: 26 },
  { key: "lembur", title: "Lembur", w: 20 },
  { key: "inap", title: "Inap", w: 20 },
  { key: "total", title: "Total", w: 20, align: "right" },
];

// Density levels tried in order until the invoice fits above the dashed line.
const LEVELS = [
  { font: 7.5, padY: 1.8, sigGap: 13, gapS: 1 },
  { font: 7, padY: 1.3, sigGap: 11, gapS: 0.85 },
  { font: 6.5, padY: 1, sigGap: 9, gapS: 0.7 },
  { font: 6, padY: 0.7, sigGap: 7, gapS: 0.6 },
  { font: 5.5, padY: 0.5, sigGap: 6, gapS: 0.5 },
];

const lh = (pt, f = 1.2) => pt * PT * f;     // line height in mm

function setFont(doc, style = "normal", size = 8) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
}

function header(doc, y, logo, company, compact) {
  const logoH = compact ? 15 : 17;
  const logoW = logoH * (515 / 191);
  if (logo) doc.addImage(logo, "PNG", L, y, logoW, logoH, undefined, "FAST");
  const x = L + logoW + 5;
  const nameSize = compact ? 13 : 14;
  const blockH = lh(nameSize, 1.15) + 2 * lh(9, 1.4);
  let by = y + (logoH - blockH) / 2;
  setFont(doc, "bold", nameSize);
  by += lh(nameSize, 1.15) * 0.8;
  doc.text(company.name, x, by);
  setFont(doc, "normal", 9);
  by += lh(9, 1.4);
  doc.text(company.addr, x, by);
  by += lh(9, 1.4);
  doc.text(company.phone, x, by);
  return y + logoH;
}

/** Wrap text to width; returns array of lines (never empty). */
function wrap(doc, text, width) {
  const s = String(text ?? "").trim();
  if (!s) return ["-"];
  return s.split("\n").flatMap((part) => doc.splitTextToSize(part, width));
}

// ─── Page 1, top half: invoice (layout + optional draw) ─────────────────────
function invoiceTop(doc, d, lv, draw, logo, company) {
  let y = 12;
  if (draw) header(doc, y, logo, company, false);
  y += 17;
  if (d.letterNo) {
    y += 5.2;
    if (draw) { setFont(doc, "normal", 7.5); doc.text(d.letterNo, L, y); }
  }
  // Title (kept tight under the header / letter number)
  y += d.letterNo ? 6 : 8.5;
  if (draw) { setFont(doc, "bold", 18); doc.text("INVOICE", PAGE_W / 2, y, { align: "center" }); }
  y += 3.6;
  if (draw) { setFont(doc, "normal", 7); doc.text(d.invoiceNo || "", PAGE_W / 2, y, { align: "center" }); }

  // Nama / Alamat (a little air under the invoice number)
  y += 7.5;
  const vx = L + 26, vw = R - vx;
  setFont(doc, "normal", 8);
  const nameLines = wrap(doc, d.clientName, vw);
  const addrLines = wrap(doc, d.clientAddress, vw);
  if (draw) {
    setFont(doc, "bold", 8); doc.text("Nama", L, y);
    setFont(doc, "normal", 8); doc.text(":", L + 22, y); doc.text(nameLines, vx, y);
  }
  y += lh(8, 1.25) * nameLines.length + 1.6;
  if (draw) {
    setFont(doc, "bold", 8); doc.text("Alamat", L, y);
    setFont(doc, "normal", 8); doc.text(":", L + 22, y); doc.text(addrLines, vx, y);
  }
  y += lh(8, 1.25) * (addrLines.length - 1);

  // Table
  y += 4;
  const fs = lv.font, lineH = lh(fs, 1.25), padX = 1.2;
  setFont(doc, "bold", fs);
  const headLines = COLS.map((c) => doc.splitTextToSize(c.title, c.w - 2 * padX));
  const headH = Math.max(...headLines.map((l) => l.length)) * lineH + 2 * lv.padY;
  setFont(doc, "normal", fs);
  const bodyCells = d.rows.map((r) => COLS.map((c) => {
    const v = r[c.key];
    const parts = Array.isArray(v) ? v : [v];
    return parts.flatMap((p) => wrap(doc, p, c.w - 2 * padX));
  }));
  const rowH = bodyCells.map((cells) => Math.max(...cells.map((l) => l.length)) * lineH + 2 * lv.padY);
  const tableTop = y;
  const tableH = headH + rowH.reduce((a, b) => a + b, 0);

  if (draw) {
    doc.setDrawColor(0); doc.setLineWidth(0.2);
    const cellText = (lines, c, x, top, h, style, head) => {
      setFont(doc, style, fs);
      const textH = lines.length * lineH;
      // first baseline: vertically centred block (0.75 ≈ ascent share of the line)
      let by = top + (h - textH) / 2 + lineH * 0.75;
      for (const ln of lines) {
        if (c.align === "right" && !head) doc.text(ln, x + c.w - padX, by, { align: "right" });
        else doc.text(ln, x + c.w / 2, by, { align: "center" });
        by += lineH;
      }
    };
    let x = L;
    COLS.forEach((c, i) => { cellText(headLines[i], c, x, tableTop, headH, "bold", true); x += c.w; });
    let ry = tableTop + headH;
    bodyCells.forEach((cells, r) => {
      let cx = L;
      COLS.forEach((c, i) => { cellText(cells[i], c, cx, ry, rowH[r], "normal"); cx += c.w; });
      ry += rowH[r];
    });
    // Grid: one line width everywhere (outer = inner).
    doc.rect(L, tableTop, W, tableH);
    let gx = L;
    for (let i = 0; i < COLS.length - 1; i++) { gx += COLS[i].w; doc.line(gx, tableTop, gx, tableTop + tableH); }
    let gy = tableTop + headH;
    doc.line(L, gy, R, gy);
    for (let r = 0; r < rowH.length - 1; r++) { gy += rowH[r]; doc.line(L, gy, R, gy); }
  }
  y = tableTop + tableH;

  // Totals — directly under the table
  const totalsGap = lh(8, 1.35);
  y += 3.6;
  d.totals.forEach((t, i) => {
    if (draw) {
      setFont(doc, t.bold ? "bold" : "normal", 8);
      doc.text(t.label, R - 40, y, { align: "right" });
      doc.text(t.value, R, y, { align: "right" });
    }
    if (i < d.totals.length - 1) y += totalsGap;
  });

  // Signature
  y += 6 * lv.gapS + 1;
  if (draw) { setFont(doc, "normal", 8); doc.text(`Bandung, ${d.dateText}`, R, y, { align: "right" }); }
  y += lh(8, 1.35);
  if (draw) doc.text(company.brand, R, y, { align: "right" });
  y += lv.sigGap;
  if (draw) { doc.setLineWidth(0.2); doc.line(R - 42, y, R, y); }
  y += 3.6;
  if (draw) doc.text(`( ${company.signatory} )`, R, y, { align: "right" });
  return y + 1;
}

// ─── Page 1, bottom half: kuitansi ──────────────────────────────────────────
function kuitansi(doc, d, logo, company) {
  let y = MID + 5;
  y = header(doc, y, logo, company, true);
  y += 5;
  setFont(doc, "normal", 7); doc.text(`No. ${d.invoiceNo || ""}`, L, y);

  const lx = L, cx = L + 38, vx = L + 43, vw = R - vx;
  const fs = 9.5, lineH = lh(fs, 1.4);
  const row = (label, draw) => { setFont(doc, "bold", fs); doc.text(label, lx, y); setFont(doc, "normal", fs); doc.text(":", cx, y); draw(); };

  y += 7.5;
  row("Sudah Terima Dari", () => { setFont(doc, "bold", fs); doc.text(wrap(doc, d.clientName, vw), vx, y); });
  y += lineH * Math.max(1, wrap(doc, d.clientName, vw).length) + 2.2;

  // Terbilang — grey box centred on the text line(s)
  setFont(doc, "italic", fs);
  const tb = wrap(doc, d.terbilang, vw - 3);
  const capH = fs * PT * 0.72;                 // cap height
  const boxTop = y - capH - 1.3;
  const boxH = lineH * (tb.length - 1) + capH + 2.6;
  doc.setFillColor(235, 235, 235); doc.rect(vx, boxTop, vw, boxH, "F");
  row("Terbilang", () => { setFont(doc, "italic", fs); doc.text(tb, vx + 1.5, y); });
  y += lineH * tb.length + 2.2;

  setFont(doc, "normal", fs);
  const up = wrap(doc, d.untukPembayaran, vw);
  row("Untuk Pembayaran", () => { setFont(doc, "normal", fs); doc.text(up, vx, y); });
  y += lineH * up.length + 7;

  // Nominal (underline below the descenders) + signature on the right
  setFont(doc, "bold", fs); doc.text("Nominal :", lx, y);
  const nx = lx + doc.getTextWidth("Nominal :") + 5;
  setFont(doc, "bolditalic", fs); doc.text(d.nominal, nx, y);
  doc.setLineWidth(0.25); doc.line(nx, y + 1.6, nx + doc.getTextWidth(d.nominal), y + 1.6);
  setFont(doc, "normal", fs);
  doc.text(`Bandung, ${d.dateText}`, R, y, { align: "right" });
  doc.text(company.brand, R, y + lineH, { align: "right" });
  const sy = y + lineH + 17;
  doc.setLineWidth(0.2); doc.line(R - 45, sy, R, sy);
  doc.text(`( ${company.signatory} )`, R, sy + 4.4, { align: "right" });
}

// ─── Page 2: surat pengantar tagihan ────────────────────────────────────────
function suratPengantar(doc, s, logo, company) {
  let y = header(doc, 12, logo, company, true);
  const fs = 8.5, lineH = lh(fs, 1.45);
  y += 5;
  setFont(doc, "normal", 7.5); doc.text(s.letterNo || "No. ........./DSR/.........", L, y);
  y += 6;
  setFont(doc, "bold", 12); doc.text("SURAT PENGANTAR TAGIHAN", PAGE_W / 2, y, { align: "center" });
  y += 8.5;
  const cx = L + 20, vx = L + 23, vw = R - vx;
  const meta = (label, value) => {
    setFont(doc, "bold", fs); doc.text(label, L, y);
    setFont(doc, "normal", fs); doc.text(":", cx, y);
    const lines = wrap(doc, value, vw);
    doc.text(lines, vx, y);
    y += lineH * lines.length + 0.6;
  };
  meta("Kepada", s.to);
  meta("Dari", s.from);
  meta("Lampiran", s.lampiran);
  setFont(doc, "bold", fs); doc.text("Berita", L, y);
  setFont(doc, "normal", fs); doc.text(":", cx, y);
  const berita = doc.splitTextToSize(s.berita, vw - 1.5);
  doc.text(berita, vx, y, { maxWidth: vw - 1.5, align: "justify", lineHeightFactor: 1.45 });
  y += lineH * berita.length + 8;
  doc.text("Yang Menerima", L, y);
  doc.text(`Bandung, ${s.dateText}`, R, y, { align: "right" });
  y += lineH;
  doc.text(wrap(doc, s.to, 90)[0], L, y);
  doc.text(company.brand, R, y, { align: "right" });
  y += 13;
  doc.text("(..............................)", L, y);
  doc.text(`( ${company.signatory} )`, R, y, { align: "right" });
}

/**
 * Draw one document set into a new jsPDF.
 * data: { invoiceNo, letterNo, clientName, clientAddress, dateText,
 *         rows: [{ no, user, driver, dest, date, unit: [l1,l2], lembur: [..], inap: [..], total }],
 *         totals: [{ label, value, bold }], terbilang, untukPembayaran, nominal,
 *         letter: { letterNo, to, from, lampiran, berita, dateText } | null }
 */
export function buildInvoicePdf(jsPDF, data, { logo, company }) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setTextColor(0, 0, 0);
  // Pick the first density that keeps the invoice above the dashed line.
  let lv = LEVELS[LEVELS.length - 1];
  for (const cand of LEVELS) { if (invoiceTop(doc, data, cand, false, logo, company) <= TOP_LIMIT) { lv = cand; break; } }
  invoiceTop(doc, data, lv, true, logo, company);
  // Dashed midline
  doc.setDrawColor(85, 85, 85); doc.setLineWidth(0.28); doc.setLineDashPattern([1.2, 1], 0);
  doc.line(L, MID, R, MID);
  doc.setLineDashPattern([], 0); doc.setDrawColor(0);
  kuitansi(doc, data, logo, company);
  if (data.letter) { doc.addPage(); suratPengantar(doc, data.letter, logo, company); }
  return doc;
}

/** PNG at `url` → data URL (for the logo). */
export async function imageDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
