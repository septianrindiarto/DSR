// ─── Daftar Akun (chart of accounts) + Kunci Periode ─────────────────────────
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";
import InlineEdit from "../InlineEdit";
import { Btn, Empty, ExportBtn, Note, Section } from "./shared";
import { MONTHS, TYPE_LABEL, inputCls } from "./utils";
import { useLanguage } from "../../context/LanguageContext";
import { labelMap } from "../../i18n";

import AsyncButton from "../AsyncButton";
const EMPTY = { code: "", name: "", type: "expense", normalBalance: "debit", description: "", isCash: false, cashFlowClass: "" };
const CF_LABEL = labelMap({ operating: "fin_cfOperating", investing: "fin_cfInvesting", financing: "fin_cfFinancing" });

export function AccountsTab({ accounts, onChanged, fin = {} }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [form, setForm] = useState(null); // null | { ...EMPTY, id? }
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function seed() {
    setBusy(true);
    try { const r = await api.books.seedAccounts(); toast.success(t("fin_accountsAddedN", { n: r.added }) + (r.skipped ? t("fin_accountsSkippedN", { n: r.skipped }) : "")); onChanged?.(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function save() {
    if (!form.code.trim() || !form.name.trim()) { toast.error(t("fin_errAccountCodeName")); return; }
    setBusy(true);
    const payload = { ...form, cashFlowClass: form.cashFlowClass || null, description: form.description || null };
    delete payload.id; delete payload.usageCount;
    try {
      if (form.id) await api.books.updateAccount(form.id, payload); else await api.books.createAccount(payload);
      setForm(null); onChanged?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  // Inline (hover ✏️) save. Tipe & saldo normal are only editable while the
  // account is unused (the server enforces this too); "Dipakai" is computed.
  async function saveAcc(a, patch) {
    try { await api.books.updateAccount(a.id, patch); toast.success(t("inlineSaved")); onChanged?.(); }
    catch (e) { toast.error(e.message); throw e; }
  }
  const TYPE_OPTS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));
  const CF_OPTS = [{ value: "", label: t("fin_auto") }, { value: "operating", label: CF_LABEL.operating }, { value: "investing", label: CF_LABEL.investing }, { value: "financing", label: CF_LABEL.financing }];

  async function toggleActive(a) {
    try { await api.books.updateAccount(a.id, { isActive: !a.isActive }); onChanged?.(); } catch (e) { toast.error(e.message); }
  }
  async function remove(a) {
    if (!confirm(t("fin_confirmDeleteAccount", { code: a.code, name: a.name }))) return;
    try { await api.books.deleteAccount(a.id); onChanged?.(); } catch (e) { toast.error(e.message); }
  }
  const list = accounts.filter((a) => !filter || `${a.code} ${a.name}`.toLowerCase().includes(filter.toLowerCase()));
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Section title={t("fin_coaTitle")} subtitle={t("fin_coaSubtitle")}
      actions={<>
        <ExportBtn rows={accounts.map((a) => ({ [t("fin_colCode")]: a.code, [t("fin_colName")]: a.name, [t("fin_colType")]: TYPE_LABEL[a.type], [t("fin_colNormal")]: a.normalBalance, "Kas/Bank": a.isCash ? t("fin_yes") : "", [t("fin_colCashFlow")]: CF_LABEL[a.cashFlowClass] || "", [t("fin_colActive")]: a.isActive ? t("fin_yes") : t("fin_no") }))} name="daftar-akun" />
        {fin.edit && <Btn icon="auto_awesome" onClick={seed} disabled={busy}>{t("fin_useStandardCoa")}</Btn>}
        {fin.edit && <Btn variant="primary" icon="add" onClick={() => setForm({ ...EMPTY })}>{t("fin_addAccount")}</Btn>}
      </>}>
      {accounts.length === 0 && <Note tone="warn">{t("fin_noAccountsSeedHint")}</Note>}
      <input className={`${inputCls} w-64`} placeholder={t("fin_searchAccount")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {list.length === 0 ? <Empty>—</Empty> : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{t("fin_colCode")}</th><th className="px-3 py-2 text-left">{t("fin_colName")}</th><th className="px-3 py-2 text-left">{t("fin_colType")}</th><th className="px-3 py-2 text-left">{t("fin_colNormal")}</th><th className="px-3 py-2 text-left">Kas/Bank</th><th className="px-3 py-2 text-left">{t("fin_colCashFlow")}</th><th className="px-3 py-2 text-right">{t("fin_colUsed")}</th><th className="px-3 py-2 text-center">{t("actions")}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{list.map((a) => (
              <tr key={a.id} className={a.isActive ? "" : "opacity-50"}>
                <td className="px-3 py-1.5 font-mono text-xs"><InlineEdit disabled={!fin.edit} value={a.code} onSave={(v) => saveAcc(a, { code: (v || a.code).trim() })} /></td>
                <td className="px-3 py-1.5"><InlineEdit disabled={!fin.edit} value={a.name} onSave={(v) => saveAcc(a, { name: (v || a.name).trim() })} /></td>
                <td className="px-3 py-1.5 text-xs"><InlineEdit value={a.type} type="select" options={TYPE_OPTS} display={TYPE_LABEL[a.type]} disabled={!fin.edit || a.usageCount > 0}
                  onSave={(v) => saveAcc(a, { type: v, normalBalance: ["asset", "expense"].includes(v) ? "debit" : "credit" })} /></td>
                <td className="px-3 py-1.5 text-xs capitalize"><InlineEdit value={a.normalBalance} type="select" disabled={!fin.edit || a.usageCount > 0}
                  options={[{ value: "debit", label: t("fin_debit") }, { value: "credit", label: t("fin_credit") }]} onSave={(v) => saveAcc(a, { normalBalance: v })} /></td>
                <td className="px-3 py-1.5 text-xs"><InlineEdit disabled={!fin.edit} value={a.isCash ? "1" : "0"} type="select" display={a.isCash ? "✓" : ""}
                  options={[{ value: "1", label: t("fin_yesCash") }, { value: "0", label: t("fin_notCash") }]} onSave={(v) => saveAcc(a, { isCash: v === "1" })} /></td>
                <td className="px-3 py-1.5 text-xs"><InlineEdit disabled={!fin.edit} value={a.cashFlowClass || ""} type="select" options={CF_OPTS}
                  display={CF_LABEL[a.cashFlowClass] || <span className="text-slate-400">{t("fin_auto")}</span>} onSave={(v) => saveAcc(a, { cashFlowClass: v || null })} /></td>
                <td className="px-3 py-1.5 text-right text-xs">{a.usageCount || ""}</td>
                <td className="px-3 py-1.5"><div className="flex justify-center gap-1">
                  <button hidden={!fin.edit} title={t("edit")} onClick={() => setForm({ ...EMPTY, ...a, cashFlowClass: a.cashFlowClass || "", description: a.description || "" })} className="p-1 rounded hover:bg-amber-50 text-amber-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                  <AsyncButton hidden={!fin.edit} title={a.isActive ? t("fin_deactivate") : t("fin_activate")} onClick={() => toggleActive(a)} className="p-1 rounded hover:bg-slate-100 text-slate-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">{a.isActive ? "toggle_on" : "toggle_off"}</span></AsyncButton>
                  {fin.edit && !a.usageCount && <AsyncButton title={t("delete")} onClick={() => remove(a)} className="p-1 rounded hover:bg-red-50 text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></AsyncButton>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-900">{form.id ? t("fin_editAccount") : t("fin_addAccount")}</h3>
            {form.usageCount > 0 && <Note tone="warn">{t("fin_accountUsedLocked", { n: form.usageCount })}</Note>}
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_colCode")} *</span><input className={inputCls} value={form.code} onChange={(e) => setF("code", e.target.value)} placeholder="6-1700" /></label>
              <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_colName")} *</span><input className={inputCls} value={form.name} onChange={(e) => setF("name", e.target.value)} /></label>
              <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_colType")}</span>
                <select className={inputCls} value={form.type} disabled={form.usageCount > 0}
                  onChange={(e) => { const ty = e.target.value; setForm((f) => ({ ...f, type: ty, normalBalance: ["asset", "expense"].includes(ty) ? "debit" : "credit" })); }}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_colNormal")}</span>
                <select className={inputCls} value={form.normalBalance} disabled={form.usageCount > 0} onChange={(e) => setF("normalBalance", e.target.value)}>
                  <option value="debit">{t("fin_debit")}</option><option value="credit">{t("fin_creditContraHint")}</option>
                </select></label>
              <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_cashFlowGroup")}</span>
                <select className={inputCls} value={form.cashFlowClass} onChange={(e) => setF("cashFlowClass", e.target.value)}>
                  {CF_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select></label>
              <label className="flex items-center gap-2 mt-5 text-sm cursor-pointer"><input type="checkbox" checked={!!form.isCash} onChange={(e) => setF("isCash", e.target.checked)} /> {t("fin_cashBankAccount")}</label>
              <label className="block col-span-2"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_colDescriptionAcc")}</span><input className={inputCls} value={form.description} onChange={(e) => setF("description", e.target.value)} /></label>
            </div>
            <div className="flex justify-end gap-2"><Btn onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn variant="primary" onClick={save} disabled={busy}>{t("save")}</Btn></div>
          </div>
        </div>
      )}
    </Section>
  );
}

export function LocksTab({ fin = {} }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [locks, setLocks] = useState([]);
  const [y, setY] = useState(new Date().getFullYear());
  const [m, setM] = useState(Math.max(1, new Date().getMonth()));
  const load = () => api.books.locks().then(setLocks).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  async function lock() {
    try { await api.books.lock(y, m); toast.success(t("fin_periodLocked")); load(); } catch (e) { toast.error(e.message); }
  }
  async function unlock(l) {
    if (!confirm(t("fin_confirmUnlock", { period: `${MONTHS[l.month - 1]} ${l.year}` }))) return;
    try { await api.books.unlock(l.id); load(); } catch (e) { toast.error(e.message); }
  }
  return (
    <Section title={t("fin_locksTitle")} subtitle={t("fin_locksSubtitle")}>
      <div className="flex items-center gap-2 flex-wrap">
        <select className={`${inputCls} w-28`} value={y} onChange={(e) => setY(Number(e.target.value))}>{Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 6 + i).map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select className={`${inputCls} w-40`} value={m} onChange={(e) => setM(Number(e.target.value))}>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select>
        {fin.lock && <Btn variant="primary" icon="lock" onClick={lock}>{t("fin_lock")}</Btn>}
      </div>
      {locks.length === 0 ? <Empty>{t("fin_noLocks")}</Empty> : (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-w-md">
          {locks.map((l) => (
            <div key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2"><span className="material-symbols-outlined text-[18px] text-slate-400">lock</span>{MONTHS[l.month - 1]} {l.year}</span>
              {fin.lock && <AsyncButton onClick={() => unlock(l)} className="text-xs text-red-600 hover:underline cursor-pointer">{t("fin_unlock")}</AsyncButton>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
