import { useState, useEffect, useMemo } from "react";
import { useToast } from "./Toast";
import { api } from "../lib/api";
import InlineEdit from "./InlineEdit";
import TablePagination from "./TablePagination";

// ─── Manajemen Pengguna → Organisasi (superadmin) ───────────────────────────
// Platform-wide organization + client↔agency relationship management (was
// the separate Administrasi → Organisasi page). Order: Tambah Organisasi →
// Relasi Klien ↔ Agency (10 per page) → Semua Organisasi (10 per page).
const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary outline-none";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1";

export default function OrganizationsPanel({ onChanged }) {
  const toast = useToast();
  const [orgs, setOrgs] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", type: "client", parentAgencyId: "", address: "", phone1: "", email: "" });
  const [linkForm, setLinkForm] = useState({ clientOrgId: "", agencyOrgId: "" });
  const [linkPage, setLinkPage] = useState({ page: 1, size: 10, q: "" });
  const [orgPage, setOrgPage] = useState({ page: 1, size: 10, q: "", type: "" });

  async function load() {
    setLoading(true);
    try {
      const [o, l] = await Promise.all([api.orgsAdmin.list(), api.orgsAdmin.links()]);
      setOrgs(o?.data || []);
      setLinks(l?.data || []);
    } catch (e) { toast.error(e.message || "Gagal memuat data."); }
    finally { setLoading(false); }
    onChanged?.();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const agencies = useMemo(() => orgs.filter(o => o.type === "agency"), [orgs]);
  const clients = useMemo(() => orgs.filter(o => o.type === "client"), [orgs]);
  const orgName = (id) => orgs.find(o => o.id === id)?.name || (id ? `#${id}` : "—");
  const match = (q, ...xs) => !q || xs.some((x) => String(x || "").toLowerCase().includes(q.toLowerCase()));
  const linksFiltered = useMemo(() => links.filter((l) => match(linkPage.q, l.clientName, l.agencyName, l.status)), [links, linkPage.q]);
  const linksShown = linksFiltered.slice((linkPage.page - 1) * linkPage.size, linkPage.page * linkPage.size);
  const orgsFiltered = useMemo(() => orgs.filter((o) => (!orgPage.type || o.type === orgPage.type) && match(orgPage.q, o.name, o.displayId, o.adminEmail, o.agencyCode)), [orgs, orgPage.q, orgPage.type]);
  const orgsShown = orgsFiltered.slice((orgPage.page - 1) * orgPage.size, orgPage.page * orgPage.size);

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

  // Inline (hover ✏️) save. Tipe, Admin and the display id are derived and
  // stay read-only (tipe follows "agency induk"; admin = org admin user).
  async function saveOrg(o, patch) {
    try { await api.orgsAdmin.update(o.id, patch); toast.success("Tersimpan."); load(); }
    catch (e) { toast.error(e.message); throw e; }
  }

  async function deleteOrg(o) {
    if (!window.confirm(`Hapus organisasi "${o.name}" secara permanen? Gunakan "Nonaktifkan" bila organisasi masih punya pengguna atau data.`)) return;
    setBusy(true);
    try { await api.orgs.delete(o.id); toast.success("Organisasi dihapus."); load(); }
    catch (e) { toast.error(e.message || "Gagal menghapus — nonaktifkan saja bila masih ada data terkait."); }
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
    <div className="space-y-4">
      {/* Create organization */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
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

      {/* Client ↔ Agency links */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
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
        <div className="flex gap-2 mb-2">
          <input className={inputCls} value={linkPage.q} onChange={e => setLinkPage({ ...linkPage, q: e.target.value, page: 1 })} placeholder="Cari klien / agency…" />
        </div>
        <TablePagination sticky={false} page={linkPage.page} pageSize={linkPage.size} totalCount={links.length} filteredCount={linksFiltered.length}
          onPageChange={(n) => setLinkPage({ ...linkPage, page: n })} onPageSizeChange={(n) => setLinkPage({ ...linkPage, size: n, page: 1 })} />
        <div className="overflow-x-auto mt-2">
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
              {!loading && linksFiltered.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">Belum ada relasi.</td></tr>}
              {linksShown.map(l => (
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
      {/* Organizations table */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 space-y-2">
          <h2 className="text-base font-bold text-slate-900">Semua Organisasi ({orgs.length})</h2>
          <div className="flex gap-2 flex-col sm:flex-row">
            <input className={inputCls} value={orgPage.q} onChange={e => setOrgPage({ ...orgPage, q: e.target.value, page: 1 })} placeholder="Cari nama, ID, admin, kode…" />
            <select className={`${inputCls} sm:w-48`} value={orgPage.type} onChange={e => setOrgPage({ ...orgPage, type: e.target.value, page: 1 })}>
              <option value="">Semua tipe</option><option value="agency">Agency</option><option value="client">Klien</option>
            </select>
          </div>
          <TablePagination sticky={false} page={orgPage.page} pageSize={orgPage.size} totalCount={orgs.length} filteredCount={orgsFiltered.length}
            onPageChange={(n) => setOrgPage({ ...orgPage, page: n })} onPageSizeChange={(n) => setOrgPage({ ...orgPage, size: n, page: 1 })} />
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
              {!loading && orgsFiltered.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Belum ada organisasi.</td></tr>}
              {orgsShown.map(o => (
                <tr key={o.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800"><InlineEdit value={o.name} onSave={(v) => saveOrg(o, { name: (v || o.name).trim() })} /></p>
                    <p className="text-[11px] text-slate-400">{o.displayId || `#${o.id}`}{o.agencyCode ? ` · kode ${o.agencyCode}` : ""}</p>
                  </td>
                  <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${typeBadge(o.type)}`}>{o.type === "agency" ? "Agency" : "Klien"}</span></td>
                  <td className="px-5 py-3 text-slate-600">{o.type === "client" ? (
                    <InlineEdit value={o.parentAgencyId ? String(o.parentAgencyId) : ""} type="select" display={orgName(o.parentAgencyId)}
                      options={agencies.map((a) => ({ value: String(a.id), label: a.name }))}
                      onSave={(v) => saveOrg(o, { parentAgencyId: v ? Number(v) : o.parentAgencyId })} />
                  ) : "—"}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{o.adminEmail || "—"}</td>
                  <td className="px-3 py-3 text-center">
                    <InlineEdit value={o.isActive ? "1" : "0"} type="select" options={[{ value: "1", label: "Aktif" }, { value: "0", label: "Nonaktif" }]}
                      onSave={(v) => saveOrg(o, { isActive: v === "1" })}
                      display={<span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${o.isActive ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                        {o.isActive ? "Aktif" : "Nonaktif"}
                      </span>} />
                  </td>
                  <td className="px-5 py-3 text-center whitespace-nowrap">
                    <button onClick={() => renameOrg(o)} disabled={busy} className="text-blue-600 hover:underline text-xs font-semibold mr-3 cursor-pointer">Ubah nama</button>
                    <button onClick={() => toggleActive(o)} disabled={busy} className={`text-xs font-semibold cursor-pointer ${o.isActive ? "text-amber-600" : "text-green-600"} hover:underline`}>
                      {o.isActive ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <button onClick={() => deleteOrg(o)} disabled={busy} className="ml-3 text-xs font-semibold text-red-600 hover:underline cursor-pointer">Hapus</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
