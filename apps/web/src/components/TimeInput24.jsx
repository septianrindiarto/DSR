import { useState } from "react";

// 24-hour time field "HH:MM" (owner 2026-11-13): no AM/PM, no browser time
// picker — type "0600", "6", "6:5" or "18.30"; it is tidied on blur.
// value / onChange use "HH:MM" (or "" when empty).
function normalizeHM(raw) {
  const s = String(raw || "").trim().replace(/[.,h ]/g, ":");
  if (!s) return "";
  let h, m;
  if (s.includes(":")) [h, m] = s.split(":");
  else if (s.length <= 2) { h = s; m = "0"; }
  else { h = s.slice(0, s.length - 2); m = s.slice(-2); }
  const hh = Number(h), mm = Number(m || 0);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function TimeInput24({ value, onChange, className = "", disabled = false, placeholder = "HH:MM", ...rest }) {
  const [text, setText] = useState(value || "");
  const [bad, setBad] = useState(false);
  // Follow the parent's value when it changes (adjust state during render).
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setText(value || ""); setBad(false); }
  const commit = () => {
    const v = normalizeHM(text);
    if (v === null) { setBad(true); return; }
    setBad(false); setText(v);
    if (v !== (value || "")) onChange(v);
  };
  return (
    <input
      {...rest}
      type="text" inputMode="numeric" maxLength={5} placeholder={placeholder} disabled={disabled}
      value={text}
      onChange={(e) => { setText(e.target.value.replace(/[^0-9:.]/g, "")); setBad(false); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      className={`${className} font-mono tabular-nums ${bad ? "border-red-400 ring-1 ring-red-200" : ""}`}
      title={bad ? "Format 24 jam HH:MM, mis. 06:00 atau 18:30" : undefined}
    />
  );
}
