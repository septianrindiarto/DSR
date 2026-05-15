import { Link } from "react-router-dom";

// Placeholder contact tokens — swap [Your Email] / [Your WhatsApp] with real
// values once you decide what to share publicly.
const CONTACT_EMAIL = "[Your Email]";
const CONTACT_WHATSAPP = "[Your WhatsApp]";

const features = [
    {
        icon: "directions_car",
        title: "Manajemen Armada",
        text: "Pantau status setiap unit kendaraan, jadwal perawatan, plat nomor, dan ketersediaan dalam satu dashboard.",
    },
    {
        icon: "receipt_long",
        title: "Order & Invoice Otomatis",
        text: "Booking online, approval workflow, generate invoice PDF, hingga rekap pembayaran end-to-end.",
    },
    {
        icon: "people",
        title: "CRM Pelanggan",
        text: "Database pelanggan terpusat — segmentasi VIP, riwayat sewa, dan komunikasi via WhatsApp.",
    },
    {
        icon: "trending_up",
        title: "Laporan Keuangan",
        text: "Jurnal otomatis, laba/rugi bulanan, neraca, dan ekspor laporan untuk akuntan & investor.",
    },
    {
        icon: "schedule",
        title: "Penjadwalan Driver",
        text: "Atur shift driver, hindari double-booking, dan lihat kalender armada per minggu.",
    },
    {
        icon: "language",
        title: "Multi-bahasa & Mobile-ready",
        text: "Antarmuka responsif untuk admin desktop dan client mobile, support Bahasa Indonesia & Inggris.",
    },
];

const techStack = [
    "React + Vite",
    "Tailwind CSS",
    "Node.js + Express",
    "PostgreSQL + Drizzle ORM",
    "Better-Auth",
    "REST API",
];

export default function PortfolioSection() {
    return (
        <section
            id="portfolio"
            className="py-20 bg-gradient-to-b from-slate-50 to-white border-t border-gray-100"
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Section header */}
                <div className="text-center max-w-3xl mx-auto mb-14">
                    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-4">
                        <span className="material-symbols-outlined text-[16px]">workspace_premium</span>
                        Portfolio Showcase
                    </span>
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 mb-4">
                        Sistem Manajemen Rental Mobil End-to-End
                    </h2>
                    <p className="text-base md:text-lg text-slate-600 leading-relaxed">
                        DSR Solution adalah aplikasi web full-stack untuk mengelola
                        operasional bisnis rental mobil — dari katalog publik, booking
                        pelanggan, hingga akuntansi dan laporan eksekutif. Dibangun
                        sebagai studi kasus dunia nyata, bukan template.
                    </p>
                </div>

                {/* Problem solved */}
                <div className="grid md:grid-cols-2 gap-6 mb-14">
                    <div className="bg-white p-6 rounded-2xl border border-red-100 shadow-sm">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                                <span className="material-symbols-outlined">warning</span>
                            </div>
                            <h3 className="font-bold text-slate-900">Masalah yang Diselesaikan</h3>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                            Banyak rental mobil masih kelola booking di WhatsApp, Excel
                            manual, dan kuitansi kertas. Akibatnya: double-booking,
                            invoice nyasar, sulit tahu unit mana yang menguntungkan, dan
                            laporan keuangan butuh berhari-hari di akhir bulan.
                        </p>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                <span className="material-symbols-outlined">check_circle</span>
                            </div>
                            <h3 className="font-bold text-slate-900">Solusi yang Ditawarkan</h3>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed">
                            Satu sistem terpadu: katalog online untuk pelanggan, admin
                            panel untuk operator, dan dashboard keuangan otomatis untuk
                            owner. Semua data tersinkron real-time, invoice di-generate
                            sekali klik, dan laporan tinggal export.
                        </p>
                    </div>
                </div>

                {/* Feature grid */}
                <div className="mb-14">
                    <h3 className="text-xl font-bold text-slate-900 mb-6 text-center">
                        Fitur Utama
                    </h3>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {features.map((f) => (
                            <div
                                key={f.title}
                                className="bg-white p-5 rounded-xl border border-slate-100 hover:border-primary/30 hover:shadow-md transition-all"
                            >
                                <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                                    <span className="material-symbols-outlined">{f.icon}</span>
                                </div>
                                <h4 className="font-bold text-slate-900 mb-1.5">{f.title}</h4>
                                <p className="text-sm text-slate-500 leading-relaxed">{f.text}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tech stack */}
                <div className="mb-14">
                    <h3 className="text-xl font-bold text-slate-900 mb-4 text-center">
                        Tech Stack
                    </h3>
                    <div className="flex flex-wrap justify-center gap-2">
                        {techStack.map((tech) => (
                            <span
                                key={tech}
                                className="px-4 py-2 rounded-full bg-slate-900 text-white text-xs font-semibold tracking-wide"
                            >
                                {tech}
                            </span>
                        ))}
                    </div>
                </div>

                {/* CTA */}
                <div className="bg-gradient-to-br from-primary to-primary-dark rounded-3xl p-8 md:p-12 text-center text-white shadow-2xl shadow-primary/20">
                    <h3 className="text-2xl md:text-3xl font-black mb-3">
                        Butuh aplikasi serupa untuk bisnis Anda?
                    </h3>
                    <p className="text-white/90 mb-7 max-w-2xl mx-auto">
                        Sistem ini bisa di-customize untuk berbagai industri: rental
                        alat berat, jasa logistik, klinik, properti, hingga retail.
                        Mari diskusikan kebutuhan Anda.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                        <Link
                            to="/admin/login"
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-primary font-bold hover:bg-slate-50 transition-colors shadow-lg"
                        >
                            <span className="material-symbols-outlined text-[20px]">play_circle</span>
                            Coba Demo Admin
                        </Link>
                        <a
                            href={`mailto:${CONTACT_EMAIL}?subject=Request%20-%20Custom%20Rental%20Management%20System`}
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 backdrop-blur border-2 border-white/40 text-white font-bold hover:bg-white/20 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[20px]">mail</span>
                            Request This for Your Business
                        </a>
                    </div>
                    <p className="text-xs text-white/70 mt-5">
                        Hubungi: {CONTACT_EMAIL} · WhatsApp {CONTACT_WHATSAPP}
                    </p>
                </div>
            </div>
        </section>
    );
}
