import { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// DashboardBookingForm v5 (Tier 2 multi-vehicle)
// Customers can request 1-N vehicles in a single submission. The backend
// generates ONE order code (C### or P###) and writes N order rows sharing
// that code. Each row represents one car within the booking and can have
// its own category, package, and per-car add-ons.
//
// Form shape:
//   trip-level: fullName, whatsapp, pickupDate, returnDate, notes
//   per-vehicle: carCategory, carCategoryNote (if Lainnya), quantity,
//                package, destination, pickupLocation
//
// Quantity > 1 expands one row into N identical rows server-side, useful
// when the customer wants e.g. 2 Avanzas without filling the row twice.

const CAR_CATEGORIES = [
  { value: "MPV",      label: "MPV",      hint: "Contoh: Avanza, Xenia" },
  { value: "SUV",      label: "SUV",      hint: "Contoh: Innova, Fortuner" },
  { value: "City Car", label: "City Car", hint: "Contoh: Brio, Agya" },
  { value: "Pickup",   label: "Pickup",   hint: "Muatan kurang dari 1.5 Ton" },
  { value: "CDE",      label: "CDE",      hint: "Engkel, 2 sampai 3 Ton" },
  { value: "Lainnya",  label: "Lainnya",  hint: "Isi keterangan di kolom detail" },
];

const PACKAGE_OPTIONS = ["All In", "Mobil dan Driver", "Lepas Kunci"];

const emptyVehicle = () => ({
  carCategory: "",
  carCategoryNote: "",
  quantity: 1,
  package: "",
  destination: "",
  pickupLocation: "",
});

export default function DashboardBookingForm({ onCreated }) {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [orgInfo, setOrgInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  // Agency staff (admin/superadmin) book on behalf of clients, so they pick
  // the company from a dropdown of affiliated clients. Plain client users are
  // locked to their own company (filled from their account).
  const isClient =
    user?.accountType === "client" ||
    user?.role === "client" || user?.role === "client_admin";
  const isAgency = !isClient;
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    api.me.get().then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.organizationId) return;
    api.myOrg.getInfo().then(setOrgInfo).catch(() => {});
  }, [user?.organizationId]);

  // Affiliated client companies — only agency staff need this list. The
  // companies endpoint already scopes to the caller's agency (every org with
  // parent_agency_id = the agency).
  useEffect(() => {
    if (!isAgency) return;
    api.companies.list("limit=1000")
      .then(res => setCompanies(Array.isArray(res) ? res : (res?.data || [])))
      .catch(() => {});
  }, [isAgency]);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fullName: "",
    whatsapp: "",
    companyName: "", // used by agency staff to pick the client company
    pickupDate: today,
    returnDate: today,
    notes: "",
    vehicles: [emptyVehicle()],
  });

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    if (!me) return;
    setForm(prev => ({
      ...prev,
      fullName: prev.fullName || me.name || "",
      whatsapp: prev.whatsapp || me.customer?.phone || me.customer?.whatsapp || me.phone || "",
    }));
  }, [me]);

  const totalDays = useMemo(() => {
    if (!form.pickupDate || !form.returnDate) return 1;
    const a = new Date(form.pickupDate);
    const b = new Date(form.returnDate);
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [form.pickupDate, form.returnDate]);

  // Client users: company is fixed to their own org/account.
  // Agency users: company comes from the dropdown selection (form.companyName).
  const ownCompany = orgInfo?.name || me?.customer?.companyName || "";
  const companyName = isAgency ? form.companyName : ownCompany;
  const hasCompany = Boolean(companyName);

  // Vehicle row helpers
  const addVehicle = () => {
    if (form.vehicles.length >= 10) return;
    setForm(prev => ({ ...prev, vehicles: [...prev.vehicles, emptyVehicle()] }));
  };
  const removeVehicle = (idx) => {
    if (form.vehicles.length <= 1) return;
    setForm(prev => ({ ...prev, vehicles: prev.vehicles.filter((_, i) => i !== idx) }));
  };
  const updateVehicle = (idx, field, value) => {
    setForm(prev => ({
      ...prev,
      vehicles: prev.vehicles.map((v, i) => i === idx ? { ...v, [field]: value } : v),
    }));
  };

  // Total expanded count across all rows (respects quantity)
  const totalVehicleCount = form.vehicles.reduce(
    (sum, v) => sum + (v.carCategory ? Math.max(1, Number(v.quantity) || 1) : 0),
    0,
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setInfo(""); setError("");

    if (!form.fullName.trim()) { setError("Nama wajib diisi."); return; }
    const whatsapp = form.whatsapp.trim();
    if (!whatsapp) { setError("Nomor WhatsApp wajib diisi."); return; }
    if (!form.pickupDate || !form.returnDate) { setError("Tanggal pemakaian wajib diisi."); return; }

    // Validate each vehicle row
    const validVehicles = [];
    for (let i = 0; i < form.vehicles.length; i++) {
      const v = form.vehicles[i];
      if (!v.carCategory) {
        setError(`Kendaraan baris ${i + 1}: pilih kategori.`);
        return;
      }
      if (v.carCategory === "Lainnya" && !v.carCategoryNote.trim()) {
        setError(`Kendaraan baris ${i + 1}: isi keterangan untuk kategori Lainnya.`);
        return;
      }
      const qty = Math.max(1, Math.min(10, Number(v.quantity) || 1));
      validVehicles.push({
        carCategoryRequested: v.carCategory,
        carCategoryNote: v.carCategory === "Lainnya" ? v.carCategoryNote.trim() : null,
        quantity: qty,
        package: v.package || null,
        destination: v.destination?.trim() || null,
        pickupLocation: v.pickupLocation?.trim() || null,
      });
    }
    if (validVehicles.length === 0) {
      setError("Tambahkan minimal satu kendaraan.");
      return;
    }
    const expandedTotal = validVehicles.reduce((s, v) => s + v.quantity, 0);
    if (expandedTotal > 10) {
      setError("Maksimal 10 kendaraan per pemesanan.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        whatsapp,
        customerType: hasCompany ? "company" : "private",
        companyName: hasCompany ? companyName : null,
        pickupDate: form.pickupDate,
        returnDate: form.returnDate,
        notes: form.notes || null,
        vehicles: validVehicles,
      };
      const result = await api.orders.createPublic(payload);
      setInfo(result?.message || "Pesanan berhasil dikirim. Admin akan menghubungi Anda.");
      // Reset per-booking fields; keep name + whatsapp for repeat bookings
      setForm(prev => ({
        ...prev,
        notes: "",
        vehicles: [emptyVehicle()],
      }));
      if (onCreated) onCreated(result);
    } catch (err) {
      setError(err.message || "Gagal mengirim pesanan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <span className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-[20px]">directions_car</span>
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900">Pesan Kendaraan</h2>
          <p className="text-xs text-slate-500">Isi form di bawah untuk membuat pemesanan baru.</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldL label="Nama" hint="Nama pemesan / PIC">
            <input
              type="text"
              value={form.fullName}
              onChange={e => set("fullName", e.target.value)}
              className="input"
              required
              placeholder="Nama lengkap pemesan"
            />
          </FieldL>

          <FieldL label="No. Whatsapp" hint="Nomor kontak pemesan (bisa berbeda dari nomor akun)">
            <input
              type="tel"
              value={form.whatsapp}
              onChange={e => set("whatsapp", e.target.value)}
              required
              className="input"
              placeholder="08xxxxxxxxxx"
            />
          </FieldL>

          {isAgency ? (
            <FieldL label="Nama Perusahaan" hint="Pilih perusahaan klien (afiliasi agensi Anda)">
              <select
                value={form.companyName}
                onChange={e => set("companyName", e.target.value)}
                className="input"
              >
                <option value="">— Pilih perusahaan klien —</option>
                {companies.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FieldL>
          ) : (
            <FieldL label="Nama Perusahaan" hint={hasCompany ? "Diisi otomatis dari akun Anda" : "Akun ini belum terdaftar pada perusahaan"}>
              <input
                type="text"
                value={companyName || "Private"}
                disabled
                className="input bg-slate-50 text-slate-500"
              />
            </FieldL>
          )}

          <FieldL label="Total Hari" hint="Dihitung otomatis dari tanggal">
            <input type="text" value={totalDays + " hari"} disabled className="input bg-slate-50 text-slate-500" />
          </FieldL>
        </div>

        {/* Dates inline */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldL label="Tgl Pemakaian">
            <input
              type="date"
              value={form.pickupDate}
              onChange={e => set("pickupDate", e.target.value)}
              className="input"
              required
            />
          </FieldL>

          <FieldL label="Tgl Selesai">
            <input
              type="date"
              value={form.returnDate}
              onChange={e => set("returnDate", e.target.value)}
              min={form.pickupDate}
              className="input"
              required
            />
          </FieldL>
        </div>
      </div>

      {/* Daftar Kendaraan - multi-row picker */}
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Daftar Kendaraan</h3>
            <p className="text-[11px] text-slate-500">
              Tambahkan setiap jenis kendaraan yang Anda butuhkan. Total saat ini: <strong>{totalVehicleCount}</strong> unit.
            </p>
          </div>
          <button
            type="button"
            onClick={addVehicle}
            disabled={form.vehicles.length >= 10}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Tambah Kendaraan
          </button>
        </div>

        <div className="space-y-3">
          {form.vehicles.map((v, idx) => (
            <VehicleRow
              key={idx}
              index={idx}
              vehicle={v}
              canRemove={form.vehicles.length > 1}
              onChange={(field, value) => updateVehicle(idx, field, value)}
              onRemove={() => removeVehicle(idx)}
            />
          ))}
        </div>
      </div>

      <div className="px-5 pb-5">
        <FieldL label="Keterangan Tambahan" hint="Catatan untuk admin (opsional)">
          <textarea
            rows={2}
            value={form.notes}
            onChange={e => set("notes", e.target.value)}
            className="input resize-y"
            placeholder="Catatan tambahan untuk admin"
          />
        </FieldL>
      </div>

      {(info || error) && (
        <div className="px-5 pb-3">
          {info && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">check_circle</span>
              {info}
            </div>
          )}
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">error</span>
              {error}
            </div>
          )}
        </div>
      )}

      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark cursor-pointer disabled:opacity-60"
        >
          {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          <span className="material-symbols-outlined text-[18px]">send</span>
          Kirim Pemesanan
        </button>
      </div>

      <style>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid rgb(226, 232, 240);
          border-radius: 0.5rem;
          font-size: 0.875rem;
          background: white;
          outline: none;
        }
        .input:focus {
          border-color: var(--color-primary, #DC2626);
          box-shadow: 0 0 0 1px var(--color-primary, #DC2626);
        }
      `}</style>
    </form>
  );
}

function VehicleRow({ index, vehicle, canRemove, onChange, onRemove }) {
  const selectedCategory = CAR_CATEGORIES.find(c => c.value === vehicle.carCategory);
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-600">Kendaraan #{index + 1}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-xs font-semibold"
            aria-label="Hapus kendaraan"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
            Hapus
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <FieldL label="Kategori" hint={selectedCategory?.hint || "Pilih jenis kendaraan"}>
            <select
              value={vehicle.carCategory}
              onChange={e => onChange("carCategory", e.target.value)}
              className="input"
              required
            >
              <option value="">Pilih kategori</option>
              {CAR_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </FieldL>
        </div>

        <div className="md:col-span-2">
          <FieldL label="Jumlah" hint="1-10 unit">
            <input
              type="number"
              min={1}
              max={10}
              value={vehicle.quantity}
              onChange={e => onChange("quantity", e.target.value)}
              className="input"
              required
            />
          </FieldL>
        </div>

        <div className="md:col-span-4">
          <FieldL label="Paket" hint="Opsional">
            <input
              list={`paket-options-${index}`}
              value={vehicle.package}
              onChange={e => onChange("package", e.target.value)}
              className="input"
              placeholder="All In / Mobil dan Driver / Lepas Kunci"
            />
            <datalist id={`paket-options-${index}`}>
              {PACKAGE_OPTIONS.map(p => <option key={p} value={p} />)}
            </datalist>
          </FieldL>
        </div>

        <div className="md:col-span-6">
          <FieldL label="Tujuan" hint="Tujuan untuk kendaraan ini">
            <input
              type="text"
              value={vehicle.destination}
              onChange={e => onChange("destination", e.target.value)}
              className="input"
              placeholder="Misal: Bandung, Jakarta"
            />
          </FieldL>
        </div>

        <div className="md:col-span-6">
          <FieldL label="Penjemputan" hint="Alamat penjemputan kendaraan ini">
            <input
              type="text"
              value={vehicle.pickupLocation}
              onChange={e => onChange("pickupLocation", e.target.value)}
              className="input"
              placeholder="Alamat penjemputan"
            />
          </FieldL>
        </div>

        {vehicle.carCategory === "Lainnya" && (
          <div className="md:col-span-12">
            <FieldL label="Detail Kendaraan Lainnya" hint="Jelaskan kendaraan yang Anda butuhkan">
              <input
                type="text"
                value={vehicle.carCategoryNote}
                onChange={e => onChange("carCategoryNote", e.target.value)}
                className="input"
                placeholder="Contoh: Bus Pariwisata 30 seat"
                required
              />
            </FieldL>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldL({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
