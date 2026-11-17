// ─── InlineEdit — hover-to-edit a single table cell ──────────────────────────
// Wraps the normal cell content. A small ✏️ appears ONLY while the cell is
// hovered (always faintly visible on touch devices, which have no hover).
// Clicking it swaps the cell for an editor; Enter / ✓ saves, Esc / ✕ cancels.
// Editing never starts from a plain cell click, so nothing changes by accident.
//
// Props
//   value      raw value fed to the editor (string | number | null)
//   display    what the cell normally shows (ReactNode); defaults to value
//   type       text | number | date | select | textarea
//   options    [{ value, label }] for type="select"
//   list       string[] → <datalist> suggestions for type="text"
//   onSave     async (newValue) => void — throw to keep the editor open
//   disabled   true → render display only (auto-filled / read-only cells)
//   confirm    optional string; asked before saving (e.g. "applies to 3 vehicles")
//   align      "left" | "right" — matches the cell
//   title      tooltip for the pencil
import { useEffect, useId, useRef, useState } from "react";

const toInput = (type, v) => {
  if (v === null || v === undefined) return "";
  if (type === "date") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : String(v).length === 10 ? String(v) : d.toISOString().slice(0, 10);
  }
  return String(v);
};

export default function InlineEdit({
  value, display, type = "text", options = [], list, onSave, disabled, confirm: confirmText,
  align = "left", title = "Edit", placeholder,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const listId = useId();

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (disabled || !onSave) return <>{display ?? value ?? "-"}</>;

  const start = (e) => { e.stopPropagation(); setDraft(toInput(type, value)); setEditing(true); };
  const cancel = (e) => { e?.stopPropagation(); setEditing(false); };
  async function commit(e) {
    e?.stopPropagation();
    const original = toInput(type, value);
    if (draft === original) { setEditing(false); return; }
    if (confirmText && !window.confirm(confirmText)) return;
    setSaving(true);
    try {
      const out = type === "number" ? (draft === "" ? null : Number(draft)) : (draft === "" ? null : draft);
      await onSave(out);
      setEditing(false);
    } catch {
      // caller shows the error toast; keep the editor open so nothing is lost
    } finally { setSaving(false); }
  }
  const onKey = (e) => {
    if (e.key === "Escape") cancel(e);
    if (e.key === "Enter" && type !== "textarea") commit(e);
    if (e.key === "Enter" && type === "textarea" && (e.ctrlKey || e.metaKey)) commit(e);
  };

  if (editing) {
    const cls = "px-2 py-1 border border-primary rounded-md text-xs bg-white text-slate-800 focus:outline-none min-w-[90px] w-full";
    return (
      <div className="flex items-start gap-1" onClick={(e) => e.stopPropagation()}>
        {type === "select" ? (
          <select ref={inputRef} className={cls} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} disabled={saving}>
            {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
          </select>
        ) : type === "textarea" ? (
          <textarea ref={inputRef} rows={2} className={cls} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} disabled={saving} placeholder={placeholder} />
        ) : (
          <>
            <input ref={inputRef} type={type} step={type === "number" ? "any" : undefined} className={`${cls} ${align === "right" ? "text-right" : ""}`}
              value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} disabled={saving} placeholder={placeholder}
              list={list?.length ? listId : undefined} />
            {list?.length > 0 && <datalist id={listId}>{list.map((v) => <option key={v} value={v} />)}</datalist>}
          </>
        )}
        <button type="button" onClick={commit} disabled={saving} title="Simpan (Enter)"
          className="p-0.5 rounded text-emerald-600 hover:bg-emerald-50 cursor-pointer disabled:opacity-50">
          {saving ? <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            : <span className="material-symbols-outlined text-[16px]">check</span>}
        </button>
        <button type="button" onClick={cancel} disabled={saving} title="Batal (Esc)"
          className="p-0.5 rounded text-slate-400 hover:bg-slate-100 cursor-pointer">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    );
  }

  return (
    <span className={`group/ie inline-flex items-center gap-1 max-w-full ${align === "right" ? "justify-end" : ""}`}>
      <span className="min-w-0">{display ?? value ?? "-"}</span>
      <button type="button" onClick={start} title={title} aria-label={title}
        className="shrink-0 p-0.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 cursor-pointer opacity-0 group-hover/ie:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-40 transition-opacity">
        <span className="material-symbols-outlined text-[14px] leading-none">edit</span>
      </button>
    </span>
  );
}
