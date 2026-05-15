/**
 * Reusable pagination control + page-size selector for admin tables.
 *
 * Placed ABOVE the table (sticky to the viewport top by default) so the user
 * can flip pages without scrolling back up the table.
 *
 * Props
 *   page           current 1-based page number
 *   pageSize       rows per page
 *   totalCount     full row count (unfiltered) — shown as "(terfilter dari N)"
 *   filteredCount  rows after search/filter — used to compute total pages
 *   onPageChange   (n) => void
 *   onPageSizeChange (n) => void
 *   pageSizes      array of selectable page sizes (default [10, 25, 50, 100])
 *   sticky         when true (default) the bar uses position: sticky
 */
export default function TablePagination({
  page,
  pageSize,
  totalCount,
  filteredCount,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50, 100],
  sticky = true,
}) {
  const total = filteredCount ?? totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, total);
  const isFiltered = filteredCount !== undefined && totalCount !== undefined && filteredCount !== totalCount;

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-2.5 rounded-xl border border-slate-200 bg-white/95 backdrop-blur ${
        sticky ? "sticky top-0 z-10 shadow-sm" : ""
      }`}
    >
      <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
        <label className="flex items-center gap-2">
          <span>Tampilkan</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2 py-1 border border-slate-200 rounded-md bg-white text-sm cursor-pointer"
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>per halaman</span>
        </label>
        <span className="text-slate-300">·</span>
        <span>
          Menampilkan <b className="text-slate-700">{pageStart}</b>–<b className="text-slate-700">{pageEnd}</b> dari <b className="text-slate-700">{total}</b>
          {isFiltered && <span className="text-slate-400"> (terfilter dari {totalCount})</span>}
        </span>
      </div>
      <PaginationNav page={page} totalPages={totalPages} onChange={onPageChange} />
    </div>
  );
}

// ─── Compact page navigator: « ‹ 1 … 4 [5] 6 … 20 › » ───────────────────────
function PaginationNav({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  // Sliding window: first, current ± 1, last
  const pages = [];
  const window = 1;
  const push = (n) => { if (!pages.includes(n) && n >= 1 && n <= totalPages) pages.push(n); };
  push(1);
  for (let p = page - window; p <= page + window; p++) if (p > 1 && p < totalPages) push(p);
  push(totalPages);
  pages.sort((a, b) => a - b);

  const elements = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) elements.push({ kind: "gap", key: `g${i}` });
    elements.push({ kind: "page", key: `p${pages[i]}`, n: pages[i] });
  }

  const Btn = ({ disabled, onClick, children, title }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-300 border border-transparent disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      <Btn onClick={() => onChange(1)}             disabled={page <= 1}          title="Halaman pertama">«</Btn>
      <Btn onClick={() => onChange(page - 1)}      disabled={page <= 1}          title="Sebelumnya">‹</Btn>
      {elements.map((el) =>
        el.kind === "gap" ? (
          <span key={el.key} className="px-1 text-slate-400">…</span>
        ) : (
          <button
            key={el.key}
            onClick={() => onChange(el.n)}
            className={`inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-md text-xs font-medium border cursor-pointer ${
              el.n === page
                ? "bg-primary text-white border-primary"
                : "text-slate-600 hover:bg-slate-100 hover:border-slate-300 border-transparent"
            }`}
          >
            {el.n}
          </button>
        )
      )}
      <Btn onClick={() => onChange(page + 1)}      disabled={page >= totalPages} title="Berikutnya">›</Btn>
      <Btn onClick={() => onChange(totalPages)}    disabled={page >= totalPages} title="Halaman terakhir">»</Btn>
    </div>
  );
}

/**
 * usePagination — small hook that handles state + persistence + auto-reset.
 *
 *   const { page, pageSize, setPage, setPageSize, paged, totalPages } =
 *     usePagination(filteredCars, { storageKey: "dsr:fleet:pageSize", deps: [search, statusFilter] });
 */
import { useState, useEffect, useMemo } from "react";

export function usePagination(items, { storageKey, defaultSize = 20, pageSizes = [10, 25, 50, 100], deps = [] } = {}) {
  const [pageSize, setPageSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return pageSizes.includes(v) ? v : defaultSize;
    } catch {
      return defaultSize;
    }
  });
  const [page, setPage] = useState(1);

  // Persist user's page-size choice across sessions
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, String(pageSize)); } catch { /* ignore */ }
  }, [pageSize, storageKey]);

  const totalPages = Math.max(1, Math.ceil((items?.length || 0) / pageSize));

  // Clamp page when the list shrinks below current page
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  // Auto-reset to page 1 when filters/search/sort change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [pageSize, ...deps]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return (items || []).slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { page, setPage, pageSize, setPageSize, paged, totalPages };
}
