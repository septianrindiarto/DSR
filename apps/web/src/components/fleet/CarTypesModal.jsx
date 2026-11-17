import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../Toast";
import { api, apiCache } from "../../lib/api";
import AsyncButton from "../AsyncButton";

// Armada → Kelola tipe (owner 2026-11-11). Each agency keeps its own list of
// vehicle types (Hiace, Bus, Pickup, …). Rename moves the cars along; a type
// still used by cars can't be removed (rename / move them first).
// data: GET /api/cars/types → { types, usage, custom }
export default function CarTypesModal({ data, onClose, onSaved }) {
  const { t } = useLanguage();
  const toast = useToast();
  // rows keep the ORIGINAL name so a change becomes a rename.
  const [rows, setRows] = useState(() => data.types.map((name) => ({ orig: name, name })));
  const [add, setAdd] = useState("");
  const used = (name) => data.usage?.[name] || 0;
  const key = (s) => s.trim().toLowerCase();

  const upd = (i, name) => setRows((r) => r.map((x, j) => (j === i ? { ...x, name } : x)));
  const move = (i, d) => setRows((r) => { const n = r.slice(); const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = (i) => setRows((r) => r.filter((_, j) => j !== i));
  function addType() {
    const name = add.replace(/\s+/g, " ").trim();
    if (!name) return;
    if (rows.some((r) => key(r.name) === key(name))) { toast.error(t("ft_dup", { name })); return; }
    setRows((r) => [...r, { orig: null, name }]); setAdd("");
  }

  async function save() {
    const names = rows.map((r) => r.name.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (new Set(names.map(key)).size !== names.length) { toast.error(t("ft_dupAny")); return; }
    const renames = rows.filter((r) => r.orig && r.name.trim() && key(r.orig) !== key(r.name)).map((r) => ({ from: r.orig, to: r.name.trim() }));
    try {
      const res = await api.cars.saveTypes(names, renames);
      apiCache.invalidate("cars:"); apiCache.invalidate("pricing:");
      toast.success(t("ft_saved"));
      onSaved(res);
    } catch (e) { toast.error(e.message); }
  }

  // Types used by cars but no longer in the list (and not renamed) — server will refuse.
  const kept = new Set(rows.map((r) => r.orig).filter(Boolean));
  const orphan = Object.entries(data.usage || {}).filter(([name, n]) => n > 0 && !kept.has(name) && !rows.some((r) => key(r.name) === key(name)));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{t("ft_title")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t("ft_sub")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="p-5 space-y-2 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={`${r.orig ?? "new"}-${i}`} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 leading-none cursor-pointer"><span className="material-symbols-outlined text-[16px]">expand_less</span></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 leading-none cursor-pointer"><span className="material-symbols-outlined text-[16px]">expand_more</span></button>
              </div>
              <input value={r.name} maxLength={40} onChange={(e) => upd(i, e.target.value)} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              <span className="text-[11px] text-slate-500 w-16 text-right">{r.orig && used(r.orig) ? t("ft_units", { n: used(r.orig) }) : ""}</span>
              {r.orig && key(r.orig) !== key(r.name) && r.name.trim() && <span className="text-[10px] text-indigo-600 w-14">{t("ft_renamed")}</span>}
              <button type="button" onClick={() => remove(i)} disabled={!!(r.orig && used(r.orig))} title={r.orig && used(r.orig) ? t("ft_inUse") : t("delete")}
                className="text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <input value={add} maxLength={40} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addType(); } }}
              placeholder={t("ft_addPh")} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <button type="button" onClick={addType} className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 cursor-pointer">{t("ft_add")}</button>
          </div>
          {orphan.length > 0 && <p className="text-xs text-amber-700">{t("ft_orphan", { list: orphan.map(([n, c]) => `${n} (${c})`).join(", ") })}</p>}
          <p className="text-[11px] text-slate-400">{t("ft_pricingNote")}</p>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm cursor-pointer">{t("cancel")}</button>
          <AsyncButton onClick={save} disabled={!rows.length} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50">{t("save")}</AsyncButton>
        </div>
      </div>
    </div>
  );
}
