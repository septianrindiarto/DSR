import { useEffect, useState } from "react";
import { apiActivity } from "../lib/api";

// Thin bar at the very top of the window while the app talks to the server.
// Saves (POST/PUT/DELETE) show immediately in the brand colour; plain loads
// only after 400 ms so fast page loads don't flicker.
export default function ApiActivityBar() {
  const [state, setState] = useState(apiActivity.get());
  const [showReads, setShowReads] = useState(false);

  useEffect(() => apiActivity.subscribe(setState), []);
  useEffect(() => {
    if (state.reads === 0) { const t = setTimeout(() => setShowReads(false), 0); return () => clearTimeout(t); }
    const t = setTimeout(() => setShowReads(true), 400);
    return () => clearTimeout(t);
  }, [state.reads]);

  const writing = state.writes > 0;
  if (!writing && !(showReads && state.reads > 0)) return null;
  return (
    <div className="fixed top-0 left-0 right-0 h-[3px] z-[100] overflow-hidden pointer-events-none" role="progressbar" aria-label={writing ? "Menyimpan" : "Memuat"}>
      <div className={`h-full w-1/3 animate-[dsrbar_1.1s_ease-in-out_infinite] ${writing ? "bg-primary" : "bg-slate-400"}`} />
      <style>{"@keyframes dsrbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}
