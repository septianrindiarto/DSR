import { useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";

// Audit M-01: Footer fully wired through t(). Privacy/Terms modal copy
// still pulled from t("privacyPolicyText") / t("termsText") which already
// existed in the i18n bundles.

export default function Footer() {
  const { t } = useLanguage();
  const [showModal, setShowModal] = useState(null); // 'privacy' | 'terms' | null

  return (
    <>
      <footer id="hubungi" className="bg-text-main text-white pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 mb-12">
            {/* Brand */}
            <div className="space-y-4">
              <Link to="/" className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity">
                <img src="/dsr-logo.png" alt="DSR Solution" className="h-10 w-auto" />
                <h2 className="text-xl font-bold tracking-tight">DSR Solution</h2>
              </Link>
              <p className="text-gray-400 text-sm leading-relaxed">{t("footerBrandText")}</p>
            </div>

            {/* Contact Info */}
            <div>
              <h4 className="text-lg font-bold mb-4">{t("contactUs")}</h4>
              <ul className="space-y-3 text-sm text-gray-400">
                <li className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-lg">location_on</span>
                  <span>{t("addressValue")}</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-lg">call</span>
                  <span>+62 822 1981 2530</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-lg">mail</span>
                  <span>dsrjayakarya@gmail.com</span>
                </li>
              </ul>
            </div>

            {/* Quick Action */}
            <div>
              <h4 className="text-lg font-bold mb-4">{t("quickActionTitle")}</h4>
              <p className="text-sm text-gray-400 mb-4">{t("quickActionBody")}</p>
              <a
                href="https://wa.me/6282219812530"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-bold transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">chat</span>
                {t("contactWa")}
              </a>
            </div>
          </div>

          <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
            <p>{t("footerCopyright")}</p>
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => setShowModal("privacy")} className="hover:text-white transition-colors cursor-pointer">
                {t("privacyPolicy")}
              </button>
              <span className="text-gray-600">·</span>
              <button type="button" onClick={() => setShowModal("terms")} className="hover:text-white transition-colors cursor-pointer">
                {t("termsConditions")}
              </button>
            </div>
          </div>
        </div>
      </footer>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={() => setShowModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto text-slate-900" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-xl font-bold">
                {showModal === "privacy" ? t("privacyPolicy") : t("termsConditions")}
              </h2>
              <button onClick={() => setShowModal(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 prose prose-sm max-w-none text-slate-700 leading-relaxed whitespace-pre-line">
              {showModal === "privacy" ? t("privacyPolicyText") : t("termsText")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
