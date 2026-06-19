import { useLanguage } from "../context/LanguageContext";

// Audit M-01: every visible string flows through t().

export default function FeaturesSection() {
  const { t } = useLanguage();
  const features = [
    { icon: "verified", title: t("feature1Title"), body: t("feature1Body") },
    { icon: "price_check", title: t("feature2Title"), body: t("feature2Body") },
    { icon: "support_agent", title: t("feature3Title"), body: t("feature3Body") },
  ];

  return (
    <section className="py-16 lg:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">
            {t("featuresEyebrow")}
          </p>
          <h2 className="text-3xl md:text-4xl font-black text-text-main mb-3">
            {t("featuresTitle")}
          </h2>
          <p className="text-slate-500 max-w-xl mx-auto">
            {t("featuresSubtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div key={i} className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-primary/30 transition-colors">
              <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 text-primary mb-4">
                <span className="material-symbols-outlined text-[26px]">{f.icon}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
