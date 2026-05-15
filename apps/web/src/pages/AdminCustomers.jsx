import { useState, useEffect, useMemo, useCallback } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";
import TablePagination, { usePagination } from "../components/TablePagination";
import SharedImportModal from "../components/SharedImportModal";
import SharedExportModal from "../components/SharedExportModal";
import { exportAs } from "../lib/dataFormats";

const statusColors = {
  active: "bg-green-100 text-green-700",
  vip: "bg-purple-100 text-purple-700",
  inactive: "bg-slate-100 text-slate-600",
  pending: "bg-amber-100 text-amber-700",
};

const typeColors = {
  private: "bg-blue-50 text-blue-600",
  company: "bg-orange-50 text-orange-600",
};

const emptyForm = {
  name: "", email: "", phone: "", whatsapp: "",
  customerType: "private", job: "", address: "",
  status: "active", notes: "",
};

export default function AdminCustomers() {
  const { t } = useLanguage();
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const cacheKey = `customers:list:${statusFilter}:${typeFilter}:${sortBy}:${sortOrder}`;
  const [customers, setCustomers] = useState(() => apiCache.get(cacheKey)?.data || []);
  const [stats, setStats] = useState(() => apiCache.get("customers:stats") || null);
  const [loading, setLoading] = useState(() => !apiCache.has(cacheKey));
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // ─── Bulk select state ─────────────────────────────────────────────────────
  const [selected, setSelected] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deduplicating, setDeduplicating] = useState(false);

  // ─── Toast state ───────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null); // { msg, type: "success"|"error" }
  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => { loadCustomers(); }, [statusFilter, typeFilter, sortBy, sortOrder]);

  async function loadCustomers() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (typeFilter) params.set("customerType", typeFilter);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    params.set("limit", "5000");
    const listKey = `customers:list:${statusFilter}:${typeFilter}:${sortBy}:${sortOrder}`;

    swr(listKey, () => api.customers.list(params.toString()), (data) => {
      setCustomers(data?.data || []);
      setLoading(false);
    }).catch(err => { console.error("Failed to load customers:", err); setLoading(false); });

    swr("customers:stats", () => api.customers.stats(), (s) => setStats(s))
      .catch(err => console.error("Failed to load customer stats:", err));
  }

  function handleSort(field) {
    if (sortBy === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortOrder("asc"); }
  }

  function SortIcon({ field }) {
    if (sortBy !== field) return <span className="material-symbols-outlined text-[14px] text-slate-300 ml-1">unfold_more</span>;
    return <span className="material-symbols-outlined text-[14px] text-primary ml-1">{sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}</span>;
  }

  function openAdd() { setForm(emptyForm); setEditingId(null); setShowModal(true); }

  function openEdit(cust) {
    setForm({
      name: cust.name, email: cust.email || "", phone: cust.phone || "",
      whatsapp: cust.whatsapp || "", customerType: cust.customerType || "private",
      job: cust.job || "", address: cust.address || "",
      status: cust.status, notes: cust.notes || "",
    });
    setEditingId(cust.id);
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) await api.customers.update(editingId, form);
      else await api.customers.create(form);
      setShowModal(false);
      apiCache.invalidate("customers:");
      loadCustomers();
      showToast(editingId ? "Pelanggan diperbarui." : "Pelanggan ditambahkan.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Hapus pelanggan ini?")) return;
    try {
      await api.customers.delete(id);
      apiCache.invalidate("customers:");
      loadCustomers();
      showToast("Pelanggan dihapus.");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  // ─── Bulk delete ───────────────────────────────────────────────────────────
  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Hapus ${selected.size} pelanggan yang dipilih? Pelanggan yang memiliki pesanan akan dilewati.`)) return;
    setBulkDeleting(true);
    try {
      const result = await api.customers.bulkDelete([...selected]);
      apiCache.invalidate("customers:");
      setSelected(new Set());
      loadCustomers();
      if (result.skipped > 0) {
        showToast(`${result.deleted} dihapus. ${result.skipped} dilewati (memiliki pesanan): ${result.skippedNames?.join(", ")}`, "error");
      } else {
        showToast(`${result.deleted} pelanggan berhasil dihapus.`);
      }
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setBulkDeleting(false);
    }
  }

  // ─── Deduplicate ───────────────────────────────────────────────────────────
  async function handleDeduplicate() {
    if (!confirm("Gabungkan semua pelanggan dengan nama yang sama? Pesanan akan dipindahkan ke satu entri, duplikat akan dihapus.")) return;
    setDeduplicating(true);
    try {
      const result = await api.customers.deduplicate();
      apiCache.invalidate("customers:");
      loadCustomers();
      showToast(result.message);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setDeduplicating(false);
    }
  }

  // ─── Export / Import ───────────────────────────────────────────────────────
  async function runExport(format) {
    const data = await api.customers.exportData();
    await exportAs(data, format, "pelanggan-export");
  }

  async function runImport(rows) {
    if (!Array.isArray(rows)) throw new Error("File harus berisi array data pelanggan.");
    const result = await api.customers.importData(rows);
    apiCache.invalidate("customers:");
    loadCustomers();
    return result;
  }

  function handleStatClick(stat) {
    if (stat === "all") { setStatusFilter(""); setTypeFilter(""); }
    else if (["active", "vip", "inactive"].includes(stat)) { setStatusFilter(statusFilter === stat ? "" : stat); setTypeFilter(""); }
    else if (["private", "company"].includes(stat)) { setTypeFilter(typeFilter === stat ? "" : stat); setStatusFilter(""); }
  }

  const formatDate = (d) => d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";

  // ─── Deduplicated display: one row per unique name (by lowest id) ──────────
  const deduplicatedCustomers = useMemo(() => {
    const seen = new Map(); // name.toLowerCase() → customer
    for (const c of customers) {
      const key = c.name?.trim().toLowerCase();
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, c);
      else {
        // Prefer the one with more orders; on tie keep the older id
        const prev = seen.get(key);
        if ((c.totalOrders ?? 0) > (prev.totalOrders ?? 0)) seen.set(key, c);
      }
    }
    return [...seen.values()];
  }, [customers]);

  // Client-side search applied on deduplicated list
  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deduplicatedCustomers;
    return deduplicatedCustomers.filter(cust => {
      const typeLabel = cust.customerType === "company" ? "Perusahaan" : "Pribadi";
      const parts = [
        cust.name, cust.email, cust.phone, cust.whatsapp,
        cust.companyName, cust.job, cust.address, cust.notes,
        cust.customerType, typeLabel, cust.status,
        String(cust.totalOrders ?? ""),
        formatDate(cust.lastOrderDate),
      ];
      return parts.filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [deduplicatedCustomers, search]);

  const { page, setPage, pageSize, setPageSize, paged: pagedCustomers } = usePagination(filteredCustomers, {
    storageKey: "dsr:customers:pageSize",
    deps: [search, statusFilter, typeFilter, sortBy, sortOrder],
  });

  // ─── Select helpers ────────────────────────────────────────────────────────
  const allPageIds = pagedCustomers.map(c => c.id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelected(prev => { const n = new Set(prev); allPageIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); allPageIds.forEach(id => n.add(id)); return n; });
    }
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ─── Duplicate count badge ─────────────────────────────────────────────────
  const duplicateCount = customers.length - deduplicatedCustomers.length;

  return (
    <AdminLayout>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.type === "error" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
        }`}>
          <span className="material-symbols-outlined text-[18px]">{toast.type === "error" ? "error" : "check_circle"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("customers")}</h1>
          <p className="text-slate-500 text-sm mt-1">Kelola data pelanggan</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {duplicateCount > 0 && (
            <button
              onClick={handleDeduplicate}
              disabled={deduplicating}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">{deduplicating ? "hourglass_empty" : "merge"}</span>
              {deduplicating ? "Menggabungkan..." : `Hapus Duplikat (${duplicateCount})`}
            </button>
          )}
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">upload</span>
            Import
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:opacity-90 transition-colors shadow-sm cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">person_add</span>
            {t("addCustomer")}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { key: "all",      label: "Total",       value: stats.total,    icon: "group",        color: "bg-blue-500",   active: !statusFilter && !typeFilter },
            { key: "active",   label: t("active"),   value: stats.active,   icon: "check_circle", color: "bg-green-500",  active: statusFilter === "active" },
            { key: "vip",      label: t("vip"),      value: stats.vip,      icon: "star",         color: "bg-purple-500", active: statusFilter === "vip" },
            { key: "inactive", label: t("inactive"), value: stats.inactive, icon: "pause_circle", color: "bg-slate-400",  active: statusFilter === "inactive" },
            { key: "private",  label: t("private"),  value: stats.private,  icon: "person",       color: "bg-blue-400",   active: typeFilter === "private" },
            { key: "company",  label: t("company"),  value: stats.company,  icon: "business",     color: "bg-orange-500", active: typeFilter === "company" },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => handleStatClick(s.key)}
              className={`bg-white rounded-xl border shadow-sm p-3 flex items-center gap-3 cursor-pointer text-left transition-all ${
                s.active ? "border-primary ring-2 ring-primary/20" : "border-slate-200 hover:border-slate-300 hover:shadow"
              }`}
            >
              <div className={`${s.color} text-white p-2 rounded-lg`}>
                <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-medium uppercase">{s.label}</p>
                <p className="text-lg font-bold text-slate-900">{s.value}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setSelected(new Set()); }}
            placeholder="Cari nama, email, HP, tipe, pekerjaan, status…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSelected(new Set()); }}
          className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer">
          <option value="">Semua Status</option>
          <option value="active">{t("active")}</option>
          <option value="vip">{t("vip")}</option>
          <option value="inactive">{t("inactive")}</option>
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setSelected(new Set()); }}
          className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer">
          <option value="">Semua Tipe</option>
          <option value="private">{t("private")}</option>
          <option value="company">{t("company")}</option>
        </select>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <span className="material-symbols-outlined text-red-500">checklist</span>
          <span className="text-sm font-medium text-red-700">{selected.size} pelanggan dipilih</span>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 cursor-pointer disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]">{bulkDeleting ? "hourglass_empty" : "delete"}</span>
            {bulkDeleting ? "Menghapus..." : "Hapus yang Dipilih"}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-2 text-sm text-red-600 hover:text-red-800 cursor-pointer"
          >
            Batal
          </button>
        </div>
      )}

      {/* Pagination */}
      {filteredCustomers.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalCount={deduplicatedCustomers.length}
          filteredCount={filteredCustomers.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase align-middle">
                <th className="px-3 py-3 text-center align-middle w-10">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectAll}
                    className="cursor-pointer accent-primary"
                  />
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle" style={{ minWidth: 40 }}>No.</th>
                <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("name")}>
                  <span className="inline-flex items-center gap-1">{t("customerName")}<SortIcon field="name" /></span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle">{t("phone")}</th>
                <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("customerType")}>
                  <span className="inline-flex items-center gap-1">{t("customerType")}<SortIcon field="customerType" /></span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle">{t("job")}</th>
                <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("status")}>
                  <span className="inline-flex items-center gap-1">{t("status")}<SortIcon field="status" /></span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle" style={{ minWidth: 90 }}>{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedCustomers.map((cust, idx) => (
                <tr
                  key={cust.id}
                  className={`hover:bg-slate-50/60 transition-colors ${selected.has(cust.id) ? "bg-red-50/40" : ""}`}
                >
                  <td className="px-3 py-3 text-center align-middle">
                    <input
                      type="checkbox"
                      checked={selected.has(cust.id)}
                      onChange={() => toggleSelect(cust.id)}
                      className="cursor-pointer accent-primary"
                    />
                  </td>
                  <td className="px-3 py-3 text-center align-middle text-slate-500 tabular-nums">
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  <td className="px-3 py-3 text-left align-middle">
                    <p className="font-medium text-slate-900">{cust.name}</p>
                    <p className="text-xs text-slate-400">{cust.email || "-"}</p>
                  </td>
                  <td className="px-3 py-3 text-left align-middle text-slate-600">{cust.phone || "-"}</td>
                  <td className="px-3 py-3 text-left align-middle">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeColors[cust.customerType] || "bg-slate-100 text-slate-600"}`}>
                      {cust.customerType === "company" ? "🏢 Perusahaan" : "👤 Pribadi"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-left align-middle text-slate-600">{cust.job || "-"}</td>
                  <td className="px-3 py-3 text-left align-middle">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[cust.status]}`}>{t(cust.status)}</span>
                  </td>
                  <td className="px-3 py-3 text-center align-middle">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(cust)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer">
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button onClick={() => handleDelete(cust.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-400">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                      Memuat...
                    </span>
                  ) : "Tidak ada data"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? "Edit Pelanggan" : t("addCustomer")}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("customerName")} *</label>
                  <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("email")}</label>
                  <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("phone")}</label>
                  <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("whatsapp")}</label>
                  <input type="tel" value={form.whatsapp} onChange={e => setForm({...form, whatsapp: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("customerType")}</label>
                  <select value={form.customerType} onChange={e => setForm({...form, customerType: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                    <option value="private">{t("private")}</option><option value="company">{t("company")}</option>
                  </select></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("job")}</label>
                  <input type="text" value={form.job} onChange={e => setForm({...form, job: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("status")}</label>
                  <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                    <option value="active">{t("active")}</option><option value="vip">{t("vip")}</option><option value="inactive">{t("inactive")}</option>
                  </select></div>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">{t("address")}</label>
                <textarea value={form.address} onChange={e => setForm({...form, address: e.target.value})} rows={2} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none" /></div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">{t("cancel")}</button>
                <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-60">{saving ? "Menyimpan..." : t("save")}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExport && (
        <SharedExportModal
          title="Export Data Pelanggan"
          exportFn={runExport}
          onClose={() => setShowExport(false)}
        />
      )}
      {showImport && (
        <SharedImportModal
          title="Import Data Pelanggan"
          hint="Kolom yang dikenali: name, email, phone, whatsapp, customerType (private/company), job, address, status (active/vip/inactive), notes"
          importFn={runImport}
          onClose={() => setShowImport(false)}
          onSuccess={() => showToast("Import pelanggan selesai.")}
        />
      )}
    </AdminLayout>
  );
}
