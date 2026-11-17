// ─── Books v2 — shared UI components (period picker, buttons, cards) ────────
import { useState } from "react";
import { exportAs } from "../../lib/dataFormats";
import { MONTHS, TYPE_LABEL } from "./utils";
import { useLanguage } from "../../context/LanguageContext";
import { Spinner } from "../AsyncButton";

export function PeriodPicker({ period, onChange }) {
  const { t } = useLanguage();
  const set = (k, v) => onChange({ ...period, [k]: v });
  const sel = "px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-medium bg-white focus:outline-none";
  const years = Array.from({ length: 9 }, (_, i) => new Date().getFullYear() - 6 + i);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
        {[["monthly", t("fin_pMonthly")], ["quarterly", t("fin_pQuarterly")], ["semesterly", t("fin_pSemesterly")], ["yearly", t("fin_pYearly")], ["custom", t("fin_pCustom")]].map(([v, l]) => (
          <button key={v} type="button" onClick={() => set("type", v)}
            className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${period.type === v ? "bg-primary text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      {period.type !== "custom" && (
        <select className={sel} value={period.year} onChange={(e) => set("year", Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
      {period.type === "monthly" && (
        <select className={sel} value={period.month} onChange={(e) => set("month", Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      )}
      {period.type === "quarterly" && (
        <select className={sel} value={period.quarter} onChange={(e) => set("quarter", Number(e.target.value))}>
          {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{t("fin_quarterOpt", { n: q })}</option>)}
        </select>
      )}
      {period.type === "semesterly" && (
        <select className={sel} value={period.semester} onChange={(e) => set("semester", Number(e.target.value))}>
          <option value={1}>{t("fin_semester1Opt")}</option>
          <option value={2}>{t("fin_semester2Opt")}</option>
        </select>
      )}
      {period.type === "custom" && (
        <>
          <input type="date" className={sel} value={period.from || ""} onChange={(e) => set("from", e.target.value)} />
          <span className="text-xs text-slate-400">{t("fin_until")}</span>
          <input type="date" className={sel} value={period.to || ""} onChange={(e) => set("to", e.target.value)} />
        </>
      )}
      <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer ml-1">
        <input type="checkbox" checked={!!period.compare} onChange={(e) => set("compare", e.target.checked)} className="cursor-pointer" />
        {t("fin_comparePrev")}
      </label>
    </div>
  );
}

// ─── Small building blocks ───────────────────────────────────────────────────
export function Section({ title, subtitle, actions, children }) {
  return (
    <div className="space-y-3">
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            {title && <h2 className="font-bold text-slate-900">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Btn({ children, onClick, variant = "outline", disabled, icon, type = "button", title }) {
  const [busy, setBusy] = useState(false);
  const cls = {
    primary: "bg-primary text-white hover:opacity-90",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    danger: "border border-red-200 text-red-600 hover:bg-red-50",
    outline: "border border-slate-200 text-slate-700 bg-white hover:bg-slate-50",
  }[variant];
  // Async-aware: when onClick returns a promise the button locks and spins
  // until it settles (no double submit) — same behaviour as AsyncButton.
  async function handle(e) {
    if (busy || !onClick) return;
    const r = onClick(e);
    if (r && typeof r.then === "function") { setBusy(true); try { await r; } finally { setBusy(false); } }
  }
  return (
    <button type={type} onClick={handle} disabled={disabled || busy} title={title} aria-busy={busy || undefined}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}>
      {busy ? <Spinner /> : icon && <span className="material-symbols-outlined text-[18px]">{icon}</span>}{children}
    </button>
  );
}

export function ExportBtn({ rows, name, disabled }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  return (
    <Btn icon="download" disabled={disabled || busy || !rows?.length}
      onClick={async () => { setBusy(true); try { await exportAs(rows, "xlsx", name); } finally { setBusy(false); } }}>
      {t("fin_exportExcel")}
    </Btn>
  );
}

export function Empty({ children }) {
  return <p className="text-sm text-slate-400 text-center py-10">{children}</p>;
}

export function Note({ tone = "info", children }) {
  const cls = { info: "bg-blue-50 border-blue-200 text-blue-800", warn: "bg-amber-50 border-amber-200 text-amber-800", ok: "bg-emerald-50 border-emerald-200 text-emerald-800", err: "bg-red-50 border-red-200 text-red-700" }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

/** Account <select>, grouped by type. `filter` narrows the list. */
export function AccountSelect({ accounts, value, onChange, filter, placeholder, className = "", disabled }) {
  const { t } = useLanguage();
  const list = (accounts || []).filter((a) => a.isActive !== false).filter(filter || (() => true));
  const groups = ["asset", "liability", "equity", "income", "expense"];
  return (
    <select value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={`w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100 ${className}`}>
      <option value="">{placeholder ?? t("fin_pickAccount")}</option>
      {groups.map((g) => {
        const items = list.filter((a) => a.type === g);
        if (!items.length) return null;
        return (
          <optgroup key={g} label={TYPE_LABEL[g]}>
            {items.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}

