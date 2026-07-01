import { useState, useMemo } from "react";
import { api } from "../lib/api";

// LandingBookingForm v4 (Tier 2 multi-vehicle)
// PUBLIC booking section on the landing page. Anonymous submission via
// /api/orders/public. Mirrors DashboardBookingForm's multi-vehicle shape:
// one trip can include N vehicle rows, each with category, quantity, and
// optional package. Backend creates one shared order code (P### for
// private, C### for company) and writes N rows linked by it.

const CAR_CATEGORIES = [
  { value: "MPV",      label: "MPV",      hint: "Contoh: Avanza, Xenia" },
  { value: "SUV",      label: "SUV",      hint: "Contoh: Innova, Fortuner" },
  { value: "City Car", label: "City Car", hint: "Contoh: Brio, Agya" },
  { value: "LCV",      label: "LCV",      hint: "Contoh: Hiace, Elf" },
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

export default function LandingBookingForm() {
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fullName: "",
    whatsapp: "",
    companyName: "",
    pickupDate: today,
    returnDate: today,
    notes: "",
    vehicles: [emptyVehicle()],
  });

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const totalDays = useMemo(() => {
    if (!form.pickupDate || !form.returnDate) return 1;
    const a = new Date(form.pickupDate);
    const b = new Date(form.returnDate);
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [form.pickupDate, form.returnDate]);

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

  const totalVehicleCount = form.vehicles.reduce(
    (sum, v) => sum + (v.carCategory ? Math.max(1, Number(v.quantity) || 1) : 0),
    0,
  );

  // Submit stays locked until every mandatory field is valid: name, whatsapp,
  // both dates, and each vehicle row has a category (+ a note when "Lainnya").
  // Company name is optional (blank = private booking).
  const canSubmit = useMemo(() => {
    if (!form.fullName.trim()) return false;
    if (!form.whatsapp.trim()) return false;
    if (!form.pickupDate || !form.returnDate) return false;
    if (form.vehicles.length === 0) return false;
    return form.vehicles.every(
      v => v.carCategory && v.package && v.package.trim() &&
        (v.carCategory !== "Lainnya" || v.carCategoryNote.trim()),
    );
  }, [form]);

  async function handleSubmit(e) {
    e.preventDefault();
    setInfo(""); setError("");

    if (!form.fullName.trim()) { setError("Nama wajib diisi."); return; }
    if (!form.whatsapp.trim()) { setError("Nomor WhatsApp wajib diisi agar admin bisa menghubungi."); return; }

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
      if (!v.package || !v.package.trim()) {
        setError(`Kendaraan baris ${i + 1}: pilih paket.`);
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
      const isCompany = !!form.companyName.trim();
      // Affiliate routing — /?ref=<agent code> ties this order to that agent's agency.
      const affiliateRef = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("ref")
        : null;
      const payload = {
        fullName: form.fullName.trim(),
        whatsapp: form.whatsapp.trim(),
        customerType: isCompany ? "company" : "private",
        companyName: isCompany ? form.companyName.trim() : null,
        pickupDate: form.pickupDate,
        returnDate: form.returnDate,
        notes: form.notes || null,
        affiliateCode: affiliateRef || null,
        vehicles: validVehicles,
      };
      const result = await api.orders.createPublic(payload);
      setInfo(result?.message || "Pesanan berhasil dikirim. Admin akan menghubungi Anda via WhatsApp.");
      setForm({
        fullName: "", whatsapp: "", companyName: "",
        pickupDate: today, returnDate: today,
        notes: "",
        vehicles: [emptyVehicle()],
      });
    } catch (err) {
      setError(err.message || "Gagal mengirim pesanan. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      id="pesan"
      className="relative py-16 lg:py-20 bg-gradient-to-b from-[#fdf6f6] via-[#fcefef] to-[#fdf6f6]"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-extrabold uppercase tracking-wider">
            <span className="material-symbols-outlined text-[14px]">bolt</span>
            Pemesanan Online
          </span>
          <h2 className="text-3xl md:text-4xl font-black mt-3 mb-2 text-text-main">
            Pesan <span className="text-primary">Kendaraan</span> Anda
          </h2>
          <p className="text-slate-500 text-sm md:text-base max-w-xl mx-auto">
            Isi formulir berikut. Tim DSR akan menghubungi Anda via WhatsApp untuk konfirmasi.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-6 md:p-8"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <LField label="Nama *">
              <input
                type="text"
                value={form.fullName}
                onChange={e => set("fullName", e.target.value)}
                className="light-input"
                required
                placeholder="Nama lengkap"
              />
            </LField>

            <LField label="No. WhatsApp *" hint="Admin akan kirim konfirmasi ke nomor ini">
              <input
                type="tel"
                value={form.whatsapp}
                onChange={e => set("whatsapp", e.target.value)}
                className="light-input"
                required
                placeholder="08xxxxxxxxxx"
              />
            </LField>

            <LField label="Nama Perusahaan" hint="Kosongkan jika pemesanan pribadi">
              <input
                type="text"
                value={form.companyName}
                onChange={e => set("companyName", e.target.value)}
                className="light-input"
                placeholder="Opsional"
              />
            </LField>

            <LField label="Total Hari" hint="Otomatis">
              <input type="text" value={totalDays + " hari"} disabled className="light-input bg-slate-50 text-slate-500" />
            </LField>
          </div>

          {/* Dates inline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-5">
            <LField label="Tgl Pemakaian *">
              <input
                type="date"
                value={form.pickupDate}
                onChange={e => set("pickupDate", e.target.value)}
                className="light-input"
                required
              />
            </LField>

            <LField label="Tgl Selesai *">
              <input
                type="date"
                value={form.returnDate}
                onChange={e => set("returnDate", e.target.value)}
                min={form.pickupDate}
                className="light-input"
                required
              />
            </LField>
          </div>

          {/* Daftar Kendaraan */}
          <div className="mt-6 border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Daftar Kendaraan</h3>
                <p className="text-[11px] text-slate-500">
                  Tambahkan setiap jenis kendaraan yang Anda butuhkan. Total: <strong>{totalVehicleCount}</strong> unit.
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
                <LandingVehicleRow
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

          <div className="mt-6 pt-5 border-t border-slate-100">
            <LField label="Keterangan Tambahan" hint="Catatan untuk admin (opsional)">
              <textarea
                rows={2}
                value={form.notes}
                onChange={e => set("notes", e.target.value)}
                className="light-input resize-y"
                placeholder="Catatan tambahan untuk admin"
              />
            </LField>
          </div>

          {(info || error) && (
            <div className="mt-5">
              {info && (
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  {info}
                </div>
              )}
              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">error</span>
                  {error}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-slate-400">
              Dengan mengirim form ini Anda menyetujui untuk dihubungi oleh tim DSR.
            </p>
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              title={!canSubmit ? "Lengkapi semua kolom wajib terlebih dahulu" : undefined}
              className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-lg bg-primary hover:bg-primary-dark text-white font-bold tracking-wide transition-colors shadow-lg shadow-primary/25 disabled:opacity-60 disabled:cursor-not-allowed uppercase text-sm"
            >
              {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span className="material-symbols-outlined text-[20px]">send</span>
              Kirim Pemesanan
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .light-input {
          width: 100%;
          padding: 0.625rem 0.875rem;
          background: white;
          border: 1px solid rgb(226, 232, 240);
          border-radius: 0.5rem;
          font-size: 0.875rem;
          color: rgb(15, 23, 42);
          outline: none;
          transition: border-color 120ms, box-shadow 120ms;
        }
        .light-input::placeholder { color: rgb(148, 163, 184); }
        .light-input:focus {
          border-color: var(--color-primary, #DC2626);
          box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
        }
        .light-input:disabled {
          color: rgb(100, 116, 139);
          cursor: not-allowed;
        }
      `}</style>
    </section>
  );
}

function LandingVehicleRow({ index, vehicle, canRemove, onChange, onRemove }) {
  const selectedCategory = CAR_CATEGORIES.find(c => c.value === vehicle.carCategory);
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40">
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
          <LField label="Kategori *" hint={selectedCategory?.hint || "Pilih jenis kendaraan"}>
            <select
              value={vehicle.carCategory}
              onChange={e => onChange("carCategory", e.target.value)}
              className="light-input"
              required
            >
              <option value="">Pilih kategori</option>
              {CAR_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </LField>
        </div>

        <div className="md:col-span-2">
          <LField label="Jumlah *" hint="1-10">
            <input
              type="number"
              min={1}
              max={10}
              value={vehicle.quantity}
              onChange={e => onChange("quantity", e.target.value)}
              className="light-input"
              required
            />
          </LField>
        </div>

        <div className="md:col-span-4">
          <LField label="Paket *">
            <input
              list={`landing-paket-${index}`}
              value={vehicle.package}
              onChange={e => onChange("package", e.target.value)}
              className="light-input"
              required
              placeholder="All In / Mobil dan Driver"
            />
            <datalist id={`landing-paket-${index}`}>
              {PACKAGE_OPTIONS.map(p => <option key={p} value={p} />)}
            </datalist>
          </LField>
        </div>

        <div className="md:col-span-6">
          <LField label="Tujuan" hint="Tujuan untuk kendaraan ini">
            <input
              type="text"
              value={vehicle.destination}
              onChange={e => onChange("destination", e.target.value)}
              className="light-input"
              placeholder="Kota tujuan"
            />
          </LField>
        </div>

        <div className="md:col-span-6">
          <LField label="Penjemputan" hint="Alamat penjemputan kendaraan ini">
            <input
              type="text"
              value={vehicle.pickupLocation}
              onChange={e => onChange("pickupLocation", e.target.value)}
              className="light-input"
              placeholder="Alamat penjemputan"
            />
          </LField>
        </div>

        {vehicle.carCategory === "Lainnya" && (
          <div className="md:col-span-12">
            <LField label="Detail Kendaraan Lainnya" hint="Jelaskan kendaraan yang Anda butuhkan">
              <input
                type="text"
                value={vehicle.carCategoryNote}
                onChange={e => onChange("carCategoryNote", e.target.value)}
                className="light-input"
                placeholder="Contoh: Bus Pariwisata 30 seat"
                required
              />
            </LField>
          </div>
        )}
      </div>
    </div>
  );
}

function LField({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
