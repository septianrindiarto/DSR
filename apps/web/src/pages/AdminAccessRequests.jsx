import { useState, useEffect } from "react";
import AdminLayout from "../components/AdminLayout";
import { useLanguage } from "../context/LanguageContext";
import { api, apiCache, swr } from "../lib/api";

// ─── /admin/access-requests ────────────────────────────────────────────────
// Phase 3 — admin queue for pending feature-access requests submitted by
// clients via RequestAccessModal. Approving flips the requester's
// user.permissions JSON; rejecting just marks the row.

export default function AdminAccessRequests() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(() => apiCache.get("accessReq:pending") || []);
  const [loading, setLoading] = useState(() => !apiCache.has("accessReq:pending"));
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  function load() {
    swr("accessReq:pending", () => api.accessRequests.listPending(), (data) => {
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    }).catch((err) => {
      console.error("Failed to load access requests:", err);
      setLoading(false);
    });
  }

  async function handleDecision(id, action) {
    setError("");
    setPendingId(id);
    try {
      if (action === "approve") await api.accessRequests.approve(id);
      else await api.accessRequests.reject(id);
      apiCache.invalidate("accessReq:");
      load();
    } catch (err) {
      setError(err.message || t("errorGeneric"));
    } finally {
      setPendingId(null);
    }
  }

  const formatDateTime = (d) =>
    d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";

  return (
    <AdminLayout>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("accessRequests")}</h1>
        <p className="text-slate-500 text-sm mt-1">
          Setujui atau tolak permintaan akses fitur dari pengguna.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {error}
        </div>
      )}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">{t("requester")}</th>
                <th className="px-5 py-3 text-left font-semibold">{t("feature")}</th>
                <th className="px-5 py-3 text-left font-semibold">{t("requestedAt")}</th>
                <th className="px-5 py-3 text-left font-semibold">Catatan</th>
                <th className="px-5 py-3 text-center font-semibold">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      {t("loading")}
                    </span>
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                    {t("noData")}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-slate-800">{row.userName || "-"}</p>
                    <p className="text-xs text-slate-400">{row.userEmail || "-"}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 uppercase">
                      <span className="material-symbols-outlined text-[14px]">key</span>
                      {t(row.featureKey) || row.featureKey}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                    {formatDateTime(row.requestedAt)}
                  </td>
                  <td className="px-5 py-3 text-slate-600 max-w-xs">
                    {row.note ? (
                      <span className="italic">"{row.note}"</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleDecision(row.id, "approve")}
                        disabled={pendingId === row.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">check_circle</span>
                        {t("approve")}
                      </button>
                      <button
                        onClick={() => handleDecision(row.id, "reject")}
                        disabled={pendingId === row.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 disabled:opacity-50 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">cancel</span>
                        {t("reject")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}
