// ─── EntryModal — create / edit one journal entry ────────────────────────────
// Three ways in, all producing the same balanced double entry:
//   • Kas Masuk / Keluar — pick Kas/Bank + lawan akun + jumlah. The system
//     writes both sides (no debit/credit knowledge needed). Template chips
//     preset the lawan akun for common rental transactions.
//   • Jurnal Umum       — free lines with a live debit/credit balance check
//                         (accruals, depreciation, transfers, corrections).
//   • Saldo Awal        — opening balances at the cut-over date from the
//                         manual books; the difference goes to 3-9000
//                         Ekuitas Saldo Awal so the entry always balances.
// "Simpan Draft" keeps it out of reports; "Simpan & Posting" makes it final.
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";
import { AccountSelect, Btn, Note } from "./shared";
import { inputCls, rp } from "./utils";
import { useLanguage } from "../../context/LanguageContext";

const today = () => new Date().toISOString().slice(0, 10);

// Cash templates: direction + lawan akun (by code).
// Labels are i18n keys (finance.id.js).
const CASH_TEMPLATES = [
  { id: "terima-invoice", label: "fin_tplReceiveInvoice", dir: "in", code: "1-1300" },
  { id: "pendapatan-tunai", label: "fin_tplCashRental", dir: "in", code: "4-1000" },
  { id: "setor-modal", label: "fin_tplCapital", dir: "in", code: "3-1000" },
  { id: "pinjaman", label: "fin_tplLoanIn", dir: "in", code: "2-2100" },
  { id: "bayar-vendor", label: "fin_tplVendorRent", dir: "out", code: "5-1000" },
  { id: "bayar-driver", label: "fin_tplDriver", dir: "out", code: "5-1100" },
  { id: "bbm", label: "fin_tplFuel", dir: "out", code: "5-1200" },
  { id: "tol", label: "fin_tplToll", dir: "out", code: "5-1300" },
  { id: "servis", label: "fin_tplService", dir: "out", code: "5-1400" },
  { id: "gaji", label: "fin_tplSalary", dir: "out", code: "6-1000" },
  { id: "cicilan", label: "fin_tplInstallment", dir: "out", code: "2-2100" },
  { id: "prive", label: "fin_tplDrawing", dir: "out", code: "3-2000" },
];
// Non-cash (journal) templates: [debit code, credit code].
const JOURNAL_TEMPLATES = [
  { id: "invoice", label: "fin_tplInvoiceSent", dr: "1-1300", cr: "4-1000" },
  { id: "tagihan-vendor", label: "fin_tplVendorBill", dr: "5-1000", cr: "2-1100" },
  { id: "penyusutan", label: "fin_tplDepreciation", dr: "5-1700", cr: "1-2110" },
  { id: "transfer", label: "fin_tplTransfer", dr: "1-1200", cr: "1-1100" },
];

const blankLine = () => ({ accountId: null, debit: "", credit: "", memo: "" });

export default function EntryModal({ accounts, initial, onClose, onSaved, canPost = true }) {
  const toast = useToast();
  const { t } = useLanguage();
  const byCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);
  const cashAccounts = accounts.filter((a) => a.isCash && a.isActive !== false);
  const editing = !!initial?.id;

  const [mode, setMode] = useState(editing ? "journal" : "cash");
  const [date, setDate] = useState(initial?.entryDate || today());
  const [description, setDescription] = useState(initial?.description || "");
  const [reference, setReference] = useState(initial?.reference || "");
  const [saving, setSaving] = useState(false);

  // Kas mode
  const [dir, setDir] = useState("in");
  const [cashId, setCashId] = useState(cashAccounts[0]?.id || null);
  const [counterId, setCounterId] = useState(null);
  const [amount, setAmount] = useState("");
  const [orderNumber, setOrderNumber] = useState("");

  // Journal mode
  const [lines, setLines] = useState(() => initial?.lines?.length
    ? initial.lines.map((l) => ({ accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", memo: l.memo || "" }))
    : [blankLine(), blankLine()]);
  const setLine = (i, patch) => setLines((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const totals = lines.reduce((t, l) => ({ d: t.d + (Number(l.debit) || 0), c: t.c + (Number(l.credit) || 0) }), { d: 0, c: 0 });
  const diff = Math.round((totals.d - totals.c) * 100) / 100;

  // Saldo awal mode — amounts on each account's normal side.
  const bsAccounts = accounts.filter((a) => ["asset", "liability", "equity"].includes(a.type) && a.code !== "3-9000" && a.isActive !== false);
  const [opening, setOpening] = useState({});

  function applyCashTemplate(tpl) {
    setDir(tpl.dir);
    const acc = byCode.get(tpl.code);
    if (acc) setCounterId(acc.id);
    if (!description) setDescription(t(tpl.label));
  }
  function applyJournalTemplate(tpl) {
    const dr = byCode.get(tpl.dr), cr = byCode.get(tpl.cr);
    setLines([{ ...blankLine(), accountId: dr?.id || null }, { ...blankLine(), accountId: cr?.id || null }]);
    if (!description) setDescription(t(tpl.label));
  }

  function buildLines() {
    if (mode === "cash") {
      const a = Number(amount) || 0;
      const tag = orderNumber.trim() || null;
      return dir === "in"
        ? [{ accountId: cashId, debit: a, credit: 0, orderNumber: tag }, { accountId: counterId, debit: 0, credit: a, orderNumber: tag }]
        : [{ accountId: counterId, debit: a, credit: 0, orderNumber: tag }, { accountId: cashId, debit: 0, credit: a, orderNumber: tag }];
    }
    if (mode === "opening") {
      const out = [];
      let net = 0; // debit − credit
      for (const acc of bsAccounts) {
        const v = Number(opening[acc.id]) || 0;
        if (!v) continue;
        const onDebit = (acc.normalBalance === "debit") === (v > 0);
        const amt = Math.abs(v);
        out.push({ accountId: acc.id, debit: onDebit ? amt : 0, credit: onDebit ? 0 : amt });
        net += onDebit ? amt : -amt;
      }
      const eq = byCode.get("3-9000");
      if (Math.abs(net) > 0.004 && eq) out.push({ accountId: eq.id, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 });
      return out;
    }
    return lines.filter((l) => l.accountId || Number(l.debit) || Number(l.credit))
      .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || null }));
  }

  async function save(post) {
    const ls = buildLines();
    if (mode === "cash" && (!cashId || !counterId || !(Number(amount) > 0))) { toast.error(t("fin_errCashForm")); return; }
    if (mode === "opening" && !byCode.get("3-9000")) { toast.error(t("fin_errNoOpeningEquity")); return; }
    if (ls.length < 2) { toast.error(t("fin_errMinLines")); return; }
    const desc = description.trim() || (mode === "opening" ? t("fin_openingAsOf", { date }) : "");
    if (!desc) { toast.error(t("fin_errDescription")); return; }
    setSaving(true);
    try {
      const payload = { date, description: desc, reference: reference || null, lines: ls };
      if (editing) await api.books.updateTx(initial.id, payload);
      else await api.books.createTx({ ...payload, post, source: mode === "cash" ? "cashbook" : mode === "opening" ? "opening" : "manual" });
      if (editing && post) await api.books.postTx({ ids: [initial.id] });
      toast.success(post ? t("fin_journalPosted") : t("fin_draftSaved"));
      onSaved?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  const tab = (id, label) => (
    <button type="button" onClick={() => setMode(id)} disabled={editing && id !== "journal"}
      className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-40 ${mode === id ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{editing ? t("fin_editDraftNo", { no: initial.journalNo }) : t("fin_newJournal")}</h2>
            <div className="flex gap-1.5 mt-2">{tab("cash", t("fin_modeCash"))}{tab("journal", t("fin_generalJournal"))}{tab("opening", t("fin_modeOpening"))}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_colDate")} *</span>
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="block sm:col-span-2"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_colDescription")} *</span>
              <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={mode === "opening" ? t("fin_openingAsOf", { date }) : t("fin_phDescription")} /></label>
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_referenceProof")}</span>
              <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("fin_phReference")} /></label>
          </div>

          {mode === "cash" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {CASH_TEMPLATES.map((tpl) => (
                  <button key={tpl.id} type="button" onClick={() => applyCashTemplate(tpl)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer ${tpl.dir === "in" ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-red-200 text-red-600 hover:bg-red-50"}`}>
                    {tpl.dir === "in" ? "↓" : "↑"} {t(tpl.label)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_kind")} *</span>
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                    {[["in", t("fin_cashIn")], ["out", t("fin_cashOut")]].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setDir(v)}
                        className={`flex-1 py-2 text-sm font-medium cursor-pointer ${dir === v ? (v === "in" ? "bg-emerald-600 text-white" : "bg-red-600 text-white") : "bg-white text-slate-600"}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_amountRp")} *</span>
                  <input type="number" min="0" step="any" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{dir === "in" ? t("fin_into") : t("fin_outOf")} (Kas/Bank) *</span>
                  <AccountSelect accounts={accounts} value={cashId} onChange={setCashId} filter={(a) => a.isCash} /></label>
                <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{dir === "in" ? t("fin_counterIn") : t("fin_counterOut")} *</span>
                  <AccountSelect accounts={accounts} value={counterId} onChange={setCounterId} filter={(a) => !a.isCash} /></label>
                <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_orderCodeOptional")}</span>
                  <input className={inputCls} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder={t("fin_phOrderCode")} /></label>
              </div>
              {!cashAccounts.length && <Note tone="warn">{t("fin_noCashAccounts")}</Note>}
            </>
          )}

          {mode === "journal" && (
            <>
              {!editing && (
                <div className="flex flex-wrap gap-1.5">
                  {JOURNAL_TEMPLATES.map((tpl) => (
                    <button key={tpl.id} type="button" onClick={() => applyJournalTemplate(tpl)}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">{t(tpl.label)}</button>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 sm:col-span-5"><AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} /></div>
                    <input type="number" min="0" step="any" placeholder={t("fin_debit")} className={`${inputCls} col-span-5 sm:col-span-2`} value={l.debit}
                      onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
                    <input type="number" min="0" step="any" placeholder={t("fin_credit")} className={`${inputCls} col-span-5 sm:col-span-2`} value={l.credit}
                      onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
                    <input placeholder="Memo" className={`${inputCls} col-span-10 sm:col-span-2 hidden sm:block`} value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} />
                    <button type="button" onClick={() => setLines((p) => p.filter((_, k) => k !== i))} disabled={lines.length <= 2}
                      className="col-span-2 sm:col-span-1 text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Btn icon="add" onClick={() => setLines((p) => [...p, blankLine()])}>{t("fin_addLine")}</Btn>
                <div className="text-xs text-slate-600">
                  {t("fin_debit")} <b>{rp(totals.d)}</b> · {t("fin_credit")} <b>{rp(totals.c)}</b> ·{" "}
                  <span className={diff === 0 ? "text-emerald-700 font-bold" : "text-red-600 font-bold"}>{t("fin_difference")} {rp(diff)}{diff === 0 ? " ✓" : ""}</span>
                </div>
              </div>
            </>
          )}

          {mode === "opening" && (
            <>
              <Note>{t("fin_openingHelp")}</Note>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
                {bsAccounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="flex-1 text-sm text-slate-700 truncate">{a.code} · {a.name}</span>
                    <input type="number" step="any" className="w-44 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right"
                      value={opening[a.id] ?? ""} onChange={(e) => setOpening((p) => ({ ...p, [a.id]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100">
          <Btn onClick={onClose}>{t("cancel")}</Btn>
          <Btn onClick={() => save(false)} disabled={saving || (mode === "journal" && diff !== 0)}>{t("fin_saveDraft")}</Btn>
          {canPost && <Btn variant="primary" icon="task_alt" onClick={() => save(true)} disabled={saving || (mode === "journal" && diff !== 0)}>{t("fin_saveAndPost")}</Btn>}
        </div>
      </div>
    </div>
  );
}
