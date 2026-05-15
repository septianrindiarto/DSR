const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

export default function PeriodSelector({ period, onChange }) {
  const { type, year, month, quarter, semester } = period;

  const setField = (k, v) => onChange({ ...period, [k]: v });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Period type */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
        {[
          { value: "monthly", label: "Bulanan" },
          { value: "quarterly", label: "Kuartal" },
          { value: "semesterly", label: "Semester" },
          { value: "yearly", label: "Tahunan" },
        ].map(t => (
          <button key={t.value} onClick={() => setField("type", t.value)}
            className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              type === t.value ? "bg-primary text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}>{t.label}</button>
        ))}
      </div>

      {/* Year — dynamic: 5 years back to 2 years ahead */}
      <select value={year} onChange={e => setField("year", Number(e.target.value))}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none">
        {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 5 + i)
          .map(y => <option key={y} value={y}>{y}</option>)}
      </select>

      {/* Month */}
      {type === "monthly" && (
        <select value={month} onChange={e => setField("month", Number(e.target.value))}
          className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none">
          <option value={0}>Semua Bulan</option>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
      )}

      {/* Quarter */}
      {type === "quarterly" && (
        <select value={quarter} onChange={e => setField("quarter", Number(e.target.value))}
          className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none">
          {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
        </select>
      )}

      {/* Semester */}
      {type === "semesterly" && (
        <select value={semester} onChange={e => setField("semester", Number(e.target.value))}
          className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none">
          <option value={1}>Semester 1 (Jan-Jun)</option>
          <option value={2}>Semester 2 (Jul-Des)</option>
        </select>
      )}
    </div>
  );
}
