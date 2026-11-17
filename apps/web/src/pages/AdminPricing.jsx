// ─── Tarif — pricing engine configuration (agency) ──────────────────────────
// Rate card (category × package × zone 1–4, per day), model overrides,
// city → zone list, corporate rates per client company, lembur/inap settings,
// and a quote simulator. Backend: /api/pricing (rules in pricing-core.js).
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { can } from "../lib/permissions";
import { Btn, Note, Section, Empty } from "../components/books/shared";
import PriceEstimate from "../components/PriceEstimate";

const inp = "w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white disabled:bg-slate-100";
const rp = (n) => (Number(n) || 0).toLocaleString("id-ID");
const TABS = ["rates", "zones", "corporate", "settings", "simulate"];

// Example tiers (edit freely): 1 Bandung Raya · 2 rest of West Java ·
// 3 Jabodetabek · 4 Banten & far West/Central Java.
const ZONE_TEMPLATE = [
  ["Bandung", 1], ["Cimahi", 1], ["Bandung Barat", 1], ["Sumedang", 1],
  ["Garut", 2], ["Subang", 2], ["Purwakarta", 2], ["Cianjur", 2], ["Tasikmalaya", 2], ["Sukabumi", 2],
  ["Jakarta", 3], ["Bogor", 3], ["Depok", 3], ["Tangerang", 3], ["Tangerang Selatan", 3], ["Bekasi", 3], ["Karawang", 3],
  ["Serang", 4], ["Cilegon", 4], ["Pandeglang", 4], ["Lebak", 4], ["Cirebon", 4], ["Indramayu", 4], ["Pangandaran", 4],
];

export default function AdminPricing() {
  const { t } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = can(user, "pricing", "edit");
  const [tab, setTab] = useState("rates");
  const [cfg, setCfg] = useState(null);
  const load = () => api.pricing.config().then(setCfg).catch((e) => toast.error(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  return (
    <AdminLayout>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("prc_title")}</h1>
        <p className="text-slate-500 text-sm mt-1">{t("prc_subtitle")}</p>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto mb-4 border-b border-slate-200 pb-px">
        {TABS.map((id) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-2.5 border-b-2 text-sm font-semibold whitespace-nowrap cursor-pointer ${tab === id ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
            {t(`prc_tab_${id}`)}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        {!cfg ? <Empty>{t("loading")}</Empty> : (
          <>
            {tab === "rates" && <RatesTab cfg={cfg} canEdit={canEdit} onSaved={setCfg} />}
            {tab === "zones" && <ZonesTab cfg={cfg} canEdit={canEdit} onSaved={setCfg} />}
            {tab === "corporate" && <CorporateTab cfg={cfg} canEdit={canEdit} />}
            {tab === "settings" && <SettingsTab cfg={cfg} canEdit={canEdit} onSaved={setCfg} />}
            {tab === "simulate" && <SimulateTab cfg={cfg} />}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// ─── Rate card ───────────────────────────────────────────────────────────────
const cellKey = (c, p, z, m = "") => `${c}|${p}|${z}|${m}`;
function RatesTab({ cfg, canEdit, onSaved }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [pkg, setPkg] = useState(cfg.packages[0].key);
  const [cells, setCells] = useState(() => Object.fromEntries(cfg.rateCards.map((r) => [cellKey(r.category, r.package, r.zone, r.carModel || ""), String(r.pricePerDay)])));
  const [models, setModels] = useState(() => cfg.rateCards.filter((r) => r.carModel).map((r) => ({ category: r.category, package: r.package, zone: r.zone, carModel: r.carModel, price: String(r.pricePerDay) })));
  const [removed, setRemoved] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setCells((c) => ({ ...c, [k]: v }));
  const filled = cfg.rateCards.filter((r) => !r.carModel).length;

  async function save() {
    setBusy(true);
    try {
      const rows = [];
      for (const c of cfg.categories) for (const p of cfg.packages) for (const z of cfg.zones) {
        const k = cellKey(c, p.key, z);
        if (k in cells) rows.push({ category: c, package: p.key, zone: z, carModel: "", pricePerDay: Number(cells[k]) || 0 });
      }
      for (const m of models) if (m.carModel.trim()) rows.push({ category: m.category, package: m.package, zone: Number(m.zone), carModel: m.carModel.trim(), pricePerDay: Number(m.price) || 0 });
      for (const m of removed) rows.push({ ...m, pricePerDay: 0 });
      const next = await api.pricing.saveRateCards(rows);
      setRemoved([]); onSaved(next); toast.success(t("prc_saved"));
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  // Copy zone 1 to the empty zones of the same row (+10% per zone) — a fast start.
  function fillFromZone1() {
    setCells((c) => {
      const n = { ...c };
      for (const cat of cfg.categories) {
        const base = Number(n[cellKey(cat, pkg, 1)]) || 0;
        if (!base) continue;
        for (const z of [2, 3, 4]) { const k = cellKey(cat, pkg, z); if (!Number(n[k])) n[k] = String(Math.round(base * (1 + 0.1 * (z - 1)) / 1000) * 1000); }
      }
      return n;
    });
  }

  return (
    <Section title={t("prc_rates_title")} subtitle={t("prc_rates_subtitle")}
      actions={canEdit && <><Btn onClick={fillFromZone1}>{t("prc_fillZones")}</Btn><Btn variant="primary" icon="save" onClick={save} disabled={busy}>{t("save")}</Btn></>}>
      {filled === 0 && <Note tone="warn">{t("prc_rates_empty")}</Note>}
      <div className="flex flex-wrap gap-1.5">
        {cfg.packages.map((p) => (
          <button key={p.key} onClick={() => setPkg(p.key)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer ${pkg === p.key ? "bg-primary text-white border-primary" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{p.label}</button>
        ))}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-3 py-2 text-left">{t("prc_category")}</th>{cfg.zones.map((z) => <th key={z} className="px-3 py-2 text-right">{t("prc_zoneN", { n: z })}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cfg.categories.map((c) => (
              <tr key={c}>
                <td className="px-3 py-1.5 font-medium text-slate-700">{c}</td>
                {cfg.zones.map((z) => (
                  <td key={z} className="px-2 py-1.5">
                    <input type="number" min="0" step="1000" disabled={!canEdit} className={`${inp} text-right`} placeholder="—"
                      value={cells[cellKey(c, pkg, z)] ?? ""} onChange={(e) => set(cellKey(c, pkg, z), e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">{t("prc_rates_hint")}</p>

      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-slate-800">{t("prc_models_title")}</p>
          {canEdit && <Btn icon="add" onClick={() => setModels((m) => [...m, { category: cfg.categories[0], package: pkg, zone: 1, carModel: "", price: "" }])}>{t("prc_addModel")}</Btn>}
        </div>
        {models.length === 0 ? <p className="text-xs text-slate-400">{t("prc_models_empty")}</p> : (
          <div className="space-y-2">
            {models.map((m, i) => {
              const upd = (patch) => setModels((list) => list.map((x, k) => (k === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-center">
                  <input className={`${inp} md:col-span-2`} disabled={!canEdit} placeholder={t("prc_modelPh")} value={m.carModel} onChange={(e) => upd({ carModel: e.target.value })} />
                  <select className={inp} disabled={!canEdit} value={m.category} onChange={(e) => upd({ category: e.target.value })}>{cfg.categories.map((c) => <option key={c}>{c}</option>)}</select>
                  <select className={inp} disabled={!canEdit} value={m.package} onChange={(e) => upd({ package: e.target.value })}>{cfg.packages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
                  <select className={inp} disabled={!canEdit} value={m.zone} onChange={(e) => upd({ zone: Number(e.target.value) })}>{cfg.zones.map((z) => <option key={z} value={z}>{t("prc_zoneN", { n: z })}</option>)}</select>
                  <div className="flex gap-1">
                    <input type="number" min="0" className={`${inp} text-right`} disabled={!canEdit} placeholder="Rp/hari" value={m.price} onChange={(e) => upd({ price: e.target.value })} />
                    {canEdit && <button onClick={() => { if (m.carModel.trim()) setRemoved((r) => [...r, { category: m.category, package: m.package, zone: m.zone, carModel: m.carModel.trim() }]); setModels((l) => l.filter((_, k) => k !== i)); }}
                      className="text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

// ─── Zones ───────────────────────────────────────────────────────────────────
function ZonesTab({ cfg, canEdit, onSaved }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [rows, setRows] = useState(() => cfg.zoneCities.map((z) => ({ city: z.city, zone: z.zone })));
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const upd = (i, patch) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  function addPasted() {
    const add = paste.split(/\n+/).map((l) => l.split(/[,;\t]/)).filter((p) => p[0]?.trim())
      .map(([city, zone]) => ({ city: city.trim(), zone: Math.min(4, Math.max(1, Number(zone) || 1)) }));
    setRows((r) => [...r, ...add]); setPaste("");
  }
  async function save() {
    setBusy(true);
    try { onSaved(await api.pricing.saveZones(rows.filter((r) => r.city.trim()))); toast.success(t("prc_saved")); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  const byZone = cfg.zones.map((z) => rows.filter((r) => Number(r.zone) === z).length);
  return (
    <Section title={t("prc_zones_title")} subtitle={t("prc_zones_subtitle")}
      actions={canEdit && <>
        {rows.length === 0 && <Btn icon="auto_awesome" onClick={() => setRows(ZONE_TEMPLATE.map(([city, zone]) => ({ city, zone })))}>{t("prc_zoneTemplate")}</Btn>}
        <Btn icon="add" onClick={() => setRows((r) => [...r, { city: "", zone: 1 }])}>{t("prc_addCity")}</Btn>
        <Btn variant="primary" icon="save" onClick={save} disabled={busy}>{t("save")}</Btn>
      </>}>
      <p className="text-xs text-slate-500">{cfg.zones.map((z, i) => `${t("prc_zoneN", { n: z })}: ${byZone[i]}`).join(" · ")}</p>
      {rows.length === 0 && <Note tone="warn">{t("prc_zones_empty")}</Note>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input className={inp} disabled={!canEdit} value={r.city} placeholder={t("prc_cityPh")} onChange={(e) => upd(i, { city: e.target.value })} />
            <select className={`${inp} w-32`} disabled={!canEdit} value={r.zone} onChange={(e) => upd(i, { zone: Number(e.target.value) })}>
              {cfg.zones.map((z) => <option key={z} value={z}>{t("prc_zoneN", { n: z })}</option>)}
            </select>
            {canEdit && <button onClick={() => setRows((l) => l.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-600 cursor-pointer"><span className="material-symbols-outlined text-[18px]">delete</span></button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="pt-2">
          <p className="text-xs font-semibold text-slate-600 mb-1">{t("prc_pasteTitle")}</p>
          <textarea className={`${inp} h-24 font-mono`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Bandung,1\nJakarta,3\nSerang,4"} />
          <div className="flex justify-end mt-1"><Btn onClick={addPasted} disabled={!paste.trim()}>{t("prc_pasteAdd")}</Btn></div>
        </div>
      )}
    </Section>
  );
}

// ─── Corporate rates ─────────────────────────────────────────────────────────
function CorporateTab({ cfg, canEdit }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [companies, setCompanies] = useState([]);
  const [clientId, setClientId] = useState("");
  const [rows, setRows] = useState({});      // `${cat}|${pkg}` → { mode: price|discount, value, validUntil }
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.companies.list("limit=1000").then((r) => setCompanies(Array.isArray(r) ? r : (r?.data || []))).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!clientId) { setRows({}); return; }
    api.pricing.corporate(clientId).then((r) => {
      const m = {};
      for (const x of r.rates || []) {
        if (Number(x.zone)) continue; // UI edits the all-zone row
        m[`${x.category}|${x.package}`] = x.pricePerDay ? { mode: "price", value: String(x.pricePerDay) } : { mode: "discount", value: String(x.discountPct) };
      }
      setValidUntil((r.rates || []).find((x) => x.validUntil)?.validUntil || "");
      setRows(m);
    }).catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  const get = (c, p) => rows[`${c}|${p}`] || { mode: "discount", value: "" };
  const setCell = (c, p, patch) => setRows((r) => ({ ...r, [`${c}|${p}`]: { ...get(c, p), ...patch } }));
  async function save() {
    setBusy(true);
    try {
      const rates = [];
      for (const [k, v] of Object.entries(rows)) {
        const [category, pkg] = k.split("|");
        if (!Number(v.value)) continue;
        rates.push({ category, package: pkg, zone: 0, ...(v.mode === "price" ? { pricePerDay: Number(v.value) } : { discountPct: Number(v.value) }), validUntil: validUntil || null });
      }
      await api.pricing.saveCorporate(clientId, rates);
      toast.success(t("prc_saved"));
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Section title={t("prc_corp_title")} subtitle={t("prc_corp_subtitle")}
      actions={canEdit && clientId && <Btn variant="primary" icon="save" onClick={save} disabled={busy}>{t("save")}</Btn>}>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="block min-w-[260px]"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("prc_corp_company")}</span>
          <select className={inp} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">{t("prc_corp_pick")}</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        {clientId && <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{t("prc_corp_validUntil")}</span>
          <input type="date" className={inp} disabled={!canEdit} value={validUntil || ""} onChange={(e) => setValidUntil(e.target.value)} /></label>}
      </div>
      {!clientId ? <Empty>{t("prc_corp_pickHint")}</Empty> : (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{t("prc_category")}</th>{cfg.packages.map((p) => <th key={p.key} className="px-3 py-2 text-left">{p.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {cfg.categories.map((c) => (
                <tr key={c}>
                  <td className="px-3 py-1.5 font-medium">{c}</td>
                  {cfg.packages.map((p) => {
                    const v = get(c, p.key);
                    return (
                      <td key={p.key} className="px-2 py-1.5">
                        <div className="flex gap-1">
                          <select className="px-1.5 py-2 border border-slate-200 rounded-lg text-xs bg-white" disabled={!canEdit} value={v.mode} onChange={(e) => setCell(c, p.key, { mode: e.target.value })}>
                            <option value="discount">%</option><option value="price">Rp</option>
                          </select>
                          <input type="number" min="0" className={`${inp} text-right min-w-[90px]`} disabled={!canEdit} placeholder={v.mode === "price" ? "Rp/hari" : t("prc_corp_discount")}
                            value={v.value} onChange={(e) => setCell(c, p.key, { value: e.target.value })} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-400">{t("prc_corp_hint")}</p>
    </Section>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────
function SettingsTab({ cfg, canEdit, onSaved }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [s, setS] = useState(cfg.settings);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { onSaved(await api.pricing.saveSettings({ ...s, overtimePerHour: Number(s.overtimePerHour) || 0, overnightPerNight: Number(s.overnightPerNight) || 0, rounding: Number(s.rounding), defaultZone: s.defaultZone ? Number(s.defaultZone) : null })); toast.success(t("prc_saved")); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  const lbl = (k) => <span className="block text-xs font-semibold text-slate-600 mb-1">{k}</span>;
  return (
    <Section title={t("prc_settings_title")} subtitle={t("prc_settings_subtitle")} actions={canEdit && <Btn variant="primary" icon="save" onClick={save} disabled={busy}>{t("save")}</Btn>}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl">
        <label className="block">{lbl(t("prc_overtime"))}<input type="number" min="0" className={inp} disabled={!canEdit} value={s.overtimePerHour ?? 0} onChange={(e) => setS({ ...s, overtimePerHour: e.target.value })} /></label>
        <label className="block">{lbl(t("prc_overnight"))}<input type="number" min="0" className={inp} disabled={!canEdit} value={s.overnightPerNight ?? 0} onChange={(e) => setS({ ...s, overnightPerNight: e.target.value })} /></label>
        <label className="block">{lbl(t("prc_rounding"))}
          <select className={inp} disabled={!canEdit} value={s.rounding ?? 1000} onChange={(e) => setS({ ...s, rounding: e.target.value })}>
            {[0, 100, 500, 1000, 5000, 10000].map((v) => <option key={v} value={v}>{v ? `Rp${rp(v)}` : t("prc_noRounding")}</option>)}
          </select></label>
        <label className="block">{lbl(t("prc_defaultZone"))}
          <select className={inp} disabled={!canEdit} value={s.defaultZone || ""} onChange={(e) => setS({ ...s, defaultZone: e.target.value })}>
            <option value="">{t("prc_defaultZoneNone")}</option>
            {cfg.zones.map((z) => <option key={z} value={z}>{t("prc_zoneN", { n: z })}</option>)}
          </select></label>
        <label className="flex items-center gap-2 text-sm md:col-span-2 mt-5 cursor-pointer">
          <input type="checkbox" disabled={!canEdit} checked={s.publicPrices !== false} onChange={(e) => setS({ ...s, publicPrices: e.target.checked })} /> {t("prc_publicPrices")}
        </label>
      </div>
    </Section>
  );
}

// ─── Simulator ───────────────────────────────────────────────────────────────
function SimulateTab({ cfg }) {
  const { t } = useLanguage();
  const today = new Date().toLocaleDateString("en-CA");
  const [f, setF] = useState({ category: cfg.categories[0], package: cfg.packages[0].label, destination: "", quantity: 1, pickupDate: today, returnDate: today, clientOrgId: "" });
  const [companies, setCompanies] = useState([]);
  useEffect(() => { api.companies.list("limit=1000").then((r) => setCompanies(Array.isArray(r) ? r : (r?.data || []))).catch(() => {}); }, []);
  const vehicles = useMemo(() => [{ category: f.category, package: f.package, destination: f.destination, quantity: Number(f.quantity) || 1 }], [f]);
  const lbl = (k) => <span className="block text-xs font-semibold text-slate-600 mb-1">{k}</span>;
  return (
    <Section title={t("prc_sim_title")} subtitle={t("prc_sim_subtitle")}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">{lbl(t("prc_category"))}<select className={inp} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cfg.categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="block">{lbl(t("paket"))}<select className={inp} value={f.package} onChange={(e) => setF({ ...f, package: e.target.value })}>{cfg.packages.map((p) => <option key={p.key} value={p.label}>{p.label}</option>)}</select></label>
        <label className="block md:col-span-2">{lbl(t("tujuan"))}<input className={inp} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="mis. Bandung - Jakarta" /></label>
        <label className="block">{lbl(t("pickupDate"))}<input type="date" className={inp} value={f.pickupDate} onChange={(e) => setF({ ...f, pickupDate: e.target.value })} /></label>
        <label className="block">{lbl(t("returnDate"))}<input type="date" className={inp} value={f.returnDate} onChange={(e) => setF({ ...f, returnDate: e.target.value })} /></label>
        <label className="block">{lbl(t("prc_qty"))}<input type="number" min="1" max="10" className={inp} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
        <label className="block">{lbl(t("prc_corp_company"))}<select className={inp} value={f.clientOrgId} onChange={(e) => setF({ ...f, clientOrgId: e.target.value })}><option value="">{t("prc_sim_public")}</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <PriceEstimate vehicles={vehicles} pickupDate={f.pickupDate} returnDate={f.returnDate} clientOrgId={f.clientOrgId ? Number(f.clientOrgId) : null} detailed />
    </Section>
  );
}
