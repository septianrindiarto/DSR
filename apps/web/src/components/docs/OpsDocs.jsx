// ─── Dokumen → lembur & SPPD documents (invoice enclosures) ──────────────────
// Adapted from the client's monitoring sheets (Form SPPD, Form LEMBUR DRIVER,
// Rekap SPPD, Rekap Lembur). Data comes from Rekap Operasional & Lembur
// (contract + period, or one R code); every document is still produced only
// here in Dokumen (X-05).
//   spkl          Surat Perintah Kerja Lembur + laporan hasil (one entry)
//   sppd          Surat Perintah Perjalanan Dinas (one entry)
//   rekap_lembur  Rekap lembur per driver (one page per driver) — lampiran
//   rekap_sppd    Rekapitulasi SPPD pengemudi (+ lembur, total)  — lampiran
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";
import { policyOf, hourlyRateOf, lodgingClaimed, hhmm } from "../../lib/ops";


const KIND_OF = { spkl: "overtime", sppd: "trip", rekap_lembur: "overtime", rekap_sppd: "trip" };
const OK_STATUS = new Set(["verified", "in_recap", "approved", "billed"]);
const lab = (children) => <span className="block text-xs font-medium text-slate-600 mb-1">{children}</span>;

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const dt = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`) : null);
const fmtLong = (iso) => { const d = dt(iso); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "…………"; };
const fmtDay = (iso) => { const d = dt(iso); return d ? `${DAYS[d.getDay()]}, ${fmtLong(iso)}` : "…………"; };
const fmtShort = (iso) => { const d = dt(iso); return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : ""; };
const periodLabel = (p) => (p ? `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`.toUpperCase() : "");
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const num = (n) => Math.round(Number(n) || 0).toLocaleString("id-ID");
const hrs = (h) => (h ? String(Math.round(h * 100) / 100).replace(".", ",") : "");


// ─── Form (left column): pick source data + header fields ──────────────────
export function OpsDocForm({ docType, form, setForm }) {
  const toast = useToast();
  const [contracts, setContracts] = useState([]);
  const [recaps, setRecaps] = useState([]);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const kind = KIND_OF[docType];
  const single = docType === "spkl" || docType === "sppd";
  const upd = (patch) => setForm({ ...form, ...patch });
  const contract = contracts.find((c) => String(c.id) === String(form.contractId));

  useEffect(() => { api.ops.contracts().then((r) => setContracts(r.data || [])).catch((e) => toast.error(e.message)); }, [toast]);
  useEffect(() => {
    if (!form.contractId) { setRecaps([]); setEntries([]); return; }
    if (!single) api.ops.recaps({ contractId: form.contractId }).then((r) => setRecaps((r.data || []).filter((x) => x.kind === kind && x.status !== "cancelled"))).catch(() => setRecaps([]));
    else api.ops.list({ contractId: form.contractId, period: form.period, kind }).then((r) => setEntries((r.data || []).filter((e) => e.status !== "draft"))).catch(() => setEntries([]));
  }, [form.contractId, form.period, kind, single]);

  async function load(entryId = form.entryId) {
    if (!contract) { toast.error("Pilih kontrak dulu."); return; }
    setBusy(true);
    try {
      const policy = policyOf(contract.policy);
      const base = { contract: { contractNumber: contract.contractNumber, clientName: contract.clientName, workStart: contract.workStart, workEnd: contract.workEnd }, policy };
      if (single) {
        const e = entries.find((x) => String(x.id) === String(entryId));
        if (!e) { toast.error("Pilih data dulu."); return; }
        upd({ entryId, city: form.city || policy.sign.city, date: form.date || todayISO(), loaded: { ...base, entry: e } });
        return;
      }
      const filter = (list) => list.filter((e) => (form.onlyApproved ? ["approved", "billed"].includes(e.status) : OK_STATUS.has(e.status)));
      const main = form.recapId
        ? (await api.ops.list({ recapId: form.recapId })).data
        : (await api.ops.list({ contractId: form.contractId, period: form.period, kind })).data;
      const recap = recaps.find((r) => String(r.id) === String(form.recapId));
      let overtime = [];
      if (docType === "rekap_sppd") overtime = filter((await api.ops.list({ contractId: form.contractId, period: recap?.period || form.period, kind: "overtime" })).data || []);
      upd({ city: form.city || policy.sign.city, loaded: { ...base, period: recap?.period || form.period, recapCode: recap?.code || "", range: recap ? { from: recap.dateFrom, to: recap.dateTo } : null, entries: filter(main || []).filter((e) => e.kind === kind), overtime } });
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }

  const inp = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary outline-none";
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
        <p className="text-xs font-bold text-slate-600">Ambil data dari Lembur & Operasional</p>
        <label className="block">{lab("Kontrak")}
          <select className={inp} value={form.contractId} onChange={(e) => upd({ contractId: e.target.value, recapId: "", entryId: "", loaded: null })}>
            <option value="">— Pilih kontrak —</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.contractNumber} · {c.clientName}</option>)}
          </select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">{lab("Periode")}<input type="month" className={inp} value={form.period} onChange={(e) => upd({ period: e.target.value, recapId: "", entryId: "", loaded: null })} /></label>
          {!single && (
            <label className="block">{lab("Kode rekap (opsional)")}
              <select className={inp} value={form.recapId} onChange={(e) => upd({ recapId: e.target.value, loaded: null })}>
                <option value="">Semua data periode</option>
                {recaps.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.period} · {r.status}</option>)}
              </select></label>
          )}
        </div>
        {single ? (
          <label className="block">{lab(docType === "spkl" ? "Data lembur" : "Data perjalanan dinas")}
            <select className={inp} value={form.entryId} onChange={(e) => load(e.target.value)}>
              <option value="">— Pilih —</option>
              {entries.map((e) => <option key={e.id} value={e.id}>{fmtShort(e.entryDate)} · {e.driverName || "-"} · {e.plate || ""}{e.kind === "trip" ? ` · ${e.detail?.destinationCity || ""}` : ` · ${e.hours ?? 0} jam`}</option>)}
            </select></label>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={form.onlyApproved} onChange={(e) => upd({ onlyApproved: e.target.checked, loaded: null })} />Hanya yang sudah disetujui klien</label>
            <button type="button" onClick={() => load()} disabled={busy || !form.contractId} className="w-full py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer">{busy ? "Memuat…" : "Ambil data"}</button>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">{lab("Kota tanda tangan")}<input className={inp} value={form.city} onChange={(e) => upd({ city: e.target.value })} placeholder="Bandung" /></label>
        <label className="block">{lab("Tanggal tanda tangan")}<input type="date" className={inp} value={form.date} onChange={(e) => upd({ date: e.target.value })} /></label>
        {!single && <label className="block col-span-2">{lab("Lampiran untuk invoice no. (opsional)")}<input className={inp} value={form.invoiceNo} onChange={(e) => upd({ invoiceNo: e.target.value })} /></label>}
      </div>
      {form.loaded && !single && <p className="text-xs text-slate-500">{form.loaded.entries.length} baris dimuat{form.loaded.recapCode ? ` dari ${form.loaded.recapCode}` : ""}.</p>}
      <p className="text-[11px] text-slate-400">Tarif, uang harian, dan nama penandatangan diambil dari matriks lembur & perjalanan dinas di kontrak.</p>
    </div>
  );
}

// ─── Templates (right column / print) ──────────────────────────────────────
const box = { fontSize: "10pt", lineHeight: 1.45 };
const cell = { border: "0.5pt solid #000", padding: "3pt 5pt", verticalAlign: "middle" };
const th = { ...cell, fontWeight: "bold", textAlign: "center", background: "#f1f1f1" };
const Empty = () => <div className="doc-page doc-page-a4" style={{ ...box, color: "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>Pilih kontrak & data di kiri.</div>;

function Signatures({ sign, city, date, executor }) {
  const col = (title, name) => (
    <div style={{ textAlign: "center", width: "55mm" }}>
      <div>{title},</div>
      <div style={{ height: "20mm" }} />
      <div>( {name || "…................................."} )</div>
    </div>
  );
  return (
    <div style={{ marginTop: "8mm" }}>
      <div style={{ textAlign: "right", marginBottom: "2mm" }}>{city || "Bandung"}, {fmtLong(date)}</div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {col("Menyetujui", sign.approverTitle)}
        {col("Mengetahui", sign.knowerTitle)}
        {col("Pelaksana", executor || sign.executorTitle)}
      </div>
    </div>
  );
}

function Row({ label, value, w = "48mm" }) {
  return <div style={{ display: "flex" }}><div style={{ width: w }}>{label}</div><div style={{ width: "4mm" }}>:</div><div style={{ flex: 1, fontWeight: 600 }}>{value || "…………………………"}</div></div>;
}

function SpklTemplate({ form }) {
  const L = form.loaded;
  if (!L?.entry) return <Empty />;
  const e = L.entry, d = e.detail || {}, s = L.policy.sign;
  const rows = d.rows?.length ? d.rows : [{ start: e.startTime, end: e.endTime }];
  const calc = d.calc || {};
  const DT = { workday: "Hari kerja", restday: "Libur mingguan", holiday: "Libur nasional" };
  const period = d.startDate && d.endDate && d.endDate !== d.startDate ? `${fmtDay(d.startDate)} s/d ${fmtDay(d.endDate)}` : fmtDay(d.startDate || e.entryDate);
  const byMult = (calc.byMult || []).filter((x) => x.hours > 0);
  return (
    <div className="doc-page doc-page-a4" style={box}>
      <div style={{ textAlign: "center", fontSize: "13pt", fontWeight: "bold", textDecoration: "underline", marginBottom: "6mm" }}>SURAT PERINTAH KERJA LEMBUR</div>
      <div style={{ marginBottom: "1mm" }}>Diperintahkan kepada :</div>
      <Row label="Nama" value={e.driverName} />
      <Row label="No. Pol Kendaraan" value={e.plate} />
      <div style={{ margin: "4mm 0 1mm" }}>Untuk melaksanakan kerja lembur pada :</div>
      <Row label="Hari / Tanggal" value={period} />
      <Row label="Lokasi Kerja Lembur" value={d.location} />
      <Row label="Total Lembur" value={e.hours ? `${hhmm(e.hours)} jam` : ""} />
      <Row label="Kontrak / Klien" value={`${L.contract.contractNumber} · ${L.contract.clientName}`} />
      <div style={{ textAlign: "center", fontSize: "12pt", fontWeight: "bold", textDecoration: "underline", margin: "8mm 0 3mm" }}>DETAIL LEMBUR</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}>
        <thead>
          <tr><th style={th}>NO</th><th style={th}>TANGGAL</th><th style={th}>JENIS HARI</th><th style={th}>MULAI</th><th style={th}>SELESAI</th><th style={th}>MENUNGGU</th><th style={th}>LOKASI KERJA</th><th style={th}>URAIAN PEKERJAAN</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ ...cell, textAlign: "center" }}>{i + 1}</td>
              <td style={{ ...cell, textAlign: "center", whiteSpace: "nowrap" }}>{fmtShort(r.date || d.startDate || e.entryDate)}</td>
              <td style={{ ...cell, textAlign: "center" }}>{DT[r.dayType || e.dayType] || ""}</td>
              <td style={{ ...cell, textAlign: "center" }}>{r.start}</td>
              <td style={{ ...cell, textAlign: "center" }}>{r.end}</td>
              <td style={{ ...cell, textAlign: "center" }}>{r.waitMinutes ? hhmm(r.waitMinutes / 60) : "-"}</td>
              <td style={cell}>{r.location}</td>
              <td style={cell}>{r.description}</td>
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 4 - rows.length) }, (_, i) => <tr key={`b${i}`}>{Array.from({ length: 8 }, (__, j) => <td key={j} style={{ ...cell, height: "7mm" }} />)}</tr>)}
        </tbody>
      </table>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9.5pt", marginTop: "3mm" }}>
        <tbody>
          <tr>
            <td style={{ ...cell, fontWeight: "bold", width: "40%" }}>Lembur mengemudi (setelah pembulatan{calc.breakMinutes ? " & istirahat" : ""})</td>
            <td style={cell}>{byMult.length ? byMult.map((x) => `${hhmm(x.hours)} × ${String(x.mult).replace(".", ",")}`).join("   ·   ") : `${hhmm(calc.driveHours)}`}</td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: "bold" }}>Menunggu</td>
            <td style={cell}>{hhmm(calc.waitHours)}{calc.waitingPct != null ? ` × ${calc.waitingPct}%` : ""}</td>
          </tr>
          <tr>
            <td style={{ ...cell, fontWeight: "bold" }}>Total jam lembur</td>
            <td style={{ ...cell, fontWeight: "bold" }}>{hhmm(e.hours)}</td>
          </tr>
        </tbody>
      </table>
      <Signatures sign={s} city={form.city} date={form.date} executor={e.driverName} />
      <div style={{ fontSize: "8.5pt", marginTop: "8mm", fontStyle: "italic" }}>Surat Perintah Kerja Lembur dan Hasil Kerja Lembur harus diserahkan setiap hari setelah melaksanakan kerja lembur atau selambat-lambatnya 2 x 24 jam ke {s.approverTitle}.</div>
    </div>
  );
}

function SppdTemplate({ form }) {
  const L = form.loaded;
  if (!L?.entry) return <Empty />;
  const e = L.entry, d = e.detail || {}, s = L.policy.sign;
  const legs = d.legs?.length ? d.legs : [];
  const blank = Math.max(0, 4 - legs.length);
  return (
    <div className="doc-page doc-page-a4" style={box}>
      <div style={{ textAlign: "center", fontSize: "13pt", fontWeight: "bold", textDecoration: "underline" }}>SURAT PERINTAH PERJALANAN DINAS</div>
      <div style={{ marginBottom: "6mm" }} />
      <div style={{ fontWeight: "bold" }}>MEMERINTAHKAN KEPADA</div>
      <Row label="Nama" value={e.driverName} />
      <div style={{ fontWeight: "bold", marginTop: "4mm" }}>UNTUK MELAKUKAN PERJALANAN DINAS</div>
      <Row label="Kota Tujuan" value={d.destinationCity} />
      <Row label="Lokasi Tugas" value={d.taskLocation} />
      <div style={{ display: "flex", gap: "6mm" }}>
        <div style={{ flex: 1 }}><Row label="Tanggal Berangkat" value={fmtShort(d.departDate)} /></div>
        <div style={{ flex: 1 }}><Row label="Tanggal Kembali" value={fmtShort(d.returnDate)} w="30mm" /></div>
        <div style={{ width: "30mm" }}>Lamanya <b>{d.calc?.days || ""}</b> Hari</div>
      </div>
      <Row label="No. Polisi Kendaraan" value={e.plate} />
      <Row label="User / Kontrak" value={[d.userName, `${L.contract.contractNumber} · ${L.contract.clientName}`].filter(Boolean).join(" · ")} />
      <div style={{ fontWeight: "bold", marginTop: "4mm", marginBottom: "2mm" }}>PELAKSANAAN PERJALANAN DINAS</div>
      {[...legs, ...Array.from({ length: blank }, () => ({}))].map((l, i) => (
        <div key={i} style={{ display: "flex", gap: "6mm", marginBottom: "3mm" }}>
          <div style={{ flex: 1 }}>
            <Row label="Tiba di" value={l.arrivedAt} w="22mm" />
            <Row label="Tanggal" value={l.date ? fmtShort(l.date) : ""} w="22mm" />
          </div>
          <div style={{ flex: 1.3 }}>
            <Row label="Penginapan diganti" value={l.lodging === undefined || l.lodging === "" ? "Ya / Tidak *" : lodgingClaimed(l.lodging) ? "Ya" : "Tidak"} w="30mm" />
          </div>
        </div>
      ))}
      <div style={{ textAlign: "right", fontSize: "8.5pt" }}>* : pilih salah satu</div>
      <Signatures sign={s} city={form.city} date={form.date} executor={e.driverName} />
      <div style={{ fontSize: "8.5pt", marginTop: "8mm", fontStyle: "italic" }}>Pertanggungjawaban surat perintah perjalanan dinas ini harus diisi lengkap dan diserahkan setiap hari setelah selesai melaksanakan perjalanan dinas atau selambat-lambatnya 2 x 24 jam ke {s.approverTitle}.</div>
    </div>
  );
}

function RekapHeader({ form, header, title }) {
  const L = form.loaded;
  return (
    <>
      {header}
      <div style={{ textAlign: "center", fontSize: "12.5pt", fontWeight: "bold", margin: "4mm 0 1mm" }}>{title}</div>
      <div style={{ textAlign: "center", fontSize: "9.5pt" }}>
        Periode {periodLabel(L.period)}{L.range ? ` (${fmtShort(L.range.from)} – ${fmtShort(L.range.to)})` : ""} · Kontrak {L.contract.contractNumber} · {L.contract.clientName}
        {L.recapCode ? ` · Rekap ${L.recapCode}` : ""}{form.invoiceNo ? ` · Lampiran Invoice ${form.invoiceNo}` : ""}
      </div>
    </>
  );
}

function ApproverBlock({ sign, city, date }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8mm" }}>
      <div style={{ textAlign: "center", width: "70mm" }}>
        <div>{city || "Bandung"}, {fmtLong(date)}</div>
        <div>Menyetujui,</div>
        <div style={{ height: "20mm" }} />
        <div style={{ fontWeight: "bold", textDecoration: "underline" }}>{sign.approverName || "…................................."}</div>
        <div>{sign.approverPosition || sign.approverTitle}</div>
      </div>
    </div>
  );
}

function RekapLemburTemplate({ form, header }) {
  const L = form.loaded;
  const byDriver = useMemo(() => {
    const m = new Map();
    for (const e of L?.entries || []) {
      const k = e.driverName || "-";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()].map(([name, list]) => [name, list.sort((a, b) => a.entryDate.localeCompare(b.entryDate))]);
  }, [L]);
  if (!L?.entries) return <Empty />;
  if (!byDriver.length) return <div className="doc-page doc-page-a4" style={box}><RekapHeader form={form} header={header} title="REKAP LEMBUR" /><p style={{ marginTop: "10mm", textAlign: "center" }}>Tidak ada data lembur.</p></div>;
  const o = L.policy.overtime;
  const hourly = hourlyRateOf(L.policy) ?? 0;
  const waitRate = o.waitingRate != null ? Number(o.waitingRate) : hourly;
  // hours per multiplier for one entry (multi-day form: calc.byMult; one-day: calc.tiers.split; older: h15/h2/h3/h4)
  const byMult = (e) => {
    const c = e.detail?.calc || {}, tr = c.tiers || {}, out = {};
    if (Array.isArray(c.byMult)) c.byMult.forEach((x) => { out[x.mult] = (out[x.mult] || 0) + (x.hours || 0); });
    else if (Array.isArray(tr.split)) tr.split.forEach((x) => { out[x.mult] = (out[x.mult] || 0) + (x.hours || 0); });
    else [[1.5, tr.h15], [2, tr.h2], [3, tr.h3], [4, tr.h4]].forEach(([m, h]) => { if (h) out[m] = (out[m] || 0) + h; });
    return out;
  };
  const tierText = (list) => list.map((x) => `jam ${x.from}–${x.to ?? "…"} ×${String(x.mult).replace(".", ",")}`).join(", ");
  return (
    <>
      {byDriver.map(([name, list], pi) => {
        const rows = list.map((e) => ({ e, m: byMult(e) }));
        const mults = [...new Set(rows.flatMap((r) => Object.keys(r.m).map(Number)))].sort((a, b) => a - b);
        const t = rows.reduce((a, { e, m }) => {
          mults.forEach((k) => { a.m[k] = (a.m[k] || 0) + (m[k] || 0); });
          return { ...a, hours: a.hours + (e.hours || 0), w: a.w + (e.detail?.calc?.waitHours || 0), amount: a.amount + (e.amount || 0) };
        }, { hours: 0, w: 0, amount: 0, m: {} });
        const plate = [...new Set(list.map((e) => e.plate).filter(Boolean))].join(", ");
        const line = (label, h, mult, rate) => (
          <tr key={label}><td style={cell}>{label}</td><td style={{ ...cell, textAlign: "right" }}>{hrs(h) || 0}</td><td style={{ ...cell, textAlign: "center" }}>×</td>
            <td style={{ ...cell, textAlign: "right" }}>{String(mult).replace(".", ",")}</td><td style={{ ...cell, textAlign: "center" }}>×</td>
            <td style={{ ...cell, textAlign: "right" }}>{num(rate)}</td><td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{num(h * mult * rate)}</td></tr>
        );
        return (
          <div key={name} className="doc-page doc-page-a4" style={{ ...box, fontSize: "9.5pt", pageBreakAfter: pi < byDriver.length - 1 ? "always" : "auto" }}>
            <RekapHeader form={form} header={header} title={`LEMBUR PERIODE ${periodLabel(L.period)}`} />
            <div style={{ display: "flex", justifyContent: "space-between", margin: "5mm 0 3mm" }}>
              <div><Row label="NAMA" value={name} w="30mm" /><Row label="KENDARAAN" value={plate} w="30mm" /></div>
              {hourly > 0 && <div>{o.baseSalary != null && o.hourlyRate == null && <Row label="GAJI POKOK" value={rp(o.baseSalary)} w="34mm" />}<Row label="UPAH PER JAM" value={`${rp(hourly)}${o.hourlyRate == null && o.divisor ? ` (÷${o.divisor})` : ""}`} w="34mm" /></div>}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>TANGGAL</th><th style={th}>JAM</th><th style={th}>JAM KERJA</th>
                {mults.map((k) => <th key={k} style={th}>× {String(k).replace(".", ",")}</th>)}
                <th style={th}>MENUNGGU {o.waitingPct ?? 0}%</th><th style={th}>TOTAL JAM</th>
              </tr></thead>
              <tbody>
                {rows.map(({ e, m }) => (
                  <tr key={e.id}>
                    <td style={cell}>{fmtShort(e.entryDate)}{e.dayType !== "workday" ? " (libur)" : ""}</td>
                    <td style={{ ...cell, textAlign: "center" }}>{e.startTime}–{e.endTime}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{hrs(e.hours)}</td>
                    {mults.map((k) => <td key={k} style={{ ...cell, textAlign: "right" }}>{hrs(m[k])}</td>)}
                    <td style={{ ...cell, textAlign: "right" }}>{hrs(e.detail?.calc?.waitHours)}</td><td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{hrs(e.hours)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: "bold" }}>
                  <td style={cell} colSpan={2}>TOTAL WAKTU LEMBUR</td><td style={{ ...cell, textAlign: "right" }}>{hrs(t.hours)}</td>
                  {mults.map((k) => <td key={k} style={{ ...cell, textAlign: "right" }}>{hrs(t.m[k])}</td>)}
                  <td style={{ ...cell, textAlign: "right" }}>{hrs(t.w)}</td><td style={{ ...cell, textAlign: "right" }}>{hrs(t.hours)}</td>
                </tr>
              </tbody>
            </table>
            {hourly > 0 ? (
              <table style={{ width: "75%", borderCollapse: "collapse", marginTop: "5mm" }}>
                <tbody>
                  {mults.map((k) => line(`JAM × ${String(k).replace(".", ",")}`, t.m[k] || 0, k, hourly))}
                  {line(`KOMPENSASI MENUNGGU (${o.waitingPct ?? 0}%)`, t.w, (Number(o.waitingPct) || 0) / 100, waitRate)}
                  <tr style={{ fontWeight: "bold" }}><td style={cell} colSpan={6}>TOTAL UPAH LEMBUR</td><td style={{ ...cell, textAlign: "right" }}>{rp(t.amount)}</td></tr>
                </tbody>
              </table>
            ) : (
              <p style={{ marginTop: "5mm", fontWeight: "bold" }}>TOTAL JAM LEMBUR: {hrs(t.hours)} jam</p>
            )}
            <div style={{ fontSize: "8pt", color: "#444", marginTop: "4mm", lineHeight: 1.35 }}>
              Ketentuan kontrak — hari kerja: {tierText(o.tiers.workday) || "-"}; libur mingguan: {tierText(o.tiers.restday) || "-"}; libur nasional: {tierText(o.tiers.holiday) || "-"}.
              {o.breakEvery > 0 ? ` Setiap ${o.breakEvery} jam lembur dipotong ${o.breakHours ?? 1} jam istirahat.` : ""}
              {o.rounding?.length ? ` Pembulatan sisa menit: ${o.rounding.map((b) => `${b.from}–${b.to} mnt = ${String(b.hours).replace(".", ",")} jam`).join(", ")}.` : ""}
            </div>
            <ApproverBlock sign={L.policy.sign} city={form.city} date={form.date} />
          </div>
        );
      })}
    </>
  );
}

function RekapSppdTemplate({ form, header }) {
  const L = form.loaded;
  if (!L?.entries) return <div className="doc-page doc-page-a4-land" style={{ ...box, color: "#888" }}>Pilih kontrak lalu klik "Ambil data".</div>;
  const drivers = [...new Set([...L.entries.map((e) => e.driverName || "-")])];
  const otBy = new Map();
  for (const e of L.overtime || []) otBy.set(e.driverName || "-", (otBy.get(e.driverName || "-") || 0) + (e.amount || 0));
  let no = 0, grand = 0;
  const c = { ...cell, fontSize: "8.5pt" };
  return (
    <div className="doc-page doc-page-a4-land" style={{ ...box, fontSize: "9pt" }}>
      <RekapHeader form={form} header={header} title="REKAPITULASI PERJALANAN DINAS PENGEMUDI" />
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "4mm" }}>
        <thead><tr>
          {["NO", "NAMA", "USER", "TUJUAN", "SEKTOR", "BERANGKAT", "KEMBALI", "LAMA / HARI", "HARIAN", "PENGGANTI PENGINAPAN", "JUMLAH", "JUMLAH AKHIR", "LEMBUR", "TOTAL KESELURUHAN"].map((h) => <th key={h} style={{ ...th, fontSize: "8pt" }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {drivers.map((name) => {
            const list = L.entries.filter((e) => (e.driverName || "-") === name).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
            const sub = list.reduce((t, e) => t + (e.amount || 0), 0);
            const ot = otBy.get(name) || 0;
            grand += sub + ot;
            no += 1;
            return list.map((e, i) => {
              const d = e.detail || {}, k = d.calc || {};
              return (
                <tr key={e.id}>
                  {i === 0 && <td style={{ ...c, textAlign: "center" }} rowSpan={list.length}>{no}</td>}
                  {i === 0 && <td style={c} rowSpan={list.length}>{name}</td>}
                  <td style={c}>{d.userName || ""}</td><td style={c}>{d.destinationCity || ""}</td><td style={c}>{d.sector || ""}</td>
                  <td style={{ ...c, textAlign: "center" }}>{fmtShort(d.departDate)}</td><td style={{ ...c, textAlign: "center" }}>{fmtShort(d.returnDate)}</td>
                  <td style={{ ...c, textAlign: "center" }}>{k.days || ""}</td><td style={{ ...c, textAlign: "right" }}>{num(k.dailyAllowance)}</td>
                  <td style={{ ...c, textAlign: "right" }}>{num(k.lodging)}</td><td style={{ ...c, textAlign: "right" }}>{num(e.amount)}</td>
                  {i === 0 && <td style={{ ...c, textAlign: "right", fontWeight: 600 }} rowSpan={list.length}>{num(sub)}</td>}
                  {i === 0 && <td style={{ ...c, textAlign: "right" }} rowSpan={list.length}>{ot ? num(ot) : "-"}</td>}
                  {i === 0 && <td style={{ ...c, textAlign: "right", fontWeight: "bold" }} rowSpan={list.length}>{num(sub + ot)}</td>}
                </tr>
              );
            });
          })}
          {drivers.length === 0 && <tr><td style={{ ...c, textAlign: "center" }} colSpan={14}>Tidak ada data perjalanan dinas.</td></tr>}
          <tr style={{ fontWeight: "bold" }}><td style={c} colSpan={13}>TOTAL</td><td style={{ ...c, textAlign: "right" }}>{rp(grand)}</td></tr>
        </tbody>
      </table>
      <ApproverBlock sign={L.policy.sign} city={form.city} date={form.date} />
    </div>
  );
}

export function OpsDocTemplate({ docType, form, header }) {
  if (docType === "spkl") return <SpklTemplate form={form} />;
  if (docType === "sppd") return <SppdTemplate form={form} />;
  if (docType === "rekap_lembur") return <RekapLemburTemplate form={form} header={header} />;
  if (docType === "rekap_sppd") return <RekapSppdTemplate form={form} header={header} />;
  return null;
}
