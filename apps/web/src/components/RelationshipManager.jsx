import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";

// ─── Pengaturan → Mitra (Stage 2) ────────────────────────────────────────────
// Client POV: manage the agencies that serve you (add by Agency Code).
// Agency POV: manage your client companies (share your Agency Code; add a
// company client → approval email), plus your affiliate link for private
// clients. Client↔agency is many-to-many.
const statusBadge = {
  active:   "bg-green-100 text-green-700",
  pending:  "bg-amber-100 text-amber-700",
  archived: "bg-slate-100 text-slate-500",
};

export default function RelationshipManager() {
  const { user } = useAuth();
  const toast = useToast();
  const isAgency = user?.accountType === "agency" || user?.role === "superadmin";

  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [codeInput, setCodeInput] = useState("");   // client → agency code to add
  const [clientName, setClientName] = useState(""); // agency → client company to add
  const [myCode, setMyCode] = useState("");         // this agency's join code
  const [affiliate, setAffiliate] = useState("");   // this agent's affiliate code
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    try {
      const res = isAgency ? await api.myOrg.myClients() : await api.myOrg.myAgencies();
      setLinks(res?.data || []);
    } catch (e) { console.error("relationships:", e); } finally { setLoading(false); }
  }

  async function addAgency() {
    if (!codeInput.trim()) return;
    setBusy(true);
    try { await api.myOrg.addAgency(codeInput.trim()); toast.success("Agency ditambahkan."); setCodeInput(""); load(); }
    catch (e) { toast.error(e.message || "Gagal menambah agency."); } finally { setBusy(false); }
  }

  async function addClient() {
    if (!clientName.trim()) return;
    setBusy(true);
    try {
      const company = await api.companies.lookup(clientName.trim());
      const orgId = company?.id || company?.organizationId;
      if (!orgId) { toast.error("Perusahaan tidak ditemukan / belum terdaftar di platform."); return; }
      const res = await api.myOrg.addClient(orgId);
      toast.success(res?.emailed ? "Permintaan kemitraan dikirim ke email klien." : "Klien ditambahkan (menunggu persetujuan).");
      setClientName(""); load();
    } catch (e) { toast.error(e.message || "Gagal menambah klien."); } finally { setBusy(false); }
  }

  async function removeLink(id) {
    setBusy(true);
    try { await api.myOrg.removeLink(id); load(); }
    catch (e) { toast.error(e.message || "Gagal menghapus."); } finally { setBusy(false); }
  }

  async function genAgencyCode() { try { const r = await api.myOrg.agencyCode(); setMyCode(r.agencyCode); } catch (e) { toast.error(e.message); } }
  async function genAffiliate() { try { const r = await api.myOrg.affiliateCode(); setAffiliate(r.affiliateCode); } catch (e) { toast.error(e.message); } }

  const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none";
  const btnCls = "px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap cursor-pointer";

  return (
    <div className="space-y-4">
      {/* Codes (agency only) */}
      {isAgency && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Kode Anda</h2>
            <p className="text-xs text-slate-500 mt-0.5">Bagikan ke klien untuk menautkan akun mereka ke agency ini.</p>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kode Agency</label>
              <div className="flex gap-2">
                <input className={inputCls + " font-mono"} value={myCode} readOnly placeholder="— belum dibuat —" />
                <button className={btnCls} onClick={genAgencyCode}>{myCode ? "Perbarui" : "Buat"}</button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kode Affiliate (link privat)</label>
              <div className="flex gap-2">
                <input className={inputCls + " font-mono"} value={affiliate} readOnly placeholder="— belum dibuat —" />
                <button className={btnCls} onClick={genAffiliate}>{affiliate ? "Perbarui" : "Buat"}</button>
              </div>
              {affiliate && <p className="text-[11px] text-slate-400 mt-1">Link: <span className="font-mono">/?ref={affiliate}</span></p>}
            </div>
          </div>
        </div>
      )}

      {/* Links list */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">{isAgency ? "Klien Anda" : "Agency Anda"}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAgency ? "Perusahaan klien yang Anda layani." : "Agency yang melayani perusahaan Anda."}
          </p>
        </div>

        {/* Add row */}
        <div className="p-5 border-b border-slate-100">
          {isAgency ? (
            <div className="flex gap-2">
              <input className={inputCls} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nama perusahaan klien (harus sudah terdaftar)" />
              <button className={btnCls} onClick={addClient} disabled={busy}>+ Tambah Klien</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input className={inputCls + " font-mono uppercase"} value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="Masukkan Kode Agency" />
              <button className={btnCls} onClick={addAgency} disabled={busy}>+ Tambah Agency</button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {loading && (<tr><td className="px-5 py-8 text-center text-slate-400">Memuat…</td></tr>)}
              {!loading && links.length === 0 && (<tr><td className="px-5 py-8 text-center text-slate-400">Belum ada.</td></tr>)}
              {links.map((l) => (
                <tr key={l.linkId} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-800">{isAgency ? l.clientName : l.agencyName}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[l.status] || "bg-slate-100 text-slate-600"}`}>{l.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {l.status !== "archived" && (
                      <button onClick={() => removeLink(l.linkId)} disabled={busy} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer" title="Hapus tautan">
                        <span className="material-symbols-outlined text-[18px]">link_off</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        Untuk mengelola pengguna akun, gunakan menu <b>{isAgency ? "Manajemen Pengguna" : "Pengguna"}</b>.
      </p>
    </div>
  );
}
