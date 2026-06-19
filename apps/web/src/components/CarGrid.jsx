import { useState, useEffect } from "react";
import CarCard from "./CarCard";
import { api, apiCache, swr } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

// Audit M-R4: CarGrid now flows through the same stale-while-revalidate
// helper that powers every authenticated page. First paint is hydrated
// from cache (if any), and a background refresh fills in the latest
// fleet without blocking the UI.

export default function CarGrid() {
    const { t } = useLanguage();
    const CACHE_KEY = "cars:public";
    const [cars, setCars] = useState(() => apiCache.get(CACHE_KEY)?.data || []);
    const [loading, setLoading] = useState(() => !apiCache.has(CACHE_KEY));
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState("all");

    useEffect(() => {
        let active = true;
        swr(CACHE_KEY, () => api.cars.listPublic())
            .then((data) => {
                if (!active) return;
                setCars(Array.isArray(data) ? data : []);
                setLoading(false);
                setError(null);
            })
            .catch((err) => {
                if (!active) return;
                console.error("Error fetching cars:", err);
                setError(err.message);
                setLoading(false);
            });
        return () => { active = false; };
    }, []);

    const categories = ["all", ...new Set(cars.map(c => c.category).filter(Boolean))];
    const categoryLabels = { all: t('allCategories'), economy: t('economy'), standard: t('standard'), premium: t('premium'), luxury: t('luxury') };
    const filteredCars = filter === "all" ? cars : cars.filter(c => c.category === filter);

    if (loading) {
        return (
            <section className="py-16 bg-background-light">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-text-sub text-sm">{t('loadingCars')}</p>
                    </div>
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="py-16 bg-background-light">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <p className="text-red-600">{t('failedToLoadData').replace('{error}', error)}</p>
                    <button onClick={() => window.location.reload()} className="mt-4 text-primary font-medium hover:underline cursor-pointer">
                        {t('tryAgain')}
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section id="katalog" className="py-16 bg-background-light">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-4">
                    <div>
                        <h2 className="text-3xl font-bold text-text-main mb-2">
                            {t('availableCars')}
                        </h2>
                        <p className="text-text-sub">
                            {t('bestFleetChoice')}
                        </p>
                    </div>
                    {/* Category Filter */}
                    <div className="flex gap-2 flex-wrap">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setFilter(cat)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                                    filter === cat
                                        ? "bg-primary text-white shadow-sm"
                                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                }`}
                            >
                                {categoryLabels[cat] || cat}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {filteredCars.map((car) => (
                        <CarCard key={car.id} car={car} />
                    ))}
                </div>
                {filteredCars.length === 0 && (
                    <div className="text-center py-12 text-slate-400">
                        <span className="material-symbols-outlined text-4xl mb-2 block">directions_car</span>
                        <p>{t('noCarsInCategory')}</p>
                    </div>
                )}
            </div>
        </section>
    );
}