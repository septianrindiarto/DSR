import { createContext, useContext, useState, useCallback, useEffect } from "react";

// Toast notification system (audit M-08).
// Replaces native alert() calls across the app. The provider mounts once at
// the App root; useToast() exposes success/error/info/warning helpers.
//
//   import { useToast } from "../components/Toast";
//   const toast = useToast();
//   toast.success("Tersimpan");
//   toast.error("Gagal: " + err.message);
//
// Toasts auto-dismiss after 4 seconds. Multiple toasts stack vertically in
// the top-right corner. Each toast can be dismissed by tapping the X.

const ToastContext = createContext(null);

let _toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((variant, message, opts = {}) => {
    const id = ++_toastId;
    const duration = opts.duration || 4000;
    setToasts(prev => [...prev, { id, variant, message }]);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const api = {
    success: (msg, opts) => push("success", msg, opts),
    error:   (msg, opts) => push("error",   msg, opts),
    info:    (msg, opts) => push("info",    msg, opts),
    warning: (msg, opts) => push("warning", msg, opts),
    dismiss,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Soft fallback — should never fire once all pages are inside
    // ToastProvider. Uses console.warn (never console.log in shipped code).
    return {
      success: (m) => { console.warn("[toast:success] outside provider:", m); },
      error:   (m) => { console.error("[toast:error] outside provider:", m); },
      info:    (m) => { console.warn("[toast:info] outside provider:", m); },
      warning: (m) => { console.warn("[toast:warning] outside provider:", m); },
      dismiss: () => {},
    };
  }
  return ctx;
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Auto-leave animation hook (we just toggle a class; the dismiss timer
    // controls the actual removal from state).
  }, []);

  const styles = {
    success: { bg: "bg-emerald-50",  border: "border-emerald-200", text: "text-emerald-800", icon: "check_circle", iconColor: "text-emerald-500" },
    error:   { bg: "bg-red-50",      border: "border-red-200",     text: "text-red-800",     icon: "error",        iconColor: "text-red-500"     },
    info:    { bg: "bg-blue-50",     border: "border-blue-200",    text: "text-blue-800",    icon: "info",         iconColor: "text-blue-500"    },
    warning: { bg: "bg-amber-50",    border: "border-amber-200",   text: "text-amber-800",   icon: "warning",      iconColor: "text-amber-500"   },
  };
  const s = styles[toast.variant] || styles.info;

  return (
    <div
      className={"pointer-events-auto rounded-lg border shadow-lg px-4 py-3 flex items-start gap-2 transition-all " + s.bg + " " + s.border + " " + s.text + " " + (leaving ? "opacity-0 translate-x-2" : "opacity-100")}
      role="status"
    >
      <span className={"material-symbols-outlined text-[20px] mt-0.5 " + s.iconColor}>{s.icon}</span>
      <div className="flex-1 text-sm">{toast.message}</div>
      <button
        onClick={() => { setLeaving(true); setTimeout(() => onDismiss(toast.id), 120); }}
        className="text-slate-400 hover:text-slate-600 cursor-pointer"
        aria-label="Close"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}
