import { useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { api } from "../lib/api";

// ─── RequestAccessModal ────────────────────────────────────────────────────
// Shown when a client lands on a feature their role doesn't grant. Lets them
// submit a "Permintaan Akses" with an optional note. Admin reviews from the
// /admin/access-requests page (Phase 3).
//
// Props
//   featureKey       — FEATURES.<X> string, e.g. "fleet"
//   featureLabel     — human label shown in the modal title (already i18n'd
//                      by the caller, e.g. t('fleet'))
//   onClose          — called when user cancels OR after successful submit
//   onSuccess        — called after the request was successfully sent (defaults
//                      to onClose if not provided)

export default function RequestAccessModal({ featureKey, featureLabel, onClose, onSuccess }) {
  const { t } = useLanguage();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.accessRequests.create(featureKey, note);
      setSent(true);
      setTimeout(() => {
        (onSuccess || onClose)?.();
      }, 1500);
    } catch (err) {
      setError(err.message || t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="inline-flex items-center justify-center size-14 rounded-full bg-amber-100 text-amber-600 mb-4 mx-auto">
            <span className="material-symbols-outlined text-3xl">lock</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900">{t("requestAccessTitle")}</h2>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
            {t("requestAccessBody")}
          </p>
          {featureLabel && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
              <span className="material-symbols-outlined text-[14px]">key</span>
              {t("feature")}: {featureLabel}
            </div>
          )}
        </div>

        {sent ? (
          <div className="mt-5 bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-700 flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            {t("requestAccessSent")}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("requestAccessNotePlaceholder")}
              rows={3}
              maxLength={500}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-slate-50 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
            />
            {error && (
              <p className="text-xs text-red-600 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">error</span>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-dark text-white text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
              >
                {submitting && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {t("requestAccessSubmit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
