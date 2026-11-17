// ─── Catat Transaksi — guided entry (the main input of Keuangan) ────────────
// The user says WHAT happened (e.g. "BBM", "Setoran modal"); the server picks
// the accounts and posts one balanced journal entry, so every report
// (Laba Rugi, Neraca, Arus Kas, Buku Besar) updates immediately.
//
// Invoices and their payments are NOT entered here: they are booked
// automatically from Rekap Order (see the "Pembukuan otomatis" panel).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";
import { useLanguage } from "../../context/LanguageContext";
import { AccountSelect, Btn, Note, Section } from "./shared";
import { SOURCE_LABEL, STATUS_LABEL, STATUS_STYLE, fmtDate, inputCls, rp } from "./utils";

const todayIso = () => new Date().toLocaleDateString("en-CA");
const GROUPS = [
  { id: "in", icon: "south_west", tone: "emerald" },
  { id: "out", icon: "north_east", tone: "red" },
  { id: "transfer", icon: "sync_alt", tone: "blue" },
  { id: "noncash", icon: "event_repeat", tone: "slate" },
];
const TONE = {
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-800",
  red: "border-red-300 bg-red-50 text-red-700",
  blue: "border-blue-300 bg-blue-50 text-blue-800",
  slate: "border-slate-300 bg-slate-50 text-slate-700",
};
const blank = () => ({ type: "", date: todayIso(), amount: "", cashAccountId: null, toCashAccountId: null, counterAccountId: null, onCredit: false, carId: "", orderNumber: "", description: "", reference: "" });

export default function QuickEntryTab({ accounts, onChanged, onGo, fin = {} }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [types, setTypes] = useState([]);
  const [group, setGroup] = useState("out");
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [cars, setCars] = useState([]);
  const [recent, setRecent] = useState([]);
  const [auto, setAuto] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const cashAccounts = useMemo(() => accounts.filter((a) => a.isCash && a.isActive !== false), [accounts]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const loadRecent = useCallback(() => {
    api.books.transactions({ page: 1, limit: 8 }).then((r) => setRecent(r?.data || [])).catch(() => {});
  }, []);
  const loadAuto = useCallback(() => { api.books.autoStatus().then(setAuto).catch(() => {}); }, []);

  useEffect(() => {
    api.books.quickTypes().then((r) => setTypes(Array.isArray(r) ? r : [])).catch((e) => toast.error(e.message));
    api.cars.list("limit=500&page=1").then((r) => setCars(r?.data || [])).catch(() => setCars([]));
    loadRecent(); loadAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Default the Kas/Bank selector to the first cash account.
  useEffect(() => {
    if (!form.cashAccountId && cashAccounts[0]) set({ cashAccountId: cashAccounts[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashAccounts]);

  const groupTypes = types.filter((q) => q.group === group);
  const q = types.find((x) => x.key === form.type) || null;

  async function submit() {
    if (!q) { toast.error(t("fin_q_pickType")); return; }
    if (!(Number(form.amount) > 0)) { toast.error(t("fin_q_errAmount")); return; }
    setSaving(true);
    try {
      const payload = {
        type: q.key, date: form.date, amount: Number(form.amount),
        cashAccountId: form.cashAccountId ? Number(form.cashAccountId) : null,
        toCashAccountId: form.toCashAccountId ? Number(form.toCashAccountId) : null,
        counterAccountId: q.other && form.counterAccountId ? Number(form.counterAccountId) : null,
        onCredit: !!(q.canOwe && form.onCredit),
        carId: q.unit && form.carId ? Number(form.carId) : null,
        orderNumber: q.unit && form.orderNumber.trim() ? form.orderNumber.trim() : null,
        description: form.description.trim() || null,
        reference: form.reference.trim() || null,
      };
      const tx = await api.books.quick(payload);
      toast.success(tx.status === "posted" ? t("fin_q_savedPosted", { no: tx.journalNo }) : t("fin_q_savedDraft", { no: tx.journalNo }));
      setForm((f) => ({ ...blank(), date: f.date, cashAccountId: f.cashAccountId }));
      loadRecent(); onChanged?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function resync() {
    setSyncing(true);
    try {
      const r = await api.books.autoResync();
      const changed = (r.posted || 0) + (r.replaced || 0) + (r.reversed || 0);
      if (r.errors?.length) toast.error(t("fin_auto_syncErrors", { n: r.errors.length, first: r.errors[0] }));
      else toast.success(changed ? t("fin_auto_synced", { n: changed }) : t("fin_auto_upToDate"));
      loadAuto(); loadRecent(); onChanged?.();
    } catch (e) { toast.error(e.message); }
    finally { setSyncing(false); }
  }

  const label = (k) => <span className="block text-[11px] font-semibold text-slate-600 mb-1">{k}</span>;

  return (
    <div className="space-y-6">
      {/* ── Pembukuan otomatis ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 p-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <p className="font-semibold text-slate-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary">bolt</span>{t("fin_auto_title")}
          </p>
          <p className="text-xs text-slate-500 max-w-2xl">{t("fin_auto_explain")}</p>
          {auto && (
            auto.accountsReady ? (
              <p className={`text-xs font-medium ${auto.inSync ? "text-emerald-700" : "text-amber-700"}`}>
                {t("fin_auto_status", { inv: auto.invoicesPosted, invTotal: auto.invoicesSent, pay: auto.paymentsPosted, payTotal: auto.payments })}
                {auto.inSync ? " ✓" : ` — ${t("fin_auto_needSync")}`}
              </p>
            ) : <p className="text-xs font-medium text-amber-700">{t("fin_auto_noAccounts")}</p>
          )}
        </div>
        {fin.post && <Btn icon="sync" onClick={resync} disabled={syncing || (auto && !auto.accountsReady)}>{syncing ? t("fin_auto_syncing") : t("fin_auto_sync")}</Btn>}
      </div>

      {/* ── Catat transaksi ─────────────────────────────────────────────── */}
      <Section title={t("fin_q_title")} subtitle={t("fin_q_subtitle")}>
        {!accounts.length && <Note tone="warn">{t("fin_noAccountsHint")}</Note>}
        {!fin.create ? <Note>{t("fin_q_noPermission")}</Note> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {GROUPS.map((g) => (
                <button key={g.id} type="button" onClick={() => { setGroup(g.id); set({ type: "" }); }}
                  className={`flex items-center gap-2 rounded-xl border-2 px-3 py-3 text-left cursor-pointer transition-colors ${group === g.id ? TONE[g.tone] : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                  <span className="material-symbols-outlined text-[22px]">{g.icon}</span>
                  <span>
                    <span className="block text-sm font-bold">{t(`fin_q_group_${g.id}`)}</span>
                    <span className="block text-[11px] opacity-80">{t(`fin_q_group_${g.id}_hint`)}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {groupTypes.map((x) => (
                <button key={x.key} type="button" onClick={() => set({ type: x.key, onCredit: false, counterAccountId: null })}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer ${form.type === x.key ? "bg-primary text-white border-primary" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                  {x.label}
                </button>
              ))}
            </div>

            {q && (
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                {q.hint && <Note>{q.hint}</Note>}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block">{label(`${t("fin_colDate")} *`)}
                    <input type="date" className={inputCls} value={form.date} onChange={(e) => set({ date: e.target.value })} /></label>
                  <label className="block">{label(`${t("fin_amountRp")} *`)}
                    <input type="number" min="0" step="any" className={inputCls} value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" /></label>

                  {q.group === "transfer" ? (
                    <>
                      <label className="block">{label(`${t("fin_q_from")} *`)}
                        <AccountSelect accounts={cashAccounts} value={form.cashAccountId} onChange={(v) => set({ cashAccountId: v })} /></label>
                      <label className="block">{label(`${t("fin_q_to")} *`)}
                        <AccountSelect accounts={cashAccounts} value={form.toCashAccountId} onChange={(v) => set({ toCashAccountId: v })} /></label>
                    </>
                  ) : q.group !== "noncash" && !(q.canOwe && form.onCredit) ? (
                    <label className="block">{label(`${q.group === "in" ? `${t("fin_into")} (Kas/Bank)` : t("fin_q_paidFrom")} *`)}
                      <AccountSelect accounts={cashAccounts} value={form.cashAccountId} onChange={(v) => set({ cashAccountId: v })} /></label>
                  ) : null}

                  {q.other && (
                    <label className="block">{label(t("fin_q_otherAccount"))}
                      <AccountSelect accounts={accounts} value={form.counterAccountId} onChange={(v) => set({ counterAccountId: v })} filter={(a) => !a.isCash} placeholder={t("fin_q_defaultAccount")} /></label>
                  )}
                  {q.unit && cars.length > 0 && (
                    <label className="block">{label(t("fin_q_unit"))}
                      <select className={inputCls} value={form.carId} onChange={(e) => set({ carId: e.target.value })}>
                        <option value="">{t("fin_q_noUnit")}</option>
                        {cars.map((c) => <option key={c.id} value={c.id}>{c.licensePlate || "-"} · {c.brand} {c.name}</option>)}
                      </select></label>
                  )}
                  {q.unit && (
                    <label className="block">{label(t("fin_orderCodeOptional"))}
                      <input className={inputCls} value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })} placeholder={t("fin_phOrderCode")} /></label>
                  )}
                  <label className="block sm:col-span-2">{label(t("fin_q_description"))}
                    <input className={inputCls} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={q.label} /></label>
                  <label className="block">{label(t("fin_referenceProof"))}
                    <input className={inputCls} value={form.reference} onChange={(e) => set({ reference: e.target.value })} placeholder={t("fin_phReference")} /></label>
                </div>
                {q.canOwe && q.group === "out" && (
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={form.onCredit} onChange={(e) => set({ onCredit: e.target.checked })} className="cursor-pointer" />
                    {t("fin_q_onCredit")}
                  </label>
                )}
                <div className="flex justify-end">
                  <Btn variant="primary" icon="check" onClick={submit} disabled={saving}>{saving ? t("fin_q_saving") : (fin.post ? t("fin_q_saveAndPost") : t("fin_saveDraft"))}</Btn>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── Terakhir dicatat ────────────────────────────────────────────── */}
      <Section title={t("fin_q_recent")} actions={<Btn onClick={() => onGo?.("transaksi")}>{t("fin_q_allJournals")}</Btn>}>
        {recent.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            {recent.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 px-3 py-2 text-sm flex-wrap">
                <span className="font-mono text-xs text-slate-500 w-32">{tx.journalNo}</span>
                <span className="text-xs text-slate-500 w-24">{fmtDate(tx.entryDate)}</span>
                <span className="flex-1 min-w-[200px] truncate" title={tx.description}>{tx.description}</span>
                <span className="text-[11px] text-slate-400">{SOURCE_LABEL[tx.source] || tx.source}</span>
                <span className="font-mono w-32 text-right">{rp(tx.totalAmount)}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[tx.status]}`}>{STATUS_LABEL[tx.status]}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
