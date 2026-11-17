// ─── ScenePanels — contents of the garage-scene popovers ─────────────────────
// Each panel gets { preset, goto } from LandingScene. goto(panel, preset)
// switches the open popover (e.g. car card "Pesan ini" → order form with the
// category prefilled). Data comes only from public endpoints via api.* + swr.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiCache, swr, carImgSrc } from "../../lib/api";
import { useLanguage } from "../../context/LanguageContext";
import { useAuth } from "../../context/AuthContext";
import { isDriverOnly } from "../../lib/permissions";
import { CAR_CATEGORIES, PACKAGE_OPTIONS, waLink, typeToCategory } from "../../lib/booking-options";
import PriceEstimate from "../PriceEstimate";

const rp = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;
const todayWib = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const inp = "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const btnPrimary = "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover active:scale-[.98] transition disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = "inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition";


function useSwr(key, fetcher) {
  const [state, setState] = useState(() => ({ data: apiCache.get(key)?.data ?? null, error: null }));
  useEffect(() => {
    let alive = true;
    swr(key, fetcher).then((d) => alive && setState({ data: d, error: null })).catch((e) => alive && setState((s) => ({ ...s, error: e.message })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function F({ label, children, className = "" }) {
  return <label className={`block ${className}`}><span className="block text-[11px] font-bold text-slate-500 mb-1 uppercase tracking-wide">{label}</span>{children}</label>;
}

// ─── Order ──────────────────────────────────────────────────────────────────
export function OrderPanel({ preset = {}, onFullForm }) {
  const { t } = useLanguage();
  const today = todayWib();
  const blank = () => ({
    fullName: "", whatsapp: "", companyName: "",
    category: preset.category || "", note: preset.note || "", quantity: 1,
    package: preset.package || "", pickupDate: preset.date || today, returnDate: preset.date || today,
    destination: "", notes: preset.notes || "",
  });
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const set = (k, v) => setF((p) => {
    const n = { ...p, [k]: v };
    if (k === "pickupDate" && n.returnDate < v) n.returnDate = v;
    return n;
  });
  const ok = f.fullName.trim() && f.whatsapp.trim() && f.category && f.package && (f.category !== "Lainnya" || f.note.trim());
  const vehicles = useMemo(() => [{ category: f.category, package: f.package, destination: f.destination, quantity: f.quantity }], [f.category, f.package, f.destination, f.quantity]);

  async function submit(e) {
    e.preventDefault();
    if (!ok) { setError(t("sc_required")); return; }
    setBusy(true); setError("");
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      const company = f.companyName.trim();
      const r = await api.orders.createPublic({
        fullName: f.fullName.trim(), whatsapp: f.whatsapp.trim(),
        customerType: company ? "company" : "private", companyName: company || null,
        pickupDate: f.pickupDate, returnDate: f.returnDate,
        notes: f.notes || null, affiliateCode: ref || null,
        vehicles: [{
          carCategoryRequested: f.category,
          carCategoryNote: f.category === "Lainnya" ? f.note.trim() : null,
          quantity: Math.max(1, Math.min(10, Number(f.quantity) || 1)),
          package: f.package, destination: f.destination.trim() || null, pickupLocation: null,
        }],
      });
      setDone(r?.message || t("sc_sentBody"));
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center gs-pop">
          <span className="material-symbols-outlined text-[36px]">check_circle</span>
        </div>
        <p className="font-black text-lg mt-3">{t("sc_sent")}</p>
        <p className="text-sm text-slate-500 mt-1">{done}</p>
        <button type="button" className={`${btnGhost} mt-4`} onClick={() => { setF(blank()); setDone(""); }}>{t("sc_again")}</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-slate-500 -mt-1">{t("sc_order_sub")}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <F label={`${t("sc_name")} *`}><input className={inp} value={f.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder={t("sc_namePh")} /></F>
        <F label={`${t("sc_wa")} *`}><input className={inp} inputMode="tel" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="08…" /></F>
        <F label={`${t("sc_category")} *`}>
          <select className={inp} value={f.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">{t("sc_choose")}</option>
            {CAR_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </F>
        <F label={`${t("sc_package")} *`}>
          <select className={inp} value={f.package} onChange={(e) => set("package", e.target.value)}>
            <option value="">{t("sc_choose")}</option>
            {PACKAGE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </F>
        {f.category === "Lainnya" && <F label={`${t("sc_note")} *`} className="col-span-2"><input className={inp} value={f.note} onChange={(e) => set("note", e.target.value)} /></F>}
        <F label={t("sc_pickup")}><input type="date" className={inp} min={today} value={f.pickupDate} onChange={(e) => set("pickupDate", e.target.value)} /></F>
        <F label={t("sc_return")}><input type="date" className={inp} min={f.pickupDate} value={f.returnDate} onChange={(e) => set("returnDate", e.target.value)} /></F>
        <F label={t("sc_destination")}><input className={inp} value={f.destination} onChange={(e) => set("destination", e.target.value)} placeholder={t("sc_destinationPh")} /></F>
        <F label={t("sc_qty")}><input type="number" min={1} max={10} className={inp} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></F>
        <F label={t("sc_company")} className="col-span-2"><input className={inp} value={f.companyName} onChange={(e) => set("companyName", e.target.value)} /></F>
      </div>
      <PriceEstimate vehicles={vehicles} pickupDate={f.pickupDate} returnDate={f.returnDate} />
      {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
      <button type="submit" className={`${btnPrimary} w-full`} disabled={busy || !ok}>
        <span className="material-symbols-outlined text-[18px]">send</span>{busy ? t("sc_sending") : t("sc_submit")}
      </button>
      <button type="button" onClick={onFullForm} className="w-full text-xs font-semibold text-primary hover:underline">{t("sc_fullForm")}</button>
    </form>
  );
}

// ─── Cars ───────────────────────────────────────────────────────────────────
export function CarsPanel({ preset = {}, goto }) {
  const { t } = useLanguage();
  const { data, error } = useSwr("cars:public", () => api.cars.listPublic());
  const cars = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const types = useMemo(() => [...new Set(cars.map((c) => c.type).filter(Boolean))], [cars]);
  // The popover remounts when the preset changes, so the initial tab is enough.
  const [tab, setTab] = useState(preset.type || "all");
  const list = tab === "all" ? cars : cars.filter((c) => c.type === tab);
  const units = cars.reduce((s, c) => s + Math.max(1, Number(c.availableCount) || 1), 0);

  if (error) return <p className="text-sm text-red-600">{t("sc_loadFail")}</p>;
  if (!data) return <p className="text-sm text-slate-500">{t("sc_loading")}</p>;
  return (
    <div>
      <p className="text-xs text-slate-500 -mt-1 mb-2">{t("sc_cars_sub", { n: units })}</p>
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
        {["all", ...types, ...(preset.type && !types.includes(preset.type) ? [preset.type] : [])].map((ty) => (
          <button key={ty} type="button" onClick={() => setTab(ty)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold border transition ${tab === ty ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-primary/50"}`}>
            {ty === "all" ? t("sc_all") : ty}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="text-sm text-slate-500 bg-slate-50 rounded-xl p-4">
          {t("sc_noCars")}
          <a href={waLink(t("sc_wa_text"))} target="_blank" rel="noreferrer" className="block mt-2 font-bold text-[#128C7E]">{t("sc_wa_btn")} →</a>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((c, i) => (
            <div key={c.id} className="flex gap-3 p-2 rounded-xl border border-slate-100 hover:border-primary/40 hover:shadow-md transition bg-white gs-pop" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="w-28 h-20 rounded-lg bg-slate-100 overflow-hidden shrink-0">
                {c.image && <img src={carImgSrc(c.image)} alt={`${c.brand} ${c.name}`} loading="lazy" className="w-full h-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm truncate">{c.brand} {c.name}</p>
                <p className="text-[11px] text-slate-500">{[c.type, t("sc_seats", { n: c.capacity }), c.transmission, c.fuel].filter(Boolean).join(" · ")}</p>
                <p className="text-sm font-black text-primary mt-0.5">{rp(c.price)}<span className="text-[11px] font-semibold text-slate-400">{t("sc_perDay")}</span></p>
                <div className="flex gap-1.5 mt-1">
                  <button type="button" className="px-2.5 py-1 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-primary-hover"
                    onClick={() => goto("order", { category: typeToCategory(c.type), note: typeToCategory(c.type) === "Lainnya" ? `${c.type} — ${c.brand} ${c.name}` : "", notes: `Minat unit: ${c.brand} ${c.name}` })}>
                    {t("sc_bookThis")}
                  </button>
                  <Link to={`/car/${c.id}`} className="px-2.5 py-1 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50">{t("sc_detail")}</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Schedule (whiteboard) ──────────────────────────────────────────────────
export function SchedulePanel({ goto }) {
  const { t } = useLanguage();
  const { data, error } = useSwr("cars:availability:7", () => api.cars.availability(7));
  if (error) return <p className="text-sm text-red-600">{t("sc_loadFail")}</p>;
  if (!data) return <p className="text-sm text-slate-500">{t("sc_loading")}</p>;
  const days = data.days || [];
  const types = data.types || [];
  const color = (n) => (n >= 2 ? "bg-emerald-500" : n === 1 ? "bg-amber-400" : "bg-red-500");
  return (
    <div>
      <p className="text-xs text-slate-500 -mt-1 mb-3">{t("sc_sched_sub")}</p>
      {types.length === 0 ? <p className="text-sm text-slate-500">{t("sc_sched_empty")}</p> : (
        <div className="rounded-xl border-4 border-slate-200 bg-white p-2 overflow-x-auto">
          <table className="w-full text-center">
            <thead>
              <tr>
                <th></th>
                {days.map((d) => {
                  const dt = new Date(`${d}T00:00:00`);
                  return <th key={d} className="px-1 pb-1 gs-chalk text-[11px] font-bold text-slate-500">{dt.toLocaleDateString("id-ID", { weekday: "short" })}<br /><span className="text-slate-800 text-sm">{dt.getDate()}</span></th>;
                })}
              </tr>
            </thead>
            <tbody>
              {types.map((ty) => (
                <tr key={ty.type} className="border-t border-dashed border-slate-200">
                  <td className="text-left pr-2 py-1.5 gs-chalk text-xs font-bold text-primary whitespace-nowrap">{ty.type}</td>
                  {ty.free.map((n, i) => (
                    <td key={i} className="py-1">
                      <button type="button" disabled={n === 0} title={`${n} ${t("sc_sched_free")}`}
                        onClick={() => goto("order", { category: typeToCategory(ty.type), date: days[i], note: typeToCategory(ty.type) === "Lainnya" ? ty.type : "" })}
                        className={`w-7 h-7 rounded-full text-white text-xs font-black shadow-[0_2px_0_rgba(0,0,0,.15)] ${color(n)} hover:scale-125 hover:-rotate-6 transition disabled:cursor-not-allowed disabled:opacity-70`}>
                        {n}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3 mt-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full bg-emerald-500" />{t("sc_sched_legend_ok")}</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full bg-amber-400" />{t("sc_sched_legend_low")}</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full bg-red-500" />{t("sc_sched_legend_full")}</span>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">{t("sc_sched_note")}</p>
    </div>
  );
}

// ─── Packages (chalk menu) ──────────────────────────────────────────────────
export function PackagesPanel({ goto }) {
  const { t } = useLanguage();
  const items = [
    { pkg: "Lepas Kunci", icon: "key", title: t("sc_pkg_lk"), desc: t("sc_pkg_lk_d") },
    { pkg: "Mobil dan Driver", icon: "person_pin_circle", title: t("sc_pkg_md"), desc: t("sc_pkg_md_d") },
    { pkg: "All In", icon: "auto_awesome", title: t("sc_pkg_ai"), desc: t("sc_pkg_ai_d"), star: true },
  ];
  return (
    <div className="rounded-2xl bg-[#2f3b35] p-4 text-white border-[6px] border-[#8a5a3a]">
      <p className="gs-chalk text-xs text-white/70 mb-3">{t("sc_pkg_sub")}</p>
      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={it.pkg} className="flex gap-3 items-start gs-pop" style={{ animationDelay: `${i * 60}ms` }}>
            <span className={`material-symbols-outlined text-[26px] ${it.star ? "text-[#ffd36b]" : "text-white/80"}`}>{it.icon}</span>
            <div className="flex-1">
              <p className="gs-chalk font-bold text-base">{it.title}{it.star && " ★"}</p>
              <p className="text-xs text-white/70">{it.desc}</p>
            </div>
            <button type="button" onClick={() => goto("order", { package: it.pkg })} className="shrink-0 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold">{t("sc_pkg_check")}</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => goto("corporate")} className="mt-4 gs-chalk text-sm text-[#ffd36b] hover:underline">{t("sc_pkg_contract")}</button>
    </div>
  );
}

// ─── Location ───────────────────────────────────────────────────────────────
export function LocationPanel() {
  const { t } = useLanguage();
  const maps = "https://www.google.com/maps/search/?api=1&query=DSR+Solution+Buah+Batu+Bandung";
  return (
    <div className="space-y-3">
      <div className="rounded-xl overflow-hidden border border-slate-100 bg-[#fff7e8]">
        <svg viewBox="0 0 360 150" className="w-full h-auto block">
          <path d="M0 90 Q120 60 200 100 T360 90" stroke="#9bd0a1" strokeWidth="26" fill="none" opacity="0.6" />
          <path d="M20 150 L300 0 M80 0 L150 150" stroke="#f3b2a0" strokeWidth="9" fill="none" />
          <path d="M0 60 L360 110" stroke="#94b8e8" strokeWidth="10" fill="none" />
          <g transform="translate(166,40)"><g className="gs-bob"><path d="M14 0 C6 0 0 6 0 14 C0 24 14 38 14 38 C14 38 28 24 28 14 C28 6 22 0 14 0 Z" fill="#e3262d" /><circle cx="14" cy="14" r="5" fill="#fff" /></g></g>
          <text x="196" y="66" fontSize="13" fontWeight="800" fill="#2b2422">DSR Solution</text>
        </svg>
      </div>
      <p className="flex gap-2 text-sm"><span className="material-symbols-outlined text-primary text-[20px]">location_on</span><span className="font-semibold">{t("addressValue")}</span></p>
      <p className="text-xs text-slate-500">{t("sc_loc_delivery")}</p>
      <div className="grid grid-cols-2 gap-2">
        <a href={maps} target="_blank" rel="noreferrer" className={btnGhost}><span className="material-symbols-outlined text-[18px]">map</span>{t("sc_loc_maps")}</a>
        <a href={waLink(t("sc_wa_text"))} target="_blank" rel="noreferrer" className={`${btnGhost} text-[#128C7E]`}><span className="material-symbols-outlined text-[18px]">chat</span>{t("sc_loc_chat")}</a>
      </div>
    </div>
  );
}

// ─── Trust (photo wall) ─────────────────────────────────────────────────────
export function TrustPanel() {
  const { t } = useLanguage();
  const { data } = useSwr("cars:summary", () => api.cars.summary());
  const stats = [
    { icon: "directions_car", label: t("sc_trust_units"), value: data ? data.units : "…" },
    { icon: "route", label: t("sc_trust_trips"), value: data ? data.trips.toLocaleString("id-ID") : "…" },
    { icon: "star", label: t("sc_trust_rating"), value: data ? (data.reviews ? `${data.rating} ★` : t("sc_trust_noRating")) : "…", sub: data?.reviews ? t("sc_trust_reviews", { n: data.reviews }) : "" },
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s, i) => (
          <div key={s.label} className="bg-white rounded-lg p-2 pb-3 shadow-md border border-slate-100 text-center gs-pop" style={{ transform: `rotate(${[-3, 2, -1][i]}deg)`, animationDelay: `${i * 70}ms` }}>
            <div className="bg-primary-light rounded-md py-3"><span className="material-symbols-outlined text-primary text-[26px]">{s.icon}</span></div>
            <p className="font-black text-lg mt-1.5">{s.value}</p>
            <p className="text-[10px] text-slate-500 leading-tight">{s.label}</p>
            {s.sub && <p className="text-[10px] text-slate-400">{s.sub}</p>}
          </div>
        ))}
      </div>
      <AboutList className="mt-4" />
    </div>
  );
}

function AboutList({ className = "" }) {
  const { t } = useLanguage();
  const items = [
    { icon: "verified", title: t("feature1Title"), body: t("feature1Body") },
    { icon: "price_check", title: t("feature2Title"), body: t("feature2Body") },
    { icon: "support_agent", title: t("feature3Title"), body: t("feature3Body") },
  ];
  return (
    <div className={`space-y-2.5 ${className}`}>
      {items.map((it) => (
        <div key={it.title} className="flex gap-3">
          <span className="w-9 h-9 rounded-xl bg-primary-light text-primary flex items-center justify-center shrink-0"><span className="material-symbols-outlined text-[20px]">{it.icon}</span></span>
          <div><p className="font-bold text-sm">{it.title}</p><p className="text-xs text-slate-500">{it.body}</p></div>
        </div>
      ))}
    </div>
  );
}

export function AboutPanel({ goto }) {
  const { t } = useLanguage();
  return (
    <div>
      <p className="text-sm text-slate-600 -mt-1 mb-3">{t("featuresSubtitle")}</p>
      <AboutList />
      <button type="button" onClick={() => goto("order")} className={`${btnPrimary} w-full mt-4`}>{t("sc_h_order")}</button>
    </div>
  );
}

export function WhatsAppPanel() {
  const { t } = useLanguage();
  return (
    <div className="text-center">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-[#25D366] text-white flex items-center justify-center gs-ring"><span className="material-symbols-outlined text-[34px]">chat</span></div>
      <p className="text-sm text-slate-600 mt-3">{t("sc_wa_sub")}</p>
      <a href={waLink(t("sc_wa_text"))} target="_blank" rel="noreferrer" className="mt-4 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#1ebe5b] text-white font-bold text-sm">{t("sc_wa_btn")}</a>
    </div>
  );
}

export function LoginPanel() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const home = user && isDriverOnly(user) ? "/driver" : "/admin/dashboard";
  return (
    <div>
      <p className="text-sm text-slate-600 -mt-1">{user ? t("sc_login_hi", { name: user.name || user.email }) : t("sc_login_sub")}</p>
      <Link to={user ? home : "/admin/login"} className={`${btnPrimary} w-full mt-4`}>
        <span className="material-symbols-outlined text-[18px]">{user ? "dashboard" : "login"}</span>{user ? t("sc_login_open") : t("sc_login_btn")}
      </Link>
      {!user && <a href={waLink(t("sc_corp_text"))} target="_blank" rel="noreferrer" className="block text-center text-xs text-slate-500 mt-3 hover:text-primary">{t("sc_login_noAcc")}</a>}
    </div>
  );
}

export function CorporatePanel() {
  const { t } = useLanguage();
  const points = [["task_alt", t("sc_corp_1")], ["account_tree", t("sc_corp_2")], ["receipt_long", t("sc_corp_3")], ["contract", t("sc_corp_4")]];
  return (
    <div>
      <p className="text-sm text-slate-600 -mt-1 mb-3">{t("sc_corp_sub")}</p>
      <ul className="space-y-2">
        {points.map(([icon, txt], i) => (
          <li key={txt} className="flex gap-2.5 items-center text-sm gs-pop" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>{txt}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <a href={waLink(t("sc_corp_text"))} target="_blank" rel="noreferrer" className={btnPrimary}>{t("sc_corp_cta")}</a>
        <Link to="/admin/login" className={btnGhost}>{t("sc_login_btn")}</Link>
      </div>
    </div>
  );
}
