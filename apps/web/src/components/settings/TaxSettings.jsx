import { useEffect, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../Toast";
import { api, apiCache } from "../../lib/api";
import AsyncButton from "../AsyncButton";
import InfoTip from "../InfoTip";
import TaxProfileEditor from "../TaxProfileEditor";

// Pengaturan → Pajak invoice (owner 2026-11-09): agency default + per client.
// Some clients want PPh 23 withheld, others a "Pajak 2,5 %" / "2 %" line added.
export default function TaxSettings() {
  const { t } = useLanguage();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [def, setDef] = useState(null);
  const [open, setOpen] = useState(null);        // client id being edited
  const [draft, setDraft] = useState(null);
  const [q, setQ] = useState("");

  const load = () => api.invoices.tax().then((r) => { setData(r); setDef(r.profile); }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDefault() {
    try { const r = await api.invoices.setDefaultTax(def); setData(r); toast.success(t("tx_saved")); apiCache.invalidate("tax:"); }
    catch (e) { toast.error(e.message); }
  }
  async function saveClient(id, profile) {
    try { const r = await api.invoices.setCompanyTax(id, profile); setData(r); setOpen(null); toast.success(t("tx_saved")); apiCache.invalidate("tax:"); }
    catch (e) { toast.error(e.message); }
  }

  if (!data || !def) return <p className="text-sm text-slate-500">{t("loadingShort")}</p>;
  const list = data.companies.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-1">{t("tx_sectionTitle")} <InfoTip text={t("tx_sectionSub")} size={15} /></h2>
      </div>
      <div className="p-5 space-y-6">
        <section>
          <h3 className="text-sm font-bold text-slate-800 mb-2">{t("tx_default")}</h3>
          <TaxProfileEditor value={def} onChange={setDef} />
          <div className="mt-3"><AsyncButton onClick={saveDefault} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">{t("save")}</AsyncButton></div>
        </section>
        <section>
          <h3 className="text-sm font-bold text-slate-800 mb-2">{t("tx_perClient")}</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tx_search")} className="w-full md:w-80 px-3 py-2 border border-slate-200 rounded-lg text-sm mb-3" />
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
            {list.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">{t("noData")}</p>}
            {list.map((c) => (
              <div key={c.id} className="px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.profile ? summary(c.profile, t) : t("tx_useDefault")}</span>
                  {open !== c.id && <button className="text-xs font-semibold text-primary cursor-pointer" onClick={() => { setOpen(c.id); setDraft(c.profile || def); }}>{t("tx_custom")}</button>}
                  {c.profile && open !== c.id && <AsyncButton onClick={() => saveClient(c.id, null)} className="text-xs text-slate-500 hover:text-red-600">{t("tx_useDefault")}</AsyncButton>}
                </div>
                {open === c.id && (
                  <div className="mt-3 space-y-3">
                    <TaxProfileEditor value={draft} onChange={setDraft} />
                    <div className="flex gap-2">
                      <AsyncButton onClick={() => saveClient(c.id, draft)} className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium">{t("save")}</AsyncButton>
                      <button className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 cursor-pointer" onClick={() => setOpen(null)}>{t("cancel")}</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function summary(p, t) {
  const parts = [p.ppn.enabled ? `PPN ${p.ppn.rate}%` : "Tanpa PPN"];
  if (p.pph.mode !== "none") parts.push(`${p.pph.label} ${p.pph.rate}% · ${t(`tx_mode_${p.pph.mode}`)}`);
  return parts.join(" · ");
}
