import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ⓘ help icon (owner 2026-11-06). Rules learned from testing:
//  • only the icon itself reacts (hover / keyboard focus / tap) — never the
//    label text or the space around it;
//  • the bubble is rendered in a portal with fixed positioning and kept inside
//    the viewport, so it is never clipped by a scrolling modal or table.
//   <InfoTip text="…" />   ·   <InfoTip title="Judul">…JSX…</InfoTip>
export default function InfoTip({ text, title, children, size = 16 }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const tip = useRef(null);
  const id = useId();

  const place = useCallback(() => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const h = tip.current?.offsetHeight || 0;
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - 8 && r.top - 8 - h > 8 ? r.top - 8 - h : below;
    setPos({ left, top, width: w });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return undefined;
    const close = () => { setOpen(false); setPinned(false); };
    const away = (e) => { if (!btn.current?.contains(e.target) && !tip.current?.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, place]);

  const body = children || text;
  if (!body) return null;
  return (
    <>
      <button ref={btn} type="button" aria-label="Info" aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => !pinned && setOpen(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinned((p) => !p); setOpen(true); }}
        className="inline-flex shrink-0 items-center justify-center rounded-full p-0 leading-none text-slate-400 hover:text-primary focus:text-primary focus:outline-none cursor-help align-middle">
        <span className="material-symbols-outlined" style={{ fontSize: size }}>info</span>
      </button>
      {open && createPortal(
        <div ref={tip} id={id} role="tooltip"
          style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width ?? 300, zIndex: 1000 }}
          className="rounded-lg bg-slate-900 text-white text-xs leading-relaxed px-3 py-2 shadow-xl">
          {title && <b className="block mb-0.5">{title}</b>}
          {body}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Field label with optional required star and ⓘ. Not a <label>: a click on
 *  the text must never trigger the ⓘ (labels forward clicks to their first button). */
export function LabelTip({ children, tip, required }) {
  return (
    <div className="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1 min-h-[18px]">
      <span>{children}{required && <span className="text-red-500"> *</span>}</span>
      {tip && <InfoTip text={tip} size={14} />}
    </div>
  );
}
