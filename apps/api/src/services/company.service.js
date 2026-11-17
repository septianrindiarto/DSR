// ─── Company service (Phase 4C-2) ─────────────────────────────────────────
// Reads/writes go to the `organizations` table now. The `companies` table is
// no longer used at the service layer — its data was migrated by
// scripts/backfill-orgs-from-companies.js. Public method signatures remain
// unchanged so route handlers and the frontend `api.companies` namespace work
// without modification.
//
// Field shape mapping (legacy companies → organizations):
//   companies.id              → organizations.id
//   companies.name            → organizations.name
//   companies.address         → organizations.address
//   companies.phone           → organizations.phone1     (legacy single-phone)
//   companies.email           → organizations.email
//   companies.notes           → organizations.notes
//   companies.organizationId  → organizations.parent_agency_id
//   companies.createdBy       → (dropped — not present on organizations)
//
// Returned rows are reshaped to look like legacy `companies` rows for backward
// compatibility with the frontend.

import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { eq, ilike, or, asc, desc, sql, and } from 'drizzle-orm';
import { findAvailableDisplayId } from './display-id.service.js';
import { resolveDefaultAgencyId, ensureParentLink } from './relationship.service.js';

/**
 * Visibility of client companies (organizations rows) for the address book.
 *   superadmin / no user → everything
 *   demo                 → read-only view as before (no writes via RBAC)
 *   client account       → its own organization only
 *   agency account       → orgs whose parent_agency_id = my agency, plus
 *                          orgs linked through client_agency_links (active)
 * Exported for the by-id route guard.
 */
export function companyScope(user) {
    if (!user || user.role === 'superadmin' || user.isDemo === true) return [];
    const orgId = user.organizationId;
    if (!orgId) return [sql`false`];
    const isClient = user.accountType === 'client' || user.role === 'client' || user.role === 'client_admin';
    if (isClient) return [eq(organizations.id, orgId)];
    return [sql`(${organizations.parentAgencyId} = ${orgId} OR ${organizations.id} IN (
        SELECT client_org_id FROM client_agency_links WHERE agency_org_id = ${orgId} AND status = 'active'))`];
}

// Convert an organizations row → legacy companies shape for frontend.
function toCompanyShape(o) {
    if (!o) return o;
    return {
        id: o.id,
        name: o.name,
        address: o.address,
        phone: o.phone1,
        email: o.email,
        notes: o.notes,
        organizationId: o.parentAgencyId,
        // displayId is new — surfaced as a hint for the agency UI.
        displayId: o.displayId,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
    };
}

export const companyService = {
    async findAll({ search, sortBy = 'name', sortOrder = 'asc', page = 1, limit = 1000, scopeUser = null } = {}) {
        const offset = (page - 1) * limit;
        const sortFields = {
            name: organizations.name,
            createdAt: organizations.createdAt,
            updatedAt: organizations.updatedAt,
        };
        const orderField = sortFields[sortBy] || organizations.name;
        const orderDir = sortOrder === 'desc' ? desc(orderField) : asc(orderField);

        const conditions = [];
        if (search) {
            const term = `%${search}%`;
            conditions.push(or(
                ilike(organizations.name, term),
                ilike(organizations.address, term),
                ilike(organizations.phone1, term),
                ilike(organizations.email, term),
                ilike(organizations.displayId, term),
            ));
        }

        // Scope: the caller's client companies only (see companyScope). Other
        // agencies (top-level orgs) never appear in an agency's address book.
        conditions.push(...companyScope(scopeUser));

        let query = db.select().from(organizations);
        let countQuery = db.select({ count: sql`count(*)` }).from(organizations);

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
            countQuery = countQuery.where(and(...conditions));
        }

        const data = await query.orderBy(orderDir).limit(limit).offset(offset);
        const countResult = await countQuery;
        return {
            data: data.map(toCompanyShape),
            total: Number(countResult[0].count),
            page,
            limit,
        };
    },

    async findById(id, scopeUser = null) {
        const rows = await db.select().from(organizations)
            .where(and(eq(organizations.id, Number(id)), ...companyScope(scopeUser))).limit(1);
        return toCompanyShape(rows[0]);
    },

    // scopeUser given → only a company the caller may see (Documents lookup).
    // Without it (internal duplicate check) the whole table is searched.
    async findByName(name, scopeUser = null) {
        if (!name) return null;
        const rows = await db.select().from(organizations)
            .where(and(sql`LOWER(TRIM(${organizations.name})) = ${String(name).toLowerCase().trim()}`, ...companyScope(scopeUser)))
            .limit(1);
        return toCompanyShape(rows[0]);
    },

    async create(data) {
        if (data.name) {
            const existing = await this.findByName(data.name);
            if (existing) {
                const e = new Error(`Perusahaan "${existing.name}" sudah terdaftar.`);
                e.code = 'DUPLICATE';
                e.existing = existing;
                throw e;
            }
        }
        const { displayId } = await findAvailableDisplayId(data.name, new Date());
        // Owner agency = caller's org (agency admin), else the default agency
        // (e.g. a superadmin with no org). No more hardcoded id 1.
        const parentAgencyId = data.organizationId || data.parentAgencyId || (await resolveDefaultAgencyId());
        const result = await db.insert(organizations).values({
            name: data.name,
            nameNormalized: String(data.name || '').toLowerCase().replace(/\s+/g, ' ').trim(),
            isActive: true,
            adminUserId: null,
            inviteCode: null,
            address: data.address || null,
            phone1: data.phone || null,
            phone2: null,
            email: data.email || null,
            notes: data.notes || null,
            displayId,
            parentAgencyId,
        }).returning();
        await ensureParentLink(result[0].id, parentAgencyId, data.createdBy || null);
        return toCompanyShape(result[0]);
    },

    async update(id, data) {
        const patch = { updatedAt: new Date() };
        if (data.name !== undefined) {
            patch.name = data.name;
            patch.nameNormalized = String(data.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
        }
        if (data.address !== undefined) patch.address = data.address === '' ? null : data.address;
        if (data.phone !== undefined) patch.phone1 = data.phone === '' ? null : data.phone;
        if (data.email !== undefined) patch.email = data.email === '' ? null : data.email;
        if (data.notes !== undefined) patch.notes = data.notes === '' ? null : data.notes;
        const result = await db.update(organizations).set(patch).where(eq(organizations.id, Number(id))).returning();
        return toCompanyShape(result[0]);
    },

    async delete(id) {
        const [check] = await db.select({ id: organizations.id, adminUserId: organizations.adminUserId })
            .from(organizations)
            .where(eq(organizations.id, Number(id)))
            .limit(1);
        if (!check) return null;
        if (check.adminUserId) {
            const e = new Error('Perusahaan ini memiliki admin terdaftar — tidak dapat dihapus dari buku alamat. Nonaktifkan akun admin-nya dulu.');
            e.code = 'HAS_ADMIN';
            throw e;
        }
        const result = await db.delete(organizations).where(eq(organizations.id, Number(id))).returning();
        return toCompanyShape(result[0]);
    },
};
