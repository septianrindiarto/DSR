// ─── RBAC v2 core — permission catalog, built-in templates, effective set ────
// Pure functions (no DB) so the rules are unit-tested (test/access.test.js)
// and shared verbatim with the frontend copy (apps/web/src/lib/access.js).
//
// A permission is a 'feature.action' string. Effective permissions =
//   (template ∪ grants) − revokes
//   ∩ CLIENT_ALLOWED            when the account is a client
//   − SETUP_BLOCKED             when the agency's legal documents are incomplete
// superadmin bypasses everything.

export const CATALOG = {
    dashboard: ['view'],
    fleet: ['view', 'create', 'edit', 'delete'],
    orders: ['view', 'create', 'edit', 'delete', 'claim', 'export', 'approve'],
    schedule: ['view'],
    customers: ['view', 'create', 'edit', 'delete'],
    drivers: ['view', 'create', 'edit', 'delete'],
    analytics: ['view'],
    finance: ['view', 'create', 'edit', 'post', 'lock'],
    documents: ['view', 'create', 'edit'],
    users: ['view', 'create', 'edit', 'delete'],
    settings: ['view', 'edit'],
    pricing: ['view', 'edit'],        // rate cards, zones, corporate rates (agency)
    corporate: ['view', 'manage'],    // client portal: spend dashboard / cost centres & approval settings
    driverapp: ['use'],               // driver app (/driver): own assignments, trips, expenses
    contracts: ['view', 'create', 'edit'], // long-term corporate contracts
    opsrecap: ['view', 'create', 'edit', 'verify', 'approve'], // Rekap Operasional & Lembur (contracts)
};

export const ALL_PERMS = Object.entries(CATALOG).flatMap(([f, acts]) => acts.map((a) => `${f}.${a}`));
const ALL_SET = new Set(ALL_PERMS);
const p = (feature, ...acts) => acts.map((a) => `${feature}.${a}`);
const views = (...features) => features.map((f) => `${f}.view`);

// Business rule: clients never edit/delete orders, never see fleet/drivers/
// customers/analytics/finance/documents. Whatever a template or grant says,
// a client account is capped to this set.
export const CLIENT_ALLOWED = new Set([
    ...p('dashboard', 'view'),
    ...p('orders', 'view', 'create', 'claim', 'export', 'approve'),
    ...p('schedule', 'view'),
    ...p('corporate', 'view', 'manage'),
    ...p('contracts', 'view', 'create', 'edit'),   // clients draft/negotiate/approve contracts too (2026-11-05)
    ...p('opsrecap', 'view', 'create', 'approve'),
    ...p('users', 'view', 'create', 'edit', 'delete'),
    ...p('settings', 'view', 'edit'),
]);

// Agency without complete legal documents ("setup" mode): may set up the
// account (profile, documents, fleet, drivers) but not take or claim orders.
export const SETUP_BLOCKED = new Set(['orders.create', 'orders.claim']);

export const SYSTEM_TEMPLATES = {
    'sys:agency_admin': { name: 'Agency — Admin', accountType: 'agency', permissions: ALL_PERMS },
    'sys:agency_staff': {
        name: 'Agency — Staff Operasional', accountType: 'agency', permissions: [
            ...views('dashboard', 'schedule', 'settings', 'pricing', 'contracts'),
            ...p('fleet', 'view', 'create', 'edit'),
            ...p('orders', 'view', 'create', 'edit', 'claim', 'export'),
            ...p('customers', 'view', 'create', 'edit'),
            ...p('drivers', 'view', 'create', 'edit'),
            ...p('documents', 'view', 'create', 'edit'),
            // Fill / edit forms (L/T/O and the monthly M form); approving is for
            // admin + Staff Persetujuan (owner 2026-11-13).
            ...p('opsrecap', 'view', 'create', 'edit'),
        ],
    },
    'sys:agency_approver': {
        name: 'Agency — Staff Persetujuan', accountType: 'agency', permissions: [
            ...views('dashboard', 'schedule', 'fleet', 'orders', 'customers', 'drivers', 'documents', 'settings', 'contracts'),
            ...p('opsrecap', 'view', 'verify'),
        ],
    },
    'sys:agency_finance': {
        name: 'Agency — Keuangan', accountType: 'agency', permissions: [
            ...views('dashboard', 'schedule', 'customers', 'analytics', 'settings', 'pricing', 'contracts'),
            ...p('orders', 'view', 'export'),
            ...p('finance', 'view', 'create', 'edit', 'post'),
            ...p('documents', 'view', 'create', 'edit'),
            ...p('opsrecap', 'view'),
        ],
    },
    'sys:agency_driver': { name: 'Agency — Driver (aplikasi)', accountType: 'agency', permissions: ['driverapp.use'] },
    'sys:agency_viewer': {
        name: 'Agency — Lihat Saja', accountType: 'agency',
        permissions: views('dashboard', 'fleet', 'orders', 'schedule', 'customers', 'drivers', 'analytics', 'finance', 'documents', 'settings', 'opsrecap'),
    },
    'sys:client_admin': { name: 'Klien — Admin', accountType: 'client', permissions: [...CLIENT_ALLOWED] },
    'sys:client_approver': {
        name: 'Klien — Penyetuju', accountType: 'client', permissions: [
            ...views('dashboard', 'schedule', 'settings', 'corporate'), ...p('orders', 'view', 'create', 'export', 'approve'),
            ...p('contracts', 'view', 'edit'),   // review documents + approve contracts
            ...p('opsrecap', 'view', 'approve'),
        ],
    },
    'sys:client_user': {
        name: 'Klien — Pemesan', accountType: 'client', permissions: [
            ...views('dashboard', 'schedule', 'settings'), ...p('orders', 'view', 'create'),
            ...p('opsrecap', 'view', 'create'),
        ],
    },
};

const LEGACY_ROLE = { client_admin: 'admin', client: 'user' };

/** Account type with legacy fallback (pre-Phase-4A rows). */
export function accountTypeOf(u) {
    if (u?.accountType) return u.accountType;
    return u?.role === 'client' || u?.role === 'client_admin' ? 'client' : 'agency';
}

/** Template a user starts from when template_key is NULL (existing users). */
export function defaultTemplateKey(u) {
    const at = accountTypeOf(u);
    const role = LEGACY_ROLE[u?.role] || u?.role;
    if (at === 'client') return role === 'admin' ? 'sys:client_admin' : 'sys:client_user';
    if (role === 'admin') return 'sys:agency_admin';
    if (role === 'demo') return 'sys:agency_viewer';
    return 'sys:agency_staff';
}

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Effective permission set.
 *   user            { role, accountType, templateKey, permGrants, permRevokes, permissions(legacy) }
 *   templatePerms   permissions of the user's template (resolved by caller)
 *   orgLegalStatus  'active' | 'setup' (agency only)
 */
export function effectivePermissions(user, templatePerms, orgLegalStatus = 'active') {
    if (!user) return new Set();
    if (user.role === 'superadmin') return new Set(ALL_PERMS);
    const set = new Set(asArray(templatePerms).filter((x) => ALL_SET.has(x)));
    for (const g of asArray(user.permGrants)) if (ALL_SET.has(g)) set.add(g);
    // Legacy access-request grants ({ grant_<feature>: true }) → feature.view
    const legacy = user.permissions && typeof user.permissions === 'object' ? user.permissions : {};
    for (const [k, v] of Object.entries(legacy)) {
        if (v === true && k.startsWith('grant_')) {
            const f = k.slice(6) === 'access_requests' ? 'orders.claim' : `${k.slice(6)}.view`;
            if (ALL_SET.has(f)) set.add(f);
        }
    }
    for (const r of asArray(user.permRevokes)) set.delete(r);
    if (accountTypeOf(user) === 'client') {
        for (const x of [...set]) { if (!CLIENT_ALLOWED.has(x)) set.delete(x); }
    } else if (orgLegalStatus === 'setup') {
        for (const x of SETUP_BLOCKED) set.delete(x);
    }
    return set;
}

/**
 * Escalation guard: may `actorPerms` (of an actor with `actorAccountType`)
 * give `targetPerms` to a user of `targetAccountType`?
 * Rules: superadmin may do anything; nobody may grant a permission they don't
 * hold; a client admin only manages client users within CLIENT_ALLOWED.
 */
export function canAssign({ actorRole, actorAccountType, actorPerms, targetAccountType, targetPerms }) {
    if (actorRole === 'superadmin') return { ok: true };
    if (actorAccountType !== targetAccountType) return { ok: false, reason: 'Tipe akun target berbeda dengan Anda.' };
    const missing = [...targetPerms].filter((x) => !actorPerms.has(x));
    if (missing.length) return { ok: false, reason: `Tidak dapat memberi hak yang tidak Anda miliki: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}` };
    if (targetAccountType === 'client') {
        const bad = [...targetPerms].filter((x) => !CLIENT_ALLOWED.has(x));
        if (bad.length) return { ok: false, reason: `Hak tidak tersedia untuk akun klien: ${bad.join(', ')}` };
    }
    return { ok: true };
}

/** grants/revokes that turn `templatePerms` into `desiredPerms`. */
export function diffFromTemplate(templatePerms, desiredPerms) {
    const t = new Set(asArray(templatePerms)), d = new Set([...desiredPerms].filter((x) => ALL_SET.has(x)));
    return { grants: [...d].filter((x) => !t.has(x)).sort(), revokes: [...t].filter((x) => !d.has(x)).sort() };
}

/** Required legal documents for agency activation. */
export const LEGAL_DOCS = ['nib', 'akta', 'npwp', 'ktp'];
export function legalComplete(org) {
    const docs = org?.legalDocs || {};
    return LEGAL_DOCS.every((k) => docs[k]?.url) && !!String(org?.nib || '').trim()
        && !!String(org?.npwp || '').trim() && !!String(org?.phone1 || '').trim();
}
