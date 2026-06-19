import { useLanguage } from "../context/LanguageContext";

// Public WhatsApp floating action button. Audit M-01: now flows through t().
// TODO H-02: pull the phone number from settings instead of hardcoding.

export default function WhatsAppFAB() {
  const { t } = useLanguage();
  return (
    <a
      href="https://wa.me/6281234567890"
      target="_blank"
      rel="noopener noreferrer"
      title={t("whatsappChatTitle")}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold rounded-full shadow-2xl shadow-green-500/30 transition-all hover:scale-105 px-5 h-14"
      aria-label={t("whatsappChat")}
    >
      <span className="material-symbols-outlined text-[24px]">chat</span>
      <span className="hidden sm:inline text-sm">{t("whatsappChat")}</span>
    </a>
  );
}
