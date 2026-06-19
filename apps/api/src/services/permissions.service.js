// ─── Backend role + accountType → feature access ─────────────────────────
// Mirror of apps/web/src/lib/permissions.js. Keep the two in sync.

export const ROLES = Object.freeze({
    SUPERADMIN: 'superadmin',
    ADMIN: 'admin',
    AGENT: 'agent',
    USER: 'user',
    CLIENT_ADMIN: 'client_admin', // legacy
    CLIENT: 'client',             // legacy
    DEMO: 'demo',
});

export const ACCOUNT_TYPES = Object.freeze({
    AGENCY: 'agency',
    CLIENT: 'client',
});

export const FEATURES = Object.freeze({
    DASHBOARD: 'dashboard',
    FLEET: 'fleet',
    ORDERS: 'orders',
    SCHEDULE: 'schedule',
    CUSTOMERS: 'customers',
    DRIVERS: 'drivers',
    ANALYTICS: 'analytics',
    FINANCE: 'finance',
    DOCUMENTS: 'documents',
    USERS: 'users',
    ACCESS_REQUESTS: 'access_requests',
    SETTINGS: 'settings',
});

// Used by requireRole(...) — accepts ROLE values, but the middleware also
// resolves legacy client/client_admin to admin/user before checking.
export const ROLE_GROUPS = Object.freeze({
    AGENCY_STAFF:      ['superadmin', 'admin', 'agent', 'demo'],
    ANY_ADMIN:         ['superadmin', 'admin', 'demo', 'client_admin'],
    CLIENT_SIDE:       ['client', 'client_admin', 'user'],
    ANY_AUTHENTICATED: ['superadmin', 'admin', 'agent', 'demo', 'client_admin', 'client', 'user'],
});

const ALL = Object.values(FEATURES);

const CLIENT_ADMIN_FEATURES = [
    FEATURES.DASHBOARD,
    FEATURES.ORDERS,
    FEATURES.SCHEDULE,
    FEATURES.USERS,
    FEATURES.ACCESS_REQUESTS,
    FEATURES.SETTINGS,
];

const CLIENT_USER_FEATURES = [
    FEATURES.DASHBOARD,
    FEATURES.ORDERS,
    FEATURES.SCHEDULE,
    FEATURES.SETTINGS,
];

function resolveAxes(user) {
    if (!user) return { accountType: null, role: null };
    let { accountType, role } = user;
    if (!accountType) {
        if (role === 'client' || role === 'client_admin') accountType = 'client';
        else accountType = 'agency';
    }
    if (role === 'client_admin') role = 'admin';
    if (role === 'client') role = 'user';
    return { accountType, role };
}

function featuresFor(accountType, role) {
    if (accountType === 'agency') return ALL;
    if (accountType === 'client') {
        if (role === 'admin' || role === 'superadmin') return CLIENT_ADMIN_FEATURES;
        return CLIENT_USER_FEATURES;
    }
    return [];
}

/** Does this user have access to this feature? */
export function canAccess(user, feature) {
    if (!user || !feature) return false;
    const { accountType, role } = resolveAxes(user);
    if (!accountType) return false;
    const baseline = featuresFor(accountType, role);
    if (baseline.includes(feature)) return true;
    if (user.permissions && user.permissions[`grant_${feature}`] === true) return true;
    return false;
}

/**
 * Per-user permission override (used by Phase 3 access-request approvals).
 * Same flag pattern: `grant_<feature>` or arbitrary key like `view_all_orders`.
 */
export function hasPermission(user, permKey) {
    return Boolean(user?.permissions && user.permissions[permKey] === true);
}

export function isAdminLike(user) {
    if (!user) return false;
    const { role } = resolveAxes(user);
    return role === 'admin' || role === 'superadmin';
}
