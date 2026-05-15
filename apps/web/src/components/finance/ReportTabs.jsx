import { useState, useEffect, useCallback } from "react";
import { api, apiCache, swr } from "../../lib/api";
import TablePagination from "../TablePagination";

const fmt = v => Number(v || 0).toLocaleString("id-ID", { minimumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";
const toInputDate = d => {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

// ─── Jurnal Umum ─────────────────────────────────────────────────────────────
export function TabJurnal({ params, onClearSuccess }) {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalDebit, setTotalDebit] = useState(0);
  const [totalCredit, setTotalCredit] = useState(0);
  const [isBalanced, setIsBalanced] = useState(true);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Clear all modal
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearForce, setClearForce] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categories, setCategories] = useState([]);

  // Bulk select
  const [selected, setSelected] = useState(new Set());
  const allSelected = data.length > 0 && data.every(e => selected.has(e.id));

  // Edit modal
  const [editEntry, setEditEntry] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Fetch category list once
  useEffect(() => {
    api.journal.categories().then(r => {
      const cats = Array.isArray(r) ? r : (r?.categories || []);
      setCategories(cats.map(c => (typeof c === "string" ? c : c.category || c.name)).filter(Boolean));
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams(params);
    p.set("page", page);
    p.set("limit", pageSize);
    if (search) p.set("search", search);
    if (categoryFilter) p.set("category", categoryFilter);
    if (dateFrom) p.set("startDate", dateFrom);
    if (dateTo) p.set("endDate", dateTo);
    const key = `journal:list:${params}:${page}:${pageSize}:${search}:${categoryFilter}:${dateFrom}:${dateTo}`;
    swr(key, () => api.journal.list(p.toString()), r => {
      setData(r?.data || []);
      setTotal(r?.total || 0);
      setTotalDebit(r?.totalDebit || 0);
      setTotalCredit(r?.totalCredit || 0);
      setIsBalanced(r?.isBalanced !== false);
      setLoading(false);
      setHasLoaded(true);
    }).catch(() => setLoading(false));
  }, [params, page, pageSize, search, categoryFilter, dateFrom, dateTo]);

  useEffect(() => { setPage(1); }, [params]);
  useEffect(() => { load(); }, [load]);

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(data.map(e => e.id)));
  }

  function toggleOne(id) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }

  async function handleBulkDelete(force = false) {
    if (!selected.size) return;
    if (!force && !confirm(`Hapus ${selected.size} entri yang dipilih? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const res = await api.journal.bulkDelete([...selected], force);
      const locked = res.errors?.filter(e => e.reason?.includes('dikunci')) || [];
      if (!force && locked.length > 0 && confirm(
        `${res.deleted} entri dihapus, ${locked.length} diblokir karena periode dikunci.\n\nHapus paksa entri yang terkunci juga?`
      )) {
        return handleBulkDelete(true);
      }
      alert(`${res.deleted} entri dihapus${res.skipped ? `, ${res.skipped} dilewati` : ""}.`);
      setSelected(new Set());
      apiCache.invalidate("journal");
      load();
    } catch (e) { alert(e.message); }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      const periodData = {};
      const p = new URLSearchParams(params);
      if (p.get('year')) periodData.year = Number(p.get('year'));
      if (p.get('month')) periodData.month = Number(p.get('month'));
      if (p.get('quarter')) periodData.quarter = Number(p.get('quarter'));
      if (p.get('semester')) periodData.semester = Number(p.get('semester'));
      const res = await api.journal.clearAll({ ...periodData, force: clearForce });
      alert(`${res.deleted} entri berhasil dihapus.`);
      setShowClearModal(false);
      setClearForce(false);
      setSelected(new Set());
      apiCache.invalidate("journal");
      load();
      onClearSuccess?.();
    } catch (e) { alert(e.message); }
    finally { setClearing(false); }
  }

  function openEdit(entry) {
    setEditEntry(entry);
    setEditForm({
      entryDate: toInputDate(entry.entryDate),
      description: entry.description,
      category: entry.category,
      debit: Number(entry.debit || 0),
      credit: Number(entry.credit || 0),
      reference: entry.reference || "",
    });
  }

  async function handleSaveEdit() {
    setSaving(true);
    try {
      await api.journal.update(editEntry.id, {
        ...editForm,
        debit: Number(editForm.debit),
        credit: Number(editForm.credit),
      });
      setEditEntry(null);
      apiCache.invalidate("journal");
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleReverse(entry) {
    if (!confirm(`Buat entri reversal untuk "${entry.description}"?\n\nDebit dan Kredit akan dibalik. Entri asli tetap tersimpan.`)) return;
    try {
      const res = await api.journal.reverse(entry.id);
      alert(`Reversal dibuat: ${res.entry?.journalRef || "OK"}`);
      apiCache.invalidate("journal");
      load();
    } catch (e) { alert(e.message); }
  }

  async function handleDelete(entry, force = false) {
    if (!force && !confirm(`Hapus entri "${entry.description}"?`)) return;
    try {
      await api.journal.delete(entry.id, force);
      apiCache.invalidate("journal");
      load();
    } catch (e) {
      if (e.message?.includes('dikunci') && !force &&
        confirm(`Periode untuk entri ini dikunci.\n\nHapus paksa lewati kunci periode?`)) {
        return handleDelete(entry, true);
      }
      alert(e.message);
    }
  }

  const hasActiveFilter = search || categoryFilter || dateFrom || dateTo;
  function clearFilters() { setSearch(""); setCategoryFilter(""); setDateFrom(""); setDateTo(""); setPage(1); }

  if (loading && !hasLoaded) return <div className="py-12 text-center text-slate-400">Memuat data jurnal...</div>;

  return (
    <div className="space-y-3">

      {/* ── Floating filter bar ─────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl shadow-md px-4 py-3">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[17px] pointer-events-none">search</span>
            <input
              type="text" value={search} placeholder="Cari deskripsi..."
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
          </div>
          {/* Category */}
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 min-w-[160px]">
            <option value="">Semua Kategori</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
            <span className="text-slate-400 text-xs font-medium">–</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
          </div>
          {/* Clear */}
          {hasActiveFilter && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg border border-red-200 cursor-pointer whitespace-nowrap">
              <span className="material-symbols-outlined text-[14px]">close</span>Reset
            </button>
          )}
          {/* Record count */}
          <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
            {loading ? "Memuat..." : `${total.toLocaleString("id-ID")} entri`}
          </span>
          {/* Hapus Semua */}
          <button onClick={() => setShowClearModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer whitespace-nowrap">
            <span className="material-symbols-outlined text-[14px]">delete_forever</span>Hapus Semua
          </button>
        </div>
      </div>

      {/* ── Clear All Modal ─────────────────────────────────────────── */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-red-600 px-6 py-4 flex items-center gap-3">
              <span className="material-symbols-outlined text-white text-2xl">delete_forever</span>
              <h3 className="text-white font-bold text-lg">Hapus Semua Entri Jurnal</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <span className="material-symbols-outlined text-amber-500 text-xl mt-0.5">warning</span>
                <p className="text-sm text-amber-800">
                  Semua entri jurnal pada periode yang dipilih akan <strong>dihapus permanen</strong>. Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <input type="checkbox" checked={clearForce} onChange={e => setClearForce(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-red-600 cursor-pointer" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">Lewati kunci periode</p>
                  <p className="text-xs text-slate-500 mt-0.5">Paksa hapus entri meskipun periodenya dikunci. Gunakan hanya jika perlu menimpa data terkunci.</p>
                </div>
              </label>
            </div>
            <div className="px-6 pb-6 flex gap-3 justify-end">
              <button onClick={() => { setShowClearModal(false); setClearForce(false); }}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">Batal</button>
              <button onClick={handleClearAll} disabled={clearing}
                className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 cursor-pointer flex items-center gap-2">
                {clearing && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {clearing ? "Menghapus..." : "Ya, Hapus Semua"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !data.length && (
        <div className="py-12 text-center text-slate-400">
          {hasActiveFilter
            ? <><p className="font-medium">Tidak ada entri yang cocok.</p><button onClick={clearFilters} className="mt-2 text-sm text-primary hover:underline cursor-pointer">Hapus filter</button></>
            : <p>Belum ada data jurnal. Silakan import data terlebih dahulu.</p>}
        </div>
      )}

      {/* Balance warning */}
      {!isBalanced && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-[18px] text-amber-500 mt-0.5">warning</span>
          <div>
            <p className="font-semibold">Jurnal Tidak Seimbang</p>
            <p className="text-xs mt-0.5">
              Total Debit: <b>Rp{fmt(totalDebit)}</b> — Total Kredit: <b>Rp{fmt(totalCredit)}</b> —
              Selisih: <b>Rp{fmt(Math.abs(totalDebit - totalCredit))}</b>.
              Periksa entri yang salah kolom, lalu gunakan Edit atau Reversal untuk koreksi.
            </p>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium text-red-700">{selected.size} entri dipilih</span>
          <button onClick={handleBulkDelete}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 cursor-pointer">
            <span className="material-symbols-outlined text-[15px]">delete</span>Hapus Pilihan
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer">Batalkan</button>
        </div>
      )}

      {/* Pagination top */}
      <TablePagination
        page={page} pageSize={pageSize} totalCount={total} filteredCount={total}
        onPageChange={setPage} onPageSizeChange={v => { setPageSize(v); setPage(1); }}
        pageSizes={[25, 50, 100, 200]} sticky={false}
      />

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400 tracking-wider border-b border-slate-200">
              <th className="px-3 py-3 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="cursor-pointer rounded" />
              </th>
              <th className="px-3 py-3 text-left w-28">Ref</th>
              <th className="px-3 py-3 text-left">Tanggal</th>
              <th className="px-3 py-3 text-left">Deskripsi</th>
              <th className="px-3 py-3 text-left">Kategori</th>
              <th className="px-3 py-3 text-right">Debit (Rp)</th>
              <th className="px-3 py-3 text-right">Kredit (Rp)</th>
              <th className="px-3 py-3 text-right w-28">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((e) => (
              <tr key={e.id}
                className={`hover:bg-slate-50/60 ${e.isReversal ? "bg-orange-50/40" : ""} ${selected.has(e.id) ? "bg-primary/5" : ""}`}>
                <td className="px-3 py-2.5 text-center">
                  <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleOne(e.id)}
                    className="cursor-pointer rounded" />
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-[10px] font-mono text-slate-400">{e.journalRef || `#${e.id}`}</span>
                  {e.isReversal && (
                    <span className="ml-1 text-[9px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-semibold uppercase">Rev</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap">{fmtDate(e.entryDate)}</td>
                <td className="px-3 py-2.5 font-medium text-slate-900 max-w-[220px] truncate" title={e.description}>
                  {e.description}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{e.category}</span>
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs ${Number(e.debit) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                  {Number(e.debit) > 0 ? fmt(e.debit) : "-"}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs ${Number(e.credit) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                  {Number(e.credit) > 0 ? fmt(e.credit) : "-"}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(e)} title="Edit"
                      className="p-1 text-slate-400 hover:text-primary cursor-pointer rounded">
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button onClick={() => handleReverse(e)} title="Buat Reversal"
                      className="p-1 text-slate-400 hover:text-amber-600 cursor-pointer rounded">
                      <span className="material-symbols-outlined text-[16px]">undo</span>
                    </button>
                    <button onClick={() => handleDelete(e)} title="Hapus"
                      className="p-1 text-slate-400 hover:text-red-500 cursor-pointer rounded">
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-bold text-sm border-t-2 border-slate-300">
              <td colSpan={5} className="px-3 py-3">TOTAL HALAMAN INI ({data.length} entri)</td>
              <td className="px-3 py-3 text-right font-mono">{fmt(data.reduce((s, e) => s + Number(e.debit || 0), 0))}</td>
              <td className="px-3 py-3 text-right font-mono">{fmt(data.reduce((s, e) => s + Number(e.credit || 0), 0))}</td>
              <td />
            </tr>
            <tr className={`text-sm font-bold border-t border-slate-200 ${isBalanced ? "bg-emerald-50" : "bg-red-50"}`}>
              <td colSpan={5} className="px-3 py-2 text-xs">
                TOTAL PERIODE · {isBalanced
                  ? <span className="text-emerald-700">✓ Seimbang</span>
                  : <span className="text-red-600">✗ Tidak Seimbang (selisih Rp{fmt(Math.abs(totalDebit - totalCredit))})</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs">{fmt(totalDebit)}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{fmt(totalCredit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Edit Modal */}
      {editEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditEntry(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg">Edit Entri Jurnal</h3>
                <p className="text-xs text-slate-400 mt-0.5">{editEntry.journalRef || `ID #${editEntry.id}`}</p>
              </div>
              <button onClick={() => setEditEntry(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tanggal *</label>
                  <input type="date" value={editForm.entryDate}
                    onChange={e => setEditForm(p => ({ ...p, entryDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Referensi</label>
                  <input type="text" value={editForm.reference}
                    onChange={e => setEditForm(p => ({ ...p, reference: e.target.value }))}
                    placeholder="No. referensi"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Deskripsi *</label>
                <input type="text" value={editForm.description}
                  onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Kategori *</label>
                <input type="text" value={editForm.category}
                  onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Debit (Rp)</label>
                  <input type="number" min="0" step="1" value={editForm.debit}
                    onChange={e => setEditForm(p => ({ ...p, debit: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Kredit (Rp)</label>
                  <input type="number" min="0" step="1" value={editForm.credit}
                    onChange={e => setEditForm(p => ({ ...p, credit: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                </div>
              </div>
              {/* Swap Debit ↔ Kredit */}
              <button type="button"
                onClick={() => setEditForm(p => ({ ...p, debit: p.credit, credit: p.debit }))}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 cursor-pointer">
                <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                Tukar Debit ↔ Kredit
              </button>
            </div>
            <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setEditEntry(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                Batal
              </button>
              <button onClick={handleSaveEdit} disabled={saving}
                className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 cursor-pointer flex items-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {saving ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Shared: HTML report generator ──────────────────────────────────────────
function generateReportHTML(reportType, data, title, period) {
  const now = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const fmtN = v => Number(v || 0).toLocaleString('id-ID');
  const fmtD = d => d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const css = `body{font-family:Arial,sans-serif;margin:24px;color:#1e293b}h1{font-size:18px;margin:0 0 4px}
.meta{font-size:12px;color:#64748b;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #e2e8f0;padding:7px 10px;text-align:left}th{background:#f8fafc;font-weight:600;font-size:11px;text-transform:uppercase;color:#475569}
.right{text-align:right}.total-row{font-weight:700;background:#f1f5f9}.neg{color:#dc2626}
.section-header{background:#eff6ff;font-weight:700;font-size:13px;padding:8px 10px;border:1px solid #e2e8f0;border-bottom:none;margin-top:16px}
.net-row{background:#1e293b;color:#fff;font-weight:700;font-size:15px}`;

  let body = '';
  if (reportType === 'ledger') {
    const rows = Array.isArray(data) ? data : [];
    body = `<table><thead><tr><th>Ref</th><th>Tanggal</th><th>Deskripsi</th><th>Kategori</th><th class="right">Debit (Rp)</th><th class="right">Kredit (Rp)</th><th class="right">Saldo</th></tr></thead><tbody>` +
      rows.map(e => {
        const bal = Number(e.runningBalance != null ? e.runningBalance : (e.balance != null ? e.balance : 0));
        return `<tr><td style="font-size:11px;font-family:monospace">${e.journalRef||('#'+e.id)}</td><td>${fmtD(e.entryDate)}</td><td>${e.description}</td><td>${e.category}</td><td class="right">${Number(e.debit)>0?fmtN(e.debit):'-'}</td><td class="right">${Number(e.credit)>0?fmtN(e.credit):'-'}</td><td class="right">${fmtN(Math.abs(bal))} ${bal>=0?'(D)':'(K)'}</td></tr>`;
      }).join('') + `</tbody></table>`;
  } else if (reportType === 'trial-balance') {
    const rows = Array.isArray(data) ? data : [];
    const gd = rows.reduce((s,r)=>s+Number(r.debit||r.totalDebit||0),0);
    const gc = rows.reduce((s,r)=>s+Number(r.credit||r.totalCredit||0),0);
    body = `<table><thead><tr><th>Nama Akun / Kategori</th><th class="right">Debit (Rp)</th><th class="right">Kredit (Rp)</th></tr></thead><tbody>` +
      rows.map(r=>`<tr><td>${r.category||r.name}</td><td class="right">${fmtN(r.debit||r.totalDebit)}</td><td class="right">${fmtN(r.credit||r.totalCredit)}</td></tr>`).join('') +
      `</tbody><tfoot><tr class="total-row"><td>TOTAL</td><td class="right">${fmtN(gd)}</td><td class="right">${fmtN(gc)}</td></tr></tfoot></table>`;
  } else if (reportType === 'income-statement') {
    const revenues = data?.revenues||data?.income||[];
    const expenses = data?.expenses||[];
    const totalRev = data?.totalRevenue!=null?data.totalRevenue:revenues.reduce((s,x)=>s+Number(x.amount||0),0);
    const totalExp = data?.totalExpense!=null?data.totalExpense:expenses.reduce((s,x)=>s+Number(x.amount||0),0);
    const net = data?.netIncome!=null?data.netIncome:(totalRev-totalExp);
    body = `<div class="section-header">Pendapatan</div><table><tbody>`+
      revenues.map(r=>`<tr><td>${r.category||r.name}</td><td class="right">${fmtN(r.amount)}</td></tr>`).join('')+
      `</tbody><tfoot><tr class="total-row"><td>Total Pendapatan</td><td class="right">${fmtN(totalRev)}</td></tr></tfoot></table>`+
      `<div class="section-header" style="margin-top:12px">Beban</div><table><tbody>`+
      expenses.map(r=>`<tr><td>${r.category||r.name}</td><td class="right">${fmtN(r.amount)}</td></tr>`).join('')+
      `</tbody><tfoot><tr class="total-row"><td>Total Beban</td><td class="right">${fmtN(totalExp)}</td></tr></tfoot></table>`+
      `<table style="margin-top:8px"><tbody><tr class="net-row"><td>${net>=0?'LABA BERSIH':'RUGI BERSIH'}</td><td class="right">Rp ${fmtN(Math.abs(net))}</td></tr></tbody></table>`;
  } else if (reportType === 'cash-flow') {
    const sections = [['operating','Aktivitas Operasi'],['investing','Aktivitas Investasi'],['financing','Aktivitas Pendanaan']];
    body = sections.map(([key,label])=>{
      const items = data?.[key]?.items||(Array.isArray(data?.[key])?data[key]:[]);
      const total = data?.[key]?.total!=null?data[key].total:items.reduce((s,x)=>s+Number(x.amount||0),0);
      return `<div class="section-header">${label}</div><table><tbody>`+
        items.map(r=>`<tr><td>${r.category||r.name||r.description}</td><td class="right ${Number(r.amount)<0?'neg':''}">${Number(r.amount)<0?'('+fmtN(Math.abs(r.amount))+')':fmtN(r.amount)}</td></tr>`).join('')+
        `</tbody><tfoot><tr class="total-row"><td>Total ${label}</td><td class="right ${total<0?'neg':''}">${total<0?'('+fmtN(Math.abs(total))+')':fmtN(total)}</td></tr></tfoot></table>`;
    }).join('')+
    `<table style="margin-top:8px"><tbody><tr class="net-row"><td>KENAIKAN/PENURUNAN KAS BERSIH</td><td class="right">Rp ${fmtN(Math.abs(data?.netCashFlow||0))} ${(data?.netCashFlow||0)<0?'(Keluar)':'(Masuk)'}</td></tr></tbody></table>`;
  } else if (reportType === 'balance-sheet') {
    const sHTML = (label, rows, total) => {
      const isNeg = total < 0;
      return `<div class="section-header">${label}</div><table><tbody>`+
        rows.map(r=>{const n=Number(r.amount!=null?r.amount:(r.total||0));return`<tr><td>${r.category||r.name}</td><td class="right ${n<0?'neg':''}">${n<0?'('+fmtN(Math.abs(n))+')':fmtN(n)}</td></tr>`;}).join('')+
        `</tbody><tfoot><tr class="total-row"><td>Total ${label}</td><td class="right ${isNeg?'neg':''}">${isNeg?'('+fmtN(Math.abs(total))+')':fmtN(total)}</td></tr></tfoot></table>`;
    };
    const tl = Number(data?.totalLiabilities||0), te = Number(data?.totalEquity||0);
    body = sHTML('Aset', data?.assets||[], Number(data?.totalAssets||0))+
      sHTML('Liabilitas', data?.liabilities||[], tl)+
      sHTML('Ekuitas', data?.equity||[], te)+
      `<table style="margin-top:8px"><tbody><tr class="net-row"><td>TOTAL LIABILITAS + EKUITAS</td><td class="right">Rp ${fmtN(tl+te)}</td></tr></tbody></table>`;
  }

  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>${title}</title><style>${css}</style></head><body><h1>${title}</h1><p class="meta">Periode: ${period} &nbsp;|&nbsp; Dibuat: ${now}</p>${body}</body></html>`;
}

// ─── Shared: Produce Document Modal ─────────────────────────────────────────
function ProduceModal({ onClose, onGoToDokumen, reportTitle, reportType, period, data }) {
  const [filename, setFilename] = useState(`${reportTitle} - ${period}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleProduce() {
    const name = filename.trim();
    if (!name) { setError("Nama file wajib diisi."); return; }
    setSaving(true); setError("");
    let container = null;
    try {
      // 1. Dynamically load html2pdf.js from CDNJS
      await new Promise((resolve, reject) => {
        if (window.html2pdf) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Gagal memuat library PDF. Periksa koneksi internet.'));
        document.head.appendChild(s);
      });

      // 2. Generate full HTML document and extract style + body content
      const htmlDoc = generateReportHTML(reportType, data, name, period);
      const bodyMatch = htmlDoc.match(/<body>([\s\S]*)<\/body>/);
      const cssMatch = htmlDoc.match(/<style>([\s\S]*?)<\/style>/);

      // 3. Render into a hidden off-screen div
      container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:white;padding:20px;box-sizing:border-box;font-family:sans-serif';
      container.innerHTML = `<style>${cssMatch?.[1] || ''}</style>${bodyMatch?.[1] || htmlDoc}`;
      document.body.appendChild(container);

      // 4. Convert to PDF blob
      const pdfBlob = await window.html2pdf()
        .set({
          margin: 8,
          filename: name + '.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(container)
        .outputPdf('blob');

      document.body.removeChild(container);
      container = null;

      // 5. Upload PDF
      const safeName = name.replace(/[/\\?%*:|"<>]/g, '_');
      const file = new File([pdfBlob], safeName + '.pdf', { type: 'application/pdf' });
      const fd = new FormData(); fd.append('file', file);
      const upload = await api.finance.upload(fd);
      await api.finance.create({
        name, category: 'keuangan_inti', period,
        fileUrl: upload.url, fileType: 'PDF', status: 'final',
        notes: `Laporan ${reportTitle} — diproduksi otomatis`,
      });
      apiCache.invalidate('finance');
      onClose();
      onGoToDokumen();
    } catch (e) {
      if (container && container.parentNode) document.body.removeChild(container);
      setError(e.message || "Gagal membuat PDF. Periksa koneksi server.");
    }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900">Produksi Dokumen Laporan</h3>
            <p className="text-xs text-slate-500 mt-0.5">{reportTitle} &middot; {period}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nama File *</label>
            <input value={filename} onChange={e => setFilename(e.target.value)}
              placeholder="contoh: Laporan Buku Besar Mei 2026"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
            <p className="text-xs text-slate-400 mt-1.5">Dokumen akan disimpan sebagai file <b>.pdf</b> yang dapat dibuka dan dicetak langsung.</p>
          </div>
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
            <span className="material-symbols-outlined text-[18px] text-blue-500 mt-0.5">info</span>
            <span>Setelah diproduksi, dokumen akan langsung tersedia di <b>Tab Dokumen</b> dan dapat diunduh kapan saja.</span>
          </div>
          {error && <p className="text-sm text-red-600 flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">error</span>{error}</p>}
        </div>
        <div className="p-5 border-t bg-slate-50/50 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-slate-200 bg-white rounded-lg text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-50">
            Batal
          </button>
          <button onClick={handleProduce} disabled={saving || !filename.trim()}
            className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-60 cursor-pointer flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">{saving ? "hourglass_empty" : "description"}</span>
            {saving ? "Memproduksi..." : "Produksi Dokumen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Buku Besar ──────────────────────────────────────────────────────────────
export function TabBukuBesar({ params, periodLabel = "", onGoToDokumen }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [showProduce, setShowProduce] = useState(false);

  useEffect(() => {
    setLoading(true);
    swr(`journal:ledger:${params}`, () => api.journal.ledger(params), r => {
      // API returns { category: { entries: [], totalDebit, totalCredit, balance } }
      if (r && !Array.isArray(r)) {
        const allEntries = Object.values(r).flatMap(cat => cat.entries || []);
        allEntries.sort((a, b) => new Date(a.entryDate || a.date) - new Date(b.entryDate || b.date));
        setData(allEntries);
        const grandDebit = Object.values(r).reduce((s, cat) => s + (cat.totalDebit || 0), 0);
        const grandCredit = Object.values(r).reduce((s, cat) => s + (cat.totalCredit || 0), 0);
        setSummary({ totalDebit: grandDebit, totalCredit: grandCredit, closingBalance: grandDebit - grandCredit });
      } else {
        setData(r?.data || r || []);
        setSummary(r?.summary || null);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [params]);

  if (loading && !data.length) return <div className="py-12 text-center text-slate-400">Memuat buku besar...</div>;
  if (!loading && !data.length) return <div className="py-12 text-center text-slate-400">Belum ada data.</div>;

  return (
    <>
      {showProduce && <ProduceModal onClose={() => setShowProduce(false)} onGoToDokumen={onGoToDokumen} reportTitle="Buku Besar" reportType="ledger" period={periodLabel} data={data} />}
      <div className="flex justify-end mb-3"><button onClick={() => setShowProduce(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 cursor-pointer"><span className="material-symbols-outlined text-[18px]">description</span>Produksi Laporan</button></div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400 tracking-wider border-b border-slate-200">
            <th className="px-3 py-3 text-left w-28">Ref</th>
            <th className="px-3 py-3 text-left">Tanggal</th>
            <th className="px-3 py-3 text-left">Deskripsi</th>
            <th className="px-3 py-3 text-left">Kategori</th>
            <th className="px-3 py-3 text-right">Debit (Rp)</th>
            <th className="px-3 py-3 text-right">Kredit (Rp)</th>
            <th className="px-3 py-3 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((e, i) => {
            const balanceNum = Number(e.runningBalance ?? e.balance ?? 0);
            return (
              <tr key={e.id ?? i}
                className={`hover:bg-slate-50/60 ${e.isReversal ? "bg-orange-50/40 text-orange-900" : ""}`}>
                <td className="px-3 py-2.5">
                  <span className="text-[10px] font-mono text-slate-400">{e.journalRef || `#${e.id}`}</span>
                  {e.isReversal && (
                    <span className="ml-1 text-[9px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-semibold uppercase">Rev</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap">{fmtDate(e.entryDate || e.date)}</td>
                <td className="px-3 py-2.5 font-medium text-slate-900 max-w-[220px] truncate" title={e.description}>{e.description}</td>
                <td className="px-3 py-2.5">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{e.category}</span>
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs ${Number(e.debit) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                  {Number(e.debit) > 0 ? fmt(e.debit) : "-"}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs ${Number(e.credit) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                  {Number(e.credit) > 0 ? fmt(e.credit) : "-"}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${balanceNum >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {fmt(Math.abs(balanceNum))} {balanceNum >= 0 ? "(D)" : "(K)"}
                </td>
              </tr>
            );
          })}
        </tbody>
        {summary && (
          <tfoot>
            <tr className="bg-slate-50 font-bold text-sm border-t-2 border-slate-300">
              <td colSpan={4} className="px-3 py-3">TOTAL</td>
              <td className="px-3 py-3 text-right font-mono">{fmt(summary.totalDebit)}</td>
              <td className="px-3 py-3 text-right font-mono">{fmt(summary.totalCredit)}</td>
              <td className="px-3 py-3 text-right font-mono text-xs font-semibold">
                {(() => {
                  const cb = summary.closingBalance ?? (summary.totalDebit - summary.totalCredit);
                  return `${fmt(Math.abs(cb))} ${cb >= 0 ? "(D)" : "(K)"}`;
                })()}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    </>
  );
}

// ─── Neraca Saldo ────────────────────────────────────────────────────────────
export function TabNeracaSaldo({ params, periodLabel = "", onGoToDokumen }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProduce, setShowProduce] = useState(false);
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });

  useEffect(() => {
    setLoading(true);
    swr(`journal:trial-balance:${params}`, () => api.journal.trialBalance(params), r => {
      const rows = r?.accounts || r?.data || [];
      setData(rows);
      setTotals({
        debit: rows.reduce((s, x) => s + Number(x.debit || x.totalDebit || 0), 0),
        credit: rows.reduce((s, x) => s + Number(x.credit || x.totalCredit || 0), 0),
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [params]);

  if (loading && !data.length) return <div className="py-12 text-center text-slate-400">Memuat neraca saldo...</div>;
  if (!loading && !data.length) return <div className="py-12 text-center text-slate-400">Belum ada data.</div>;

  const balanced = Math.abs(totals.debit - totals.credit) < 0.01;

  return (
    <>
      {showProduce && <ProduceModal onClose={() => setShowProduce(false)} onGoToDokumen={onGoToDokumen} reportTitle="Neraca Saldo" reportType="trial-balance" period={periodLabel} data={data} />}
      <div className="flex justify-end mb-3"><button onClick={() => setShowProduce(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 cursor-pointer"><span className="material-symbols-outlined text-[18px]">description</span>Produksi Laporan</button></div>
      <div className="space-y-3">
      {!balanced && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-[18px] text-amber-500">warning</span>
          <p>Neraca saldo tidak seimbang — selisih: <b>Rp{fmt(Math.abs(totals.debit - totals.credit))}</b></p>
        </div>
      )}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-bold uppercase text-slate-400 tracking-wider border-b border-slate-200">
              <th className="px-3 py-3 text-left">Kode</th>
              <th className="px-3 py-3 text-left">Nama Akun</th>
              <th className="px-3 py-3 text-right">Debit (Rp)</th>
              <th className="px-3 py-3 text-right">Kredit (Rp)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{row.code || row.accountCode || "-"}</td>
                <td className="px-3 py-2.5 font-medium text-slate-900">{row.name || row.accountName || row.category}</td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs ${Number(row.debit || row.totalDebit) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                  {Number(row.debit || row.totalDebit) > 0 ? fmt(row.debit || row.totalDebit) : "-"}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs ${Number(row.credit || row.totalCredit) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                  {Number(row.credit || row.totalCredit) > 0 ? fmt(row.credit || row.totalCredit) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={`font-bold text-sm border-t-2 border-slate-300 ${balanced ? "bg-emerald-50" : "bg-red-50"}`}>
              <td colSpan={2} className="px-3 py-3">
                TOTAL {balanced ? "✓ Seimbang" : "✗ Tidak Seimbang"}
              </td>
              <td className="px-3 py-3 text-right font-mono">{fmt(totals.debit)}</td>
              <td className="px-3 py-3 text-right font-mono">{fmt(totals.credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    </>
  );
}

// ─── Laba Rugi ───────────────────────────────────────────────────────────────
export function TabLabaRugi({ params, periodLabel = "", onGoToDokumen }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProduce, setShowProduce] = useState(false);

  useEffect(() => {
    setLoading(true);
    swr(`journal:income-statement:${params}`, () => api.journal.incomeStatement(params), r => {
      setData(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [params]);

  if (loading && !data) return <div className="py-12 text-center text-slate-400">Memuat laporan laba rugi...</div>;
  if (!loading && !data) return <div className="py-12 text-center text-slate-400">Belum ada data.</div>;

  const revenues = data?.revenues || data?.pendapatan || [];
  const expenses = data?.expenses || data?.beban || [];
  const totalRevenue = data?.totalRevenue ?? revenues.reduce((s, x) => s + Number(x.amount || x.total || 0), 0);
  const totalExpense = data?.totalExpense ?? expenses.reduce((s, x) => s + Number(x.amount || x.total || 0), 0);
  const netIncome = data?.netIncome ?? (totalRevenue - totalExpense);

  return (
    <>
      {showProduce && <ProduceModal onClose={() => setShowProduce(false)} onGoToDokumen={onGoToDokumen} reportTitle="Laporan Laba Rugi" reportType="income-statement" period={periodLabel} data={data} />}
      <div className="flex justify-end mb-3"><button onClick={() => setShowProduce(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 cursor-pointer"><span className="material-symbols-outlined text-[18px]">description</span>Produksi Laporan</button></div>
      <div className="max-w-2xl mx-auto space-y-4">
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-emerald-50 px-4 py-3 border-b border-slate-200">
          <h4 className="font-bold text-sm text-emerald-800">Pendapatan</h4>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {revenues.length > 0 ? revenues.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 text-slate-700">{r.category || r.name}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmt(r.amount || r.total || 0)}</td>
              </tr>
            )) : (
              <tr><td colSpan={2} className="px-4 py-3 text-center text-slate-400 text-xs">Tidak ada data pendapatan</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-emerald-50 font-bold border-t border-slate-200">
              <td className="px-4 py-3 text-emerald-800">Total Pendapatan</td>
              <td className="px-4 py-3 text-right font-mono text-emerald-800">{fmt(totalRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-red-50 px-4 py-3 border-b border-slate-200">
          <h4 className="font-bold text-sm text-red-800">Beban</h4>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {expenses.length > 0 ? expenses.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 text-slate-700">{r.category || r.name}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmt(r.amount || r.total || 0)}</td>
              </tr>
            )) : (
              <tr><td colSpan={2} className="px-4 py-3 text-center text-slate-400 text-xs">Tidak ada data beban</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-red-50 font-bold border-t border-slate-200">
              <td className="px-4 py-3 text-red-800">Total Beban</td>
              <td className="px-4 py-3 text-right font-mono text-red-800">{fmt(totalExpense)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className={`flex items-center justify-between rounded-xl px-6 py-4 ${netIncome >= 0 ? "bg-emerald-600" : "bg-red-600"}`}>
        <span className="font-bold text-white text-base">{netIncome >= 0 ? "Laba Bersih" : "Rugi Bersih"}</span>
        <span className="font-bold text-white text-xl font-mono">Rp{fmt(Math.abs(netIncome))}</span>
      </div>
    </div>
    </>
  );
}

// ─── Arus Kas ────────────────────────────────────────────────────────────────
export function TabArusKas({ params, periodLabel = "", onGoToDokumen }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProduce, setShowProduce] = useState(false);

  useEffect(() => {
    setLoading(true);
    swr(`journal:cash-flow:${params}`, () => api.journal.cashFlow(params), r => {
      setData(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [params]);

  if (loading && !data) return <div className="py-12 text-center text-slate-400">Memuat laporan arus kas...</div>;
  if (!loading && !data) return <div className="py-12 text-center text-slate-400">Belum ada data.</div>;

  const sections = [
    { key: "operating", label: "Aktivitas Operasi", bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-200" },
    { key: "investing", label: "Aktivitas Investasi", bg: "bg-purple-50", text: "text-purple-800", border: "border-purple-200" },
    { key: "financing", label: "Aktivitas Pendanaan", bg: "bg-indigo-50", text: "text-indigo-800", border: "border-indigo-200" },
  ];

  return (
    <>
      {showProduce && <ProduceModal onClose={() => setShowProduce(false)} onGoToDokumen={onGoToDokumen} reportTitle="Laporan Arus Kas" reportType="cash-flow" period={periodLabel} data={data} />}
      <div className="flex justify-end mb-3"><button onClick={() => setShowProduce(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 cursor-pointer"><span className="material-symbols-outlined text-[18px]">description</span>Produksi Laporan</button></div>
      <div className="max-w-2xl mx-auto space-y-4">
      {sections.map(({ key, label, bg, text, border }) => {
        const items = data?.[key]?.items || (Array.isArray(data?.[key]) ? data[key] : []);
        const total = data?.[key]?.total ?? items.reduce((s, x) => s + Number(x.amount || x.total || 0), 0);
        return (
          <div key={key} className={`border ${border} rounded-lg overflow-hidden`}>
            <div className={`${bg} px-4 py-3 border-b ${border}`}>
              <h4 className={`font-bold text-sm ${text}`}>{label}</h4>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {items.length > 0 ? items.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 text-slate-700">{r.category || r.name || r.description}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${Number(r.amount || r.total) < 0 ? "text-red-600" : ""}`}>
                      {Number(r.amount || r.total) < 0
                        ? `(${fmt(Math.abs(r.amount || r.total))})`
                        : fmt(r.amount || r.total || 0)}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={2} className="px-4 py-3 text-center text-slate-400 text-xs">Tidak ada data</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className={`${bg} font-bold border-t ${border}`}>
                  <td className={`px-4 py-3 ${text}`}>Total {label}</td>
                  <td className={`px-4 py-3 text-right font-mono ${total < 0 ? "text-red-600" : text}`}>
                    {total < 0 ? `(${fmt(Math.abs(total))})` : fmt(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
      {data?.netCashFlow !== undefined && (
        <div className={`flex items-center justify-between rounded-xl px-6 py-4 ${Number(data.netCashFlow) >= 0 ? "bg-emerald-600" : "bg-red-600"}`}>
          <span className="font-bold text-white text-base">Kenaikan/Penurunan Kas Bersih</span>
          <span className="font-bold text-white text-xl font-mono">
            {Number(data.netCashFlow) < 0
              ? `(Rp${fmt(Math.abs(data.netCashFlow))})`
              : `Rp${fmt(data.netCashFlow)}`}
          </span>
        </div>
      )}
    </div>
    </>
  );
}

// ─── Neraca ──────────────────────────────────────────────────────────────────
export function TabNeraca({ params, periodLabel = "", onGoToDokumen }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProduce, setShowProduce] = useState(false);

  useEffect(() => {
    setLoading(true);
    swr(`journal:balance-sheet:${params}`, () => api.journal.balanceSheet(params), r => {
      setData(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [params]);

  if (loading && !data) return <div className="py-12 text-center text-slate-400">Memuat neraca...</div>;
  if (!loading && !data) return <div className="py-12 text-center text-slate-400">Belum ada data.</div>;

  const assets = data?.assets || [];
  const liabilities = data?.liabilities || [];
  const equity = data?.equity || [];
  const totalAssets = data?.totalAssets ?? assets.reduce((s, x) => s + Number(x.amount || x.total || 0), 0);
  const totalLiabilities = data?.totalLiabilities ?? liabilities.reduce((s, x) => s + Number(x.amount || x.total || 0), 0);
  const totalEquity = data?.totalEquity ?? equity.reduce((s, x) => s + Number(x.amount || x.total || 0), 0);
  const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

  function Section({ title, rows, total, headerClass }) {
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className={`px-4 py-3 border-b border-slate-200 ${headerClass}`}>
          <h4 className="font-bold text-sm">{title}</h4>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.length > 0 ? rows.map((r, i) => {
              const amt = Number(r.amount ?? r.total ?? 0);
              const isNeg = amt < 0;
              return (
                <tr key={i} className="hover:bg-slate-50/60">
                  <td className={`px-4 py-2.5 ${isNeg ? "text-red-600" : "text-slate-700"}`}>
                    {r.category || r.name}
                    {isNeg && <span className="ml-1 text-[10px] text-red-400">(pengurang)</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono ${isNeg ? "text-red-600" : ""}`}>
                    {isNeg ? `(${fmt(Math.abs(amt))})` : fmt(amt)}
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={2} className="px-4 py-3 text-center text-slate-400 text-xs">Tidak ada data</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className={`font-bold border-t border-slate-200 ${total < 0 ? "bg-red-50" : "bg-slate-50"}`}>
              <td className="px-4 py-3">Total {title}</td>
              <td className={`px-4 py-3 text-right font-mono ${total < 0 ? "text-red-700" : "text-slate-900"}`}>
                {total < 0 ? `(${fmt(Math.abs(total))})` : fmt(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-4">
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${balanced ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
        <span className="material-symbols-outlined text-[18px]">{balanced ? "check_circle" : "warning"}</span>
        {balanced ? "Neraca seimbang" : "Neraca tidak seimbang — periksa entri jurnal Anda."}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Aset" rows={assets} total={totalAssets} headerClass="bg-blue-50 text-blue-700" />
        <div className="space-y-4">
          <Section title="Kewajiban" rows={liabilities} total={totalLiabilities} headerClass="bg-amber-50 text-amber-700" />
          <Section title="Ekuitas" rows={equity} total={totalEquity} headerClass="bg-emerald-50 text-emerald-700" />
        </div>
      </div>
      <div className={`flex items-center justify-between rounded-xl px-6 py-4 ${balanced ? "bg-slate-800" : "bg-red-700"}`}>
        <span className="font-bold text-white text-sm">Total Aset = Total Kewajiban + Ekuitas</span>
        <div className="text-right">
          <span className="font-bold text-white font-mono">{fmt(totalAssets)}</span>
          <span className="text-white/70 text-xs ml-2">vs {fmt(totalLiabilities + totalEquity)}</span>
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={() => setShowProduce(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:opacity-90 cursor-pointer">
          <span className="material-symbols-outlined text-[16px]">description</span>
          Produksi Laporan
        </button>
      </div>
    </div>
    {showProduce && <ProduceModal onClose={() => setShowProduce(false)} onGoToDokumen={onGoToDokumen} reportTitle="Neraca" reportType="balance-sheet" period={periodLabel} data={data} />}
    </>
  );
}
