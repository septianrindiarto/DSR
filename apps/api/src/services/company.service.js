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
import { buildScopeConditions } from '../middleware/scope.js';
import { findAvailableDisplayId } from './display-id.service.js';

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

        // Scope by agency — every org with parent_agency_id = caller's agency
        // is visible. Agency's OWN org (where parent_agency_id IS NULL) is
        // intentionally excluded from the address book.
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: organizations.parentAgencyId,
            isDemo: null,
            createdBy: null,
        });
        conditions.push(...scopeConds);

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

    async findById(id) {
        const rows = await db.select().from(organizations).where(eq(organizations.id, Number(id))).limit(1);
        return toCompanyShape(rows[0]);
    },

    async findByName(name) {
        if (!name) return null;
        const rows = await db.select().from(organizations)
            .where(sql`LOWER(TRIM(${organizations.name})) = ${String(name).toLowerCase().trim()}`)
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
            parentAgencyId: data.organizationId || data.parentAgencyId || 1,
        }).returning();
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
