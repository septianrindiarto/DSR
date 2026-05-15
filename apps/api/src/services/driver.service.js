import { db } from '../db/index.js';
import { drivers } from '../db/schema.js';
import { eq, ilike, or, asc, desc, sql, and } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

const sortFields = {
    name: drivers.name,
    phone: drivers.phone,
    status: drivers.status,
    licenseExpiry: drivers.licenseExpiry,
    createdAt: drivers.createdAt,
};

export const driverService = {
    async findAll({ search, status, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20, scopeUser = null }) {
        const conditions = [];
        if (search) {
            conditions.push(or(ilike(drivers.name, `%${search}%`), ilike(drivers.phone, `%${search}%`)));
        }
        if (status) conditions.push(eq(drivers.status, status));

        // Company-level isolation
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: drivers.organizationId,
            isDemo: drivers.isDemo,
            createdBy: drivers.createdBy,
        });
        conditions.push(...scopeConds);

        const orderField = sortFields[sortBy] || drivers.createdAt;
        const orderDir = sortOrder === 'asc' ? asc(orderField) : desc(orderField);
        const offset = (page - 1) * limit;

        let query = db.select().from(drivers);
        let countQuery = db.select({ count: sql`count(*)` }).from(drivers);

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
            countQuery = countQuery.where(and(...conditions));
        }

        const results = await query.orderBy(orderDir).limit(limit).offset(offset);
        const countResult = await countQuery;

        return { data: results, total: Number(countResult[0].count), page, limit };
    },

    async findById(id) {
        const result = await db.select().from(drivers).where(eq(drivers.id, id));
        return result[0] || null;
    },

    /** Case-insensitive exact lookup by name — used by CSV import / Rekap sync. */
    async findByName(name) {
        if (!name) return null;
        const result = await db.select().from(drivers)
            .where(sql`LOWER(${drivers.name}) = ${String(name).toLowerCase()}`)
            .limit(1);
        return result[0] || null;
    },

    async findAvailable() {
        return db.select().from(drivers).where(eq(drivers.status, 'active'));
    },

    async create(data) {
        const result = await db.insert(drivers).values(data).returning();
        return result[0];
    },

    async update(id, data) {
        const result = await db.update(drivers).set({ ...data, updatedAt: new Date() }).where(eq(drivers.id, id)).returning();
        return result[0];
    },

    async delete(id) {
        const result = await db.delete(drivers).where(eq(drivers.id, id)).returning();
        return result[0];
    },

    async updateDocuments(id, docs) {
        const result = await db.update(drivers).set({ ...docs, updatedAt: new Date() }).where(eq(drivers.id, id)).returning();
        return result[0];
    },

    async getStats(scopeUser = null) {
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: drivers.organizationId,
            isDemo: drivers.isDemo,
            createdBy: drivers.createdBy,
        });
        const base = scopeConds.length ? scopeConds : [sql`true`];
        const [total, active, inactive, suspended] = await Promise.all([
            db.select({ n: sql`count(*)::int` }).from(drivers).where(scopeConds.length ? and(...scopeConds) : undefined).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(drivers).where(and(...base, eq(drivers.status, 'active'))).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(drivers).where(and(...base, eq(drivers.status, 'inactive'))).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(drivers).where(and(...base, eq(drivers.status, 'suspended'))).then(r => Number(r[0]?.n || 0)),
        ]);
        return { total, active, inactive, suspended };
    },
};
