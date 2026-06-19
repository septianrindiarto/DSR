// ─── Role + accountType → feature access map (single source of truth) ───
// Phase 4A made accountType the "agency vs client" axis separate from role.
// Permission decisions consider BOTH dimensions:
//
//   accountType='agency' (any role)  → ALL features (DSR internal staff)
//   accountType='client' role='admin' → DASHBOARD + ORDERS + SCHEDULE +
//                                       USERS + ACCESS_REQUESTS + SETTINGS
//                                       (the company admin's view)
//   accountType='client' role='user'  → DASHBOARD + ORDERS + SCHEDULE +
//                                       SETTINGS  (regular client view)
//   Legacy roles (client_admin, client) map to the above for backwards compat
//   so existing accounts created before Phase 4A still work.
//
// Per-user overrides in user.permissions JSONB add a feature to the role's
// default list (e.g. {grant_fleet: true}). Backend mirror lives at
// apps/api/src/services/permissions.service.js — keep the two in sync.

export const ROLES = Object.freeze({
    SUPERADMIN: 'superadmin',
    ADMIN: 'admin',
    AGENT: 'agent',
    USER: 'user',
    CLIENT_ADMIN: 'client_admin', // legacy — treated as admin+client
    CLIENT: 'client',             // legacy — treated as user+client
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

/**
 * Resolve the effective (accountType, role) from a user. Handles legacy
 * accounts created before Phase 4A introduced accountType as a column.
 */
function resolveAxes(user) {
    if (!user) return { accountType: null, role: null };
    let { accountType, role } = user;
    // Legacy role mapping
    if (!accountType) {
        if (role === 'client' || role === 'client_admin') accountType = 'client';
        else accountType = 'agency';
    }
    if (role === 'client_admin') role = 'admin';
    if (role === 'client') role = 'user';
    return { accountType, role };
}

/** Features baseline for a given (accountType, role) pair. */
function featuresFor(accountType, role) {
    if (accountType === 'agency') return ALL;
    if (accountType === 'client') {
        if (role === 'admin' || role === 'superadmin') return CLIENT_ADMIN_FEATURES;
        return CLIENT_USER_FEATURES;
    }
    return [];
}

/**
 * Can this user see this feature? Checks the role-default list first, then
 * the per-user grant override (`grant_<feature>` in permissions JSONB).
 */
export function canAccess(user, feature) {
    if (!user || !feature) return false;
    const { accountType, role } = resolveAxes(user);
    if (!accountType) return false;
    const baseline = featuresFor(accountType, role);
    if (baseline.includes(feature)) return true;
    // Per-user grant override (Phase 3 access-request approvals)
    if (user.permissions && user.permissions[`grant_${feature}`] === true) return true;
    return false;
}

/**
 * Filter a navItems array down to the ones this user can access.
 * Each item must carry `key` matching a FEATURES value.
 */
export function visibleNavFor(user, navItems) {
    if (!user) return [];
    return (navItems || []).filter(item => canAccess(user, item.key));
}

/** Is this user any kind of admin (within whatever scope they have)? */
export function isAdminLike(user) {
    if (!user) return false;
    const { role } = resolveAxes(user);
    return role === 'admin' || role === 'superadmin';
}
