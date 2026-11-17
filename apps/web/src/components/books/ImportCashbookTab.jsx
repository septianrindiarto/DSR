// ─── Impor Buku Kas — manual cash book (Masuk/Keluar) → professional journal ──
// Steps: 1 file + Kas/Bank account (+ optional saldo awal) → 2 match columns →
// 3 map each category/keterangan to an account (saved mappings & keyword
// suggestions prefill it) → 4 preview with a per-month summary (insight from
// the old records, before anything is posted) → 5 import as a DRAFT batch,
// then post it (or delete the whole batch and retry).
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { parse, parseWorkbookTyped } from "../../lib/dataFormats";
import { useToast } from "../Toast";
import { AccountSelect, Btn, Note, Section } from "./shared";
import { MONTHS, inputCls, parseDateLoose, parseMoney, rp } from "./utils";
import { useLanguage } from "../../context/LanguageContext";

// Header auto-detection (first match wins; every column can be changed).
// Note: in a cash book "Debet" = money IN to the cash account — the
// accounting convention. Bank statements use the opposite, so check the
// preview and swap the Masuk/Keluar columns if needed.
const GUESS = {
  date: /\b(tgl|tanggal|date)\b/i,
  description: /(keterangan|uraian|deskripsi|description|\bket\b|memo|catatan)/i,
  amountIn: /(masuk|debet|debit|pemasukan|penerimaan|\bin\b)/i,
  amountOut: /(keluar|kredit|credit|pengeluaran|\bout\b)/i,
  label: /(kategori|category|\bakun\b|jenis|\bpos\b|klasifikasi)/i,
  reference: /(\bref\b|referensi|bukti|nota|invoice)/i,
};
// [field, i18n key, required]
const FIELDS = [
  ["date", "fin_colDate", true], ["description", "fin_colDescription", true], ["amountIn", "fin_in", true],
  ["amountOut", "fin_out", true], ["label", "fin_categoryOptional", false], ["reference", "fin_referenceOptional", false],
];
const NO_DESC = "(tanpa keterangan)"; // grouping key for rows without a description (data, not UI)

export default function ImportCashbookTab({ accounts, onDone, fin = {} }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);      // [{ name, rows }] for Excel files
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [raw, setRaw] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [cols, setCols] = useState({});
  const [cashId, setCashId] = useState(accounts.find((a) => a.isCash)?.id || null);
  const [opening, setOpening] = useState({ date: "", amount: "" });
  const [labels, setLabels] = useState([]);     // [{ key, label, direction, count, total, accountId, source }]
  const [labelSearch, setLabelSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const isExcel = (f) => /\.xlsx?$/i.test(f?.name || "");
  function applyRows(rows) {
    if (!rows.length) throw new Error(t("fin_imp_sheetEmpty"));
    const hs = Object.keys(rows[0]);
    const guess = {};
    for (const [k] of FIELDS) guess[k] = hs.find((h) => GUESS[k].test(String(h).trim())) || "";
    setRaw(rows); setHeaders(hs); setCols(guess);
  }
  async function load(f, hr = headerRow, idx = 0) {
    setBusy(true);
    try {
      if (isExcel(f)) {
        const sh = await parseWorkbookTyped(f, { headerRow: hr });
        setSheets(sh); setSheetIdx(idx); applyRows(sh[idx]?.rows || []);
      } else {
        setSheets([]); applyRows(await parse(f));
      }
      setFile(f); setFileName(f.name); setStep(2);
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  }
  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    await load(f, headerRow, 0);
  }

  // Normalized rows (only those with a valid date and an amount).
  const rows = useMemo(() => raw.map((r, i) => ({
    idx: i + 1,
    date: parseDateLoose(r[cols.date]),
    description: String(r[cols.description] ?? "").trim(),
    amountIn: Math.abs(parseMoney(r[cols.amountIn])),
    amountOut: Math.abs(parseMoney(r[cols.amountOut])),
    label: cols.label ? String(r[cols.label] ?? "").trim() : "",
    reference: cols.reference ? String(r[cols.reference] ?? "").trim() : "",
  })), [raw, cols]);
  const valid = rows.filter((r) => r.date && (r.amountIn > 0 || r.amountOut > 0));
  const invalid = rows.filter((r) => !(r.date && (r.amountIn > 0 || r.amountOut > 0)) && (r.amountIn || r.amountOut || r.description));

  async function toMapping() {
    if (!cols.date || !cols.description || (!cols.amountIn && !cols.amountOut)) { toast.error(t("fin_imp_errColumns")); return; }
    if (!cashId) { toast.error(t("fin_imp_errCash")); return; }
    if (!valid.length) { toast.error(t("fin_imp_errNoValid")); return; }
    const m = new Map();
    for (const r of valid) {
      for (const [direction, amt] of [["in", r.amountIn], ["out", r.amountOut]]) {
        if (!(amt > 0)) continue;
        const label = (r.label || r.description || NO_DESC).trim();
        const key = `${direction}|${label.toLowerCase()}`;
        const cur = m.get(key) || { key, label, direction, count: 0, total: 0 };
        cur.count += 1; cur.total += amt; m.set(key, cur);
      }
    }
    const list = [...m.values()].sort((a, b) => b.total - a.total);
    setBusy(true);
    try {
      const sug = await api.books.suggest(list.map((l) => ({ label: l.label, direction: l.direction })));
      const byKey = new Map(sug.map((s) => [`${s.direction}|${String(s.label).toLowerCase()}`, s]));
      setLabels(list.map((l) => ({ ...l, accountId: byKey.get(l.key)?.accountId || null, source: byKey.get(l.key)?.source || null })));
      setStep(3);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const setLabelAccount = (key, accountId) => setLabels((p) => p.map((l) => (l.key === key ? { ...l, accountId, source: "manual" } : l)));
  const unmapped = labels.filter((l) => !l.accountId);

  // Preview: monthly summary + resulting P&L-ish insight from the old books.
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const preview = useMemo(() => {
    if (step < 4) return null;
    const lab = new Map(labels.map((l) => [l.key, l]));
    const months = new Map();
    const byAcc = new Map();
    let tin = 0, tout = 0;
    for (const r of valid) {
      const ym = r.date.slice(0, 7);
      const m = months.get(ym) || { ym, in: 0, out: 0, revenue: 0, expense: 0 };
      for (const [direction, amt] of [["in", r.amountIn], ["out", r.amountOut]]) {
        if (!(amt > 0)) continue;
        const l = lab.get(`${direction}|${(r.label || r.description || NO_DESC).trim().toLowerCase()}`);
        const acc = accById.get(l?.accountId);
        m[direction] += amt; if (direction === "in") tin += amt; else tout += amt;
        if (acc?.type === "income") m.revenue += amt;
        if (acc?.type === "expense") m.expense += amt;
        if (acc) { const c = byAcc.get(acc.id) || { acc, amount: 0, n: 0 }; c.amount += amt; c.n += 1; byAcc.set(acc.id, c); }
      }
      months.set(ym, m);
    }
    const ms = [...months.values()].sort((a, b) => a.ym.localeCompare(b.ym));
    const top = [...byAcc.values()].sort((a, b) => b.amount - a.amount);
    const first = valid.reduce((d, r) => (!d || r.date < d ? r.date : d), null);
    const last = valid.reduce((d, r) => (!d || r.date > d ? r.date : d), null);
    return { months: ms, top, tin, tout, first, last };
  }, [step, labels, valid, accById]);

  async function doImport() {
    if (unmapped.length) { toast.error(t("fin_imp_unmappedN", { n: unmapped.length })); return; }
    setBusy(true);
    try {
      const r = await api.books.importCashbook({
        cashAccountId: cashId,
        rows: valid.map((r) => ({ date: r.date, description: r.description, reference: r.reference || null, amountIn: r.amountIn, amountOut: r.amountOut, label: r.label || r.description })),
        mappings: labels.map((l) => ({ label: l.label, direction: l.direction, accountId: l.accountId })),
        opening: opening.date && Number(opening.amount) ? { date: opening.date, amount: Number(opening.amount) } : null,
      });
      setResult(r); setStep(5);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }
  async function postBatch() {
    setBusy(true);
    try { const r = await api.books.postTx({ batchId: result.batchId }); toast.success(t("fin_postedN", { n: r.posted })); setResult((x) => ({ ...x, posted: r.posted })); onDone?.(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function deleteBatch() {
    if (!confirm(t("fin_imp_confirmDeleteBatch"))) return;
    setBusy(true);
    try { const r = await api.books.deleteBatch(result.batchId); toast.success(t("fin_imp_deletedN", { n: r.deleted })); reset(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  function reset() { setStep(1); setRaw([]); setHeaders([]); setCols({}); setLabels([]); setResult(null); setFileName(""); setFile(null); setSheets([]); setSheetIdx(0); }

  const stepper = [t("fin_imp_stepFile"), t("fin_imp_stepColumns"), t("fin_imp_stepAccounts"), t("fin_imp_stepPreview"), t("fin_imp_stepDone")];
  return (
    <Section title={t("fin_imp_title")} subtitle={t("fin_imp_subtitle")}>
      <div className="flex items-center gap-2 text-xs">
        {stepper.map((s, i) => (
          <span key={s} className={`px-2.5 py-1 rounded-full font-medium ${step === i + 1 ? "bg-primary text-white" : step > i + 1 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{i + 1}. {s}</span>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <Note>{t("fin_imp_formats")}</Note>
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:bg-slate-50">
            <span className="material-symbols-outlined text-[36px] text-slate-400">upload_file</span>
            <span className="text-sm text-slate-600 mt-1">{busy ? t("fin_imp_reading") : t("fin_imp_pickFile")}</span>
            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
            <span>{t("fin_imp_fileRows", { name: fileName, n: raw.length })}</span>
            {sheets.length > 1 && (
              <label className="inline-flex items-center gap-1.5">Sheet
                <select className="px-2 py-1 border border-slate-200 rounded-lg" value={sheetIdx}
                  onChange={(e) => { const i = Number(e.target.value); setSheetIdx(i); try { applyRows(sheets[i].rows); } catch (er) { toast.error(er.message); } }}>
                  {sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                </select>
              </label>
            )}
            {sheets.length > 0 && (
              <label className="inline-flex items-center gap-1.5">{t("fin_imp_headerRow")}
                <input type="number" min="1" max="50" className="w-16 px-2 py-1 border border-slate-200 rounded-lg" value={headerRow}
                  onChange={(e) => setHeaderRow(Number(e.target.value) || 1)} onBlur={() => file && load(file, headerRow, sheetIdx)} />
              </label>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {FIELDS.map(([k, label, req]) => (
              <label key={k} className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t(label)}{req && k !== "amountIn" && k !== "amountOut" ? " *" : ""}</span>
                <select className={inputCls} value={cols[k] || ""} onChange={(e) => setCols((c) => ({ ...c, [k]: e.target.value }))}>
                  <option value="">{t("fin_imp_none")}</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_imp_cashOfBook")} *</span>
              <AccountSelect accounts={accounts} value={cashId} onChange={setCashId} filter={(a) => a.isCash} /></label>
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_imp_openingDate")}</span>
              <input type="date" className={inputCls} value={opening.date} onChange={(e) => setOpening((o) => ({ ...o, date: e.target.value }))} /></label>
            <label className="block"><span className="block text-[11px] font-semibold text-slate-600 mb-1">{t("fin_imp_openingAmount")}</span>
              <input type="number" step="any" className={inputCls} value={opening.amount} onChange={(e) => setOpening((o) => ({ ...o, amount: e.target.value }))} /></label>
          </div>
          <Note>{t("fin_imp_validSummary", { n: valid.length, in: rp(valid.reduce((s, r) => s + r.amountIn, 0)), out: rp(valid.reduce((s, r) => s + r.amountOut, 0)) })}{invalid.length ? t("fin_imp_skippedN", { n: invalid.length }) : ""}</Note>
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-1 text-left">{t("fin_colDate")}</th><th className="px-2 py-1 text-left">{t("fin_colDescription")}</th><th className="px-2 py-1 text-left">{t("fin_category")}</th><th className="px-2 py-1 text-right">{t("fin_in")}</th><th className="px-2 py-1 text-right">{t("fin_out")}</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{rows.slice(0, 15).map((r) => (
                <tr key={r.idx} className={r.date ? "" : "bg-red-50"}><td className="px-2 py-1">{r.date || "✗"}</td><td className="px-2 py-1 truncate max-w-[260px]">{r.description}</td><td className="px-2 py-1">{r.label}</td><td className="px-2 py-1 text-right">{r.amountIn ? rp(r.amountIn) : ""}</td><td className="px-2 py-1 text-right">{r.amountOut ? rp(r.amountOut) : ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex justify-between"><Btn onClick={reset}>{t("fin_imp_changeFile")}</Btn><Btn variant="primary" onClick={toMapping} disabled={busy}>{t("fin_imp_nextMap")}</Btn></div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <Note>{t("fin_imp_mapHelp", { what: cols.label ? t("fin_category").toLowerCase() : t("fin_colDescription").toLowerCase() })}</Note>
          <div className="flex items-center gap-2 flex-wrap">
            <input className={`${inputCls} w-64`} placeholder={t("search")} value={labelSearch} onChange={(e) => setLabelSearch(e.target.value)} />
            <span className="text-xs text-slate-500">{t("fin_imp_categoriesN", { n: labels.length })} · <b className={unmapped.length ? "text-red-600" : "text-emerald-700"}>{t("fin_imp_unmappedShort", { n: unmapped.length })}</b></span>
          </div>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
            {labels.filter((l) => !labelSearch || l.label.toLowerCase().includes(labelSearch.toLowerCase())).map((l) => (
              <div key={l.key} className="grid grid-cols-12 gap-2 items-center px-3 py-1.5">
                <span className={`col-span-1 text-[10px] font-bold ${l.direction === "in" ? "text-emerald-700" : "text-red-600"}`}>{l.direction === "in" ? t("fin_in").toUpperCase() : t("fin_out").toUpperCase()}</span>
                <span className="col-span-5 text-sm text-slate-700 truncate" title={l.label}>{l.label} <span className="text-[11px] text-slate-400">· {l.count}× · Rp{rp(l.total)}</span></span>
                <div className="col-span-5"><AccountSelect accounts={accounts} value={l.accountId} onChange={(v) => setLabelAccount(l.key, v)} filter={(a) => !a.isCash} /></div>
                <span className="col-span-1 text-[10px] text-slate-400">{l.source === "saved" ? t("fin_imp_saved") : l.source === "keyword" && l.accountId ? t("fin_imp_suggested") : ""}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between"><Btn onClick={() => setStep(2)}>{t("back")}</Btn><Btn variant="primary" onClick={() => setStep(4)} disabled={!!unmapped.length}>{t("fin_imp_nextPreview")}</Btn></div>
        </div>
      )}

      {step === 4 && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[[t("fin_period"), `${preview.first} ${t("fin_until")} ${preview.last}`], [t("fin_totalIn"), `Rp${rp(preview.tin)}`], [t("fin_totalOut"), `Rp${rp(preview.tout)}`], [t("fin_netCashFlow"), `Rp${rp(preview.tin - preview.tout)}`]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-3"><p className="text-[11px] text-slate-500">{k}</p><p className="font-bold text-slate-900 text-sm">{v}</p></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-1.5 text-left">{t("fin_month")}</th><th className="px-2 py-1.5 text-right">{t("fin_in")}</th><th className="px-2 py-1.5 text-right">{t("fin_out")}</th><th className="px-2 py-1.5 text-right">{t("fin_type_income")}</th><th className="px-2 py-1.5 text-right">{t("fin_type_expense")}</th><th className="px-2 py-1.5 text-right">{t("fin_profit")}*</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{preview.months.map((m) => (
                  <tr key={m.ym}><td className="px-2 py-1">{MONTHS[Number(m.ym.slice(5)) - 1].slice(0, 3)} {m.ym.slice(0, 4)}</td><td className="px-2 py-1 text-right">{rp(m.in)}</td><td className="px-2 py-1 text-right">{rp(m.out)}</td><td className="px-2 py-1 text-right">{rp(m.revenue)}</td><td className="px-2 py-1 text-right">{rp(m.expense)}</td>
                    <td className={`px-2 py-1 text-right font-semibold ${m.revenue - m.expense < 0 ? "text-red-600" : "text-emerald-700"}`}>{rp(m.revenue - m.expense)}</td></tr>
                ))}</tbody>
              </table>
              <p className="text-[10px] text-slate-400 px-2 py-1">{t("fin_imp_profitNote")}</p>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <p className="text-xs font-bold text-slate-700 mb-2">{t("fin_imp_composition")}</p>
              <ul className="space-y-1.5">{preview.top.slice(0, 10).map(({ acc, amount, n }) => {
                const pct = (amount / Math.max(preview.tin, preview.tout, 1)) * 100;
                return (
                  <li key={acc.id} className="text-xs">
                    <div className="flex justify-between"><span className="truncate">{acc.code} · {acc.name} <span className="text-slate-400">({n}×)</span></span><b>Rp{rp(amount)}</b></div>
                    <div className="h-1.5 bg-slate-100 rounded-full"><div className={`h-full rounded-full ${acc.type === "income" ? "bg-emerald-500" : acc.type === "expense" ? "bg-red-400" : "bg-blue-400"}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                  </li>
                );
              })}</ul>
            </div>
          </div>
          {opening.date && Number(opening.amount) ? <Note>{t("fin_imp_openingWillCreate", { amount: rp(opening.amount), date: opening.date })}</Note> : null}
          <div className="flex justify-between"><Btn onClick={() => setStep(3)}>{t("back")}</Btn><Btn variant="primary" icon="upload" onClick={doImport} disabled={busy}>{busy ? t("fin_imp_importing") : t("fin_imp_importN", { n: valid.length })}</Btn></div>
        </div>
      )}

      {step === 5 && result && (
        <div className="space-y-3">
          <Note tone={result.errors?.length ? "warn" : "ok"}>
            {t("fin_imp_createdN", { n: result.created })}{result.batchId ? <> (batch <span className="font-mono">{result.batchId}</span>)</> : null}.
            {result.errors?.length ? t("fin_imp_failedN", { n: result.errors.length }) : ""}{result.posted ? t("fin_imp_alreadyPostedN", { n: result.posted }) : ""}
          </Note>
          {result.errors?.length > 0 && (
            <ul className="text-xs text-red-600 max-h-40 overflow-y-auto list-disc pl-5">{result.errors.slice(0, 100).map((e, i) => <li key={i}>{t("fin_imp_rowN", { n: e.row })}: {e.reason}</li>)}</ul>
          )}
          <div className="flex gap-2 flex-wrap">
            {fin.post && result.batchId && !result.posted && <Btn variant="success" icon="task_alt" onClick={postBatch} disabled={busy}>{t("fin_imp_postAllN", { n: result.created })}</Btn>}
            {result.batchId && !result.posted && <Btn variant="danger" icon="delete" onClick={deleteBatch} disabled={busy}>{t("fin_imp_deleteBatch")}</Btn>}
            <Btn onClick={reset}>{t("fin_imp_another")}</Btn>
          </div>
        </div>
      )}
    </Section>
  );
}
