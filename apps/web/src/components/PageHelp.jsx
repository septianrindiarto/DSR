import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { PAGE_HELP } from "../i18n/help.id";

// ⓘ in the page corner: short guide for the current page / tab (help.id.js).
export default function PageHelp() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const page = pathname.replace(/^\/admin\/?/, "").split("/")[0] || "dashboard";
  const tab = params.get("tab");
  const lines = [...(PAGE_HELP[page] || []), ...((tab && PAGE_HELP[`${page}.${tab}`]) || [])];
  if (!lines.length) return null;
  return (
    <div className="absolute top-[76px] right-4 md:top-4 md:right-6 z-30 print:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Bantuan halaman ini"
        className="h-8 w-8 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-primary hover:border-primary flex items-center justify-center cursor-pointer">
        <span className="material-symbols-outlined text-[20px]">info</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[85vw] rounded-xl bg-white border border-slate-200 shadow-xl p-4 text-sm text-slate-700">
          <div className="flex items-center justify-between mb-2">
            <b className="text-slate-900">Bantuan</b>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">close</span></button>
          </div>
          <ul className="list-disc pl-4 space-y-1">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="text-[11px] text-slate-400 mt-3">Arahkan kursor ke ikon ⓘ di samping kolom untuk penjelasan kolom tersebut.</p>
        </div>
      )}
    </div>
  );
}
