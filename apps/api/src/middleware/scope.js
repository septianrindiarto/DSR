import { eq, or, isNull, sql } from 'drizzle-orm';

/**
 * Build Drizzle WHERE conditions that enforce data isolation.
 *
 * Roles (after normalize_client_roles.sql):
 *   superadmin             Platform owner. No filter.
 *   agency admin           Agency staff. Sees:
 *                            • their agency's own rows
 *                            • every row tagged to a CLIENT org whose
 *                              parent_agency_id = my agency
 *                            • legacy NULL-org rows (anonymous bookings)
 *                          Rationale: agency members are the ones who serve
 *                          the client; a Tambah Rekap order they make for
 *                          PT Foo must remain visible to them even though
 *                          the order is correctly tagged to PT Foo's org.
 *   agency agent           Same visibility model as agency admin, minus the
 *                          NULL-org cushion (which is a one-off legacy bucket
 *                          only admins should babysit).
 *   client admin           Sees every order tagged to their org (Tambah Rekap
 *                          entries the agency made for them) AND their own
 *                          dashboard bookings (which can have org_id NULL).
 *   client user            Locked to their own bookings. Visibility is
 *                          customers.user_id = me, regardless of org.
 *   demo                   is_demo = true AND created_by = me.
 *
 * Many-to-many vendor relationships are a planned phase 2 enhancement.
 * Today there is exactly one agency (DSR Rent Car, org_id=1), so the
 * "client orgs of my agency" subquery is just "every non-DSR org". When
 * the m2m table ships, the subquery swaps in a join against the
 * client_agency_links table and nothing else in this file changes.
 *
 * Legacy role values ("client", "client_admin") are still accepted as a
 * compatibility cushion; they map to client user and client admin
 * respectively. After the normalize migration runs in production no row
 * should hit those branches.
 *
 * @param {object|null} user - req.user from Better Auth session
 * @param {{ organizationId, isDemo, createdBy, ownerUserId }} cols - Drizzle column refs
 * @returns {import('drizzle-orm').SQL[]}
 */
export function buildScopeConditions(user, { organizationId, isDemo, createdBy, ownerUserId }) {
    if (!user) return [];

    if (user.role === 'superadmin') return [];

    if (user.isDemo === true) {
        const conds = isDemo ? [eq(isDemo, true)] : [];
        if (createdBy) conds.push(eq(createdBy, user.id));
        return conds;
    }

    const isClientAccount = user.accountType === 'client'
        || user.role === 'client'
        || user.role === 'client_admin';

    if (isClientAccount) {
        if (user.permissions && user.permissions.view_all_orders === true) {
            return [];
        }

        // Treat legacy strings as their canonical equivalents.
        const effectiveRole =
            user.role === 'client_admin' ? 'admin' :
            user.role === 'client'       ? 'user'  :
            user.role;

        const orgId = user.organizationId;

        if (effectiveRole === 'admin') {
            // Client ADMIN: full company-wide visibility plus any of their own
            // dashboard bookings that landed without an org tag.
            const orConds = [];
            if (orgId && organizationId) orConds.push(eq(organizationId, orgId));
            if (ownerUserId) orConds.push(eq(ownerUserId, user.id));
            if (orConds.length === 0) return [sql`false`];
            return [orConds.length === 1 ? orConds[0] : or(...orConds)];
        }

        // Client USER (or anything not admin): only rows they own.
        // The agency creating an order FOR them via Tambah Rekap goes to the
        // org admin's user_id (see orders.routes.js admin POST), not to the
        // requester. So the client user only sees orders they personally
        // booked through the Dashboard form.
        if (!ownerUserId) return [sql`false`];
        return [eq(ownerUserId, user.id)];
    }

    // AGENCY ACCOUNT
    const orgId = user.organizationId;
    if (!orgId) return [sql`false`];

    // "My client orgs" — every organization whose parent_agency_id points
    // at this agency. Today this is the single-agency model; when the
    // m2m vendor table ships, swap this subquery for a join. Written as
    // a raw SQL fragment so we can keep buildScopeConditions synchronous
    // and avoid touching every route that calls it.
    const clientOrgsSubquery = sql`(SELECT id FROM organizations WHERE parent_agency_id = ${orgId})`;

    if (user.role === 'admin') {
        const conds = [or(
            eq(organizationId, orgId),
            sql`${organizationId} IN ${clientOrgsSubquery}`,
            isNull(organizationId),
        )];
        if (isDemo) conds.push(eq(isDemo, false));
        return conds;
    }

    // Agency agent — same visibility as admin minus the NULL-org cushion.
    const conds = [or(
        eq(organizationId, orgId),
        sql`${organizationId} IN ${clientOrgsSubquery}`,
    )];
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
