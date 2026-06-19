import { useState, useMemo, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { api, carImgSrc } from "../lib/api";
import { useToast } from "../components/Toast";

export default function CarDetail() {
  const toast = useToast();
  const { id } = useParams();

  const [car, setCar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.cars.get(id)
      .then(data => {
        const transformedCar = {
          ...data,
          seats: data.capacity,
          priceNum: Number(data.price),
          priceFormatted: `Rp ${Number(data.price).toLocaleString('id-ID')}`,
          gallery: Array.isArray(data.gallery) ? data.gallery : [],
          features: typeof data.features === 'string' ? JSON.parse(data.features) : (data.features || []),
        };
        setCar(transformedCar);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  // Remove this line: const car = cars.find((c) => c.id === Number(id));

  const [selectedImage, setSelectedImage] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [customerType, setCustomerType] = useState("private"); // 'private' | 'company'
  const [companyName, setCompanyName] = useState("");
  // Extra Rekap Order fields — collected on the booking form
  const [packageName, setPackageName] = useState("");
  const [destination, setDestination] = useState("");
  const [overnightNights, setOvernightNights] = useState("");
  const [overtimeHours, setOvertimeHours] = useState("");
  const [bailout, setBailout] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const gallery = useMemo(() => {
    if (!car) return [];
    return [car.image, ...(car.gallery || [])].map(carImgSrc);
  }, [car]);

  const rentalDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : 0;
  }, [startDate, endDate]);

  const totalPrice = useMemo(() => {
    if (!car) return 0;
    return rentalDays * car.priceNum;
  }, [rentalDays, car]);

  const validateForm = () => {
    const errors = {};
    if (!fullName.trim()) errors.fullName = "Nama wajib diisi";
    if (!whatsapp.trim()) errors.whatsapp = "Nomor WhatsApp wajib diisi";
    if (customerType === "company" && !companyName.trim())
      errors.companyName = "Nama perusahaan wajib diisi";
    if (!startDate) errors.startDate = "Pilih tanggal mulai";
    if (!endDate) errors.endDate = "Pilih tanggal selesai";
    if (rentalDays <= 0 && startDate && endDate)
      errors.endDate = "Tanggal selesai harus setelah tanggal mulai";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitting(true);

    try {
      const result = await api.orders.createPublic({
        carId: Number(id),
        fullName,
        whatsapp,
        customerType,
        companyName: customerType === "company" ? companyName.trim() : null,
        pickupDate: startDate,
        returnDate: endDate,
        // Extra Rekap Order fields
        package: packageName || null,
        destination: destination || null,
        overnightNights: Number(overnightNights || 0),
        overtimeHours: Number(overtimeHours || 0),
        bailout: Number(bailout || 0),
      });
      setSubmitResult(result);
      setShowSuccess(true);
    } catch (err) {
      toast.error(err.message || 'Gagal mengirim pesanan. Silakan coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  // ← 4. Handle loading state
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background-light">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <p className="text-text-sub">Memuat detail mobil...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ← 5. Handle error state
  if (error) {
    return (
      <div className="min-h-screen flex flex-col bg-background-light">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600">Error: {error}</p>
            <Link to="/" className="text-primary hover:underline font-medium mt-4 block">
              ← Kembali ke Katalog
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ← 6. Original "car not found" logic stays the same
  if (!car) {
    return (
      <div className="min-h-screen flex flex-col bg-background-light">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <span className="material-symbols-outlined text-6xl text-slate-300 mb-4 block">
              directions_car
            </span>
            <h1 className="text-2xl font-bold text-text-main mb-4">
              Mobil tidak ditemukan
            </h1>
            <Link to="/" className="text-primary hover:underline font-medium">
              ← Kembali ke Katalog
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ← 7. Rest of the component stays exactly the same
  return (
    <div className="bg-[#f8f5f5] text-slate-900 font-[Inter,sans-serif] antialiased min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* All your existing JSX stays exactly the same */}
        <div className="mb-8">
          <Link
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-primary transition-colors"
            to="/"
          >
            <span className="material-symbols-outlined text-[18px]">
              arrow_back
            </span>
            Kembali ke Katalog
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left Column - Images & Info */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            {/* Main Image */}
            <div className="group relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-slate-100 shadow-sm border border-slate-200">
              <div
                className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                style={{
                  backgroundImage: `url("${gallery[selectedImage] || carImgSrc(car.image)}")`,
                }}
              ></div>
              <div className="absolute top-4 right-4">
                <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700 ring-1 ring-inset ring-green-600/20">
                  Tersedia
                </span>
              </div>
            </div>

            {/* Thumbnail Gallery */}
            <div className="grid grid-cols-4 gap-3">
              {gallery.slice(0, 3).map((img, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedImage(idx)}
                  className={`aspect-video cursor-pointer rounded-lg bg-cover bg-center transition-opacity ${selectedImage === idx
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-[#f8f5f5]"
                      : "opacity-70 hover:opacity-100"
                    }`}
                  style={{ backgroundImage: `url("${img}")` }}
                ></div>
              ))}
              {gallery.length <= 1 && (
                <div className="aspect-video rounded-lg bg-slate-100 flex items-center justify-center opacity-50">
                  <span className="material-symbols-outlined text-slate-400">
                    photo_library
                  </span>
                </div>
              )}
            </div>

            {/* Car Info */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  {car.brand}
                </h2>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                  {car.name}
                </h1>
              </div>

              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-primary">
                  {car.priceFormatted}
                </span>
                <span className="mb-1 text-base font-medium text-slate-500">
                  / hari
                </span>
              </div>

              <p className="text-slate-600 leading-relaxed">
                {car.description}
              </p>

              {/* Specs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-slate-200">
                <div className="flex items-center gap-2 text-slate-700">
                  <span className="material-symbols-outlined text-primary">
                    person
                  </span>
                  <span className="text-sm font-medium">{car.seats}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <span className="material-symbols-outlined text-primary">
                    local_gas_station
                  </span>
                  <span className="text-sm font-medium">{car.fuel}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <span className="material-symbols-outlined text-primary">
                    settings
                  </span>
                  <span className="text-sm font-medium">
                    {car.transmission}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <span className="material-symbols-outlined text-primary">
                    ac_unit
                  </span>
                  <span className="text-sm font-medium">
                    {car.features?.includes("AC Double") ? "AC Double" : "AC"}
                  </span>
                </div>
              </div>

              {/* WhatsApp Button */}

              <a
                href={`https://wa.me/6281234567890?text=${encodeURIComponent(`Halo, saya tertarik dengan ${car.brand} ${car.name}. Apakah masih tersedia?`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-primary bg-white px-6 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary/5"
              >
                <span className="material-symbols-outlined">chat</span>
                Tanya via WhatsApp
              </a>
          </div>
        </div>

        {/* Right Column - Booking Form - ALL STAYS THE SAME */}
        <div className="lg:col-span-5">
          <div className="sticky top-24 rounded-2xl bg-white p-6 shadow-xl shadow-slate-200/50 ring-1 ring-slate-200">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">
                Form Pemesanan
              </h3>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-sm">
                  edit_calendar
                </span>
              </span>
            </div>

            {showSuccess ? (
              <div className="text-center py-8">
                <div className="inline-flex items-center justify-center size-14 rounded-full bg-green-100 mb-3">
                  <span className="material-symbols-outlined text-3xl text-green-600">
                    check_circle
                  </span>
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-2">
                  Pesanan Berhasil! 🎉
                </h4>
                {submitResult && (
                  <p className="text-sm font-mono font-bold text-primary mb-2">
                    {submitResult.order?.orderNumber}
                  </p>
                )}
                <p className="text-sm text-slate-500 mb-2">
                  {submitResult?.message || 'Admin akan menghubungi Anda via WhatsApp untuk konfirmasi.'}
                </p>
                {submitResult?.order && (
                  <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3 mb-3">
                    <p>Durasi: {submitResult.order.totalDays} hari</p>
                    <p>Total: {submitResult.order.totalPrice}</p>
                  </div>
                )}
                <button
                  onClick={() => {
                    setShowSuccess(false);
                    setSubmitResult(null);
                    setFullName("");
                    setWhatsapp("");
                    setCustomerType("private");
                    setCompanyName("");
                    setStartDate("");
                    setEndDate("");
                    setPackageName("");
                    setDestination("");
                    setOvernightNights("");
                    setOvertimeHours("");
                    setBailout("");
                  }}
                  className="text-sm text-primary font-medium hover:underline cursor-pointer"
                >
                  Buat pesanan baru
                </button>
              </div>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(e) => e.preventDefault()}
              >
                {/* Customer Type Tab */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Tipe Pemesan
                  </label>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerType("private");
                        setCompanyName("");
                        setFormErrors({ ...formErrors, companyName: "" });
                      }}
                      className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold transition-all cursor-pointer ${customerType === "private"
                          ? "bg-white text-primary shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">person</span>
                      Pribadi
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerType("company")}
                      className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold transition-all cursor-pointer ${customerType === "company"
                          ? "bg-white text-primary shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">business</span>
                      Perusahaan
                    </button>
                  </div>
                </div>

                {/* Company Name (only when type === company) */}
                {customerType === "company" && (
                  <div className="space-y-1.5">
                    <label
                      className="text-sm font-medium text-slate-700"
                      htmlFor="company_name"
                    >
                      Nama Perusahaan
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                        business
                      </span>
                      <input
                        className={`block w-full rounded-lg border ${formErrors.companyName ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-slate-200 focus:border-primary focus:ring-primary"} bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-1 outline-none transition-all`}
                        id="company_name"
                        placeholder="PT. Maju Jaya Sentosa"
                        type="text"
                        value={companyName}
                        onChange={(e) => {
                          setCompanyName(e.target.value);
                          setFormErrors({ ...formErrors, companyName: "" });
                        }}
                      />
                    </div>
                    {formErrors.companyName && (
                      <p className="text-xs text-red-500">
                        {formErrors.companyName}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label
                    className="text-sm font-medium text-slate-700"
                    htmlFor="fullname"
                  >
                    {customerType === "company" ? "Nama PIC" : "Nama Lengkap"}
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                      person
                    </span>
                    <input
                      className={`block w-full rounded-lg border ${formErrors.fullName ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-slate-200 focus:border-primary focus:ring-primary"} bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-1 outline-none transition-all`}
                      id="fullname"
                      placeholder="Budi Santoso"
                      type="text"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        setFormErrors({ ...formErrors, fullName: "" });
                      }}
                    />
                  </div>
                  {formErrors.fullName && (
                    <p className="text-xs text-red-500">
                      {formErrors.fullName}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    className="text-sm font-medium text-slate-700"
                    htmlFor="whatsapp"
                  >
                    Nomor WhatsApp
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                      phone_iphone
                    </span>
                    <input
                      className={`block w-full rounded-lg border ${formErrors.whatsapp ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-slate-200 focus:border-primary focus:ring-primary"} bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-1 outline-none transition-all`}
                      id="whatsapp"
                      placeholder="08123456789"
                      type="tel"
                      value={whatsapp}
                      onChange={(e) => {
                        setWhatsapp(e.target.value);
                        setFormErrors({ ...formErrors, whatsapp: "" });
                      }}
                    />
                  </div>
                  {formErrors.whatsapp && (
                    <p className="text-xs text-red-500">
                      {formErrors.whatsapp}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label
                      className="text-sm font-medium text-slate-700"
                      htmlFor="start_date"
                    >
                      Tanggal Mulai
                    </label>
                    <input
                      className={`block w-full rounded-lg border ${formErrors.startDate ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-slate-200 focus:border-primary focus:ring-primary"} bg-slate-50 py-2.5 px-3 text-sm text-slate-900 focus:bg-white focus:ring-1 outline-none transition-all`}
                      id="start_date"
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setFormErrors({ ...formErrors, startDate: "" });
                      }}
                    />
                    {formErrors.startDate && (
                      <p className="text-xs text-red-500">
                        {formErrors.startDate}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label
                      className="text-sm font-medium text-slate-700"
                      htmlFor="end_date"
                    >
                      Tanggal Selesai
                    </label>
                    <input
                      className={`block w-full rounded-lg border ${formErrors.endDate ? "border-red-400 focus:border-red-500 focus:ring-red-500" : "border-slate-200 focus:border-primary focus:ring-primary"} bg-slate-50 py-2.5 px-3 text-sm text-slate-900 focus:bg-white focus:ring-1 outline-none transition-all`}
                      id="end_date"
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setFormErrors({ ...formErrors, endDate: "" });
                      }}
                    />
                    {formErrors.endDate && (
                      <p className="text-xs text-red-500">
                        {formErrors.endDate}
                      </p>
                    )}
                  </div>
                </div>

                {/* Detail Sewa (extra Rekap Order fields) */}
                <div className="space-y-4 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Detail Sewa
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700" htmlFor="paket">
                      Paket
                    </label>
                    <select
                      id="paket"
                      value={packageName}
                      onChange={(e) => setPackageName(e.target.value)}
                      className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 px-3 text-sm text-slate-900 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    >
                      <option value="">— Pilih paket —</option>
                      <option value="Private">Private</option>
                      <option value="All In">All In</option>
                      <option value="Mobil & Driver">Mobil &amp; Driver</option>
                      <option value="Lepas Kunci">Lepas Kunci</option>
                      <option value="Drop">Drop</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700" htmlFor="tujuan">
                      Tujuan
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                        location_on
                      </span>
                      <input
                        id="tujuan"
                        type="text"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        placeholder="Contoh: Bandung, Bromo, dalam kota"
                        className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700" htmlFor="inap">
                        Inap (malam)
                      </label>
                      <input
                        id="inap"
                        type="number"
                        min="0"
                        value={overnightNights}
                        onChange={(e) => setOvernightNights(e.target.value)}
                        placeholder="0"
                        className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700" htmlFor="lembur">
                        Lembur (jam)
                      </label>
                      <input
                        id="lembur"
                        type="number"
                        min="0"
                        step="0.5"
                        value={overtimeHours}
                        onChange={(e) => setOvertimeHours(e.target.value)}
                        placeholder="0"
                        className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700" htmlFor="bailout">
                      Jaminan / Bailout (Rp)
                    </label>
                    <input
                      id="bailout"
                      type="number"
                      min="0"
                      step="any"
                      value={bailout}
                      onChange={(e) => setBailout(e.target.value)}
                      placeholder="0"
                      className="block w-full rounded-lg border border-slate-200 bg-white py-2.5 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Rental Summary */}
                <div className="mt-6 rounded-lg bg-slate-50 p-4 border border-slate-100">
                  <div className="flex items-center justify-between text-sm text-slate-600 mb-2">
                    <span>Durasi Sewa</span>
                    <span className="font-medium text-slate-900">
                      {rentalDays > 0 ? `${rentalDays} Hari` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-600 mb-2">
                    <span>Harga Harian</span>
                    <span className="font-medium text-slate-900">
                      {car.priceFormatted}
                    </span>
                  </div>
                  <div className="my-3 h-px bg-slate-200"></div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-slate-900">
                      Estimasi Total
                    </span>
                    <span className="text-xl font-bold text-primary">
                      {totalPrice > 0
                        ? `Rp ${totalPrice.toLocaleString("id-ID")}`
                        : "—"}
                    </span>
                  </div>
                </div>

                <button
                  className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-primary px-4 py-3.5 text-base font-bold text-white shadow-lg shadow-red-500/30 transition-all hover:bg-red-700 hover:shadow-red-500/50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <span className="mr-2">PESAN SEKARANG</span>
                      <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">
                        arrow_forward
                      </span>
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-slate-400">
                  Dengan memesan, Anda menyetujui{" "}
                  <a className="underline hover:text-primary" href="#">
                    Syarat &amp; Ketentuan
                  </a>{" "}
                  kami.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>

    <Footer />
  </div>
  );
}
