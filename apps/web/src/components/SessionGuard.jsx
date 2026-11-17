import { useEffect, useRef, useState } from "react";
import { api, apiActivity } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

// ─── Idle timeout in the browser (owner 2026-11-13) ─────────────────────────
// The server ends a session after 15 idle minutes (drivers on a phone: longer;
// superadmin: never). Here we (1) tell the server about real use that makes no
// API call — typing a long form — with a quiet ping at most once a minute,
// (2) warn 2 minutes before the end with "Tetap masuk", and (3) at the end ask
// the server, which answers 401 SESSION_EXPIRED → the login page says why.
// Background polling (the bell) never counts as activity.
const TICK_MS = 5000;
const PING_EVERY_MS = 60_000;
const EVENTS = ["mousedown", "keydown", "touchstart", "wheel", "mousemove", "scroll"];

export default function SessionGuard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [policy, setPolicy] = useState(null);
  const [left, setLeft] = useState(null);          // seconds until expiry while warning
  const lastInput = useRef(0);
  const lastServer = useRef(0);
  const lastCheck = useRef(0);
  const userId = user?.id || null;

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    api.session.policy().then((p) => alive && setPolicy(p)).catch(() => {});
    return () => { alive = false; setPolicy(null); setLeft(null); };
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    lastInput.current = Date.now(); lastServer.current = Date.now();   // start of this login
    const mark = () => { lastInput.current = Date.now(); };
    EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    // Every counted (non-background) API call is activity on the server.
    const unsub = apiActivity.subscribe(() => { lastServer.current = Date.now(); });
    return () => { EVENTS.forEach((e) => window.removeEventListener(e, mark)); unsub(); };
  }, [userId]);

  useEffect(() => {
    if (!policy || policy.exempt || !policy.idleMinutes) return undefined;
    const idleMs = policy.idleMinutes * 60000, warnMs = (policy.warnMinutes || 2) * 60000;
    const id = setInterval(() => {
      const now = Date.now();
      const last = Math.max(lastInput.current, lastServer.current);
      // Used but no API call for a minute → keep the server session alive.
      if (lastInput.current > lastServer.current && now - lastServer.current > PING_EVERY_MS) {
        lastServer.current = now;
        api.session.ping().catch(() => {});
      }
      const idle = now - last;
      if (idle >= idleMs) {
        // Ask the server (background, not activity): 401 SESSION_EXPIRED → login page with the reason.
        if (now - lastCheck.current > 30_000) { lastCheck.current = now; api.session.check().catch(() => {}); }
        setLeft(0);
      } else if (idle >= idleMs - warnMs) setLeft(Math.ceil((idleMs - idle) / 1000));
      else setLeft(null);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [policy]);

  if (left == null || !userId) return null;
  const stay = () => { lastInput.current = Date.now(); lastServer.current = Date.now(); setLeft(null); api.session.ping().catch(() => {}); };
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-3 text-center">
        <span className="material-symbols-outlined text-4xl text-amber-500">timer</span>
        <h3 className="font-bold text-lg">{t("sessWarnTitle")}</h3>
        <p className="text-sm text-slate-600">{t("sessWarnText", { t: `${mm}:${ss}` })}</p>
        <button type="button" onClick={stay} className="w-full py-2.5 rounded-lg bg-primary text-white font-semibold cursor-pointer">{t("sessStay")}</button>
      </div>
    </div>
  );
}
