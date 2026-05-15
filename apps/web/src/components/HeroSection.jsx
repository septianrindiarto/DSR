export default function HeroSection() {
    return (
        <section className="relative bg-gray-900 text-white py-20 lg:py-32 overflow-hidden">
            {/* Background Image with Overlay */}
            <div className="absolute inset-0 z-0">
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-black/40 z-10"></div>
                <img
                    alt="Modern luxury car driving on highway"
                    className="w-full h-full object-cover"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuATmAW7sflncoGimMxkjLbfdt0qv0k6oJ5iqn4iDMX6BQSIhuHjaLYhxXuEnP6YTFijAQmJiVxnHZoDxOfLc3Ex4t-xmKFN4Qc1gQ7iOaUsNeOxJpeIRfQ76RewmklQBcvDp0kyTPYif7MN3qnQJVhsLhl7rdMxKXB_CTeLhmtntzua7EG3l0KRovwi6TQb6P3gQVdHlhrAQDuKbwNgU4BuZfOWa21tYi4ImUuUmm81E4BtFu8XurKztFnEsKK0wkaua2PUcWF_HPXg"
                    loading="eager"
                />
            </div>

            {/* Content */}
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight mb-6 leading-tight">
                    SEWA MOBIL <span className="text-primary">TERPERCAYA</span>
                </h1>
                <p className="text-lg md:text-xl text-gray-200 mb-10 max-w-2xl mx-auto font-light">
                    Temukan mobil terbaik untuk perjalanan Anda dengan harga terjangkau dan
                    pelayanan terbaik. Kenyamanan Anda adalah prioritas kami.
                </p>

                {/* Search Bar — Single Input Only */}
                <div className="w-full max-w-2xl bg-white/10 backdrop-blur-md p-2 rounded-xl border border-white/20 shadow-2xl">
                    <div className="bg-white rounded-lg flex items-center p-2 gap-2">
                        <div className="flex-1 flex items-center px-3 h-12">
                            <span className="material-symbols-outlined text-gray-400 mr-3">
                                search
                            </span>
                            <input
                                className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-text-main placeholder-gray-400 text-base"
                                placeholder="Cari mobil impian Anda..."
                                type="text"
                            />
                        </div>
                        <a
                            href="#katalog"
                            className="h-12 px-8 bg-primary hover:bg-primary-dark text-white font-bold rounded-lg transition-all shadow-lg shadow-primary/30 flex items-center justify-center gap-2 cursor-pointer shrink-0"
                        >
                            <span>Cari</span>
                            <span className="material-symbols-outlined text-sm">
                                arrow_forward
                            </span>
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
