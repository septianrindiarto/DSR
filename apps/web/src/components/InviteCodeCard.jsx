import { useState, useEffect } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

// ─── InviteCodeCard ────────────────────────────────────────────────────────
// Phase 4A: shown to a client admin in the Settings page. Loads the org's
// current invite code, lets the admin copy it, re-email it, or rotate it.
//
// Self-gates: renders nothing if the current user isn't a client admin
// (accountType === 'client' AND role === 'admin'). Safe to drop into any
// settings layout — won't show up for users it shouldn't reach.

export default function InviteCodeCard() {
  const { t } = useLanguage();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(""); // "" | "resend" | "rotate" | "copy"

  const isClientAdmin =
    (user?.accountType === "client" && user?.role === "admin") ||
    user?.role === "client_admin"; // legacy fallback for pre-Phase-4 rows

  useEffect(() => {
    if (!isClientAdmin) {
      setLoading(false);
      return;
    }
    api.myOrg.getInviteCode()
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [isClientAdmin]);

  if (!isClientAdmin) return null;

  async function handleCopy() {
    if (!data?.inviteCode) return;
    setBusy("copy");
    try {
      await navigator.clipboard.writeText(data.inviteCode);
      setInfo(t("inviteCodeCopied"));
      setTimeout(() => setInfo(""), 2000);
    } catch {
      setError("Gagal menyalin. Salin manual: " + data.inviteCode);
    } finally {
      setBusy("");
    }
  }

  async function handleResend() {
    setBusy("resend");
    setError("");
    setInfo("");
    try {
      const r = await api.myOrg.resendInviteCode();
      setInfo(r.message || t("inviteCodeResend"));
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }

  async function handleRotate() {
    if (!window.confirm(t("inviteCodeRotateConfirm"))) return;
    setBusy("rotate");
    setError("");
    setInfo("");
    try {
      const r = await api.myOrg.rotateInviteCode();
      setData({ ...data, inviteCode: r.inviteCode });
      setInfo(r.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">vpn_key</span>
            {t("inviteCode")}
          </h2>
          {/* Subtitle: company name (if known) + the share blurb. The internal
              display_id used to render here in parentheses — removed per user
              request because it added noise without value for the rekan tim. */}
          <p className="text-xs text-slate-500 mt-0.5">
            {data?.companyName ? `${data.companyName} · ` : ""}
            Bagikan kode ini ke rekan tim agar mereka bergabung otomatis ke perusahaan Anda.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
          {t("loading")}
        </div>
      )}

      {!loading && error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]">error</span>
          {error}
        </div>
      )}

      {!loading && !error && data?.inviteCode && (
        <>
          <div className="bg-slate-900 text-white rounded-lg px-5 py-4 flex items-center justify-between">
            <span className="font-mono text-2xl font-bold tracking-wider">{data.inviteCode}</span>
            <button
              onClick={handleCopy}
              disabled={busy === "copy"}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span>
              {t("inviteCodeCopy")}
            </button>
          </div>

          {info && (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              {info}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleResend}
              disabled={busy === "resend"}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              {busy === "resend" && <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />}
              <span className="material-symbols-outlined text-[16px]">mail</span>
              {t("inviteCodeResend")}
            </button>
            <button
              onClick={handleRotate}
              disabled={busy === "rotate"}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 cursor-pointer disabled:opacity-50"
            >
              {busy === "rotate" && <div className="w-3 h-3 border-2 border-amber-300 border-t-amber-700 rounded-full animate-spin" />}
              <span className="material-symbols-outlined text-[16px]">autorenew</span>
              {t("inviteCodeRotate")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
