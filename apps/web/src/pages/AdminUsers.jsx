import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/permissions';
import { RolesPanel } from '../components/AccessEditor';
import OrganizationsPanel from '../components/OrganizationsPanel';
import { useToast } from '../components/Toast';

import AsyncButton from "../components/AsyncButton";
// Roles (templates) a user can hold: same account type, built-in or their org's own.
const rolesFor = (templates, accountType, orgId) =>
    templates.filter((t) => t.accountType === accountType && (t.system || t.organizationId === Number(orgId)));
const orgTypeOf = (o) => (o ? (o.parentAgencyId == null ? 'agency' : 'client') : null);
// Readable role name even when the template list doesn't include it.
const SYS_ROLE_NAMES = {
    'sys:agency_admin': 'Agency — Admin', 'sys:agency_staff': 'Agency — Staff Operasional', 'sys:agency_finance': 'Agency — Keuangan',
    'sys:agency_viewer': 'Agency — Lihat Saja', 'sys:agency_driver': 'Agency — Driver (aplikasi)',
    'sys:client_admin': 'Klien — Admin', 'sys:client_approver': 'Klien — Penyetuju', 'sys:client_user': 'Klien — Pemesan',
};
const roleLabel = (names, key) => names[key] || SYS_ROLE_NAMES[key] || (key ? String(key).replace(/^(sys|org):/, '') : '—');

const ROLE_LABELS = {
    superadmin: { label: 'Superadmin', color: 'bg-red-100 text-red-700 border border-red-200' },
    admin:      { label: 'Admin',      color: 'bg-blue-100 text-blue-700 border border-blue-200' },
    agent:      { label: 'Agent',      color: 'bg-green-100 text-green-700 border border-green-200' },
    demo:       { label: 'Demo',       color: 'bg-amber-100 text-amber-700 border border-amber-200' },
};

function RoleBadge({ role }) {
    const r = ROLE_LABELS[role] || { label: role, color: 'bg-slate-100 text-slate-600 border border-slate-200' };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.color}`}>{r.label}</span>;
}

// ─── Modal: Reset Password ───────────────────────────────────────────────────
function ResetPasswordModal({ user: target, onClose, onDone }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        if (password.length < 8) return setError('Password minimal 8 karakter.');
        if (password !== confirm) return setError('Konfirmasi password tidak cocok.');
        setSaving(true);
        try {
            await api.users.resetPassword(target.id, password);
            setSuccess(true);
            setTimeout(() => { onDone(); }, 1200);
        } catch (err) {
            setError(err.message || 'Terjadi kesalahan.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
                            <span className="material-symbols-outlined text-amber-600 text-[20px]">lock_reset</span>
                        </div>
                        <div>
                            <h2 className="text-slate-900 font-semibold text-base">Reset Password</h2>
                            <p className="text-slate-500 text-xs">{target.name} · {target.email}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                            Password berhasil direset!
                        </div>
                    )}

                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Password Baru</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={8}
                            placeholder="Minimal 8 karakter"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Konfirmasi Password</label>
                        <input
                            type="password"
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                            required
                            placeholder="Ulangi password baru"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm transition-colors"
                        >
                            Batal
                        </button>
                        <button
                            type="submit"
                            disabled={saving || success}
                            className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
                        >
                            {saving ? 'Menyimpan...' : 'Reset Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Modal: Create / Edit user ──────────────────────────────────────────────
function UserModal({ user: existing, orgs, templates: allTemplates, currentUser, onClose, onSaved }) {
    const isEdit = !!existing;
    const isSuperAdmin = currentUser?.role === 'superadmin';

    const [form, setForm] = useState({
        name: existing?.name || '',
        email: existing?.email || '',
        password: '',
        role: existing?.role || 'user',
        isDemo: existing?.role === 'demo',
        templateKey: existing?.templateKey || '',
        organizationId: existing?.organizationId || currentUser?.organizationId || '',
        isActive: existing?.isActive !== false,
        sendVerification: true,
    });
    // A new user is created straight into a role (role = privilege definition, see tab Role).
    const targetOrg = isSuperAdmin ? form.organizationId : currentUser?.organizationId;
    // No organisation = individual (private) client — an agency account always needs its organisation.
    const targetType = isSuperAdmin ? (form.organizationId ? (orgTypeOf(orgs.find((o) => String(o.id) === String(form.organizationId))) || 'agency') : 'client') : (currentUser?.accountType || 'agency');
    const templates = rolesFor(allTemplates || [], targetType, targetOrg);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            // Non-superadmins may only change name / active status here; role
            // and permissions go through "Hak Akses", org moves are superadmin-only.
            const payload = { name: form.name, isActive: form.isActive };
            if (isSuperAdmin && existing?.role !== 'superadmin') {
                if (isEdit) payload.demo = form.isDemo; else if (form.isDemo) payload.role = 'demo';
                payload.organizationId = form.organizationId ? parseInt(form.organizationId) : null;
                // Moving / re-using an account: role follows the chosen organisation.
                if (isEdit && form.role !== 'superadmin' && form.templateKey && form.templateKey !== existing?.templateKey) payload.templateKey = form.templateKey;
            }
            if (!isEdit && form.templateKey) payload.templateKey = form.templateKey;
            if (!isEdit) {
                payload.email = form.email;
                payload.password = form.password;
                payload.sendVerification = !!form.sendVerification;
            }
            if (isEdit) {
                await api.users.update(existing.id, payload);
                onSaved();
            } else {
                const created = await api.users.create(payload);
                onSaved(created);
            }
        } catch (err) {
            setError(err.message || 'Terjadi kesalahan.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <h2 className="text-slate-900 font-semibold text-base">
                        {isEdit ? 'Edit Pengguna' : 'Tambah Pengguna Baru'}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Nama Lengkap</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => set('name', e.target.value)}
                            required
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    {!isEdit && (
                        <>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1.5 font-medium">Email</label>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={e => set('email', e.target.value)}
                                    required
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1.5 font-medium">Password</label>
                                <input
                                    type="password"
                                    value={form.password}
                                    onChange={e => set('password', e.target.value)}
                                    required
                                    minLength={8}
                                    placeholder="Minimal 8 karakter"
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                                />
                            </div>
                            <label className="flex items-start gap-2 text-sm text-slate-700">
                                <input type="checkbox" className="mt-1" checked={form.sendVerification} onChange={e => set('sendVerification', e.target.checked)} />
                                <span>Kirim email verifikasi
                                    <span className="block text-[11px] text-slate-400">{form.sendVerification
                                        ? 'Pengguna harus klik link di email sebelum bisa masuk (memastikan email benar miliknya).'
                                        : 'Akun langsung aktif tanpa verifikasi — hanya untuk akun yang Anda serahkan langsung.'}</span>
                                </span>
                            </label>
                        </>
                    )}

                    {(!isEdit || (isSuperAdmin && existing?.role !== 'superadmin' && form.role !== 'superadmin')) && (
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Role {isSuperAdmin && <span className="font-normal text-slate-400">· tipe akun: {!form.organizationId ? 'Klien perorangan (tanpa organisasi)' : targetType === 'client' ? 'Klien' : 'Agency'}{form.organizationId ? ' (mengikuti organisasi)' : ''}</span>}</label>
                            <select
                                value={form.templateKey}
                                onChange={e => set('templateKey', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary bg-white"
                            >
                                <option value="">{isEdit ? 'Tetap / default organisasi' : 'Role default organisasi'}</option>
                                {templates.map(t => <option key={t.key} value={t.key}>{t.name}{t.system ? '' : ' (organisasi)'}</option>)}
                            </select>
                            <p className="text-[11px] text-slate-400 mt-1">Hak tiap role diatur di tab <b>Role</b>. Role pengguna bisa diganti kapan saja di daftar pengguna.</p>
                        </div>
                    )}
                    {isSuperAdmin && existing?.role === 'superadmin' && (
                        <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">Ini satu-satunya akun superadmin di aplikasi. Role, organisasi dan status aktifnya tidak bisa diubah.</p>
                    )}
                    {isSuperAdmin && existing?.role !== 'superadmin' && (
                        <label className="flex items-start gap-2 text-sm text-slate-700">
                            <input type="checkbox" className="mt-1" checked={form.isDemo} onChange={e => set('isDemo', e.target.checked)} />
                            <span>Akun demo <span className="block text-[11px] text-slate-400">Hanya melihat dan membuat data demo sendiri (untuk presentasi ke calon klien).</span></span>
                        </label>
                    )}

                    {isSuperAdmin && existing?.role !== 'superadmin' && (
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Organisasi</label>
                            <select
                                value={form.organizationId}
                                onChange={e => setForm(f => ({ ...f, organizationId: e.target.value, templateKey: '' }))}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary bg-white"
                            >
                                <option value="">— Tanpa organisasi (klien perorangan) —</option>
                                {orgs.map(o => (
                                    <option key={o.id} value={o.id}>{o.name}</option>
                                ))}
                            </select>
                            {!form.organizationId && <p className="text-[11px] text-slate-400 mt-1">Klien perorangan memesan untuk dirinya sendiri dan menerima invoice atas namanya. Untuk staf agency, pilih organisasi agency-nya.</p>}
                        </div>
                    )}

                    {isEdit && (
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => set('isActive', !form.isActive)}
                                className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-primary' : 'bg-slate-300'}`}
                            >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form.isActive ? 'left-5' : 'left-0.5'}`} />
                            </button>
                            <span className="text-sm text-slate-700">
                                {form.isActive ? 'Akun Aktif' : 'Akun Dinonaktifkan'}
                            </span>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm transition-colors"
                        >
                            Batal
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50"
                        >
                            {saving ? 'Menyimpan...' : (isEdit ? 'Simpan' : 'Buat Akun')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function AdminUsers() {
    const { user: currentUser } = useAuth();
    const toast = useToast();
    const isSuperAdmin = currentUser?.role === 'superadmin';

    // Task 50 - delete button visibility.
    // A row can be deleted when:
    //   - it is not the caller themselves, AND
    //   - the caller is superadmin, OR
    //   - the caller is an admin in the same organization as the target row
    //     and the target is NOT a superadmin
    // The backend re-enforces this exact rule (DELETE /api/users/:id), so the
    // client check just hides the button from users that would get a 403.
    const canDeleteUser = (u) => {
        if (!u || !currentUser) return false;
        if (u.id === currentUser.id) return false;
        if (isSuperAdmin) return true;
        if (!can(currentUser, 'users', 'delete')) return false;
        if (!currentUser.organizationId) return false;
        if (u.role === 'superadmin') return false;
        return u.organizationId === currentUser.organizationId;
    };

    const [params, setParams] = useSearchParams();
    const tab = ['users', 'roles', 'orgs'].includes(params.get('tab')) ? params.get('tab') : 'users';
    const setTab = (t) => setParams(t === 'users' ? {} : { tab: t }, { replace: true });
    const [templates, setTemplates] = useState([]);
    const [users, setUsers] = useState([]);
    const [orgs, setOrgs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('active'); // active | inactive | all
    const [orgFilter, setOrgFilter] = useState('');

    const [modal, setModal] = useState(null); // { type: 'user'|'org'|'resetPw', data: object }
    const [confirmDelete, setConfirmDelete] = useState(null); // { type, id, name }
    const [actionError, setActionError] = useState('');

    const loadOrgs = useCallback(async () => {
        if (!isSuperAdmin) return;
        try {
            const rows = await api.orgs.list();
            setOrgs(Array.isArray(rows) ? rows : []);
        } catch { /* silent */ }
    }, [isSuperAdmin]);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (roleFilter) params.set('role', roleFilter);
            if (orgFilter) params.set('organizationId', orgFilter);
            const res = await api.users.list(params.toString());
            setUsers(res.data || []);
            setTotal(res.total || 0);
        } catch (err) {
            setActionError(err.message);
        } finally {
            setLoading(false);
        }
    }, [search, roleFilter, orgFilter]);

    useEffect(() => { loadOrgs(); }, [loadOrgs]);
    const loadTemplates = useCallback(() => {
        api.users.accessTemplates().then((t) => setTemplates(t.templates || [])).catch(() => {});
    }, []);
    useEffect(() => { loadTemplates(); }, [loadTemplates, tab]);
    const roleName = useMemo(() => Object.fromEntries(templates.map((t) => [t.key, t.name])), [templates]);
    const shownUsers = users
        .filter((u) => !roleFilter || (roleFilter === 'superadmin' ? u.role === 'superadmin' : u.templateKey === roleFilter))
        .filter((u) => statusFilter === 'all' || (statusFilter === 'active' ? u.isActive !== false : u.isActive === false));
    const canAssignRole = can(currentUser, 'users', 'edit');

    async function assignRole(u, key) {
        const tpl = templates.find((t) => t.key === key);
        if (!tpl || key === u.templateKey) return;
        const msg = `Ubah role ${u.name} menjadi "${tpl.name}"?${u.customized ? '\n\nHak khusus pengguna ini akan dihapus dan mengikuti role.' : ''}`;
        if (!window.confirm(msg)) return;
        try {
            await api.users.setAccess(u.id, { templateKey: key, permissions: tpl.permissions });
            loadUsers(); loadTemplates();
        } catch (err) { setActionError(err.message); }
    }
    async function resendVerification(u) {
        try {
            await api.users.resendVerification(u.id);
            toast.success(`Email verifikasi dikirim ulang ke ${u.email}.`);
        } catch (err) { toast.error(err.message); }
    }
    useEffect(() => {
        const t = setTimeout(loadUsers, 300);
        return () => clearTimeout(t);
    }, [loadUsers]);

    async function handleToggleActive(u) {
        try {
            await api.users.update(u.id, { isActive: !u.isActive });
            loadUsers();
        } catch (err) { setActionError(err.message); }
    }

    async function handleDelete() {
        if (!confirmDelete) return;
        try {
            if (confirmDelete.type === 'user') await api.users.delete(confirmDelete.id);
            setConfirmDelete(null);
            loadUsers();
            loadOrgs();
        } catch (err) { setActionError(err.message); setConfirmDelete(null); }
    }

    const orgMap = Object.fromEntries(orgs.map(o => [o.id, o.name]));

    return (
        <AdminLayout>
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Manajemen Pengguna</h1>
                    <p className="text-slate-500 text-sm mt-1">Daftarkan pengguna, tentukan hak tiap role, lalu tetapkan role ke pengguna.</p>
                </div>
                <button
                    hidden={tab !== 'users' || !can(currentUser, 'users', 'create')}
                    onClick={() => setModal({ type: 'user', data: null })}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 transition-colors shadow-sm cursor-pointer"
                >
                    <span className="material-symbols-outlined text-[20px]">add</span>
                    Tambah Pengguna
                </button>
            </div>

            {actionError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center justify-between">
                    <span>{actionError}</span>
                    <button onClick={() => setActionError('')} className="text-red-400 hover:text-red-600">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            )}

            {/* Tabs — Role for access managers; Organisasi for superadmin */}
            {(isSuperAdmin || can(currentUser, 'users', 'edit')) && (
                <div className="flex border-b border-slate-200">
                    {['users', ...(can(currentUser, 'users', 'edit') ? ['roles'] : []), ...(isSuperAdmin ? ['orgs'] : [])].map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                                tab === t
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            {t === 'users' ? 'Pengguna' : t === 'roles' ? 'Role' : 'Organisasi'}
                        </button>
                    ))}
                </div>
            )}

            {/* ── USERS TAB ── */}
            {tab === 'users' && (
                <>
                    {/* Filters */}
                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative flex-1">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
                            <input
                                type="text"
                                placeholder="Cari nama atau email..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white text-slate-900 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                            />
                        </div>
                        <select
                            value={roleFilter}
                            onChange={e => setRoleFilter(e.target.value)}
                            className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 cursor-pointer focus:outline-none focus:border-primary"
                        >
                            <option value="">Semua Role</option>
                            {isSuperAdmin && <option value="superadmin">Superadmin</option>}
                            {[['agency', true, 'Agency — bawaan'], ['client', true, 'Klien — bawaan'], ['agency', false, 'Agency — role organisasi'], ['client', false, 'Klien — role organisasi']].map(([type, sys, label]) => {
                                const list = templates.filter((t) => t.accountType === type && !!t.system === sys);
                                return list.length ? (
                                    <optgroup key={label} label={label}>
                                        {list.map((t) => <option key={t.key} value={t.key}>{t.name}{!t.system && t.organizationName ? ` · ${t.organizationName}` : ''}</option>)}
                                    </optgroup>
                                ) : null;
                            })}
                        </select>
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 cursor-pointer focus:outline-none focus:border-primary"
                        >
                            <option value="active">Aktif</option>
                            <option value="inactive">Nonaktif</option>
                            <option value="all">Semua status</option>
                        </select>
                        {isSuperAdmin && orgs.length > 0 && (
                            <select
                                value={orgFilter}
                                onChange={e => setOrgFilter(e.target.value)}
                                className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 cursor-pointer focus:outline-none focus:border-primary"
                            >
                                <option value="">Semua Organisasi</option>
                                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                        )}
                    </div>

                    {/* Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
                                        <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Pengguna</th>
                                        <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Role</th>
                                        {isSuperAdmin && <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Organisasi</th>}
                                        <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Status</th>
                                        <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Bergabung</th>
                                        <th className="px-5 py-3.5"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {loading ? (
                                        <tr><td colSpan={6} className="text-center py-12 text-slate-400">Memuat...</td></tr>
                                    ) : shownUsers.length === 0 ? (
                                        <tr><td colSpan={6} className="text-center py-12 text-slate-400">Tidak ada pengguna ditemukan</td></tr>
                                    ) : shownUsers.map(u => (
                                        <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
                                                        {u.name?.[0]?.toUpperCase() || '?'}
                                                    </div>
                                                    <div>
                                                        <div className="text-slate-900 font-semibold text-[15px] leading-tight">{u.name}</div>
                                                        <div className="text-slate-400 text-xs">{u.email}</div>
                                                        {u.emailVerified === false && (
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Belum verifikasi email</span>
                                                                {can(currentUser, 'users', 'edit') && (
                                                                    <AsyncButton type="button" onClick={() => resendVerification(u)} className="text-[10px] text-primary hover:underline cursor-pointer">Kirim ulang</AsyncButton>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4">
                                                {u.role === 'superadmin' ? <RoleBadge role="superadmin" /> : canAssignRole && u.id !== currentUser?.id ? (
                                                    <div>
                                                        <select
                                                            value={u.templateKey || ''}
                                                            onChange={(e) => assignRole(u, e.target.value)}
                                                            className="max-w-[220px] px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white text-slate-700 cursor-pointer focus:outline-none focus:border-primary"
                                                            title="Ganti role pengguna"
                                                        >
                                                            {!rolesFor(templates, u.accountType, u.organizationId).some((t) => t.key === u.templateKey) && <option value={u.templateKey || ''}>{roleLabel(roleName, u.templateKey)}</option>}
                                                            {rolesFor(templates, u.accountType, u.organizationId).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                                                        </select>
                                                        {u.customized && <p className="text-[10px] text-amber-600 mt-0.5">+ hak khusus</p>}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs font-medium text-slate-700">{roleLabel(roleName, u.templateKey)}</span>
                                                )}
                                            </td>
                                            {isSuperAdmin && (
                                                <td className="px-5 py-4 text-slate-400 text-[11px]">
                                                    {u.organizationId ? (orgMap[u.organizationId] || `Org #${u.organizationId}`) : <span className="text-slate-300">—</span>}
                                                </td>
                                            )}
                                            <td className="px-5 py-4">
                                                <AsyncButton
                                                    onClick={() => handleToggleActive(u)}
                                                    disabled={u.id === currentUser?.id}
                                                    className="flex items-center gap-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                                                    title={u.id === currentUser?.id ? 'Tidak dapat mengubah akun sendiri' : (u.isActive ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan')}
                                                >
                                                    <span className={`inline-block w-2 h-2 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
                                                    <span className={u.isActive ? 'text-green-600' : 'text-slate-400'}>
                                                        {u.isActive ? 'Aktif' : 'Nonaktif'}
                                                    </span>
                                                </AsyncButton>
                                            </td>
                                            <td className="px-5 py-4 text-slate-400 text-xs">
                                                {u.createdAt ? new Date(u.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-1 justify-end">
                                                    {/* Reset password — superadmin only */}
                                                    {isSuperAdmin && (
                                                        <button
                                                            onClick={() => setModal({ type: 'resetPw', data: u })}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                                            title="Reset Password"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">lock_reset</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        hidden={!can(currentUser, 'users', 'edit')}
                                                        onClick={() => setModal({ type: 'user', data: u })}
                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                                        title="Edit"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">edit</span>
                                                    </button>
                                                    {canDeleteUser(u) && (
                                                        <button
                                                            onClick={() => setConfirmDelete({ type: 'user', id: u.id, name: u.name })}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                            title="Nonaktifkan akun (soft delete)"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">delete</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {total > 0 && (
                            <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
                                {shownUsers.length !== total ? `${shownUsers.length} dari ${total}` : total} pengguna
                            </div>
                        )}
                    </div>
                </>
            )}

            {tab === 'roles' && <RolesPanel currentUser={currentUser} />}

            {/* ── ORGANISATIONS TAB (superadmin only) — merged from Administrasi → Organisasi ── */}
            {tab === 'orgs' && isSuperAdmin && <OrganizationsPanel onChanged={loadOrgs} />}

            {/* ── Modals ── */}
            {modal?.type === 'user' && (
                <UserModal
                    user={modal.data}
                    orgs={orgs}
                    templates={templates}
                    currentUser={currentUser}
                    onClose={() => setModal(null)}
                    onSaved={(created) => {
                        setModal(null); loadUsers();
                        if (created?.verificationSent) toast.success(`Email verifikasi dikirim ke ${created.email}. Akun aktif setelah link diklik.`);
                        else if (created && created.emailVerified === false) toast.error('Akun dibuat, tetapi email verifikasi gagal terkirim. Kirim ulang dari daftar pengguna.');
                    }}
                />
            )}
            {modal?.type === 'resetPw' && (
                <ResetPasswordModal
                    user={modal.data}
                    onClose={() => setModal(null)}
                    onDone={() => setModal(null)}
                />
            )}

            {/* ── Confirm Delete ── */}
            {confirmDelete && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-xl p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                <span className="material-symbols-outlined text-red-500 text-[20px]">warning</span>
                            </div>
                            <div>
                                <h3 className="text-slate-900 font-semibold text-sm">
                                    {confirmDelete.type === 'user' ? 'Nonaktifkan Akun' : 'Konfirmasi Hapus'}
                                </h3>
                                <p className="text-slate-500 text-xs mt-0.5">
                                    {confirmDelete.type === 'user'
                                        ? 'Pengguna ini akan dikeluarkan dan tidak dapat login lagi.'
                                        : 'Tindakan ini tidak dapat dibatalkan'}
                                </p>
                            </div>
                        </div>
                        <p className="text-slate-700 text-sm mb-5">
                            {confirmDelete.type === 'user' ? 'Nonaktifkan' : 'Hapus'}{' '}
                            <strong className="text-slate-900">{confirmDelete.name}</strong>?
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setConfirmDelete(null)} className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm transition-colors">Batal</button>
                            <AsyncButton onClick={handleDelete} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
                                {confirmDelete.type === 'user' ? 'Nonaktifkan' : 'Hapus'}
                            </AsyncButton>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
