// ─── Transaksi — journal list (Jurnal Umum) with draft → post → reverse ──────
import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";
import EntryModal from "./EntryModal";
import { Btn, Empty, ExportBtn, Note, Section } from "./shared";
import { SOURCE_LABEL, STATUS_LABEL, STATUS_STYLE, fmtDate, inputCls, rp } from "./utils";
import { useLanguage } from "../../context/LanguageContext";

import AsyncButton from "../AsyncButton";
export default function TransactionsTab({ accounts, range, onChanged, fin = {} }) {
  const toast = useToast();
  const { t } = useLanguage();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null); // null | {} (new) | tx (edit draft)
  const limit = 50;

  const load = useCallback(() => {
    setLoading(true);
    const p = { from: range.from, to: range.to, page, limit };
    if (status) p.status = status;
    if (search.trim()) p.search = search.trim();
    api.books.transactions(p).then(setRes).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
    // toast is intentionally not a dependency: its object identity changes on
    // every toast, which would re-trigger this load in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, status, search, page]);
  useEffect(() => { load(); }, [load]);

  const refresh = () => { setSelected(new Set()); load(); onChanged?.(); };
  const toggle = (set, id) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  async function postIds(ids) {
    try { const r = await api.books.postTx({ ids }); toast.success(t("fin_postedN", { n: r.posted }) + (r.skippedLocked ? t("fin_skippedLockedN", { n: r.skippedLocked }) : "")); refresh(); }
    catch (e) { toast.error(e.message); }
  }
  async function remove(tx) {
    if (!confirm(t("fin_confirmDeleteDraft", { no: tx.journalNo }))) return;
    try { await api.books.deleteTx(tx.id); refresh(); } catch (e) { toast.error(e.message); }
  }
  async function reverse(tx) {
    const reason = prompt(t("fin_promptReverse", { no: tx.journalNo }), "");
    if (reason === null) return;
    try { await api.books.reverseTx(tx.id, { reason: reason || undefined }); toast.success(t("fin_reversalCreated")); refresh(); }
    catch (e) { toast.error(e.message); }
  }

  const rows = res?.data || [];
  const draftsOnPage = rows.filter((r) => r.status === "draft");
  const exportRows = rows.flatMap((tx) => tx.lines.map((l) => ({
    [t("fin_colJournalNo")]: tx.journalNo, [t("fin_colDate")]: tx.entryDate, [t("fin_colDescription")]: tx.description, [t("fin_colReference")]: tx.reference || "",
    [t("fin_colStatus")]: STATUS_LABEL[tx.status], [t("fin_colAccount")]: `${l.code} ${l.name}`, [t("fin_debit")]: l.debit, [t("fin_credit")]: l.credit, Memo: l.memo || "",
  })));

  return (
    <Section
      title={t("fin_generalJournal")}
      subtitle={`${range.label} · ${t("fin_journalSubtitle")}`}
      actions={<>
        <ExportBtn rows={exportRows} name={`jurnal-umum-${range.from}`} />
        {fin.post && selected.size > 0 && <Btn variant="success" icon="task_alt" onClick={() => postIds([...selected])}>{t("fin_postSelected", { n: selected.size })}</Btn>}
        {fin.create && <Btn variant="primary" icon="add" onClick={() => setModal({})} disabled={!accounts.length}>{t("fin_newJournal")}</Btn>}
      </>}
    >
      {!accounts.length && <Note tone="warn">{t("fin_noAccountsHint")}</Note>}
      {res?.draftCount > 0 && <Note tone="warn">{t("fin_draftsPending", { n: res.draftCount })}</Note>}

      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${inputCls} w-64`} placeholder={t("fin_searchJournal")} value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className={`${inputCls} w-40`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t("fin_allStatus")}</option><option value="draft">{STATUS_LABEL.draft}</option><option value="posted">{STATUS_LABEL.posted}</option><option value="reversed">{STATUS_LABEL.reversed}</option>
        </select>
        {fin.post && draftsOnPage.length > 0 && <Btn onClick={() => setSelected(new Set(draftsOnPage.map((d) => d.id)))}>{t("fin_selectAllDrafts")}</Btn>}
      </div>

      {loading ? <Empty>{t("loading")}</Empty> : rows.length === 0 ? <Empty>{t("fin_noJournalInPeriod")}</Empty> : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left">{t("fin_colJournalNo")}</th>
                <th className="px-3 py-2 text-left">{t("fin_colDate")}</th>
                <th className="px-3 py-2 text-left">{t("fin_colDescription")}</th>
                <th className="px-3 py-2 text-left">{t("fin_colSource")}</th>
                <th className="px-3 py-2 text-right">{t("fin_colAmount")}</th>
                <th className="px-3 py-2 text-center">{t("fin_colStatus")}</th>
                <th className="px-3 py-2 text-center">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((tx) => (
                <Fragment key={tx.id}>
                  <tr className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 text-center">
                      {fin.post && tx.status === "draft" && <input type="checkbox" checked={selected.has(tx.id)} onChange={() => setSelected((s) => toggle(s, tx.id))} className="cursor-pointer" />}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <button type="button" onClick={() => setExpanded((s) => toggle(s, tx.id))} className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer">
                        <span className={`material-symbols-outlined text-[16px] transition-transform ${expanded.has(tx.id) ? "rotate-90" : ""}`}>chevron_right</span>{tx.journalNo}
                      </button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(tx.entryDate)}</td>
                    <td className="px-3 py-2 max-w-[340px] truncate" title={tx.description}>{tx.description}{tx.reference && <span className="text-slate-400 text-xs"> · {tx.reference}</span>}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{SOURCE_LABEL[tx.source] || tx.source}</td>
                    <td className="px-3 py-2 text-right font-mono">{rp(tx.totalAmount)}</td>
                    <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[tx.status]}`}>{STATUS_LABEL[tx.status]}</span></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {tx.status === "draft" && <>
                          {fin.post && <AsyncButton title={t("fin_post")} onClick={() => postIds([tx.id])} className="p-1 rounded hover:bg-emerald-50 text-emerald-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">task_alt</span></AsyncButton>}
                          {fin.edit && <button title={t("fin_editDraft")} onClick={() => setModal(tx)} className="p-1 rounded hover:bg-amber-50 text-amber-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">edit</span></button>}
                          {fin.edit && <AsyncButton title={t("fin_deleteDraft")} onClick={() => remove(tx)} className="p-1 rounded hover:bg-red-50 text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></AsyncButton>}
                        </>}
                        {fin.post && tx.status === "posted" && tx.source !== "reversal" && tx.source !== "auto" && (
                          <AsyncButton title={t("fin_reverseJournal")} onClick={() => reverse(tx)} className="p-1 rounded hover:bg-slate-100 text-slate-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">undo</span></AsyncButton>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded.has(tx.id) && (
                    <tr className="bg-slate-50/50">
                      <td></td>
                      <td colSpan={7} className="px-3 py-2">
                        <table className="w-full text-xs">
                          <tbody>
                            {tx.lines.map((l) => (
                              <tr key={l.lineNo}>
                                <td className={`py-1 ${l.credit > 0 ? "pl-8" : ""}`}>{l.code} · {l.name}{l.memo && <span className="text-slate-400"> — {l.memo}</span>}{l.orderNumber && <span className="text-slate-400 font-mono"> [{l.orderNumber}]</span>}</td>
                                <td className="py-1 text-right font-mono w-32">{l.debit ? rp(l.debit) : ""}</td>
                                <td className="py-1 text-right font-mono w-32">{l.credit ? rp(l.credit) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {res && res.total > limit && (
        <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
          <Btn disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</Btn>
          {t("fin_pageOf", { page, pages: Math.ceil(res.total / limit) })}
          <Btn disabled={page >= Math.ceil(res.total / limit)} onClick={() => setPage((p) => p + 1)}>›</Btn>
        </div>
      )}

      {modal && <EntryModal canPost={!!fin.post} accounts={accounts} initial={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
    </Section>
  );
}
