import { useState } from "react";
import { Link } from "react-router-dom";

export default function Footer() {
    const [showModal, setShowModal] = useState(null); // 'privacy' | 'terms' | null

    return (
        <>
            <footer id="hubungi" className="bg-text-main text-white pt-16 pb-8">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Main Footer Content — Brand + Contact + CTA */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 mb-12">
                        {/* Brand */}
                        <div className="space-y-4">
                            <Link to="/" className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity">
                                <img src="/dsr-logo.png" alt="DSR Solution" className="h-10 w-auto" />
                                <h2 className="text-xl font-bold tracking-tight">DSR Solution</h2>
                            </Link>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                Solusi transportasi terbaik untuk kebutuhan bisnis dan liburan
                                Anda. Sewa mudah, cepat, dan terpercaya.
                            </p>
                        </div>

                        {/* Contact Info */}
                        <div>
                            <h4 className="text-lg font-bold mb-4">Hubungi Kami</h4>
                            <ul className="space-y-3 text-sm text-gray-400">
                                <li className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary text-lg">
                                        location_on
                                    </span>
                                    <span>Jl. Sudirman No. 123, Jakarta Selatan</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary text-lg">
                                        call
                                    </span>
                                    <span>+62 822 1981 2530</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary text-lg">
                                        mail
                                    </span>
                                    <span>hello@dsrsolution.id</span>
                                </li>
                            </ul>
                        </div>

                        {/* CTA */}
                        <div className="flex flex-col justify-center items-start gap-4">
                            <h4 className="text-lg font-bold">Mulai Sewa Sekarang</h4>
                            <p className="text-gray-400 text-sm">
                                Temukan mobil impian Anda dengan harga terbaik.
                            </p>
                            <a
                                href="#katalog"
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary/90 hover:bg-primary text-white font-semibold transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40"
                            >
                                <span className="material-symbols-outlined text-[20px]">directions_car</span>
                                Lihat Armada
                            </a>
                        </div>
                    </div>

                    {/* Bottom Bar */}
                    <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                        <p className="text-sm text-gray-500">
                            © 2026 DSR Solution. All rights reserved.
                        </p>
                        <div className="flex items-center gap-6">
                            <button
                                onClick={() => setShowModal('privacy')}
                                className="text-sm text-gray-400 hover:text-white transition-colors cursor-pointer"
                            >
                                Kebijakan Privasi
                            </button>
                            <button
                                onClick={() => setShowModal('terms')}
                                className="text-sm text-gray-400 hover:text-white transition-colors cursor-pointer"
                            >
                                Syarat & Ketentuan
                            </button>
                            <div className="flex gap-4">
                                <a
                                    className="text-gray-400 hover:text-white transition-colors"
                                    href="#"
                                    aria-label="Facebook"
                                >
                                    <svg
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                        fill="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            clipRule="evenodd"
                                            d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"
                                            fillRule="evenodd"
                                        />
                                    </svg>
                                </a>
                                <a
                                    className="text-gray-400 hover:text-white transition-colors"
                                    href="#"
                                    aria-label="Instagram"
                                >
                                    <svg
                                        aria-hidden="true"
                                        className="h-5 w-5"
                                        fill="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            clipRule="evenodd"
                                            d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
                                            fillRule="evenodd"
                                        />
                                    </svg>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </footer>

            {/* Privacy / Terms Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={() => setShowModal(null)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto text-slate-900" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl z-10">
                            <h2 className="text-xl font-bold">
                                {showModal === 'privacy' ? 'Kebijakan Privasi' : 'Syarat & Ketentuan'}
                            </h2>
                            <button onClick={() => setShowModal(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="p-6 prose prose-sm max-w-none text-slate-700 leading-relaxed">
                            {showModal === 'privacy' ? (
                                <>
                                    <p className="font-semibold">Terakhir diperbarui: 1 Januari 2026</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">1. Pengumpulan Data</h3>
                                    <p>Kami mengumpulkan informasi pribadi Anda seperti nama, nomor telepon, email, dan alamat saat Anda melakukan pemesanan sewa mobil. Data ini digunakan semata-mata untuk memproses dan mengelola pesanan Anda.</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">2. Penggunaan Data</h3>
                                    <p>Data Anda digunakan untuk: memproses pesanan sewa, menghubungi Anda terkait konfirmasi, meningkatkan layanan kami, dan mematuhi kewajiban hukum yang berlaku.</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">3. Perlindungan Data</h3>
                                    <p>Kami menerapkan langkah-langkah keamanan teknis dan organisasi untuk melindungi data pribadi Anda dari akses tidak sah, pengubahan, pengungkapan, atau penghancuran.</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">4. Hak Anda</h3>
                                    <p>Anda memiliki hak untuk mengakses, memperbarui, atau menghapus data pribadi Anda. Hubungi kami di hello@dsrsolution.id untuk permintaan terkait data.</p>
                                </>
                            ) : (
                                <>
                                    <p className="font-semibold">Terakhir diperbarui: 1 Januari 2026</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">1. Ketentuan Umum</h3>
                                    <p>Dengan menggunakan layanan DSR Solution, Anda menyetujui syarat dan ketentuan yang berlaku. Layanan kami mencakup penyewaan kendaraan untuk keperluan pribadi maupun bisnis.</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">2. Persyaratan Penyewa</h3>
                                    <p>Penyewa harus berusia minimal 21 tahun, memiliki SIM yang masih berlaku, dan menyerahkan identitas diri (KTP/Paspor) sebagai jaminan selama masa sewa.</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">3. Pembayaran</h3>
                                    <p>Pembayaran dilakukan di muka sebelum kendaraan diserahkan. Harga sewa sudah termasuk asuransi dasar. Biaya tambahan berlaku untuk penggunaan di luar area yang disepakati.</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">4. Tanggung Jawab</h3>
                                    <p>Penyewa bertanggung jawab atas kerusakan atau kehilangan kendaraan selama masa sewa. Penyewa wajib mematuhi peraturan lalu lintas yang berlaku.</p>
                                    <h3 className="text-lg font-bold mt-4 mb-2">5. Pembatalan</h3>
                                    <p>Pembatalan dapat dilakukan maksimal 24 jam sebelum waktu pengambilan. Pembatalan kurang dari 24 jam dikenakan biaya 50% dari total sewa.</p>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
