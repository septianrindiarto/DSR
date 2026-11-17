// ─── Financial statements (Books v2) ─────────────────────────────────────────
// Ringkasan · Buku Besar · Neraca Saldo · Laba Rugi · Neraca · Arus Kas ·
// Perubahan Ekuitas. Each reads posted entries only and can export to Excel.
// Comparison column = the previous period of the same length (toggle).
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";
import { AccountSelect, Empty, ExportBtn, Note, Section } from "./shared";
import { MONTHS, fmtDate, rp } from "./utils";
import { useLanguage } from "../../context/LanguageContext";

function useReport(name, params, deps) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!params) { setData(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.books.report(name, params).then((d) => alive && setData(d)).catch((e) => alive && toast.error(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading };
}

const Amount = ({ v, bold }) => <td className={`px-3 py-1.5 text-right font-mono whitespace-nowrap ${bold ? "font-bold" : ""} ${Number(v) < 0 ? "text-red-600" : ""}`}>{rp(v)}</td>;
const delta = (a, b) => (b ? `${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%` : "");

// ─── Ringkasan ───────────────────────────────────────────────────────────────
export function SummaryTab({ year, onGo }) {
  const { t } = useLanguage();
  const { data, loading } = useReport("insights", { year }, [year]);
  if (loading) return <Empty>{t("loading")}</Empty>;
  if (!data) return null;
  const max = Math.max(1, ...data.months.map((m) => Math.max(m.revenue, m.expense)));
  return (
    <Section title={t("fin_summaryYear", { y: data.year })} subtitle={t("fin_summarySubtitle")}>
      {data.accountCount === 0 && <Note tone="warn">{t("fin_noAccountsHint")}</Note>}
      {data.draftCount > 0 && <Note tone="warn">{t("fin_draftsNotCounted", { n: data.draftCount })} <button className="underline cursor-pointer" onClick={() => onGo?.("transaksi")}>{t("fin_view")}</button></Note>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[[t("fin_type_income"), data.totals.revenue, "text-emerald-700"], [t("fin_type_expense"), data.totals.expense, "text-red-600"], [t("fin_netIncome"), data.totals.netIncome, data.totals.netIncome < 0 ? "text-red-600" : "text-slate-900"]].map(([k, v, c]) => (
          <div key={k} className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">{k}</p><p className={`text-xl font-bold ${c}`}>Rp{rp(v)}</p></div>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-700 mb-3">{t("fin_revVsExpMonthly")}</p>
        <div className="grid grid-cols-12 gap-1.5 items-end h-40">
          {data.months.map((m) => (
            <div key={m.month} className="flex flex-col items-center justify-end h-full gap-0.5" title={t("fin_monthTooltip", { m: MONTHS[m.month - 1], rev: rp(m.revenue), exp: rp(m.expense), net: rp(m.netIncome) })}>
              <div className="w-full flex items-end gap-0.5 h-full">
                <div className="flex-1 bg-emerald-500 rounded-t" style={{ height: `${(m.revenue / max) * 100}%` }} />
                <div className="flex-1 bg-red-400 rounded-t" style={{ height: `${(m.expense / max) * 100}%` }} />
              </div>
              <span className="text-[10px] text-slate-500">{MONTHS[m.month - 1].slice(0, 3)}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-2"><span className="inline-block w-2 h-2 bg-emerald-500 rounded-sm" /> {t("fin_type_income")} · <span className="inline-block w-2 h-2 bg-red-400 rounded-sm" /> {t("fin_type_expense")}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-700 mb-2">{t("fin_topExpenses")}</p>
          {data.topExpenses.length === 0 ? <p className="text-xs text-slate-400">—</p> : data.topExpenses.map((a) => (
            <div key={a.accountId} className="flex justify-between text-xs py-1 border-b border-slate-50"><span>{a.code} · {a.name}</span><b>Rp{rp(a.amount)}</b></div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-700 mb-2">{t("fin_revenueSources")}</p>
          {data.topRevenues.length === 0 ? <p className="text-xs text-slate-400">—</p> : data.topRevenues.map((a) => (
            <div key={a.accountId} className="flex justify-between text-xs py-1 border-b border-slate-50"><span>{a.code} · {a.name}</span><b>Rp{rp(a.amount)}</b></div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ─── Laba Rugi ───────────────────────────────────────────────────────────────
export function IncomeTab({ range, compare }) {
  const { t } = useLanguage();
  const params = { from: range.from, to: range.to, ...(compare ? { cmpFrom: range.prevFrom, cmpTo: range.prevTo } : {}) };
  const { data, loading } = useReport("income-statement", params, [range.from, range.to, compare]);
  if (loading) return <Empty>{t("loading")}</Empty>;
  if (!data) return null;
  const cmp = data.compare;
  const cmpMap = new Map();
  if (cmp) for (const sec of Object.values(cmp.sections)) for (const r of sec) cmpMap.set(r.code, r.amount);
  const rows = [];
  const sec = (title, list, totalLabel, total, cmpTotal) => {
    rows.push({ kind: "head", label: title });
    list.forEach((r) => rows.push({ kind: "row", label: `${r.code} · ${r.name}`, v: r.amount, c: cmpMap.get(r.code) || 0 }));
    rows.push({ kind: "total", label: totalLabel, v: total, c: cmpTotal });
  };
  const T = data.totals, C = cmp?.totals || {};
  sec(t("fin_is_revenue"), data.sections.revenue, t("fin_is_totalRevenue"), T.revenue, C.revenue);
  sec(t("fin_is_direct"), data.sections.direct, t("fin_is_totalDirect"), T.direct, C.direct);
  rows.push({ kind: "grand", label: t("fin_is_grossProfit"), v: T.grossProfit, c: C.grossProfit });
  sec(t("fin_is_operating"), data.sections.operating, t("fin_is_totalOperating"), T.operating, C.operating);
  rows.push({ kind: "grand", label: t("fin_is_operatingProfit"), v: T.operatingProfit, c: C.operatingProfit });
  if (data.sections.otherIncome.length || data.sections.otherExpense.length || (cmp && (C.otherIncome || C.otherExpense))) {
    sec(t("fin_is_otherIncome"), data.sections.otherIncome, t("fin_is_totalOtherIncome"), T.otherIncome, C.otherIncome);
    sec(t("fin_is_otherExpense"), data.sections.otherExpense, t("fin_is_totalOtherExpense"), T.otherExpense, C.otherExpense);
  }
  rows.push({ kind: "grand", label: t("fin_is_netIncome"), v: T.netIncome, c: C.netIncome });
  const exportRows = rows.filter((r) => r.kind !== "head").map((r) => ({ [t("fin_colDescription")]: r.label, [range.label]: r.v, ...(cmp ? { [range.prevLabel]: r.c || 0, [t("fin_change")]: delta(r.v, r.c) } : {}) }));
  return (
    <Section title={t("fin_is_title")} subtitle={`${range.label} (${fmtDate(range.from)} – ${fmtDate(range.to)}) · ${t("fin_is_margins", { gross: T.grossMargin, net: T.netMargin })}`}
      actions={<ExportBtn rows={exportRows} name={`laba-rugi-${range.from}`} />}>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{t("fin_colDescription")}</th><th className="px-3 py-2 text-right">{range.label}</th>{cmp && <><th className="px-3 py-2 text-right">{range.prevLabel}</th><th className="px-3 py-2 text-right">Δ</th></>}</tr></thead>
          <tbody>{rows.map((r, i) => r.kind === "head" ? (
            <tr key={i}><td colSpan={cmp ? 4 : 2} className="px-3 pt-3 pb-1 text-xs font-bold uppercase tracking-wider text-slate-500">{r.label}</td></tr>
          ) : (
            <tr key={i} className={r.kind === "grand" ? "bg-slate-100 font-bold" : r.kind === "total" ? "border-t border-slate-200 font-semibold" : ""}>
              <td className={`px-3 py-1.5 ${r.kind === "row" ? "pl-6 text-slate-700" : ""}`}>{r.label}</td>
              <Amount v={r.v} bold={r.kind !== "row"} />
              {cmp && <><Amount v={r.c || 0} /><td className="px-3 py-1.5 text-right text-xs text-slate-500">{delta(r.v, r.c)}</td></>}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Section>
  );
}

// ─── Neraca ──────────────────────────────────────────────────────────────────
export function BalanceTab({ range, compare }) {
  const { t } = useLanguage();
  const params = { asOf: range.to, ...(compare ? { cmpAsOf: range.prevTo } : {}) };
  const { data, loading } = useReport("balance-sheet", params, [range.to, compare]);
  if (loading) return <Empty>{t("loading")}</Empty>;
  if (!data) return null;
  const cmp = data.compare;
  const cmpMap = new Map();
  if (cmp) for (const g of Object.values(cmp.groups)) for (const r of g) cmpMap.set(r.code, r.amount);
  const block = (title, groups) => (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{title}</th><th className="px-3 py-2 text-right">{fmtDate(data.asOf)}</th>{cmp && <th className="px-3 py-2 text-right">{fmtDate(cmp.asOf)}</th>}</tr></thead>
        <tbody>
          {groups.map(([label, list, total, cTotal]) => (
            <GroupRows key={label} label={label} list={list} total={total} cTotal={cTotal} cmp={!!cmp} cmpMap={cmpMap} />
          ))}
        </tbody>
      </table>
    </div>
  );
  const T = data.totals, C = cmp?.totals || {};
  const exportRows = [];
  const G = { currentAssets: t("fin_bs_currentAssets"), fixedAssets: t("fin_bs_fixedAssets"), currentLiabilities: t("fin_bs_currentLiab"), longLiabilities: t("fin_bs_longLiab"), equity: t("fin_type_equity") };
  for (const [key, label] of Object.entries(G)) {
    for (const r of data.groups[key]) exportRows.push({ [t("fin_group")]: label, [t("fin_colAccount")]: `${r.code} ${r.name}`, [data.asOf]: r.amount, ...(cmp ? { [cmp.asOf]: cmpMap.get(r.code) || 0 } : {}) });
    exportRows.push({ [t("fin_group")]: label, [t("fin_colAccount")]: t("fin_totalOf", { label }), [data.asOf]: T[key], ...(cmp ? { [cmp.asOf]: C[key] } : {}) });
  }
  return (
    <Section title={t("fin_bs_title")} subtitle={t("fin_bs_subtitle", { date: fmtDate(data.asOf) })}
      actions={<ExportBtn rows={exportRows} name={`neraca-${data.asOf}`} />}>
      {!data.balanced && <Note tone="err">{t("fin_bs_unbalanced", { diff: rp(T.difference) })}</Note>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-2">
          {block(t("fin_bs_assets"), [[G.currentAssets, data.groups.currentAssets, T.currentAssets, C.currentAssets], [G.fixedAssets, data.groups.fixedAssets, T.fixedAssets, C.fixedAssets]])}
          <TotalBar label={t("fin_bs_totalAssets")} v={T.assets} c={cmp ? C.assets : null} />
        </div>
        <div className="space-y-2">
          {block(t("fin_bs_liabEquity"), [
            [G.currentLiabilities, data.groups.currentLiabilities, T.currentLiabilities, C.currentLiabilities],
            [G.longLiabilities, data.groups.longLiabilities, T.longLiabilities, C.longLiabilities],
            [G.equity, data.groups.equity, T.equity, C.equity],
          ])}
          <TotalBar label={t("fin_bs_totalLiabEquity")} v={T.liabilitiesAndEquity} c={cmp ? C.liabilitiesAndEquity : null} />
        </div>
      </div>
    </Section>
  );
}
function GroupRows({ label, list, total, cTotal, cmp, cmpMap }) {
  const { t } = useLanguage();
  return (
    <>
      <tr><td colSpan={cmp ? 3 : 2} className="px-3 pt-2 pb-1 text-xs font-bold text-slate-500">{label}</td></tr>
      {list.length === 0 && <tr><td className="px-6 py-1 text-xs text-slate-400" colSpan={cmp ? 3 : 2}>—</td></tr>}
      {list.map((r) => (
        <tr key={r.code}><td className="px-3 py-1 pl-6 text-slate-700">{r.code.endsWith("*") ? r.name : `${r.code} · ${r.name}`}</td><Amount v={r.amount} />{cmp && <Amount v={cmpMap.get(r.code) || 0} />}</tr>
      ))}
      <tr className="border-t border-slate-200 font-semibold"><td className="px-3 py-1.5">{t("fin_totalOf", { label })}</td><Amount v={total} bold />{cmp && <Amount v={cTotal || 0} bold />}</tr>
    </>
  );
}
const TotalBar = ({ label, v, c }) => (
  <div className="flex justify-between items-center rounded-lg bg-slate-900 text-white px-3 py-2 text-sm font-bold">
    <span>{label}</span><span className="font-mono">Rp{rp(v)}{c !== null && c !== undefined && <span className="text-slate-400 font-normal ml-3">({rp(c)})</span>}</span>
  </div>
);

// ─── Arus Kas ────────────────────────────────────────────────────────────────
export function CashFlowTab({ range }) {
  const { t } = useLanguage();
  const { data, loading } = useReport("cash-flow", { from: range.from, to: range.to }, [range.from, range.to]);
  if (loading) return <Empty>{t("loading")}</Empty>;
  if (!data) return null;
  const sections = [[t("fin_cf_operating"), data.operating], [t("fin_cf_investing"), data.investing], [t("fin_cf_financing"), data.financing]];
  const A = t("fin_cf_activity"), AC = t("fin_colAccount"), IN = t("fin_in"), OUT = t("fin_out"), NET = t("fin_net");
  const exportRows = [];
  sections.forEach(([label, s]) => { s.items.forEach((i) => exportRows.push({ [A]: label, [AC]: `${i.code} ${i.name}`, [IN]: i.inflow, [OUT]: i.outflow, [NET]: i.net })); exportRows.push({ [A]: label, [AC]: t("fin_cf_netOf", { label: label.toLowerCase() }), [NET]: s.total }); });
  exportRows.push({ [AC]: t("fin_cf_netChange"), [NET]: data.netChange }, { [AC]: t("fin_cf_opening"), [NET]: data.openingCash }, { [AC]: t("fin_cf_closing"), [NET]: data.closingCash });
  return (
    <Section title={t("fin_cf_title")} subtitle={`${range.label} — ${t("fin_cf_subtitle")}`} actions={<ExportBtn rows={exportRows} name={`arus-kas-${range.from}`} />}>
      {data.warning && <Note tone="warn">{data.warning}</Note>}
      {data.reconciled === false && <Note tone="err">{t("fin_cf_mismatch", { report: rp(data.closingCash), actual: rp(data.actualClosingCash) })}</Note>}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{t("fin_colDescription")}</th><th className="px-3 py-2 text-right">{t("fin_in")}</th><th className="px-3 py-2 text-right">{t("fin_out")}</th><th className="px-3 py-2 text-right">{t("fin_net")}</th></tr></thead>
          <tbody>
            {sections.map(([label, s]) => (
              <SectionCF key={label} label={label} s={s} />
            ))}
            <tr className="bg-slate-100 font-bold"><td className="px-3 py-1.5">{t("fin_cf_netChange").toUpperCase()}</td><td /><td /><Amount v={data.netChange} bold /></tr>
            <tr><td className="px-3 py-1.5">{t("fin_cf_opening")}</td><td /><td /><Amount v={data.openingCash} /></tr>
            <tr className="bg-slate-900 text-white font-bold"><td className="px-3 py-2">{t("fin_cf_closing").toUpperCase()}</td><td /><td /><td className="px-3 py-2 text-right font-mono">{rp(data.closingCash)}</td></tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}
function SectionCF({ label, s }) {
  const { t } = useLanguage();
  return (
    <>
      <tr><td colSpan={4} className="px-3 pt-3 pb-1 text-xs font-bold uppercase tracking-wider text-slate-500">{label}</td></tr>
      {s.items.length === 0 && <tr><td colSpan={4} className="px-6 py-1 text-xs text-slate-400">—</td></tr>}
      {s.items.map((i) => (
        <tr key={i.accountId}><td className="px-3 py-1 pl-6 text-slate-700">{i.code} · {i.name}</td><Amount v={i.inflow} /><Amount v={-i.outflow} /><Amount v={i.net} /></tr>
      ))}
      <tr className="border-t border-slate-200 font-semibold"><td className="px-3 py-1.5">{t("fin_cf_netOf", { label: label.toLowerCase() })}</td><td /><td /><Amount v={s.total} bold /></tr>
    </>
  );
}

// ─── Perubahan Ekuitas ───────────────────────────────────────────────────────
export function EquityTab({ range }) {
  const { t } = useLanguage();
  const { data, loading } = useReport("equity", { from: range.from, to: range.to }, [range.from, range.to]);
  if (loading) return <Empty>{t("loading")}</Empty>;
  if (!data) return null;
  const rows = [
    { label: t("fin_eq_opening"), v: data.opening, bold: true },
    { label: `  ${t("fin_eq_openingCapital")}`, v: data.openingCapital },
    { label: `  ${t("fin_eq_openingRetained")}`, v: data.openingRetained },
    ...data.movements.map((m) => ({ label: `${m.code} · ${m.name}`, v: m.amount })),
    { label: t("fin_eq_netIncome"), v: data.netIncome },
    { label: t("fin_eq_closing").toUpperCase(), v: data.closing, bold: true, grand: true },
  ];
  return (
    <Section title={t("fin_eq_title")} subtitle={range.label} actions={<ExportBtn rows={rows.map((r) => ({ [t("fin_colDescription")]: r.label.trim(), [t("fin_colAmount")]: r.v }))} name={`perubahan-ekuitas-${range.from}`} />}>
      <div className="border border-slate-200 rounded-lg overflow-hidden max-w-2xl">
        <table className="w-full text-sm"><tbody>{rows.map((r, i) => (
          <tr key={i} className={r.grand ? "bg-slate-900 text-white" : r.bold ? "bg-slate-50 font-semibold" : ""}>
            <td className={`px-3 py-1.5 ${r.label.startsWith("  ") ? "pl-8 text-slate-500 text-xs" : ""}`}>{r.label.trim()}</td>
            <td className={`px-3 py-1.5 text-right font-mono ${r.bold ? "font-bold" : ""}`}>{rp(r.v)}</td>
          </tr>
        ))}</tbody></table>
      </div>
    </Section>
  );
}

// ─── Neraca Saldo ────────────────────────────────────────────────────────────
export function TrialBalanceTab({ range }) {
  const { t } = useLanguage();
  const { data, loading } = useReport("trial-balance", { from: range.from, to: range.to }, [range.from, range.to]);
  if (loading) return <Empty>{t("loading")}</Empty>;
  if (!data) return null;
  const exportRows = data.rows.map((r) => ({ [t("fin_colCode")]: r.code, [t("fin_colAccount")]: r.name, [t("fin_openingBalance")]: r.opening, [t("fin_debit")]: r.debit, [t("fin_credit")]: r.credit, [t("fin_closingDebit")]: r.closingDebit, [t("fin_closingCredit")]: r.closingCredit }));
  return (
    <Section title={t("fin_tb_title")} subtitle={`${range.label} · ${data.balanced ? t("fin_balancedOk") : t("fin_notBalanced")}`} actions={<ExportBtn rows={exportRows} name={`neraca-saldo-${range.from}`} />}>
      {data.rows.length === 0 ? <Empty>{t("fin_noPosted")}</Empty> : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{t("fin_colAccount")}</th><th className="px-3 py-2 text-right">{t("fin_openingBalance")}</th><th className="px-3 py-2 text-right">{t("fin_debit")}</th><th className="px-3 py-2 text-right">{t("fin_credit")}</th><th className="px-3 py-2 text-right">{t("fin_closingD")}</th><th className="px-3 py-2 text-right">{t("fin_closingK")}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.rows.map((r) => (
              <tr key={r.code}><td className="px-3 py-1.5">{r.code.endsWith("*") ? <i className="text-slate-500">{r.name}</i> : `${r.code} · ${r.name}`}</td><Amount v={r.opening} /><Amount v={r.debit} /><Amount v={r.credit} /><Amount v={r.closingDebit} /><Amount v={r.closingCredit} /></tr>
            ))}</tbody>
            <tfoot><tr className="bg-slate-100 font-bold"><td className="px-3 py-2">TOTAL</td><td /><Amount v={data.totals.debit} bold /><Amount v={data.totals.credit} bold /><Amount v={data.totals.closingDebit} bold /><Amount v={data.totals.closingCredit} bold /></tr></tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Buku Besar ──────────────────────────────────────────────────────────────
export function LedgerTab({ range, accounts }) {
  const { t } = useLanguage();
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.isCash)?.id || accounts[0]?.id || null);
  const { data, loading } = useReport("ledger", accountId ? { accountId, from: range.from, to: range.to } : null, [accountId, range.from, range.to]);
  const H = { d: t("fin_colDate"), no: t("fin_colJournalNo"), desc: t("fin_colDescription"), dr: t("fin_debit"), cr: t("fin_credit"), bal: t("fin_balance") };
  const exportRows = data ? [
    { [H.d]: "", [H.no]: "", [H.desc]: t("fin_openingBalance"), [H.dr]: "", [H.cr]: "", [H.bal]: data.opening },
    ...data.rows.map((r) => ({ [H.d]: r.entryDate, [H.no]: r.journalNo, [H.desc]: r.description, [H.dr]: r.debit, [H.cr]: r.credit, [H.bal]: r.balance })),
  ] : [];
  return (
    <Section title={t("fin_ledger")} subtitle={range.label} actions={<ExportBtn rows={exportRows} name={`buku-besar-${data?.account?.code || ""}-${range.from}`} />}>
      <div className="max-w-md"><AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} /></div>
      {loading ? <Empty>{t("loading")}</Empty> : !data ? null : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{H.d}</th><th className="px-3 py-2 text-left">{H.no}</th><th className="px-3 py-2 text-left">{H.desc}</th><th className="px-3 py-2 text-right">{H.dr}</th><th className="px-3 py-2 text-right">{H.cr}</th><th className="px-3 py-2 text-right">{H.bal}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50"><td colSpan={5} className="px-3 py-1.5 italic text-slate-500">{t("fin_openingBalance")}</td><Amount v={data.opening} bold /></tr>
              {data.rows.map((r, i) => (
                <tr key={i}><td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(r.entryDate)}</td><td className="px-3 py-1.5 font-mono text-xs">{r.journalNo}</td><td className="px-3 py-1.5 max-w-[340px] truncate" title={r.description}>{r.description}</td><Amount v={r.debit} /><Amount v={r.credit} /><Amount v={r.balance} /></tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={3} className="px-3 py-2">{t("fin_totalClosing")}</td><Amount v={data.totalDebit} bold /><Amount v={data.totalCredit} bold /><Amount v={data.closing} bold /></tr></tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}
