import { db } from '../db/index.js';
import { companies } from '../db/schema.js';
import { eq, ilike, or, asc, desc, sql, and } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

export const companyService = {
    /** List all companies, optionally filtered by free-text search. */
    async findAll({ search, sortBy = 'name', sortOrder = 'asc', page = 1, limit = 1000, scopeUser = null } = {}) {
        const offset = (page - 1) * limit;
        const sortFields = {
            name: companies.name,
            createdAt: companies.createdAt,
            updatedAt: companies.updatedAt,
        };
        const orderField = sortFields[sortBy] || companies.name;
        const orderDir = sortOrder === 'desc' ? desc(orderField) : asc(orderField);

        const conditions = [];
        if (search) {
            const term = `%${search}%`;
            conditions.push(or(ilike(companies.name, term), ilike(companies.address, term),
                ilike(companies.phone, term), ilike(companies.email, term)));
        }

        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: companies.organizationId,
            isDemo: null,   // companies table has no is_demo column
            createdBy: companies.createdBy,
        });
        conditions.push(...scopeConds);

        let query = db.select().from(companies);
        let countQuery = db.select({ count: sql`count(*)` }).from(companies);

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
            countQuery = countQuery.where(and(...conditions));
        }

        const data = await query.orderBy(orderDir).limit(limit).offset(offset);
        const countResult = await countQuery;
        return { data, total: Number(countResult[0].count), page, limit };
    },

    async findById(id) {
        const rows = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
        return rows[0] || null;
    },

    /** Case-insensitive exact lookup by name — used for invoice address auto-fill. */
    async findByName(name) {
        if (!name) return null;
        const rows = await db.select().from(companies)
            .where(sql`LOWER(${companies.name}) = ${String(name).toLowerCase()}`)
            .limit(1);
        return rows[0] || null;
    },

    async create(data) {
        // Defensive duplicate check — surfaces a clean error before the DB
        // unique-constraint kicks in (different drivers wrap that error
        // differently, so we can't always rely on catching code '23505').
        if (data.name) {
            const existing = await this.findByName(data.name);
            if (existing) {
                const e = new Error(`Perusahaan "${existing.name}" sudah terdaftar.`);
                e.code = 'DUPLICATE';
                e.existing = existing;
                throw e;
            }
        }
        const result = await db.insert(companies).values({
            name: data.name,
            address: data.address || null,
            phone: data.phone || null,
            email: data.email || null,
            notes: data.notes || null,
            organizationId: data.organizationId || null,
            createdBy: data.createdBy || null,
        }).returning();
        return result[0];
    },

    async update(id, data) {
        const patch = { updatedAt: new Date() };
        for (const k of ['name', 'address', 'phone', 'email', 'notes']) {
            if (data[k] !== undefined) patch[k] = data[k] === '' ? null : data[k];
        }
        const result = await db.update(companies).set(patch).where(eq(companies.id, id)).returning();
        return result[0] || null;
    },

    async delete(id) {
        const result = await db.delete(companies).where(eq(companies.id, id)).returning();
        return result[0] || null;
    },
};
