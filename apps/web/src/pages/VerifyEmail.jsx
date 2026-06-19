import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

// ─── /verify-email?token=xxx ─────────────────────────────────────────────
// Public page reached from the activation link emailed by Better Auth.
// On mount we POST the token to Better Auth's verify-email endpoint and
// render one of three states: verifying / success / failed. Failure path
// also exposes a "Resend activation email" form so the user isn't stuck.

export default function VerifyEmail() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [state, setState] = useState(token ? "verifying" : "failed");
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resentMsg, setResentMsg] = useState("");
  const [resendError, setResendError] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        await api.auth.verifyEmail(token);
        if (!cancelled) setState("success");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function handleResend(e) {
    e.preventDefault();
    setResendError("");
    setResentMsg("");
    if (!resendEmail.trim()) {
      setResendError("Email wajib diisi.");
      return;
    }
    setResending(true);
    try {
      await api.auth.sendVerification(resendEmail.trim());
      setResentMsg(t("verifyEmailResent"));
    } catch (err) {
      setResendError(err.message || "Gagal mengirim ulang.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="bg-[#f8f5f5] font-[Inter,sans-serif] antialiased text-slate-900 min-h-screen flex flex-col">
      <header className="flex items-center justify-center px-10 py-4 border-b border-primary/10 bg-white/50 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/dsr-logo.png" alt="DSR Solution" className="h-10 w-auto" />
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            DSR <span className="text-primary">Solution</span>
          </h1>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-primary/10 overflow-hidden">
          <div className="pt-10 pb-6 px-8 text-center">

            {state === "verifying" && (
              <>
                <div className="inline-flex items-center justify-center size-16 rounded-full bg-primary/10 text-primary mb-6">
                  <div className="w-7 h-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                </div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {t("verifyEmailTitle")}
                </h2>
                <p className="text-slate-500 mt-2 text-sm">{t("verifyEmailVerifying")}</p>
              </>
            )}

            {state === "success" && (
              <>
                <div className="inline-flex items-center justify-center size-16 rounded-full bg-green-100 text-green-600 mb-6">
                  <span className="material-symbols-outlined text-3xl">check_circle</span>
                </div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {t("verifyEmailTitle")}
                </h2>
                <p className="text-slate-500 mt-2 text-sm">{t("verifyEmailSuccess")}</p>
                <Link
                  to="/admin/login"
                  className="inline-flex items-center justify-center gap-2 mt-6 w-full py-3 px-4 rounded-lg bg-primary hover:bg-primary-dark text-white font-semibold shadow-sm shadow-primary/20 transition-colors"
                >
                  {t("login")}
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </Link>
              </>
            )}

            {state === "failed" && (
              <>
                <div className="inline-flex items-center justify-center size-16 rounded-full bg-red-100 text-red-600 mb-6">
                  <span className="material-symbols-outlined text-3xl">error</span>
                </div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {t("verifyEmailTitle")}
                </h2>
                <p className="text-slate-500 mt-2 text-sm">{t("verifyEmailFailed")}</p>

                <form onSubmit={handleResend} className="mt-6 flex flex-col gap-3 text-left">
                  <label className="block text-sm font-medium text-slate-700">
                    {t("verifyEmailResend")}
                  </label>
                  <input
                    type="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    placeholder="email@anda.com"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 text-slate-900 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 outline-none"
                    required
                  />
                  {resendError && (
                    <p className="text-xs text-red-600 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px]">error</span>
                      {resendError}
                    </p>
                  )}
                  {resentMsg && (
                    <p className="text-xs text-green-700 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                      {resentMsg}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={resending}
                    className="w-full py-3 px-4 rounded-lg bg-primary hover:bg-primary-dark text-white font-semibold shadow-sm shadow-primary/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
                  >
                    {resending && (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    )}
                    {t("verifyEmailResend")}
                  </button>
                  <Link
                    to="/admin/login"
                    className="text-center text-sm text-slate-500 hover:text-primary mt-1 cursor-pointer"
                  >
                    {t("back")}
                  </Link>
                </form>
              </>
            )}

          </div>
        </div>
      </main>

      <footer className="py-6 text-center text-sm text-slate-400">
        © 2026 DSR Solution. All rights reserved.
      </footer>
    </div>
  );
}
