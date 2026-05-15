import { eq, or, isNull, sql } from 'drizzle-orm';

/**
 * Build Drizzle WHERE conditions that enforce company-level data isolation.
 *
 * Rules:
 *   superadmin  → no filter (sees all records including NULL organization_id)
 *   admin       → org records + unassigned (NULL organization_id) + non-demo
 *   agent       → org records only + non-demo
 *   demo user   → is_demo = true AND created_by = user.id
 *   no org      → returns sql`false` (sees nothing)
 *
 * @param {object|null} user - req.user from Better Auth session
 * @param {{ organizationId, isDemo, createdBy }} cols - Drizzle column refs for the queried table
 * @returns {import('drizzle-orm').SQL[]} Array of conditions — spread into .where(and(...existing, ...scopeConds))
 */
export function buildScopeConditions(user, { organizationId, isDemo, createdBy }) {
    if (!user) return [];

    // Platform owner — unrestricted access
    if (user.role === 'superadmin') return [];

    // Demo account — can only see its own demo records
    if (user.isDemo === true) {
        const conds = isDemo ? [eq(isDemo, true)] : [];
        if (createdBy) conds.push(eq(createdBy, user.id));
        return conds;
    }

    const orgId = user.organizationId;

    if (!orgId) {
        // Authenticated but not yet assigned to an organization — block all data
        return [sql`false`];
    }

    if (user.role === 'admin') {
        // Company admin sees their org's records + unassigned (NULL) records
        const conds = [or(eq(organizationId, orgId), isNull(organizationId))];
        if (isDemo) conds.push(eq(isDemo, false));
        return conds;
    }

    // agent (and any future non-admin roles) — only their org, no unassigned
    const conds = [eq(organizationId, orgId)];
    if (isDemo) conds.push(eq(isDemo, false));
    return conds;
}

/**
 * Express middleware that checks whether the user's account is active.
 * Returns 403 if the account has been frozen by an admin.
 * Must be used AFTER requireAuth.
 */
export function requireActiveUser(req, res, next) {
    if (req.user?.isActive === false) {
        return res.status(403).json({
            error: 'Akun Anda telah dinonaktifkan. Hubungi administrator.',
        });
    }
    next();
}
