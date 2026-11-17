import { useEffect, useRef, useState } from "react";
import { useInbox } from "../lib/useInbox";
import { Link, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";

// ─── Header bell (owner 2026-11-13) ─────────────────────────────────────────
// Per user, privilege based: "Perlu tindakan" counters (forms to approve,
// monthly forms to fill, codes ready to invoice, maintenance, emergencies …)
// plus the notification feed (invoice cancelled, emergency, unit pengganti …).
// Polls quietly every 60 s (no loading bar).
const SEV = { urgent: "bg-red-600", warning: "bg-amber-500", info: "bg-sky-500" };

export function ActionList({ items, onGo }) {
  const { t } = useLanguage();
  if (!items.length) return <p className="text-xs text-slate-400 px-1">{t("nt_noActions")}</p>;
  return (
    <ul className="space-y-1.5">{items.map((a) => (
      <li key={a.key}>
        <Link to={a.link} onClick={onGo} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
          <span className={`min-w-[22px] h-[22px] px-1 rounded-full text-white text-[11px] font-bold flex items-center justify-center ${SEV[a.severity] || SEV.info}`}>{a.count}</span>
          <span className="text-sm text-slate-700 flex-1">{a.title}</span>
          <span className="material-symbols-outlined text-[16px] text-slate-300">chevron_right</span>
        </Link>
      </li>
    ))}</ul>
  );
}

export function FeedList({ items, onOpen }) {
  const { t } = useLanguage();
  if (!items.length) return <p className="text-xs text-slate-400 px-1">{t("nt_none")}</p>;
  return (
    <ul className="divide-y divide-slate-100">{items.map((n) => (
      <li key={n.id}>
        <button type="button" onClick={() => onOpen(n)} className={`w-full text-left px-2 py-2 hover:bg-slate-50 flex gap-2 cursor-pointer ${n.read ? "opacity-70" : ""}`}>
          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read ? "bg-slate-200" : SEV[n.severity] || SEV.info}`} />
          <span className="flex-1 min-w-0">
            <span className={`block text-sm ${n.read ? "text-slate-600" : "font-semibold text-slate-900"}`}>{n.title}</span>
            {n.body && <span className="block text-xs text-slate-500 line-clamp-2">{n.body}</span>}
            <span className="block text-[11px] text-slate-400">{new Date(n.at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</span>
          </span>
        </button>
      </li>
    ))}</ul>
  );
}

export default function NotificationBell() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { feed, actions, markRead } = useInbox();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const badge = feed.unread + actions.total;
  const openItem = (n) => { if (!n.read) markRead([n.id]); setOpen(false); if (n.link) navigate(n.link); };
  return (
    <div ref={box} className="absolute top-[76px] right-14 md:top-4 md:right-16 z-30 print:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} title={t("nt_title")} aria-expanded={open}
        className="relative h-8 w-8 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-primary hover:border-primary flex items-center justify-center cursor-pointer">
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {badge > 0 && <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${feed.data.some((n) => !n.read && n.severity === "urgent") || actions.data.some((a) => a.severity === "urgent") ? "bg-red-600" : "bg-primary"}`}>{badge > 99 ? "99+" : badge}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-w-[92vw] max-h-[75vh] overflow-y-auto rounded-xl bg-white border border-slate-200 shadow-xl p-3 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">{t("nt_actions")}</p>
            <ActionList items={actions.data} onGo={() => setOpen(false)} />
          </div>
          <div className="border-t border-slate-100 pt-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold uppercase text-slate-500">{t("nt_title")}</p>
              {feed.unread > 0 && <button type="button" onClick={() => markRead()} className="text-[11px] font-semibold text-primary cursor-pointer">{t("nt_readAll")}</button>}
            </div>
            <FeedList items={feed.data} onOpen={openItem} />
          </div>
        </div>
      )}
    </div>
  );
}
