import { useRef, useState } from "react";

// Button for anything that talks to the server. While onClick's promise is
// running it is disabled, shows a spinner + busyText, and ignores more clicks
// (the ref blocks a double click before React re-renders).
//
//   <AsyncButton onClick={save} busyText="Menyimpan…" className="…">Simpan</AsyncButton>
//
// `busy` lets a parent force the state (e.g. a form whose submit lives elsewhere).
// type="submit" is supported: pass onClick={undefined} and busy={saving}.
export default function AsyncButton({ onClick, busy: busyProp, busyText, disabled, children, className = "", type = "button", ...rest }) {
  const [busySelf, setBusySelf] = useState(false);
  const running = useRef(false);
  const busy = !!busyProp || busySelf;

  async function handle(e) {
    if (running.current || busy) { e.preventDefault(); return; }
    if (!onClick) return;
    running.current = true; setBusySelf(true);
    try { await onClick(e); }
    finally { running.current = false; setBusySelf(false); }
  }

  return (
    <button
      type={type}
      {...rest}
      onClick={handle}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${className} ${busy ? "cursor-wait opacity-70" : ""} disabled:cursor-not-allowed`}
    >
      {busy ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Spinner />
          {busyText || children}
        </span>
      ) : children}
    </button>
  );
}

export function Spinner({ className = "w-4 h-4" }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
