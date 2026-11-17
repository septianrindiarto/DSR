// ─── LandingScene — one-screen interactive landing ("Garasi DSR") ────────────
// The whole homepage is one illustrated garage (GarageScene). Hover an object
// (desktop) or tap it (touch) to open its popover: clipboard → order form,
// cars → fleet, whiteboard → weekly availability, chalk menu → packages,
// map → location, photo wall → trust numbers, phone → WhatsApp, door →
// login, standee → corporate. The top chips open the same popovers (keyboard
// and screen-reader friendly), and a hidden text block keeps the page
// readable for search engines.
//
// Popover rules: hover opens; leaving closes after a short delay unless the
// pointer moves into the popover; clicking, tapping or focusing a field pins
// it (so forms are safe to type in). Esc / ✕ / clicking empty scene closes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import GarageScene from "../components/scene/GarageScene";
import LandingBookingForm from "../components/LandingBookingForm";
import {
  OrderPanel, CarsPanel, SchedulePanel, PackagesPanel, LocationPanel,
  TrustPanel, AboutPanel, WhatsAppPanel, LoginPanel, CorporatePanel,
} from "../components/scene/ScenePanels";
import "../components/scene/scene.css";

const PANELS = {
  order: { icon: "edit_note", title: "sc_order_title", width: 400 },
  cars: { icon: "directions_car", title: "sc_cars_title", width: 430 },
  schedule: { icon: "calendar_month", title: "sc_sched_title", width: 440 },
  packages: { icon: "restaurant_menu", title: "sc_pkg_title", width: 400 },
  location: { icon: "location_on", title: "sc_loc_title", width: 380 },
  trust: { icon: "favorite", title: "sc_trust_title", width: 400 },
  about: { icon: "info", title: "sc_about_title", width: 380 },
  whatsapp: { icon: "chat", title: "sc_wa_title", width: 340 },
  login: { icon: "badge", title: "sc_login_title", width: 340 },
  corporate: { icon: "apartment", title: "sc_corp_title", width: 380 },
};
// hotspot id → [panel, preset]
const fromHotspot = (id) => (id.startsWith("car:") ? ["cars", { type: id.slice(4) }] : [id, {}]);
// panel → hotspot used as the popover anchor when opened from a chip / goto()
const ANCHOR = { cars: "car:MPV" };

const wibClock = () => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (k) => Number(p.find((x) => x.type === k)?.value || 0);
  return { h: g("hour") % 24, m: g("minute"), s: g("second") };
};
const isNightHour = (h) => h < 6 || h >= 18;

export default function LandingScene({ classicHref = "/" }) {
  const { t, multiLanguage, lang, toggleLanguage } = useLanguage();
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const popRef = useRef(null);
  const closeTimer = useRef(null);
  const raf = useRef(0);
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches);
  const [clock, setClock] = useState(wibClock);
  const [nightOverride, setNightOverride] = useState(null);
  const night = nightOverride ?? isNightHour(clock.h);
  const [open, setOpen] = useState(null); // { panel, preset, hotspot, rect, pinned }
  const [fullForm, setFullForm] = useState(false);
  const [greeting, setGreeting] = useState(true);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setClock(wibClock()), 30000);
    const tm = setTimeout(() => setGreeting(false), 3500);
    return () => { clearInterval(iv); clearTimeout(tm); };
  }, []);

  // Touch: start the scrollable scene centred.
  useEffect(() => {
    const el = stageRef.current;
    if (touch && el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [touch]);

  const rectOf = (hotspot) => {
    const el = rootRef.current?.querySelector(`[data-hotspot="${CSS.escape(hotspot)}"]`);
    return el ? el.getBoundingClientRect() : null;
  };

  const show = useCallback((hotspot, pinned, panelOverride) => {
    clearTimeout(closeTimer.current);
    setTouched(true);
    const [panel, preset] = panelOverride || fromHotspot(hotspot);
    setOpen((cur) => {
      // A pinned popover (e.g. the user is typing) is not replaced by mere hover.
      if (cur?.pinned && !pinned) return cur;
      return { panel, preset, hotspot, rect: rectOf(hotspot), pinned };
    });
  }, []);
  const close = useCallback(() => { clearTimeout(closeTimer.current); setOpen(null); }, []);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen((cur) => (cur?.pinned ? cur : null)), 260);
  }, []);
  // Switch the open popover to another panel, keeping the same anchor.
  const goto = useCallback((panel, preset = {}) => {
    setOpen((cur) => {
      const hotspot = cur?.hotspot || ANCHOR[panel] || panel;
      return { panel, preset, hotspot, rect: cur?.rect || rectOf(hotspot), pinned: true };
    });
  }, []);
  const openChip = (panel) => {
    const hotspot = ANCHOR[panel] || panel;
    show(hotspot, true, [panel, panel === "cars" ? { type: "all" } : {}]);
  };

  const bind = useCallback((id) => ({
    onPointerEnter: (e) => { if (e.pointerType === "mouse") show(id, false); },
    onPointerLeave: (e) => { if (e.pointerType === "mouse") scheduleClose(); },
    onClick: (e) => { e.stopPropagation(); show(id, true); },
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(id, true); } },
  }), [show, scheduleClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { close(); setFullForm(false); } };
    const onResize = () => setOpen((cur) => (cur ? { ...cur, rect: rectOf(cur.hotspot) } : cur));
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [close]);

  // Parallax: pointer position → --mx/--my (−1…1), throttled to animation frames.
  const onPointerMove = (e) => {
    if (touch || !rootRef.current) return;
    const { innerWidth: w, innerHeight: h } = window;
    const x = (e.clientX / w) * 2 - 1;
    const y = (e.clientY / h) * 2 - 1;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      rootRef.current?.style.setProperty("--mx", x.toFixed(3));
      rootRef.current?.style.setProperty("--my", y.toFixed(3));
    });
  };

  const openFullForm = useCallback(() => { close(); setFullForm(true); }, [close]);
  const activeHot = open?.hotspot || null;
  const waving = greeting || ["order", "whatsapp"].includes(open?.panel);
  const labels = {
    order: t("sc_h_order"), mpv: t("sc_h_mpv"), suv: t("sc_h_suv"), city: t("sc_h_city"),
    schedule: t("sc_h_schedule"), packages: t("sc_h_packages"), location: t("sc_h_location"),
    trust: t("sc_h_trust"), about: t("sc_h_about"), whatsapp: t("sc_h_whatsapp"),
    login: t("sc_h_login"), corporate: t("sc_h_corporate"),
  };

  return (
    <div ref={rootRef} className={`gs-root relative h-[100svh] w-full overflow-hidden select-none ${night ? "gs-night bg-[#1b1530]" : "bg-[#fbeee0]"}`} onPointerMove={onPointerMove}>
      {/* Readable text for search engines & screen readers */}
      <div className="sr-only">
        <h1>{t("sc_title")}</h1>
        <p>{t("featuresSubtitle")}</p>
        <h2>{t("sc_pkg_title")}</h2>
        <ul><li>{t("sc_pkg_lk")}: {t("sc_pkg_lk_d")}</li><li>{t("sc_pkg_md")}: {t("sc_pkg_md_d")}</li><li>{t("sc_pkg_ai")}: {t("sc_pkg_ai_d")}</li></ul>
        <h2>{t("sc_corp_title")}</h2><p>{t("sc_corp_sub")}</p>
        <p>{t("addressValue")}</p>
      </div>

      {/* The scene (16:9, covers the viewport; scrolls sideways on touch) */}
      <div ref={stageRef} className={`absolute inset-0 ${touch ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"}`} onClick={() => open?.pinned && close()}>
        <div className="relative" style={{
          width: "max(100vw, calc(100svh * 16 / 9))", aspectRatio: "16 / 9",
          top: "50%", transform: touch ? "translateY(-50%)" : "translate(-50%, -50%)", left: touch ? 0 : "50%",
        }}>
          <GarageScene night={night} bind={bind} active={activeHot} waving={waving} labels={labels} clock={clock} />
        </div>
      </div>
      {night && <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(10,6,25,.45))" }} />}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-20 p-3 sm:p-4 flex items-start justify-between gap-2 pointer-events-none">
        <Link to="/" className="pointer-events-auto flex items-center gap-2 bg-white/85 backdrop-blur rounded-2xl pl-2 pr-3 py-1.5 shadow-lg shadow-black/5 border border-white">
          <img src="/dsr-logo.png" alt="DSR Solution" className="h-8 w-auto" />
          <span className="font-black text-sm leading-tight hidden sm:block">DSR <span className="text-primary">Solution</span><br /><span className="text-[10px] font-semibold text-slate-500">Buah Batu · Bandung</span></span>
        </Link>
        <nav className="pointer-events-auto flex items-center gap-1.5 bg-white/85 backdrop-blur rounded-2xl p-1.5 shadow-lg shadow-black/5 border border-white overflow-x-auto max-w-[70vw]">
          {["order", "cars", "schedule", "packages", "location", "corporate"].map((p) => (
            <button key={p} type="button" onClick={(e) => { e.stopPropagation(); openChip(p); }}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold transition ${open?.panel === p ? "bg-primary text-white" : "text-slate-700 hover:bg-primary-light"}`}>
              {t(`sc_h_${p}`)}
            </button>
          ))}
          <button type="button" onClick={(e) => { e.stopPropagation(); openChip("login"); }} className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-700">{t("sc_h_login")}</button>
          <button type="button" title={t("sc_toggleTime")} aria-label={t("sc_toggleTime")} onClick={(e) => { e.stopPropagation(); setNightOverride(!night); }}
            className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100">
            <span className="material-symbols-outlined text-[18px]">{night ? "light_mode" : "dark_mode"}</span>
          </button>
          {multiLanguage && <button type="button" onClick={toggleLanguage} className="shrink-0 px-2 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">{lang.toUpperCase()}</button>}
        </nav>
      </div>

      {/* Hint + mini footer */}
      <div className="absolute bottom-0 inset-x-0 z-10 p-3 flex items-end justify-between gap-2 pointer-events-none">
        <div className={`pointer-events-auto flex items-center gap-2 bg-slate-900/85 text-white rounded-full px-3.5 py-2 text-xs font-semibold shadow-lg transition-opacity duration-700 ${touched ? "opacity-0" : "opacity-100"}`}>
          <span className="material-symbols-outlined text-[18px] gs-hint">{touch ? "swipe" : "mouse"}</span>
          {touch ? t("sc_taglineTouch") : t("sc_tagline")}
        </div>
        <div className="pointer-events-auto text-[10px] text-slate-500 bg-white/70 backdrop-blur rounded-full px-3 py-1.5 hidden sm:block">
          © {new Date().getFullYear()} DSR Solution · {t("addressValue")} · <a href={classicHref} className="underline hover:text-primary">{t("sc_classic")}</a>
        </div>
      </div>

      {/* Popover (desktop) / bottom sheet (touch & small screens) */}
      {open && <Popover key={`${open.panel}:${open.hotspot}:${JSON.stringify(open.preset)}`} open={open} touch={touch} popRef={popRef} t={t}
        onClose={close} onEnter={() => clearTimeout(closeTimer.current)} onLeave={() => !open.pinned && scheduleClose()}
        onPin={() => setOpen((cur) => (cur && !cur.pinned ? { ...cur, pinned: true } : cur))}>
        <PanelBody open={open} goto={goto} onFullForm={openFullForm} />
      </Popover>}

      {fullForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm overflow-y-auto" onClick={() => setFullForm(false)}>
          <div className="max-w-4xl mx-auto my-6 relative gs-pop" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setFullForm(false)} aria-label={t("sc_close")} className="absolute right-4 top-4 z-10 w-9 h-9 rounded-full bg-white shadow flex items-center justify-center"><span className="material-symbols-outlined">close</span></button>
            <div className="rounded-3xl overflow-hidden"><LandingBookingForm /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelBody({ open, goto, onFullForm }) {
  const p = { preset: open.preset, goto };
  switch (open.panel) {
    case "order": return <OrderPanel key={JSON.stringify(open.preset)} {...p} onFullForm={onFullForm} />;
    case "cars": return <CarsPanel {...p} />;
    case "schedule": return <SchedulePanel {...p} />;
    case "packages": return <PackagesPanel {...p} />;
    case "location": return <LocationPanel {...p} />;
    case "trust": return <TrustPanel {...p} />;
    case "about": return <AboutPanel {...p} />;
    case "whatsapp": return <WhatsAppPanel {...p} />;
    case "login": return <LoginPanel {...p} />;
    case "corporate": return <CorporatePanel {...p} />;
    default: return null;
  }
}

function Popover({ open, touch, popRef, t, onClose, onEnter, onLeave, onPin, children }) {
  const cfg = PANELS[open.panel] || PANELS.about;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const sheet = touch || vw < 768 || !open.rect;
  const header = (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center shadow-md shadow-primary/30"><span className="material-symbols-outlined text-[18px]">{cfg.icon}</span></span>
      <h3 className="font-black text-base text-slate-900 flex-1">{t(cfg.title)}</h3>
      <button type="button" onClick={onClose} aria-label={t("sc_close")} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"><span className="material-symbols-outlined text-[20px]">close</span></button>
    </div>
  );
  const common = {
    ref: popRef, role: "dialog", "aria-label": t(cfg.title),
    onPointerEnter: onEnter, onPointerLeave: onLeave, onFocusCapture: onPin, onPointerDown: onPin,
    onClick: (e) => e.stopPropagation(),
  };

  if (sheet) {
    return (
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose}>
        <div {...common} className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl shadow-2xl p-4 pt-2 max-h-[85svh] overflow-y-auto gs-sheet">
          <div className="w-10 h-1.5 rounded-full bg-slate-200 mx-auto mb-3" />
          {header}{children}
        </div>
      </div>
    );
  }

  const W = Math.min(cfg.width, vw - 24);
  const r = open.rect;
  const gap = 18;
  let left = r.right + gap;
  let side = "right";
  if (left + W > vw - 12) { left = r.left - gap - W; side = "left"; }
  if (left < 12) { left = Math.max(12, Math.min(vw - W - 12, r.left + r.width / 2 - W / 2)); side = "below"; }
  const maxH = Math.min(640, vh - 96);
  let top = side === "below" ? r.bottom + gap : r.top + r.height / 2 - 180;
  top = Math.max(76, Math.min(top, vh - maxH - 12));
  if (side === "below" && r.bottom + gap + 200 > vh) top = Math.max(76, r.top - gap - maxH);

  return (
    <div {...common} className="fixed z-40 gs-pop" style={{ left, top, width: W }}>
      {side !== "below" && (
        <span className="absolute w-4 h-4 bg-white rotate-45 border-slate-100"
          style={{ top: Math.max(18, Math.min(r.top + r.height / 2 - top - 8, 200)), [side === "right" ? "left" : "right"]: -7, boxShadow: side === "right" ? "-2px 2px 3px rgba(0,0,0,.04)" : "2px -2px 3px rgba(0,0,0,.04)" }} />
      )}
      <div className="relative bg-white rounded-3xl shadow-[0_24px_60px_-12px_rgba(60,10,10,.35)] border border-white p-4 overflow-y-auto" style={{ maxHeight: maxH }}>
        {header}{children}
      </div>
    </div>
  );
}
