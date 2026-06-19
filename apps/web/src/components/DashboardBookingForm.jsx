import { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// DashboardBookingForm v4
// In-dashboard booking form for logged-in users. Posts to /api/orders/public.
//
// Name + WhatsApp prefill from the user's profile but stay editable. The
// person making the booking is not always the account holder — a PIC at
// PT Foo may book a car for their courier, with the courier's phone as
// the contact. The backend's customerService.findOrCreate maps whatever
// is typed: existing customer with that whatsapp → reuse, new whatsapp →
// create a fresh customer row. Either way the order ends up linked to a
// real customers row so the agency can confirm.
//
// Nama Perusahaan stays locked to the org on the account (the form is
// only mounted inside Dashboard, so we know the account exists).
// Kendaraan is a category picker; the agency assigns a specific car
// later via Rekap Order.

const CAR_CATEGORIES = [
  { value: "MPV",       label: "MPV",      hint: "Contoh: Avanza, Xenia" },
  { value: "SUV",       label: "SUV",      hint: "Contoh: Innova, Fortuner" },
  { value: "City Car",  label: "City Car", hint: "Contoh: Brio, Agya" },
  { value: "Pickup",    label: "Pickup",   hint: "Muatan kurang dari 1.5 Ton" },
  { value: "CDE",       label: "CDE",      hint: "Engkel, muatan 2 sampai 3 Ton" },
  { value: "Lainnya",   label: "Lainnya",  hint: "Isi keterangan detail di bawah" },
];

export default function DashboardBookingForm({ onCreated }) {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [orgInfo, setOrgInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.me.get().then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.organizationId) return;
    api.myOrg.getInfo().then(setOrgInfo).catch(() => {});
  }, [user?.organizationId]);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fullName: "",
    whatsapp: "",
    carCategory: "",
    carCategoryNote: "",
    pickupDate: today,
    returnDate: today,
    destination: "",
    pickupLocation: "",
    package: "",
    notes: "",
  });

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // Prefill from profile but only if the user hasn't started editing.
  // Profile values are a convenience, not a constraint — the form is the
  // source of truth on submit.
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

  const selectedCategory = CAR_CATEGORIES.find(c => c.value === form.carCategory);

  const companyName = orgInfo?.name || me?.customer?.companyName || "";
  const hasCompany = Boolean(companyName);

  async function handleSubmit(e) {
    e.preventDefault();
    setInfo(""); setError("");
    if (!form.carCategory) { setError("Pilih kategori kendaraan."); return; }
    if (!form.fullName.trim()) { setError("Nama wajib diisi."); return; }
    const whatsapp = form.whatsapp.trim();
    if (!whatsapp) { setError("Nomor WhatsApp wajib diisi."); return; }
    if (form.carCategory === "Lainnya" && !form.carCategoryNote.trim()) {
      setError("Untuk kategori Lainnya, isi keterangan kendaraan yang dibutuhkan.");
      return;
    }
    if (!form.pickupDate || !form.returnDate) { setError("Tanggal pemakaian wajib diisi."); return; }

    setSubmitting(true);
    try {
      const payload = {
        carId: null,
        carCategoryRequested: form.carCategory,
        carCategoryNote: form.carCategory === "Lainnya" ? form.carCategoryNote.trim() : null,
        fullName: form.fullName.trim(),
        whatsapp,
        customerType: hasCompany ? "company" : "private",
        companyName: hasCompany ? companyName : null,
        pickupDate: form.pickupDate,
        returnDate: form.returnDate,
        pickupLocation: form.pickupLocation || null,
        notes: form.notes || null,
        package: form.package || null,
        destination: form.destination || null,
      };
      const result = await api.orders.createPublic(payload);
      setInfo(result?.message || "Pesanan berhasil dikirim. Admin akan menghubungi Anda.");
      // Reset only the per-booking fields. Keep name + whatsapp so the
      // next booking from the same session doesn't re-type them — they
      // can still be edited if the next pemesan is different.
      setForm(prev => ({
        ...prev,
        carCategory: "", carCategoryNote: "",
        destination: "", pickupLocation: "",
        package: "", notes: "",
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

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <FieldL label="Nama" hint="Nama User">
          <input
            type="text"
            value={form.fullName}
            onChange={e => set("fullName", e.target.value)}
            className="input"
            required
            placeholder="Nama lengkap pemesan"
          />
        </FieldL>


        <FieldL label="No. Whatsapp" hint="Nomor kontak pemesan untuk konfirmasi (bisa berbeda dari nomor akun)">
          <input
            type="tel"
            value={form.whatsapp}
            onChange={e => set("whatsapp", e.target.value)}
            required
            className="input"
            placeholder="08xxxxxxxxxx"
          />
        </FieldL>

        <FieldL label="Nama Perusahaan" hint={hasCompany ? "Diisi otomatis dari akun Anda" : "Akun ini belum terdaftar pada perusahaan"}>
          <input
            type="text"
            value={companyName || "Private"}
            disabled
            className="input bg-slate-50 text-slate-500"
          />
        </FieldL>

        <FieldL label="Kategori Kendaraan" hint={selectedCategory?.hint || "Admin akan menetapkan unit setelah konfirmasi"}>
          <select
            value={form.carCategory}
            onChange={e => set("carCategory", e.target.value)}
            className="input"
            required
          >
            <option value="">Pilih kategori</option>
            {CAR_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>
                {c.label} ({c.hint})
              </option>
            ))}
          </select>
        </FieldL>

        {form.carCategory === "Lainnya" && (
          <FieldL label="Detail Kendaraan Lainnya" hint="Jelaskan kendaraan yang Anda butuhkan">
            <input
              type="text"
              value={form.carCategoryNote}
              onChange={e => set("carCategoryNote", e.target.value)}
              className="input"
              placeholder="Contoh: Bus Pariwisata 30 seat"
            />
          </FieldL>
        )}

        <FieldL label="Tujuan">
          <input
            type="text"
            value={form.destination}
            onChange={e => set("destination", e.target.value)}
            className="input"
            placeholder="Misal: Bandung, Jakarta"
          />
        </FieldL>

                <FieldL label="Penjemputan">
          <input
            type="text"
            value={form.pickupLocation}
            onChange={e => set("pickupLocation", e.target.value)}
            className="input"
            placeholder="Alamat penjemputan"
          />
        </FieldL>

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

        <FieldL label="Total Hari" hint="Dihitung otomatis dari tanggal">
          <input type="text" value={totalDays + " hari"} disabled className="input bg-slate-50 text-slate-500" />
        </FieldL>

        <FieldL label="Paket">
          <input
            list="dashboard-paket-options"
            value={form.package}
            onChange={e => set("package", e.target.value)}
            className="input"
            placeholder="All In / Mobil dan Driver / Lepas Kunci"
          />
          <datalist id="dashboard-paket-options">
            <option value="All In" />
            <option value="Mobil dan Driver" />
            <option value="Lepas Kunci" />
          </datalist>
        </FieldL>

        <div className="md:col-span-2">
          <FieldL label="Keterangan">
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
              className="input resize-y"
              placeholder="Catatan tambahan untuk admin"
            />
          </FieldL>
        </div>
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

function FieldL({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
