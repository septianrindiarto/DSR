// ─── RBAC v2 UI — per-user access editor + templates / audit panel ───────────
// Everything here is advisory UI: the server re-checks every change
// (same org, no escalation beyond the editor's own permissions, client cap).
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./Toast";
import { CATALOG, FEATURE_LABEL, ACTIONS, ACTION_LABEL } from "../lib/accessCatalog";

import AsyncButton from "./AsyncButton";
/** Feature × action checkbox grid. */
export function PermissionMatrix({ value, onChange, allowed, readOnly }) {
  const set = new Set(value);
  const toggle = (perm) => {
    const n = new Set(set);
    if (n.has(perm)) n.delete(perm); else n.add(perm);
    // Any action implies "view" of the same feature.
    const [f] = perm.split(".");
    if (n.has(perm) && !perm.endsWith(".view")) n.add(`${f}.view`);
    if (!n.has(`${f}.view`)) for (const a of CATALOG[f]) n.delete(`${f}.${a}`);
    onChange([...n].sort());
  };
  const canSet = (perm) => !readOnly && (!allowed || allowed.has(perm));
  // One click per feature row: tick every action you may give; click again to clear the row.
  const rowPerms = (f) => CATALOG[f].map((a) => `${f}.${a}`).filter(canSet);
  const rowFull = (f) => rowPerms(f).length > 0 && rowPerms(f).every((p) => set.has(p));
  const toggleRow = (f) => {
    const n = new Set(set);
    if (rowFull(f)) for (const a of CATALOG[f]) { if (canSet(`${f}.${a}`)) n.delete(`${f}.${a}`); }
    else for (const p of rowPerms(f)) n.add(p);
    onChange([...n].sort());
  };
  const allPerms = Object.keys(CATALOG).flatMap(rowPerms);
  const allFull = allPerms.length > 0 && allPerms.every((p) => set.has(p));
  const toggleAll = () => onChange(allFull ? [...set].filter((p) => !canSet(p)).sort() : [...new Set([...set, ...allPerms])].sort());
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Fitur</th>
            <th className="px-2 py-2 text-center">
              {!readOnly && (
                <button type="button" onClick={toggleAll} className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold cursor-pointer ${allFull ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-primary hover:text-primary"}`}
                  title={allFull ? "Kosongkan semua" : "Centang semua fitur"}>{allFull ? "Kosongkan" : "Semua"}</button>
              )}
            </th>
            {ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center">{ACTION_LABEL[a]}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Object.entries(CATALOG).map(([f, acts]) => (
            <tr key={f}>
              <td className="px-3 py-1.5 font-medium text-slate-700">{FEATURE_LABEL[f]}</td>
              <td className="px-2 py-1.5 text-center">
                {!readOnly && rowPerms(f).length > 0 && (
                  <button type="button" onClick={() => toggleRow(f)}
                    className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold cursor-pointer whitespace-nowrap ${rowFull(f) ? "bg-primary/10 text-primary border-primary/40" : "bg-white text-slate-500 border-slate-200 hover:border-primary hover:text-primary"}`}
                    title={rowFull(f) ? `Hapus semua hak ${FEATURE_LABEL[f]}` : `Centang semua hak ${FEATURE_LABEL[f]}`}>
                    <span className="material-symbols-outlined text-[14px]">{rowFull(f) ? "remove_done" : "done_all"}</span>{rowFull(f) ? "Hapus" : "Semua"}
                  </button>
                )}
              </td>
              {ACTIONS.map((a) => {
                if (!acts.includes(a)) return <td key={a} className="px-2 py-1.5 text-center text-slate-200">·</td>;
                const perm = `${f}.${a}`;
                const can = canSet(perm);
                return (
                  <td key={a} className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={set.has(perm)} disabled={!can} onChange={() => toggle(perm)}
                      title={can ? perm : "Anda tidak dapat memberi hak ini"} className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-40" />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Modal: one user's template + exact permissions. */
export function AccessModal({ target, currentUser, onClose, onSaved }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [clientAllowed, setClientAllowed] = useState([]);
  const [templateKey, setTemplateKey] = useState("");
  const [perms, setPerms] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.users.getAccess(target.id), api.users.accessTemplates()])
      .then(([a, t]) => {
        setInfo(a); setTemplateKey(a.templateKey); setPerms(a.effective);
        setTemplates(t.templates.filter((x) => x.accountType === a.accountType && (x.system || x.organizationId === target.organizationId)));
        setClientAllowed(t.clientAllowed || []);
      })
      .catch((e) => { toast.error(e.message); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);

  // What the editor may grant: their own permissions (superadmin: all),
  // capped to the client set for client targets.
  const allowed = useMemo(() => {
    if (!info) return new Set();
    const mine = currentUser?.role === "superadmin" ? null : new Set(currentUser?.perms || []);
    const all = Object.entries(CATALOG).flatMap(([f, acts]) => acts.map((a) => `${f}.${a}`));
    return new Set(all.filter((p) => (!mine || mine.has(p)) && (info.accountType !== "client" || clientAllowed.includes(p))));
  }, [info, currentUser, clientAllowed]);

  function pickTemplate(key) {
    setTemplateKey(key);
    const t = templates.find((x) => x.key === key);
    if (t) setPerms([...t.permissions].sort());
  }
  const tpl = templates.find((x) => x.key === templateKey);
  const tplSet = new Set(tpl?.permissions || []);
  const extra = perms.filter((p) => !tplSet.has(p));
  const removed = [...tplSet].filter((p) => !perms.includes(p));

  async function save() {
    setSaving(true);
    try {
      await api.users.setAccess(target.id, { templateKey, permissions: perms });
      toast.success("Hak akses disimpan.");
      onSaved?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="font-semibold text-slate-900">Hak Akses — {target.name}</h2>
            <p className="text-xs text-slate-500">{target.email} · akun {info?.accountType === "client" ? "Klien" : "Agency"}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><span className="material-symbols-outlined">close</span></button>
        </div>
        {!info ? <p className="p-8 text-center text-sm text-slate-400">Memuat…</p> : (
          <div className="p-5 space-y-4 overflow-y-auto">
            <label className="block max-w-md">
              <span className="block text-xs font-semibold text-slate-600 mb-1">Template</span>
              <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" value={templateKey} onChange={(e) => pickTemplate(e.target.value)}>
                {templates.map((t) => <option key={t.key} value={t.key}>{t.name}{t.system ? "" : " (organisasi)"}</option>)}
              </select>
            </label>
            <PermissionMatrix value={perms} onChange={setPerms} allowed={allowed} />
            {(extra.length > 0 || removed.length > 0) && (
              <p className="text-[11px] text-slate-500">
                {extra.length > 0 && <>Tambahan dari template: <b className="text-emerald-700">{extra.join(", ")}</b>. </>}
                {removed.length > 0 && <>Dicabut dari template: <b className="text-red-600">{removed.join(", ")}</b>.</>}
              </p>
            )}
            <p className="text-[11px] text-slate-400">Anda hanya dapat memberi hak yang Anda miliki sendiri. Perubahan berlaku pada permintaan berikutnya pengguna ini dan dicatat di log audit.</p>
          </div>
        )}
        <div className="flex justify-end gap-2 p-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-sm cursor-pointer">Batal</button>
          <button onClick={save} disabled={!info || saving} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50 cursor-pointer">{saving ? "Menyimpan…" : "Simpan"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Role tab — role definitions (privileges) + default role for new members +
 * audit log. Flow: register user → define role → assign the role in Pengguna.
 * Built-in roles are shared by every organisation; "Ubah hak" on one saves an
 * organisation-specific version and moves that organisation's users to it.
 */
export function RolesPanel({ currentUser }) {
  const toast = useToast();
  const isSuper = currentUser?.role === "superadmin";
  const [orgId, setOrgId] = useState(isSuper ? "" : String(currentUser?.organizationId || ""));
  const [orgs, setOrgs] = useState([]);
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState([]);
  const [edit, setEdit] = useState(null); // { id?, forkKey?, name, accountType, organizationId, permissions, readOnly? }

  useEffect(() => {
    if (!isSuper) return;
    api.orgs.list().then((r) => setOrgs(Array.isArray(r) ? r : [])).catch(() => {});
  }, [isSuper]);
  const load = () => {
    api.users.accessTemplates(isSuper ? orgId : undefined).then(setData).catch((e) => toast.error(e.message));
    api.users.accessAudit().then((r) => setAudit(Array.isArray(r) ? r : [])).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [orgId]);

  const orgById = useMemo(() => Object.fromEntries(orgs.map((o) => [String(o.id), o])), [orgs]);
  const orgType = (id) => { const o = orgById[String(id)]; return o ? (o.parentAgencyId == null ? "agency" : "client") : null; };
  const allowedFor = (accountType) => {
    const all = Object.entries(CATALOG).flatMap(([f, acts]) => acts.map((a) => `${f}.${a}`));
    const mine = isSuper ? null : new Set(currentUser?.perms || []);
    const clientCap = new Set(data?.clientAllowed || []);
    return new Set(all.filter((p) => (!mine || mine.has(p)) && (accountType !== "client" || clientCap.has(p))));
  };

  if (!data) return <p className="text-sm text-slate-400 py-8 text-center">Memuat…</p>;
  const myType = currentUser?.accountType || "agency";
  const selType = isSuper ? (orgId ? orgType(orgId) : null) : myType;
  const roles = data.templates.filter((t) => (isSuper ? (!selType || t.accountType === selType) : t.accountType === myType));
  const userWord = (n) => `${n} pengguna`;

  function openNew() {
    setEdit({ name: "", accountType: selType || "agency", organizationId: orgId || "", permissions: [] });
  }
  function openEdit(t) {
    if (t.system) {
      setEdit({ forkKey: t.key, name: t.name, accountType: t.accountType, organizationId: orgId || "", permissions: t.permissions, userCount: t.userCount });
    } else {
      setEdit({ id: t.id, name: t.name, accountType: t.accountType, organizationId: t.organizationId, permissions: t.permissions });
    }
  }
  async function save() {
    try {
      if (!edit.name.trim()) { toast.error("Nama role wajib diisi."); return; }
      if (isSuper && !edit.id && !edit.organizationId) { toast.error("Pilih organisasi pemilik role."); return; }
      if (edit.forkKey) {
        const r = await api.users.forkTemplate({ key: edit.forkKey, name: edit.name, permissions: edit.permissions, organizationId: edit.organizationId ? Number(edit.organizationId) : undefined });
        toast.success(`Role disimpan untuk organisasi ini${r.moved ? ` — ${r.moved} pengguna dipindahkan` : ""}.`);
      } else {
        await api.users.saveTemplate({ id: edit.id, name: edit.name, permissions: edit.permissions, organizationId: edit.organizationId ? Number(edit.organizationId) : undefined });
        toast.success("Role disimpan.");
      }
      setEdit(null); load();
    } catch (e) { toast.error(e.message); }
  }
  async function remove(t) {
    if (!confirm(`Hapus role "${t.name}"?`)) return;
    try { await api.users.deleteTemplate(t.id); toast.success("Role dihapus."); load(); } catch (e) { toast.error(e.message); }
  }
  async function setDefault(key) {
    try { await api.users.setDefaultTemplate(key || null); toast.success("Role default disimpan."); load(); }
    catch (e) { toast.error(e.message); }
  }
  const editOrgType = edit ? (edit.id || edit.forkKey ? edit.accountType : (isSuper ? orgType(edit.organizationId) || edit.accountType : myType)) : null;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-900">Role & Hak Akses</h3>
            <p className="text-xs text-slate-500 max-w-xl">Tentukan hak tiap role di sini, lalu tetapkan role ke pengguna di tab <b>Pengguna</b>. Role bawaan berlaku untuk semua organisasi; "Ubah hak" pada role bawaan membuat versi khusus organisasi tersebut.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSuper && (
              <select className="px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">Semua organisasi</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <button onClick={openNew} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium cursor-pointer">
              <span className="material-symbols-outlined text-[18px]">add</span>Tambah Role
            </button>
          </div>
        </div>
        {!isSuper && (
          <label className="text-xs text-slate-600 flex items-center gap-2">Role default anggota baru
            <select className="px-2 py-1.5 border border-slate-200 rounded-lg bg-white" value={data.defaultTemplate || ""} onChange={(e) => setDefault(e.target.value)}>
              <option value="">Bawaan sistem</option>
              {roles.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          </label>
        )}
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="px-3 py-2 text-left">Role</th><th className="px-3 py-2 text-left">Tipe</th>
              {isSuper && <th className="px-3 py-2 text-left">Organisasi</th>}
              <th className="px-3 py-2 text-right">Hak</th><th className="px-3 py-2 text-right">Dipakai</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map((t) => (
                <tr key={t.key} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-slate-900">{t.name}</p>
                    <p className="text-[11px] text-slate-400">{t.system ? "Bawaan sistem" : "Role organisasi"}</p>
                  </td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${t.accountType === "client" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{t.accountType === "client" ? "Klien" : "Agency"}</span></td>
                  {isSuper && <td className="px-3 py-2 text-xs text-slate-600">{t.system ? "Semua" : (t.organizationName || `#${t.organizationId}`)}</td>}
                  <td className="px-3 py-2 text-right text-xs">{t.permissions.length}</td>
                  <td className="px-3 py-2 text-right text-xs">{userWord(t.userCount || 0)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(t)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:border-primary hover:text-primary cursor-pointer">
                      <span className="material-symbols-outlined text-[16px]">tune</span>Ubah hak
                    </button>
                    <button onClick={() => setEdit({ name: `${t.name} (salinan)`, accountType: t.accountType, organizationId: t.system ? (orgId || "") : t.organizationId, permissions: t.permissions.filter((p) => allowedFor(t.accountType).has(p)) })}
                      className="ml-1 p-1 text-slate-400 hover:text-blue-600 cursor-pointer" title="Salin jadi role baru"><span className="material-symbols-outlined text-[18px]">content_copy</span></button>
                    {!t.system && <button onClick={() => remove(t)} disabled={(t.userCount || 0) > 0} className="ml-1 p-1 text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      title={(t.userCount || 0) > 0 ? "Masih dipakai pengguna" : "Hapus role"}><span className="material-symbols-outlined text-[18px]">delete</span></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-900 mb-2">Log Audit Hak Akses</h3>
        {audit.length === 0 ? <p className="text-xs text-slate-400">Belum ada perubahan.</p> : (
          <div className="max-h-72 overflow-y-auto text-xs divide-y divide-slate-100">
            {audit.map((a) => (
              <div key={a.id} className="py-1.5 flex justify-between gap-3">
                <span><b>{a.action}</b>{a.targetUserId ? ` · user ${a.targetUserId.slice(0, 8)}…` : ""}{a.after?.templateKey ? ` → ${a.after.templateKey}` : ""}{a.after?.key ? ` → ${a.after.key}` : ""}</span>
                <span className="text-slate-400 whitespace-nowrap">{new Date(a.createdAt).toLocaleString("id-ID")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEdit(null)}>
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 space-y-3">
              <h3 className="font-semibold text-slate-900">{edit.id || edit.forkKey ? `Ubah hak — ${edit.name}` : "Role baru"}</h3>
              <div className="flex gap-3 items-end flex-wrap">
                <label className="block flex-1 min-w-[220px]"><span className="block text-xs font-semibold text-slate-600 mb-1">Nama role</span>
                  <input className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                {isSuper && !edit.id && (
                  <label className="block min-w-[220px]"><span className="block text-xs font-semibold text-slate-600 mb-1">Organisasi pemilik *</span>
                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" value={edit.organizationId} onChange={(e) => setEdit({ ...edit, organizationId: e.target.value })}>
                      <option value="">— Pilih —</option>
                      {orgs.filter((o) => !edit.forkKey || (o.parentAgencyId == null ? "agency" : "client") === edit.accountType).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select></label>
                )}
                <span className="text-xs text-slate-500 pb-2">Tipe: {editOrgType === "client" ? "Klien" : "Agency"}</span>
              </div>
              {edit.forkKey && (
                <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                  Ini role bawaan sistem. Menyimpan akan membuat versi khusus organisasi {isSuper ? "yang dipilih" : "Anda"} dan memindahkan pengguna organisasi itu yang memakai role ini{edit.userCount ? ` (${edit.userCount} pengguna)` : ""}. Role bawaan untuk organisasi lain tidak berubah.
                </p>
              )}
              {editOrgType === "client" && (
                <p className="text-xs bg-sky-50 border border-sky-200 text-sky-800 rounded-lg px-3 py-2">
                  Role klien: <b>Rekap Order → Tambah</b> = boleh memesan kendaraan (tombol <i>Pesan Kendaraan</i> / form di Dashboard). Kotak abu-abu tidak bisa dicentang karena klien tidak pernah mengubah/menghapus order dan tidak melihat Armada, Driver, Pelanggan, Analitik, Keuangan atau Dokumen (aturan R-01).
                </p>
              )}
            </div>
            <div className="p-5 overflow-y-auto"><PermissionMatrix value={edit.permissions} onChange={(p) => setEdit({ ...edit, permissions: p })} allowed={allowedFor(editOrgType)} /></div>
            <div className="flex justify-end gap-2 p-4 border-t border-slate-100">
              <button onClick={() => setEdit(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm cursor-pointer">Batal</button>
              <AsyncButton onClick={save} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium cursor-pointer">Simpan</AsyncButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
