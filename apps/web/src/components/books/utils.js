// ─── Books v2 — non-component helpers (period ranges, formatting, parsing) ──
// Kept separate from shared.jsx so React Fast Refresh works (component files
// should only export components). Labels come from i18n (finance.id.js).
import { labelMap, translate as tr } from "../../i18n";

export const MONTHS = labelMap(Array.from({ length: 12 }, (_, i) => `fin_month_${i + 1}`));
const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m = 1..12
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Period → { from, to, label, prevFrom, prevTo, prevLabel }.
 * type: monthly | quarterly | semesterly | yearly | custom.
 * "prev" is the immediately preceding period of the same length
 * (custom → same number of days right before `from`).
 */
export function rangeFor(p) {
  const y = Number(p.year);
  const mk = (sm, em, yy = y) => ({ from: iso(yy, sm, 1), to: iso(yy, em, lastDay(yy, em)) });
  let cur, prev, label, prevLabel;
  if (p.type === "monthly") {
    const m = Number(p.month) || 1;
    cur = mk(m, m);
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    prev = mk(pm, pm, py);
    label = `${MONTHS[m - 1]} ${y}`; prevLabel = `${MONTHS[pm - 1]} ${py}`;
  } else if (p.type === "quarterly") {
    const q = Number(p.quarter) || 1;
    cur = mk(q * 3 - 2, q * 3);
    const pq = q === 1 ? 4 : q - 1, py = q === 1 ? y - 1 : y;
    prev = mk(pq * 3 - 2, pq * 3, py);
    label = tr("fin_quarterN", { n: q, y }); prevLabel = tr("fin_quarterN", { n: pq, y: py });
  } else if (p.type === "semesterly") {
    const s = Number(p.semester) || 1;
    cur = mk(s === 1 ? 1 : 7, s === 1 ? 6 : 12);
    const ps = s === 1 ? 2 : 1, py = s === 1 ? y - 1 : y;
    prev = mk(ps === 1 ? 1 : 7, ps === 1 ? 6 : 12, py);
    label = tr("fin_semesterN", { n: s, y }); prevLabel = tr("fin_semesterN", { n: ps, y: py });
  } else if (p.type === "custom" && p.from && p.to) {
    cur = { from: p.from, to: p.to };
    const days = Math.round((new Date(p.to) - new Date(p.from)) / 86400000) + 1;
    const pt = new Date(p.from); pt.setDate(pt.getDate() - 1);
    const pf = new Date(pt); pf.setDate(pf.getDate() - days + 1);
    prev = { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
    label = `${fmtDate(p.from)} – ${fmtDate(p.to)}`; prevLabel = `${fmtDate(prev.from)} – ${fmtDate(prev.to)}`;
  } else {
    cur = mk(1, 12); prev = mk(1, 12, y - 1);
    label = tr("fin_yearN", { y }); prevLabel = tr("fin_yearN", { y: y - 1 });
  }
  return { ...cur, label, prevFrom: prev.from, prevTo: prev.to, prevLabel };
}

// ─── Formatting ──────────────────────────────────────────────────────────────
export const rp = (n) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString("id-ID", { maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};
export function fmtDate(d) {
  if (!d) return "-";
  const x = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  return isNaN(x.getTime()) ? "-" : x.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
export const TYPE_LABEL = labelMap({ asset: "fin_type_asset", liability: "fin_type_liability", equity: "fin_type_equity", income: "fin_type_income", expense: "fin_type_expense" });
export const STATUS_STYLE = {
  draft: "bg-amber-100 text-amber-700", posted: "bg-emerald-100 text-emerald-700", reversed: "bg-slate-200 text-slate-500 line-through",
};
export const STATUS_LABEL = labelMap({ draft: "fin_status_draft", posted: "fin_status_posted", reversed: "fin_status_reversed" });
export const SOURCE_LABEL = labelMap({
  manual: "fin_src_manual", cashbook: "fin_src_cashbook", template: "fin_src_template", import: "fin_src_import",
  opening: "fin_src_opening", reversal: "fin_src_reversal", auto: "fin_src_auto", quick: "fin_src_quick", driver: "fin_src_driver",
});

export const inputCls = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100";

/** Parse an Indonesian / international money string. "Rp 1.250.000,50" → 1250000.5 */
export function parseMoney(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,5" decimal vs "1,250,000" thousands
    s = /,\d{3}(,|$)/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot > -1) {
    s = /\.\d{3}(\.|$)/.test(s) && !/\.\d{1,2}$/.test(s) ? s.replace(/\./g, "") : s;
  }
  const n = Number(s);
  return isNaN(n) ? 0 : (neg ? -n : n);
}

const ID_MONTHS = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agustus: 8, aug: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, nov: 11, november: 11, des: 12, dec: 12, desember: 12 };
/** Parse dates from manual books: Date, Excel serial, dd/mm/yyyy, yyyy-mm-dd, "12 Jan 2026". → ISO or null */
export function parseDateLoose(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date && !isNaN(v)) {
    // SheetJS can return a date a few seconds before local midnight (time-
    // zone rounding); shift by 12h so we always land on the intended day.
    const x = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); return iso(y, Number(m[2]), Number(m[1])); }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m && ID_MONTHS[m[2].toLowerCase()]) return iso(Number(m[3]), ID_MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
}
