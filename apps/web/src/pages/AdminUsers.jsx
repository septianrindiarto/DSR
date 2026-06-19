import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../components/AdminLayout';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

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
        if (password.length < 6) return setError('Password minimal 6 karakter.');
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
                            minLength={6}
                            placeholder="Minimal 6 karakter"
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
function UserModal({ user: existing, orgs, currentUser, onClose, onSaved }) {
    const isEdit = !!existing;
    const isSuperAdmin = currentUser?.role === 'superadmin';

    const [form, setForm] = useState({
        name: existing?.name || '',
        email: existing?.email || '',
        password: '',
        role: existing?.role || 'agent',
        organizationId: existing?.organizationId || currentUser?.organizationId || '',
        isActive: existing?.isActive !== false,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const payload = {
                name: form.name,
                role: form.role,
                organizationId: form.organizationId ? parseInt(form.organizationId) : null,
                isActive: form.isActive,
            };
            if (!isEdit) {
                payload.email = form.email;
                payload.password = form.password;
            }
            if (isEdit) {
                await api.users.update(existing.id, payload);
            } else {
                await api.users.create(payload);
            }
            onSaved();
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
                                    minLength={6}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                                />
                            </div>
                        </>
                    )}

                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Role</label>
                        <select
                            value={form.role}
                            onChange={e => set('role', e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary bg-white"
                        >
                            {isSuperAdmin && <option value="superadmin">Superadmin</option>}
                            <option value="admin">Admin (Perusahaan)</option>
                            <option value="agent">Agent</option>
                            <option value="demo">Demo</option>
                        </select>
                    </div>

                    {isSuperAdmin && (
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5 font-medium">Organisasi</label>
                            <select
                                value={form.organizationId}
                                onChange={e => set('organizationId', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary bg-white"
                            >
                                <option value="">— Tanpa Organisasi —</option>
                                {orgs.map(o => (
                                    <option key={o.id} value={o.id}>{o.name}</option>
                                ))}
                            </select>
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

// ─── Modal: Create / Edit organization ─────────────────────────────────────
function OrgModal({ org: existing, onClose, onSaved }) {
    const [form, setForm] = useState({ name: existing?.name || '', slug: existing?.slug || '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            if (existing) {
                await api.orgs.update(existing.id, form);
            } else {
                await api.orgs.create(form);
            }
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm shadow-xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <h2 className="text-slate-900 font-semibold text-base">
                        {existing ? 'Edit Organisasi' : 'Tambah Organisasi'}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 font-medium">Nama Organisasi</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            required
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm transition-colors">Batal</button>
                        <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
                            {saving ? 'Menyimpan...' : 'Simpan'}
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
        if (currentUser.role !== 'admin') return false;
        if (!currentUser.organizationId) return false;
        if (u.role === 'superadmin') return false;
        return u.organizationId === currentUser.organizationId;
    };

    const [tab, setTab] = useState('users'); // 'users' | 'orgs'
    const [users, setUsers] = useState([]);
    const [orgs, setOrgs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('');
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
            if (confirmDelete.type === 'org') await api.orgs.delete(confirmDelete.id);
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
                    <p className="text-slate-500 text-sm mt-1">Kelola akun, role, dan organisasi</p>
                </div>
                <button
                    onClick={() => setModal({ type: tab === 'orgs' ? 'org' : 'user', data: null })}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 transition-colors shadow-sm cursor-pointer"
                >
                    <span className="material-symbols-outlined text-[20px]">add</span>
                    {tab === 'orgs' ? 'Tambah Organisasi' : 'Tambah Pengguna'}
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

            {/* Tabs — only superadmin sees Organisations tab */}
            {isSuperAdmin && (
                <div className="flex border-b border-slate-200">
                    {['users', 'orgs'].map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                                tab === t
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            {t === 'users' ? 'Pengguna' : 'Organisasi'}
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
                            <option value="superadmin">Superadmin</option>
                            <option value="admin">Admin</option>
                            <option value="agent">Agent</option>
                            <option value="demo">Demo</option>
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
                                    ) : users.length === 0 ? (
                                        <tr><td colSpan={6} className="text-center py-12 text-slate-400">Tidak ada pengguna ditemukan</td></tr>
                                    ) : users.map(u => (
                                        <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                                                        {u.name?.[0]?.toUpperCase() || '?'}
                                                    </div>
                                                    <div>
                                                        <div className="text-slate-900 font-medium">{u.name}</div>
                                                        <div className="text-slate-400 text-xs">{u.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <RoleBadge role={u.role} />
                                            </td>
                                            {isSuperAdmin && (
                                                <td className="px-5 py-4 text-slate-600 text-xs">
                                                    {u.organizationId ? (orgMap[u.organizationId] || `Org #${u.organizationId}`) : <span className="text-slate-300">—</span>}
                                                </td>
                                            )}
                                            <td className="px-5 py-4">
                                                <button
                                                    onClick={() => handleToggleActive(u)}
                                                    disabled={u.id === currentUser?.id}
                                                    className="flex items-center gap-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                                                    title={u.id === currentUser?.id ? 'Tidak dapat mengubah akun sendiri' : (u.isActive ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan')}
                                                >
                                                    <span className={`inline-block w-2 h-2 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
                                                    <span className={u.isActive ? 'text-green-600' : 'text-slate-400'}>
                                                        {u.isActive ? 'Aktif' : 'Nonaktif'}
                                                    </span>
                                                </button>
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
                                {total} pengguna
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ── ORGANISATIONS TAB (superadmin only) ── */}
            {tab === 'orgs' && isSuperAdmin && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-slate-500 text-xs uppercase border-b border-slate-200">
                                    <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Nama</th>
                                    <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Slug</th>
                                    <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Status</th>
                                    <th className="text-left px-5 py-3.5 font-semibold tracking-wider">Dibuat</th>
                                    <th className="px-5 py-3.5"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {orgs.length === 0 ? (
                                    <tr><td colSpan={5} className="text-center py-12 text-slate-400">Belum ada organisasi</td></tr>
                                ) : orgs.map(o => (
                                    <tr key={o.id} className="hover:bg-slate-50/60 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                                                    {o.name?.[0]?.toUpperCase()}
                                                </div>
                                                <span className="text-slate-900 font-medium">{o.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-slate-500 font-mono text-xs">{o.slug || '—'}</td>
                                        <td className="px-5 py-4">
                                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${o.isActive ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                                {o.isActive ? 'Aktif' : 'Nonaktif'}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-slate-400 text-xs">
                                            {o.createdAt ? new Date(o.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-1 justify-end">
                                                <button
                                                    onClick={() => setModal({ type: 'org', data: o })}
                                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDelete({ type: 'org', id: o.id, name: o.name })}
                                                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Modals ── */}
            {modal?.type === 'user' && (
                <UserModal
                    user={modal.data}
                    orgs={orgs}
                    currentUser={currentUser}
                    onClose={() => setModal(null)}
                    onSaved={() => { setModal(null); loadUsers(); }}
                />
            )}
            {modal?.type === 'org' && (
                <OrgModal
                    org={modal.data}
                    onClose={() => setModal(null)}
                    onSaved={() => { setModal(null); loadOrgs(); }}
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
                            <button onClick={handleDelete} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors">
                                {confirmDelete.type === 'user' ? 'Nonaktifkan' : 'Hapus'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
