import { useLanguage } from "../context/LanguageContext";

// Audit M-01: hero copy flows through t(). Search bar kept commented out
// per earlier UX request - revive via the comment block when needed.

export default function HeroSection() {
  const { t } = useLanguage();
  return (
    <section className="relative bg-gray-900 text-white py-20 lg:py-32 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-black/40 z-10"></div>
        <img
          alt="Modern luxury car driving on highway"
          className="w-full h-full object-cover"
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuATmAW7sflncoGimMxkjLbfdt0qv0k6oJ5iqn4iDMX6BQSIhuHjaLYhxXuEnP6YTFijAQmJiVxnHZoDxOfLc3Ex4t-xmKFN4Qc1gQ7iOaUsNeOxJpeIRfQ76RewmklQBcvDp0kyTPYif7MN3qnQJVhsLhl7rdMxKXB_CTeLhmtntzua7EG3l0KRovwi6TQb6P3gQVdHlhrAQDuKbwNgU4BuZfOWa21tYi4ImUuUmm81E4BtFu8XurKztFnEsKK0wkaua2PUcWF_HPXg"
          loading="eager"
        />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight mb-6 leading-tight">
          {t("heroHeadline1")} <span className="text-primary">{t("heroHeadline2")}</span>
        </h1>
        <p className="text-lg md:text-xl text-gray-200 mb-10 max-w-2xl mx-auto font-light">
          {t("heroSubtitle")}
        </p>
      </div>
    </section>
  );
}
