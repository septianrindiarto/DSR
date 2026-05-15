import { useState, useEffect, useMemo, useRef } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";
import TablePagination, { usePagination } from "../components/TablePagination";
import FormatPickerModal from "../components/FormatPickerModal";
import { exportAs, parse as parseDataFile, acceptForFormat } from "../lib/dataFormats";

const statusColors = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-slate-100 text-slate-600",
  suspended: "bg-red-100 text-red-700",
};

// Resolve `/uploads/...` paths to a fully-qualified URL so anchor tags work
// even when the web app runs on a different origin than the API (dev: web on
// :5173, API on :5000).
const API_ORIGIN = "http://localhost:5000";
const docHref = (url) => (url ? (url.startsWith("http") ? url : `${API_ORIGIN}${url}`) : null);

const emptyForm = {
  name: "", phone: "", licenseNumber: "", licenseExpiry: "",
  status: "active", address: "", notes: "",
};

const emptyFiles = { licenseDoc: null, idCard: null, photo: null };

export default function AdminDrivers() {
  const { t } = useLanguage();
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const cacheKey = `drivers:list:${statusFilter}:${sortBy}:${sortOrder}`;
  const [drivers, setDrivers] = useState(() => apiCache.get(cacheKey)?.data || []);
  const [stats, setStats] = useState(() => apiCache.get("drivers:stats") || null);
  const [loading, setLoading] = useState(() => !apiCache.has(cacheKey));
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  // Modal tab + document upload state
  const [activeTab, setActiveTab] = useState("data"); // "data" | "dokumen"
  const [files, setFiles] = useState(emptyFiles); // pending uploads, sent after save
  // Existing document URLs for the driver being edited (used to render previews)
  const [existingDocs, setExistingDocs] = useState({ licenseDocUrl: null, idCardUrl: null, photoUrl: null });
  // Format-picker state for Export/Import (multi-format support)
  const [formatPicker, setFormatPicker] = useState(null);
  const [pendingImportFormat, setPendingImportFormat] = useState(null);
  const [importAccept, setImportAccept] = useState("");

  // Client-side search — re-fetch only on filter/sort change
  useEffect(() => { loadDrivers(); }, [statusFilter, sortBy, sortOrder]);

  async function loadDrivers() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    params.set("limit", "5000"); // client-side pagination — fetch all
    const listKey = `drivers:list:${statusFilter}:${sortBy}:${sortOrder}`;

    swr(listKey, () => api.drivers.list(params.toString()), (data) => {
      setDrivers(data?.data || []);
      setLoading(false);
    }).catch(err => { console.error("Failed to load drivers:", err); setLoading(false); });

    swr("drivers:stats", () => api.drivers.stats(), (s) => setStats(s))
      .catch(err => console.error("Failed to load driver stats:", err));
  }

  function handleSort(field) {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  }

  function SortIcon({ field }) {
    if (sortBy !== field) return <span className="material-symbols-outlined text-[14px] text-slate-300 ml-1">unfold_more</span>;
    return <span className="material-symbols-outlined text-[14px] text-primary ml-1">{sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}</span>;
  }

  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setFiles(emptyFiles);
    setExistingDocs({ licenseDocUrl: null, idCardUrl: null, photoUrl: null });
    setActiveTab("data");
    setShowModal(true);
  }

  function openEdit(driver) {
    setForm({
      name: driver.name,
      phone: driver.phone,
      licenseNumber: driver.licenseNumber || "",
      licenseExpiry: driver.licenseExpiry ? driver.licenseExpiry.split("T")[0] : "",
      status: driver.status,
      address: driver.address || "",
      notes: driver.notes || "",
    });
    setEditingId(driver.id);
    setFiles(emptyFiles);
    setExistingDocs({
      licenseDocUrl: driver.licenseDocUrl || null,
      idCardUrl: driver.idCardUrl || null,
      photoUrl: driver.photoUrl || null,
    });
    setActiveTab("data");
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      // Step 1 — save the row first, since the upload endpoint needs an id.
      let driverId = editingId;
      if (editingId) {
        await api.drivers.update(editingId, form);
      } else {
        const created = await api.drivers.create(form);
        driverId = created?.id;
      }

      // Step 2 — if any documents were chosen, upload them all in one request.
      const hasFiles = files.licenseDoc || files.idCard || files.photo;
      if (driverId && hasFiles) {
        const fd = new FormData();
        if (files.licenseDoc) fd.append("licenseDoc", files.licenseDoc);
        if (files.idCard) fd.append("idCard", files.idCard);
        if (files.photo) fd.append("photo", files.photo);
        await api.drivers.upload(driverId, fd);
      }

      setShowModal(false);
      setFiles(emptyFiles);
      apiCache.invalidate("drivers:");
      loadDrivers();
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Hapus driver ini? Tindakan ini tidak dapat dibatalkan.")) return;
    try {
      await api.drivers.delete(id);
      apiCache.invalidate("drivers:");
      loadDrivers();
    } catch (error) {
      alert(error.message);
    }
  }

  // ─── Export / Import — multi-format with picker popup ───────────────────
  async function runExport(format) {
    try {
      const data = await api.drivers.exportData();
      await exportAs(data, format, "driver-export");
    } catch (error) { alert("Export gagal: " + error.message); }
  }

  async function runImport(file, format) {
    setImporting(true);
    try {
      const data = await parseDataFile(file, format);
      if (!Array.isArray(data)) throw new Error("File harus berisi array data driver.");
      const result = await api.drivers.importData(data);
      const errLines = (result.errors || []).slice(0, 5).join("\n");
      const tail = errLines ? `\n\nContoh error:\n${errLines}` : "";
      alert(`Impor selesai: ${result.imported} ok, ${result.skipped} skipped${tail}`);
      apiCache.invalidate("drivers:");
      loadDrivers();
    } catch (error) {
      alert("Import gagal: " + error.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const formatDate = (d) => d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";

  // Client-side haystack search — match on every value the user can see on the row
  const filteredDrivers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(driver => {
      const docs = [];
      if (driver.licenseDocUrl) docs.push("SIM");
      if (driver.idCardUrl) docs.push("KTP");
      if (driver.photoUrl) docs.push("Foto");
      const parts = [
        driver.name, driver.phone, driver.licenseNumber,
        formatDate(driver.licenseExpiry),
        driver.status, driver.status ? t(driver.status) : "",
        driver.address, driver.notes,
        docs.join(" "),
      ];
      return parts.filter(Boolean).join(" \u0001 ").toLowerCase().includes(q);
    });
  }, [drivers, search, t]);

  // Pagination — auto-resets to page 1 when search/filter/sort change
  const { page, setPage, pageSize, setPageSize, paged: pagedDrivers } = usePagination(filteredDrivers, {
    storageKey: "dsr:drivers:pageSize",
    deps: [search, statusFilter, sortBy, sortOrder],
  });

  // No full-page spinner gate — render immediately, show inline loader inside the table.

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("drivers")}</h1>
          <p className="text-slate-500 text-sm mt-1">Kelola data driver dan dokumen</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Export on the left, Import on the right */}
          <button
            onClick={() => setFormatPicker({ mode: "export" })}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export
          </button>
          <button
            onClick={() => setFormatPicker({ mode: "import" })}
            disabled={importing}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">{importing ? "hourglass_empty" : "upload"}</span>
            {importing ? "Mengimpor..." : "Import"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={importAccept}
            className="hidden"
            disabled={importing}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              const fmt = pendingImportFormat;
              e.target.value = "";
              if (file && fmt) await runImport(file, fmt);
              setPendingImportFormat(null);
            }}
          />
          <button onClick={openAdd} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark transition-colors shadow-sm cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">person_add</span>
            {t("addDriver")}
          </button>
        </div>
      </div>

      {/* Stats — clickable filter chips */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { key: "all",       label: "Total Driver", value: stats.total,     icon: "badge",        color: "bg-blue-500",  active: !statusFilter },
            { key: "active",    label: t("active"),    value: stats.active,    icon: "check_circle", color: "bg-green-500", active: statusFilter === "active" },
            { key: "inactive",  label: t("inactive"),  value: stats.inactive,  icon: "pause_circle", color: "bg-slate-400", active: statusFilter === "inactive" },
            { key: "suspended", label: t("suspended"), value: stats.suspended, icon: "block",        color: "bg-red-500",   active: statusFilter === "suspended" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key === "all" ? "" : (statusFilter === s.key ? "" : s.key))}
              title={`Filter: ${s.label}`}
              className={`bg-white rounded-xl border shadow-sm p-4 flex items-center gap-3 cursor-pointer text-left transition-all ${
                s.active ? "border-primary ring-2 ring-primary/20" : "border-slate-200 hover:border-slate-300 hover:shadow"
              }`}
            >
              <div className={`${s.color} text-white p-2 rounded-lg`}>
                <span className="material-symbols-outlined text-[20px]">{s.icon}</span>
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">{s.label}</p>
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
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari di semua kolom (nama, HP, SIM, status, alamat, dll.)…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer"
        >
          <option value="">Semua Status</option>
          <option value="active">{t("active")}</option>
          <option value="inactive">{t("inactive")}</option>
          <option value="suspended">{t("suspended")}</option>
        </select>
      </div>

      {/* Sticky pagination — stays in view while scrolling the table */}
      {filteredDrivers.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalCount={drivers.length}
          filteredCount={filteredDrivers.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Table — alignment matches Rekap Order: centered headers/cells, name left-aligned. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase align-middle">
                <th className="px-3 py-3 font-semibold text-center align-middle" style={{ minWidth: 50 }}>
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("no_") || "No."}</span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("name")}>
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("driverName")}<SortIcon field="name" /></span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("phone")}>
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("phone")}<SortIcon field="phone" /></span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle">
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("licenseNumber")}</span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("licenseExpiry")}>
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("licenseExpiry")}<SortIcon field="licenseExpiry" /></span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("status")}>
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("status")}<SortIcon field="status" /></span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle" style={{ minWidth: 180 }}>
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("address")}</span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle">
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("documents")}</span>
                </th>
                <th className="px-3 py-3 font-semibold text-center align-middle" style={{ minWidth: 100 }}>
                  <span className="inline-flex items-center justify-center gap-1 align-middle">{t("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedDrivers.map((driver, idx) => (
                <tr key={driver.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-3 py-3 text-right align-middle text-slate-500 tabular-nums">
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  <td className="px-3 py-3 text-left align-middle">
                    <p className="font-medium text-slate-900">{driver.name}</p>
                  </td>
                  <td className="px-3 py-3 text-left align-middle text-slate-600">{driver.phone}</td>
                  <td className="px-3 py-3 text-left align-middle text-slate-600 font-mono text-xs">{driver.licenseNumber || "-"}</td>
                  <td className="px-3 py-3 text-left align-middle text-slate-600">{formatDate(driver.licenseExpiry)}</td>
                  <td className="px-3 py-3 text-left align-middle">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[driver.status]}`}>
                      {t(driver.status)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-left align-middle text-slate-600 text-xs max-w-[220px]" title={driver.address || ""}>
                    <p className="line-clamp-2">{driver.address || "-"}</p>
                  </td>
                  <td className="px-3 py-3 text-left align-middle">
                    <div className="flex gap-1">
                      {driver.licenseDocUrl && <span className="material-symbols-outlined text-[16px] text-green-500" title="SIM">description</span>}
                      {driver.idCardUrl && <span className="material-symbols-outlined text-[16px] text-green-500" title="KTP">badge</span>}
                      {driver.photoUrl && <span className="material-symbols-outlined text-[16px] text-green-500" title="Foto">photo</span>}
                      {!driver.licenseDocUrl && !driver.idCardUrl && !driver.photoUrl && (
                        <span className="text-xs text-slate-400">Belum ada</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center align-middle">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(driver)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer" title={t("edit")}>
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button onClick={() => handleDelete(driver.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer" title={t("delete")}>
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDrivers.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-12 text-center text-slate-400">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                      {t("loading") || "Memuat..."}
                    </span>
                  ) : t("noData")}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal — see DocField component at bottom of file */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? "Edit Driver" : t("addDriver")}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {/* Tab switcher — Data / Dokumen */}
            <div className="px-5 pt-4 flex gap-1 border-b border-slate-100">
              {[
                { key: "data", label: "Data Driver", icon: "person" },
                { key: "dokumen", label: "Dokumen", icon: "folder" },
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px cursor-pointer transition-colors ${
                    activeTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4">
              {activeTab === "data" && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t("driverName")} *</label>
                      <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t("phone")} *</label>
                      <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t("licenseNumber")}</label>
                      <input type="text" value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">{t("licenseExpiry")}</label>
                      <input type="date" value={form.licenseExpiry} onChange={(e) => setForm({ ...form, licenseExpiry: e.target.value })}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t("status")}</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                      <option value="active">{t("active")}</option>
                      <option value="inactive">{t("inactive")}</option>
                      <option value="suspended">{t("suspended")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">{t("address")}</label>
                    <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Catatan</label>
                    <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none" />
                  </div>
                </>
              )}

              {activeTab === "dokumen" && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500">
                    Format yang didukung: JPG, PNG, GIF, atau PDF. Maksimal 10 MB per file.
                  </p>
                  <DocField
                    label="SIM (Surat Izin Mengemudi)"
                    icon="description"
                    field="licenseDoc"
                    file={files.licenseDoc}
                    existingUrl={existingDocs.licenseDocUrl}
                    onPick={(f) => setFiles(prev => ({ ...prev, licenseDoc: f }))}
                  />
                  <DocField
                    label="KTP (Kartu Tanda Penduduk)"
                    icon="badge"
                    field="idCard"
                    file={files.idCard}
                    existingUrl={existingDocs.idCardUrl}
                    onPick={(f) => setFiles(prev => ({ ...prev, idCard: f }))}
                  />
                  <DocField
                    label="Foto Driver"
                    icon="photo_camera"
                    field="photo"
                    file={files.photo}
                    existingUrl={existingDocs.photoUrl}
                    onPick={(f) => setFiles(prev => ({ ...prev, photo: f }))}
                  />
                  {!editingId && (
                    <p className="text-xs text-slate-500 italic">
                      Catatan: dokumen akan diunggah setelah data driver disimpan.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                  {t("cancel")}
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark cursor-pointer disabled:opacity-60">
                  {saving ? "Menyimpan..." : t("save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Format picker — shown before Export or Import */}
      {formatPicker && (
        <FormatPickerModal
          mode={formatPicker.mode}
          defaultFormat="xlsx"
          onCancel={() => setFormatPicker(null)}
          onConfirm={async (format) => {
            const mode = formatPicker.mode;
            setFormatPicker(null);
            if (mode === "export") {
              await runExport(format);
            } else {
              setPendingImportFormat(format);
              setImportAccept(acceptForFormat(format));
              setTimeout(() => fileInputRef.current?.click(), 0);
            }
          }}
        />
      )}
    </AdminLayout>
  );
}

// ─── Document upload field ─────────────────────────────────────────────
// Renders: a label, the existing file (if any) as a "View" link, and a file
// picker. The chosen file is held in parent state and uploaded after save.
function DocField({ label, icon, field, file, existingUrl, onPick }) {
  const inputId = `doc-${field}`;
  const existingHref = existingUrl
    ? (existingUrl.startsWith("http") ? existingUrl : `http://localhost:5000${existingUrl}`)
    : null;
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-slate-500">{icon}</span>
          <span className="text-sm font-medium text-slate-700">{label}</span>
        </div>
        {existingHref && !file && (
          <a
            href={existingHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            Lihat dokumen
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          className="flex-1 cursor-pointer px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-slate-50 hover:border-primary text-center"
        >
          {file ? (
            <span className="text-slate-800">
              <span className="material-symbols-outlined text-[14px] align-middle text-green-600 mr-1">check_circle</span>
              {file.name}
            </span>
          ) : existingHref ? (
            "Pilih file untuk mengganti"
          ) : (
            "Pilih file (JPG / PNG / PDF, maks. 10 MB)"
          )}
          <input
            id={inputId}
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.pdf"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] || null)}
          />
        </label>
        {file && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"
            title="Batal pilih"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </div>
    </div>
  );
}
