import { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api";

// LandingBookingForm v3
// PUBLIC booking section on the landing page. Anonymous submission via
// /api/orders/public. All fields start blank. Visual style: clean white
// card on a soft cream/pink backdrop.
//
// Field map (current spec):
//   2  Nama                       fullName
//      No. WhatsApp                whatsapp
//   3  Nama Perusahaan             companyName (optional; if blank = private)
//   4  Kategori Kendaraan          carCategoryRequested (NEW: not a specific car)
//      Detail Kendaraan            carCategoryNote (only when category = Lainnya)
//   6  Tgl Pemakaian               pickupDate
//   7  Tgl Selesai                 returnDate
//   8  Total Hari                  computed (readonly, display only)
//   11 Tujuan                      destination
//   12 Penjemputan                 pickupLocation
//   13 Paket                       package
//   14 Keterangan                  notes
//
// REMOVED per user spec:
//   - Nama Driver: admin assigns, never shown on form
//   - Status: always pending on create, no need to show
//   - Total Harga: agency computes after assigning a specific car

const CAR_CATEGORIES = [
  { value: "MPV",       label: "MPV",      hint: "Contoh: Avanza, Xenia" },
  { value: "SUV",       label: "SUV",      hint: "Contoh: Innova, Fortuner" },
  { value: "City Car",  label: "City Car", hint: "Contoh: Brio, Agya" },
  { value: "Pickup",    label: "Pickup",   hint: "Muatan kurang dari 1.5 Ton" },
  { value: "CDE",       label: "CDE",      hint: "Engkel, muatan 2 sampai 3 Ton" },
  { value: "Lainnya",   label: "Lainnya",  hint: "Isi keterangan detail di bawah" },
];

export default function LandingBookingForm() {
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fullName: "",
    whatsapp: "",
    companyName: "",
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

  const totalDays = useMemo(() => {
    if (!form.pickupDate || !form.returnDate) return 1;
    const a = new Date(form.pickupDate);
    const b = new Date(form.returnDate);
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [form.pickupDate, form.returnDate]);

  const selectedCategory = CAR_CATEGORIES.find(c => c.value === form.carCategory);

  async function handleSubmit(e) {
    e.preventDefault();
    setInfo(""); setError("");
    if (!form.carCategory) { setError("Pilih kategori kendaraan."); return; }
    if (!form.fullName.trim()) { setError("Nama wajib diisi."); return; }
    if (!form.whatsapp.trim()) { setError("Nomor WhatsApp wajib diisi agar admin bisa menghubungi."); return; }
    if (form.carCategory === "Lainnya" && !form.carCategoryNote.trim()) {
      setError("Untuk kategori Lainnya, isi keterangan kendaraan yang dibutuhkan.");
      return;
    }

    setSubmitting(true);
    try {
      const isCompany = !!form.companyName.trim();
      const payload = {
        carId: null,
        carCategoryRequested: form.carCategory,
        carCategoryNote: form.carCategory === "Lainnya" ? form.carCategoryNote.trim() : null,
        fullName: form.fullName.trim(),
        whatsapp: form.whatsapp.trim(),
        customerType: isCompany ? "company" : "private",
        companyName: isCompany ? form.companyName.trim() : null,
        pickupDate: form.pickupDate,
        returnDate: form.returnDate,
        pickupLocation: form.pickupLocation || null,
        notes: form.notes || null,
        package: form.package || null,
        destination: form.destination || null,
      };
      const result = await api.orders.createPublic(payload);
      setInfo(result?.message || "Pesanan berhasil dikirim. Admin akan menghubungi Anda via WhatsApp.");
      setForm({
        fullName: "", whatsapp: "", companyName: "", carCategory: "", carCategoryNote: "",
        pickupDate: today, returnDate: today, destination: "", pickupLocation: "",
        package: "", notes: "",
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
            <LField label="Nama">
              <input
                type="text"
                value={form.fullName}
                onChange={e => set("fullName", e.target.value)}
                className="light-input"
                required
                placeholder="Nama lengkap"
              />
            </LField>

            <LField label="No. WhatsApp" hint="Wajib, admin akan kirim konfirmasi ke nomor ini">
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

            <LField label="Kategori Kendaraan" hint={selectedCategory?.hint || "Admin akan menetapkan unit setelah konfirmasi"}>
              <select
                value={form.carCategory}
                onChange={e => set("carCategory", e.target.value)}
                className="light-input"
                required
              >
                <option value="">Pilih kategori</option>
                {CAR_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>
                    {c.label} ({c.hint})
                  </option>
                ))}
              </select>
            </LField>

            {form.carCategory === "Lainnya" && (
              <div className="md:col-span-2">
                <LField label="Detail Kendaraan Lainnya" hint="Jelaskan kendaraan yang Anda butuhkan">
                  <input
                    type="text"
                    value={form.carCategoryNote}
                    onChange={e => set("carCategoryNote", e.target.value)}
                    className="light-input"
                    placeholder="Contoh: Bus Pariwisata 30 seat"
                  />
                </LField>
              </div>
            )}

            <LField label="Tujuan">
              <input
                type="text"
                value={form.destination}
                onChange={e => set("destination", e.target.value)}
                className="light-input"
                placeholder="Kota tujuan"
              />
            </LField>

            <LField label="Penjemputan">
              <input
                type="text"
                value={form.pickupLocation}
                onChange={e => set("pickupLocation", e.target.value)}
                className="light-input"
                placeholder="Alamat penjemputan"
              />
            </LField>
            
            <LField label="Tgl Pemakaian">
              <input
                type="date"
                value={form.pickupDate}
                onChange={e => set("pickupDate", e.target.value)}
                className="light-input"
                required
              />
            </LField>

            <LField label="Tgl Selesai">
              <input
                type="date"
                value={form.returnDate}
                onChange={e => set("returnDate", e.target.value)}
                min={form.pickupDate}
                className="light-input"
                required
              />
            </LField>

            <LField label="Total Hari" hint="Otomatis">
              <input type="text" value={totalDays + " hari"} disabled className="light-input bg-slate-50 text-slate-500" />
            </LField>

            <LField label="Paket">
              <input
                list="landing-paket-options"
                value={form.package}
                onChange={e => set("package", e.target.value)}
                className="light-input"
                placeholder="All In / Mobil dan Driver / Lepas Kunci"
              />
              <datalist id="landing-paket-options">
                <option value="All In" />
                <option value="Mobil dan Driver" />
                <option value="Lepas Kunci" />
              </datalist>
            </LField>

            <div className="md:col-span-2">
              <LField label="Keterangan">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                  className="light-input resize-y"
                  placeholder="Catatan tambahan untuk admin"
                />
              </LField>
            </div>
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
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 h-12 px-7 rounded-lg bg-primary hover:bg-primary-dark text-white font-bold tracking-wide transition-colors shadow-lg shadow-primary/25 disabled:opacity-60 uppercase text-sm"
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
