import { useState, useEffect, useRef, useMemo } from "react";
import InlineEdit from "../components/InlineEdit";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr, carImgSrc } from "../lib/api";
import TablePagination, { usePagination } from "../components/TablePagination";
import SharedImportModal from "../components/SharedImportModal";
import SharedExportModal from "../components/SharedExportModal";
import { exportAs } from "../lib/dataFormats";
import { useToast } from '../components/Toast';
import { useAuth } from "../context/AuthContext";
import { can } from "../lib/permissions";

import AsyncButton from "../components/AsyncButton";
import CarTypesModal from "../components/fleet/CarTypesModal";
import UnitEventsModal from "../components/fleet/UnitEventsModal";
const statusColors = {
  available: "bg-green-100 text-green-700",
  rented: "bg-blue-100 text-blue-700",
  maintenance: "bg-amber-100 text-amber-700",
};

const IMAGE_LABELS = ['Tampak Depan', 'Tampak Samping', 'Tampak Belakang'];

const emptyForm = {
  name: "", brand: "", type: "MPV", category: "standard", year: 2024,
  licensePlate: "", isOwned: false, color: "", image: "", price: "",
  capacity: 7, transmission: "Automatic", fuel: "Bensin",
  description: "", features: [], status: "available", availableCount: 1,
  gallery: [],
};

export default function AdminFleet() {
  const { t } = useLanguage();
  const toast = useToast();
  // RBAC v2 — hide what the server would refuse.
  const { user: authUser } = useAuth();
  const canCreate = can(authUser, "fleet", "create");
  const canEdit = can(authUser, "fleet", "edit");
  const canDelete = can(authUser, "fleet", "delete");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  // Hydrate from cache so the table renders on the FIRST paint
  const cacheKey = `cars:list:${statusFilter}:${sortBy}:${sortOrder}`;
  const [cars, setCars] = useState(() => apiCache.get(cacheKey)?.data || []);
  const [stats, setStats] = useState(() => apiCache.get("cars:stats") || null);
  const [loading, setLoading] = useState(() => !apiCache.has(cacheKey));
  const [showModal, setShowModal] = useState(false);
  const [eventsCar, setEventsCar] = useState(null);   // Perawatan & darurat per unit
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState("table");
  const [imageFiles, setImageFiles] = useState([null, null, null]);
  const [imagePreviews, setImagePreviews] = useState(['', '', '']);
  const fileInputRefs = [useRef(null), useRef(null), useRef(null)];
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  // Bulk selection of units for one-shot status changes.
  const [selectedCars, setSelectedCars] = useState(() => new Set());
  // Vehicle types = the agency's own list (Kelola tipe), not a fixed set.
  const [typesData, setTypesData] = useState(() => apiCache.get("cars:types") || null);
  const [showTypes, setShowTypes] = useState(false);
  useEffect(() => {
    swr("cars:types", () => api.cars.types(), (d) => setTypesData(d)).catch(() => {});
  }, []);
  const carTypes = typesData?.types?.length ? typesData.types : ["MPV", "SUV", "Sedan", "City Car", "Sport"];
  // Keep a car's current value selectable even if it was removed from the list.
  const typeOptions = (current) => (current && !carTypes.includes(current) ? [...carTypes, current] : carTypes);

  // Client-side search — re-fetch only on filter/sort change
  useEffect(() => { loadCars(); }, [statusFilter, sortBy, sortOrder]);

  async function loadCars() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    params.set("limit", "5000"); // client-side pagination — fetch all
    const listKey = `cars:list:${statusFilter}:${sortBy}:${sortOrder}`;

    // Stale-while-revalidate — render cached rows instantly, refresh in bg.
    swr(listKey, () => api.cars.list(params.toString()), (data) => {
      setCars(data?.data || []);
      setLoading(false);
    }).catch(err => { console.error("Failed to load cars:", err); setLoading(false); });

    swr("cars:stats", () => api.cars.stats(), (s) => setStats(s))
      .catch(err => console.error("Failed to load car stats:", err));
  }

  function handleSort(field) {
    if (sortBy === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortOrder("asc"); }
  }

  function SortIcon({ field }) {
    if (sortBy !== field) return <span className="material-symbols-outlined text-[14px] text-slate-300 ml-1">unfold_more</span>;
    return <span className="material-symbols-outlined text-[14px] text-primary ml-1">{sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}</span>;
  }

  function openAdd() {
    setForm({ ...emptyForm, type: carTypes[0] || "" });
    setEditingId(null);
    setImageFiles([null, null, null]);
    setImagePreviews(['', '', '']);
    setShowModal(true);
  }

  function openEdit(car) {
    const gallery = car.gallery || [];
    setForm({
      name: car.name, brand: car.brand, type: car.type,
      category: car.category || "standard", year: car.year || 2024,
      licensePlate: car.licensePlate || "", isOwned: !!car.isOwned, color: car.color || "",
      image: car.image, price: car.price,
      capacity: car.capacity, transmission: car.transmission,
      fuel: car.fuel || "Bensin", description: car.description || "",
      features: car.features || [], status: car.status,
      availableCount: car.availableCount || 1, gallery,
    });
    setImageFiles([null, null, null]);
    // Show existing images as previews
    const previews = [
      car.image || '',
      gallery[0] || '',
      gallery[1] || '',
    ];
    setImagePreviews(previews.map(p => p.startsWith('/uploads') ? carImgSrc(p) : p));
    setEditingId(car.id);
    setShowModal(true);
  }

  function handleFileSelect(index, file) {
    if (!file) return;
    const newFiles = [...imageFiles];
    newFiles[index] = file;
    setImageFiles(newFiles);
    const newPreviews = [...imagePreviews];
    newPreviews[index] = URL.createObjectURL(file);
    setImagePreviews(newPreviews);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      // Check minimum 3 images for new cars
      const hasNewFiles = imageFiles.some(f => f !== null);
      let imageUrl = form.image;
      let gallery = form.gallery || [];

      if (hasNewFiles) {
        const fd = new FormData();
        imageFiles.forEach(f => { if (f) fd.append('images', f); });
        const uploadResult = await api.cars.uploadImages(fd);
        const urls = uploadResult.urls || [];
        if (urls.length > 0) imageUrl = urls[0];
        if (urls.length > 1) gallery = urls.slice(1);
      }

      if (!editingId && !imageUrl) {
        toast.error(t('minImagesRequired'));
        setSaving(false);
        return;
      }

      const data = {
        ...form,
        image: imageUrl,
        gallery,
        price: String(form.price),
        year: Number(form.year),
        capacity: Number(form.capacity),
        availableCount: Number(form.availableCount),
      };
      if (editingId) await api.cars.update(editingId, data);
      else await api.cars.create(data);
      setShowModal(false);
      apiCache.invalidate("cars:");
      loadCars();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  // Inline (hover ✏️) save — one field at a time.
  async function saveCar(car, patch) {
    try {
      await api.cars.update(car.id, patch);
      toast.success(t("inlineSaved"));
      apiCache.invalidate("cars:");
      loadCars();
    } catch (e) { toast.error(e.message); throw e; }
  }
  const sel = (vals, fmt = (v) => v) => vals.map((v) => ({ value: v, label: fmt(v) }));

  async function handleDelete(id) {
    if (!confirm("Hapus mobil ini? Tindakan ini tidak dapat dibatalkan.")) return;
    try {
      await api.cars.delete(id);
      apiCache.invalidate("cars:");
      loadCars();
    } catch (error) {
      toast.error(error.message);
    }
  }

  // ─── Export / Import — multi-format with picker popup ───────────────────
  // Format picker is the new entry point: Export button opens it in "export"
  // mode (downloads after pick), Import button opens it in "import" mode
  // (then opens the file dialog filtered to that format).
  async function runExport(format) {
    try {
      const data = await api.cars.exportData();
      await exportAs(data, format, "fleet-export");
    } catch (error) {
      toast.error(t('exportFailed') + ': ' + error.message);
    }
  }

  async function runImport(data) {
    if (!Array.isArray(data)) throw new Error("File harus berisi array data mobil.");
    const result = await api.cars.importData(data);
    apiCache.invalidate("cars:");
    loadCars();
    return result;
  }

  const formatPrice = (p) => {
    const num = Number(p || 0);
    if (num >= 1000000) return `Rp${num / 1000000}jt`;
    if (num >= 1000) return `Rp${(num / 1000).toFixed(0)}rb`;
    return `Rp${num}`;
  };

  // Client-side haystack search — match on every value the user can see on the row
  const filteredCars = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cars;
    return cars.filter(car => {
      const parts = [
        car.name, car.brand, car.type, car.category, car.transmission,
        car.fuel, car.color, car.licensePlate, car.description,
        String(car.year ?? ""), String(car.capacity ?? ""),
        formatPrice(car.price),
        Number(car.price || 0).toLocaleString("id-ID"),
        car.status, car.status ? t(car.status) : "",
        Array.isArray(car.features) ? car.features.join(" ") : "",
      ];
      return parts.filter(Boolean).join(" \u0001 ").toLowerCase().includes(q);
    });
  }, [cars, search, t]);

  // Pagination — auto-resets to page 1 when search/filter/sort change
  const { page, setPage, pageSize, setPageSize, paged: pagedCars } = usePagination(filteredCars, {
    storageKey: "dsr:fleet:pageSize",
    deps: [search, statusFilter, sortBy, sortOrder, viewMode],
  });

  // ─── Bulk selection helpers ──────────────────────────────────────────
  const toggleCar = (id) => setSelectedCars(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const pageAllSelected = pagedCars.length > 0 && pagedCars.every(c => selectedCars.has(c.id));
  const togglePageAll = () => setSelectedCars(prev => {
    const n = new Set(prev);
    if (pagedCars.every(c => n.has(c.id))) pagedCars.forEach(c => n.delete(c.id));
    else pagedCars.forEach(c => n.add(c.id));
    return n;
  });

  async function handleBulkStatus(status) {
    const ids = [...selectedCars];
    if (!ids.length) return;
    try {
      const res = await api.cars.bulkStatus(ids, status);
      apiCache.invalidate("cars:");
      setSelectedCars(new Set());
      loadCars();
      toast.success(`${res?.updated ?? ids.length} unit diperbarui ke "${t(status)}".`);
    } catch (e) { toast.error(e.message); }
  }

  async function handleBulkDelete() {
    const ids = [...selectedCars];
    if (!ids.length) return;
    if (!window.confirm(`Hapus ${ids.length} unit terpilih? Tindakan ini permanen.`)) return;
    try {
      const res = await api.cars.bulkDelete(ids);
      apiCache.invalidate("cars:");
      setSelectedCars(new Set());
      loadCars();
      let msg = `${res?.deleted ?? 0} unit dihapus.`;
      if (res?.skipped) msg += ` ${res.skipped} dilewati (masih ada order aktif): ${(res.skippedNames || []).join(", ")}`;
      res?.skipped ? toast.error(msg) : toast.success(msg);
    } catch (e) { toast.error(e.message); }
  }

  // No full-page spinner gate — page renders immediately. The empty-state row
  // shows a subtle inline loader during the initial fetch.

  return (
    <AdminLayout>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("fleet")}</h1>
          <p className="text-slate-500 text-sm mt-1">{t('manageFleet')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export
          </button>
          <button
            hidden={!canCreate}
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">upload</span>
            Import
          </button>
          <button
            hidden={!canEdit}
            onClick={() => setShowTypes(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
            title={t("ft_sub")}
          >
            <span className="material-symbols-outlined text-[18px]">category</span>
            {t("ft_manage")}
          </button>
          <button hidden={!canCreate} onClick={openAdd} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark transition-colors shadow-sm cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">add</span>
            {t("addCar")}
          </button>
        </div>
      </div>

      {/* Stats — clickable filter chips */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { key: "all",         label: t("totalCars"),     value: stats.total,       icon: "directions_car", color: "bg-blue-500",  active: !statusFilter },
            { key: "available",   label: t("available"),     value: stats.available,   icon: "check_circle",   color: "bg-green-500", active: statusFilter === "available" },
            { key: "rented",      label: t("rented"),        value: stats.rented,      icon: "key",            color: "bg-blue-500",  active: statusFilter === "rented" },
            { key: "maintenance", label: t("inMaintenance"), value: stats.maintenance, icon: "build",          color: "bg-amber-500", active: statusFilter === "maintenance" },
          ].map(s => (
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
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchAllColumns')}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white cursor-pointer">
          <option value="">{t('allStatus')}</option>
          <option value="available">{t("available")}</option>
          <option value="rented">{t("rented")}</option>
          <option value="maintenance">{t("inMaintenance")}</option>
        </select>
        <div className="flex border border-slate-200 rounded-lg overflow-hidden">
          <button onClick={() => setViewMode("table")} className={`px-3 py-2 cursor-pointer ${viewMode === "table" ? "bg-primary text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
            <span className="material-symbols-outlined text-[20px]">table_rows</span>
          </button>
          <button onClick={() => setViewMode("grid")} className={`px-3 py-2 cursor-pointer ${viewMode === "grid" ? "bg-primary text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
            <span className="material-symbols-outlined text-[20px]">grid_view</span>
          </button>
        </div>
      </div>

      {/* Table View */}
      {/* Sticky pagination — stays in view while scrolling the table/grid */}
      {filteredCars.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          totalCount={cars.length}
          filteredCount={filteredCars.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Bulk action bar — appears when units are selected (table view) */}
      {viewMode === "table" && selectedCars.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl border border-primary/30 bg-primary/5">
          <span className="text-sm font-semibold text-slate-700">{selectedCars.size} unit dipilih</span>
          <span className="text-slate-300">·</span>
          <span className="text-xs text-slate-500">Ubah status:</span>
          <AsyncButton onClick={() => handleBulkStatus("available")} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer">{t("available")}</AsyncButton>
          <AsyncButton onClick={() => handleBulkStatus("maintenance")} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 cursor-pointer">{t("maintenance") || "Perbaikan"}</AsyncButton>
          <AsyncButton onClick={() => handleBulkStatus("rented")} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 cursor-pointer">{t("rented")}</AsyncButton>
          <span className="text-slate-300">·</span>
          <AsyncButton hidden={!canDelete} onClick={handleBulkDelete} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 cursor-pointer">
            <span className="material-symbols-outlined text-[14px]">delete</span>
            Hapus
          </AsyncButton>
          <button onClick={() => setSelectedCars(new Set())} className="ml-auto text-xs text-slate-500 hover:text-slate-700 cursor-pointer">Bersihkan</button>
        </div>
      )}

      {viewMode === "table" ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase align-middle">
                  <th className="px-3 py-3 text-center align-middle" style={{ width: 40 }}>
                    <input type="checkbox" checked={pageAllSelected} onChange={togglePageAll} className="cursor-pointer" title="Pilih semua di halaman ini" />
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle" style={{ minWidth: 50 }}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("no_") || "No."}</span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("name")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("carName")}<SortIcon field="name" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("brand")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("brand")}<SortIcon field="brand" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("type")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("type")}<SortIcon field="type" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("category")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("category")}<SortIcon field="category" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("year")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("year")}<SortIcon field="year" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("licensePlate")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("licensePlate")}<SortIcon field="licensePlate" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("price")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("pricePerDay")}<SortIcon field="price" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("capacity")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("capacity")}<SortIcon field="capacity" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle cursor-pointer select-none" onClick={() => handleSort("status")}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("status")}<SortIcon field="status" /></span>
                  </th>
                  <th className="px-3 py-3 font-semibold text-center align-middle" style={{ minWidth: 100 }}>
                    <span className="inline-flex items-center justify-center gap-1 align-middle">{t("actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedCars.map((car, idx) => (
                  <tr key={car.id} className={`hover:bg-slate-50/60 transition-colors ${selectedCars.has(car.id) ? "bg-primary/5" : ""}`}>
                    <td className="px-3 py-3 text-center align-middle">
                      <input type="checkbox" checked={selectedCars.has(car.id)} onChange={() => toggleCar(car.id)} className="cursor-pointer" />
                    </td>
                    <td className="px-3 py-3 text-right align-middle text-slate-500 tabular-nums">{(page - 1) * pageSize + idx + 1}</td>
                    <td className="px-3 py-3 text-left align-middle font-medium text-slate-900"><InlineEdit disabled={!canEdit} value={car.name} onSave={(v) => saveCar(car, { name: v || car.name })} /></td>
                    <td className="px-3 py-3 text-left align-middle text-slate-600"><InlineEdit disabled={!canEdit} value={car.brand} onSave={(v) => saveCar(car, { brand: v || car.brand })} /></td>
                    <td className="px-3 py-3 text-left align-middle text-slate-600"><InlineEdit disabled={!canEdit} value={car.type} type="select" options={sel(typeOptions(car.type))} onSave={(v) => saveCar(car, { type: v })} /></td>
                    <td className="px-3 py-3 text-left align-middle"><InlineEdit disabled={!canEdit} value={car.category} type="select" options={sel(["economy", "standard", "premium", "luxury"])} onSave={(v) => saveCar(car, { category: v })}
                      display={<span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 capitalize">{car.category}</span>} /></td>
                    <td className="px-3 py-3 text-left align-middle text-slate-600"><InlineEdit disabled={!canEdit} value={car.year} type="number" onSave={(v) => saveCar(car, { year: v ? Math.round(v) : null })} /></td>
                    <td className="px-3 py-3 text-left align-middle text-slate-600">
                      <InlineEdit disabled={!canEdit} value={car.licensePlate || ""} onSave={(v) => saveCar(car, { licensePlate: v })} display={<>
                        {car.licensePlate || "-"}
                        {car.isOwned && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase">{t("ownedBadge")}</span>}
                      </>} />
                    </td>
                    <td className="px-3 py-3 text-right align-middle font-semibold text-slate-700 tabular-nums"><InlineEdit disabled={!canEdit} value={Number(car.price)} type="number" align="right" onSave={(v) => saveCar(car, { price: String(v ?? 0) })} display={`${formatPrice(car.price)}/hari`} /></td>
                    <td className="px-3 py-3 text-left align-middle text-slate-600"><InlineEdit disabled={!canEdit} value={car.capacity} type="number" onSave={(v) => saveCar(car, { capacity: Math.max(1, Math.round(v || 1)) })} display={`${car.capacity} ${t("seats")}`} /></td>
                    <td className="px-3 py-3 text-left align-middle"><InlineEdit disabled={!canEdit} value={car.status} type="select" options={sel(["available", "rented", "maintenance"], (v) => t(v))} onSave={(v) => saveCar(car, { status: v })}
                      display={<span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[car.status]}`}>{t(car.status)}</span>} /></td>
                    <td className="px-3 py-3 text-center align-middle">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setEventsCar(car)} title={t("ue_btn")} className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">build</span></button>
                        <button hidden={!canEdit} onClick={() => openEdit(car)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                        <AsyncButton hidden={!canDelete} onClick={() => handleDelete(car.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></AsyncButton>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCars.length === 0 && <tr><td colSpan={12} className="px-5 py-12 text-center text-slate-400">
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                      {t("loading") || "Memuat..."}
                    </span>
                  ) : t("noData")}
                </td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // Grid View
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pagedCars.map(car => (
            <div key={car.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden group">
              <div className="relative aspect-[16/10] overflow-hidden">
                <img src={carImgSrc(car.image)} alt={car.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                <span className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold uppercase ${statusColors[car.status]}`}>{t(car.status)}</span>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-400 font-medium uppercase">{car.brand} • {car.type} • {car.category} • {car.year} • {car.licensePlate}</p>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{car.name}</h3>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-primary font-bold">{formatPrice(car.price)}<span className="text-xs text-slate-400 font-normal">/hari</span></span>
                  <span className="text-xs text-slate-400">{car.capacity} {t("seats")} • {car.transmission}</span>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEventsCar(car)} title={t("ue_btn")} className="py-2 px-3 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 cursor-pointer"><span className="material-symbols-outlined text-[18px]">build</span></button>
                  <button hidden={!canEdit} onClick={() => openEdit(car)} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">{t("edit")}</button>
                  <AsyncButton hidden={!canDelete} onClick={() => handleDelete(car.id)} className="py-2 px-3 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 cursor-pointer">
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </AsyncButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {eventsCar && <UnitEventsModal car={eventsCar} canEdit={canEdit} onClose={() => { setEventsCar(null); apiCache.invalidate("cars:"); }} />}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? t('editCar') : t("addCar")}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label={`${t("carName")} *`} value={form.name} onChange={v => setForm({...form, name: v})} required />
                <FormField label={`${t("brand")} *`} value={form.brand} onChange={v => setForm({...form, brand: v})} required />
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">{t("type")} *</label>
                    {canEdit && <button type="button" onClick={() => setShowTypes(true)} className="text-xs font-semibold text-primary hover:underline cursor-pointer">{t("ft_manage")}</button>}
                  </div>
                  <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                    {typeOptions(form.type).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t("category")}</label>
                  <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                    {["economy", "standard", "premium", "luxury"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <FormField label={t("year")} type="number" value={form.year} onChange={v => setForm({...form, year: v})} />
                <FormField label={t("licensePlate")} value={form.licensePlate} onChange={v => setForm({...form, licensePlate: v})} />
                <FormField label={`${t("color")}`} value={form.color} onChange={v => setForm({...form, color: v})} />
                <label className="flex items-start gap-2 md:col-span-2 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={!!form.isOwned} onChange={e => setForm({ ...form, isOwned: e.target.checked })} className="mt-0.5 cursor-pointer" />
                  <span>
                    <span className="block text-sm font-medium text-slate-700">{t("ownedUnit")}</span>
                    <span className="block text-xs text-slate-500">{t("ownedUnitHint")}</span>
                  </span>
                </label>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">{t('vehiclePhotos')} * <span className="text-xs text-slate-400">({t('minImages')})</span></label>
                  <div className="grid grid-cols-3 gap-3">
                    {IMAGE_LABELS.map((lbl, idx) => (
                      <div key={lbl} className="relative">
                        <input ref={fileInputRefs[idx]} type="file" accept="image/*" className="hidden"
                          onChange={e => handleFileSelect(idx, e.target.files[0])} />
                        <button type="button" onClick={() => fileInputRefs[idx].current?.click()}
                          className="w-full aspect-[4/3] rounded-lg border-2 border-dashed border-slate-300 hover:border-primary flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors overflow-hidden bg-slate-50">
                          {imagePreviews[idx] ? (
                            <img src={imagePreviews[idx]} alt={lbl} className="w-full h-full object-cover" />
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-slate-400 text-2xl">add_photo_alternate</span>
                              <span className="text-xs text-slate-400 font-medium">{lbl}</span>
                            </>
                          )}
                        </button>
                        {imagePreviews[idx] && (
                          <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">{lbl}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <FormField label={`${t("price")} *`} type="number" value={form.price} onChange={v => setForm({...form, price: v})} required />
                <FormField label={`${t("capacity")} *`} type="number" value={form.capacity} onChange={v => setForm({...form, capacity: v})} required />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t("transmission")}</label>
                  <select value={form.transmission} onChange={e => setForm({...form, transmission: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                    <option value="Automatic">Automatic</option><option value="Manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t("fuel")}</label>
                  <select value={form.fuel} onChange={e => setForm({...form, fuel: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                    {["Bensin", "Diesel", "Pertamax", "Electric"].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t("status")}</label>
                  <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm cursor-pointer">
                    <option value="available">{t("available")}</option><option value="rented">{t("rented")}</option><option value="maintenance">{t("inMaintenance")}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("description")}</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">{t("cancel")}</button>
                <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark cursor-pointer disabled:opacity-60">{saving ? t('saving') : t("save")}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExport && (
        <SharedExportModal
          title="Export Data Armada"
          exportFn={runExport}
          onClose={() => setShowExport(false)}
        />
      )}
      {showTypes && typesData && (
        <CarTypesModal data={typesData} onClose={() => setShowTypes(false)}
          onSaved={(d) => { setTypesData(d); apiCache.set("cars:types", d); setShowTypes(false); loadCars(); }} />
      )}

      {showImport && (
        <SharedImportModal
          title="Import Data Armada"
          hint="Kolom yang dikenali: name, brand, type, category, year, licensePlate, color, price, capacity, transmission, fuel, description, status (available/rented/maintenance)"
          importFn={runImport}
          onClose={() => setShowImport(false)}
          onSuccess={() => {}}
        />
      )}
    </AdminLayout>
  );
}

function FormField({ label, type = "text", value, onChange, required }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
    </div>
  );
}
