const features = [
    {
        icon: "verified_user",
        title: "Terpercaya & Aman",
        description:
            "Kami menjamin keamanan dan kenyamanan setiap unit kendaraan yang kami sewakan.",
    },
    {
        icon: "price_check",
        title: "Harga Kompetitif",
        description:
            "Dapatkan penawaran harga terbaik untuk sewa harian, mingguan, maupun bulanan.",
    },
    {
        icon: "support_agent",
        title: "Layanan 24 Jam",
        description:
            "Tim support kami siap membantu kebutuhan perjalanan Anda kapanpun diperlukan.",
    },
];

export default function FeaturesSection() {
    return (
        <section className="py-16 bg-white border-t border-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {features.map((feature, index) => (
                        <div
                            key={index}
                            className="flex flex-col items-center text-center p-6 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4 text-primary">
                                <span className="material-symbols-outlined text-3xl">
                                    {feature.icon}
                                </span>
                            </div>
                            <h3 className="text-lg font-bold text-text-main mb-2">
                                {feature.title}
                            </h3>
                            <p className="text-gray-500 text-sm leading-relaxed">
                                {feature.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
