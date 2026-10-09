import { useState, useEffect, useMemo } from "react";
import AdminLayout from "../components/AdminLayout";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";

// ─── /admin/organizations (superadmin) ───────────────────────────────────────
// Platform-wide organization + client↔agency relationship management. Lets a
// superadmin create/edit/deactivate any org and wire client↔agency links —
// the global counterpart to the per-org "Mitra" tab.
const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1";

export default function AdminOrganizations() {
  const toast = useToast();
  const [orgs, setOrgs] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", type: "client", parentAgencyId: "", address: "", phone1: "", email: "" });
  const [linkForm, setLinkForm] = useState({ clientOrgId: "", agencyOrgId: "" });

  async function load() {
    setLoading(true);
    try {
      const [o, l] = await Promise.all([api.orgsAdmin.list(), api.orgsAdmin.links()]);
      setOrgs(o?.data || []);
      setLinks(l?.data || []);
    } catch (e) { toast.error(e.message || "Gagal memuat data."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const agencies = useMemo(() => orgs.filter(o => o.type === "agency"), [orgs]);
  const clients = useMemo(() => orgs.filter(o => o.type === "client"), [orgs]);
  const orgName = (id) => orgs.find(o => o.id === id)?.name || (id ? `#${id}` : "—");

  async function createOrg(e) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Nama wajib diisi."); return; }
    if (form.type === "client" && !form.parentAgencyId) { toast.error("Pilih agency induk untuk klien."); return; }
    setBusy(true);
    try {
      await api.orgsAdmin.create({
        name: form.name.trim(), type: form.type,
        parentAgencyId: form.type === "client" ? Number(form.parentAgencyId) : null,
        address: form.address || null, phone1: form.phone1 || null, email: form.email || null,
      });
      toast.success("Organisasi dibuat.");
      setForm({ name: "", type: "client", parentAgencyId: "", address: "", phone1: "", email: "" });
      load();
    } catch (e) { toast.error(e.message || "Gagal membuat organisasi."); }
    finally { setBusy(false); }
  }

  async function toggleActive(o) {
    setBusy(true);
    try { await api.orgsAdmin.update(o.id, { isActive: !o.isActive }); load(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function renameOrg(o) {
    const name = window.prompt("Nama baru:", o.name);
    if (!name || !name.trim() || name.trim() === o.name) return;
    setBusy(true);
    try { await api.orgsAdmin.update(o.id, { name: name.trim() }); load(); toast.success("Nama diperbarui."); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function addLink(e) {
    e.preventDefault();
    if (!linkForm.clientOrgId || !linkForm.agencyOrgId) { toast.error("Pilih klien dan agency."); return; }
    setBusy(true);
    try {
      await api.orgsAdmin.addLink(Number(linkForm.clientOrgId), Number(linkForm.agencyOrgId));
      toast.success("Relasi ditambahkan.");
      setLinkForm({ clientOrgId: "", agencyOrgId: "" });
      load();
    } catch (e) { toast.error(e.message || "Gagal menambah relasi."); }
    finally { setBusy(false); }
  }

  async function removeLink(id) {
    if (!window.confirm("Hapus relasi ini?")) return;
    setBusy(true);
    try { await api.orgsAdmin.removeLink(id); load(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const typeBadge = (t) => t === "agency"
    ? "bg-amber-100 text-amber-700"
    : "bg-blue-100 text-blue-700";

  return (
    <AdminLayout>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Organisasi</h1>
        <p className="text-slate-500 text-sm mt-1">Kelola semua agency & perusahaan klien beserta relasinya.</p>
      </div>

      {/* Create organization */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mt-4">
        <h2 className="text-base font-bold text-slate-900 mb-3">Tambah Organisasi</h2>
        <form onSubmit={createOrg} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Nama *</label>
            <input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nama organisasi" />
          </div>
          <div>
            <label className={labelCls}>Tipe *</label>
            <select className={inputCls} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="client">Klien (Perusahaan)</option>
              <option value="agency">Agency</option>
            </select>
          </div>
          {form.type === "client" && (
            <div>
              <label className={labelCls}>Agency Induk *</label>
              <select className={inputCls} value={form.parentAgencyId} onChange={e => setForm({ ...form, parentAgencyId: e.target.value })}>
                <option value="">— Pilih agency —</option>
                {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}>Alamat</label>
            <input className={inputCls} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Opsional" />
          </div>
          <div>
            <label className={labelCls}>Telepon</label>
            <input className={inputCls} value={form.phone1} onChange={e => setForm({ ...form, phone1: e.target.value })} placeholder="Opsional" />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Opsional" />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer">
              + Tambah Organisasi
            </button>
          </div>
        </form>
      </section>

      {/* Organizations table */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Semua Organisasi ({orgs.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Nama</th>
                <th className="px-3 py-3 text-left font-semibold">Tipe</th>
                <th className="px-5 py-3 text-left font-semibold">Agency Induk</th>
                <th className="px-5 py-3 text-left font-semibold">Admin</th>
                <th className="px-3 py-3 text-center font-semibold">Status</th>
                <th className="px-5 py-3 text-center font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Memuat…</td></tr>}
              {!loading && orgs.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Belum ada organisasi.</td></tr>}
              {orgs.map(o => (
                <tr key={o.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{o.name}</p>
                    <p className="text-[11px] text-slate-400">{o.displayId || `#${o.id}`}{o.agencyCode ? ` · kode ${o.agencyCode}` : ""}</p>
                  </td>
                  <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${typeBadge(o.type)}`}>{o.type === "agency" ? "Agency" : "Klien"}</span></td>
                  <td className="px-5 py-3 text-slate-600">{o.type === "client" ? orgName(o.parentAgencyId) : "—"}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{o.adminEmail || "—"}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${o.isActive ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                      {o.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center whitespace-nowrap">
                    <button onClick={() => renameOrg(o)} disabled={busy} className="text-blue-600 hover:underline text-xs font-semibold mr-3 cursor-pointer">Ubah nama</button>
                    <button onClick={() => toggleActive(o)} disabled={busy} className={`text-xs font-semibold cursor-pointer ${o.isActive ? "text-amber-600" : "text-green-600"} hover:underline`}>
                      {o.isActive ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Client ↔ Agency links */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mt-4">
        <h2 className="text-base font-bold text-slate-900 mb-3">Relasi Klien ↔ Agency</h2>
        <form onSubmit={addLink} className="flex flex-col sm:flex-row gap-2 mb-4">
          <select className={inputCls} value={linkForm.clientOrgId} onChange={e => setLinkForm({ ...linkForm, clientOrgId: e.target.value })}>
            <option value="">— Pilih klien —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="self-center text-slate-400">→</span>
          <select className={inputCls} value={linkForm.agencyOrgId} onChange={e => setLinkForm({ ...linkForm, agencyOrgId: e.target.value })}>
            <option value="">— Pilih agency —</option>
            {agencies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer whitespace-nowrap">+ Tambah</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-2.5 text-left font-semibold">Klien</th>
                <th className="px-5 py-2.5 text-left font-semibold">Agency</th>
                <th className="px-3 py-2.5 text-center font-semibold">Status</th>
                <th className="px-5 py-2.5 text-center font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && links.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">Belum ada relasi.</td></tr>}
              {links.map(l => (
                <tr key={l.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2.5 text-slate-800">{l.clientName}</td>
                  <td className="px-5 py-2.5 text-slate-800">{l.agencyName}</td>
                  <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">{l.status}</span></td>
                  <td className="px-5 py-2.5 text-center">
                    <button onClick={() => removeLink(l.id)} disabled={busy} className="text-red-600 hover:underline text-xs font-semibold cursor-pointer">Hapus</button>
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
