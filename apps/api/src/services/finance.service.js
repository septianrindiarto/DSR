import { db } from '../db/index.js';
import { financialReports } from '../db/schema.js';
import { eq, ilike, desc, asc, sql, and } from 'drizzle-orm';

// Financial documents have no organization column; they belong to the org of
// the user who uploaded them. Non-superadmins only see / change documents
// uploaded by members of their own organization (was: everyone's).
function scopeCond(user) {
    if (!user || user.role === 'superadmin') return null;
    if (!user.organizationId) return sql`${financialReports.createdBy} = ${user.id}`;
    return sql`${financialReports.createdBy} IN (SELECT id FROM "user" WHERE organization_id = ${user.organizationId})`;
}
const withScope = (user, conds = []) => { const s = scopeCond(user); return s ? [...conds, s] : conds; };

export const financeService = {
    async findAll({ search, category, status, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20, user }) {
        const conditions = [];
        if (search) conditions.push(ilike(financialReports.name, `%${search}%`));
        if (category) conditions.push(eq(financialReports.category, category));
        if (status) conditions.push(eq(financialReports.status, status));
        const all = withScope(user, conditions);

        const orderField = sortBy === 'name' ? financialReports.name : financialReports.createdAt;
        const orderDir = sortOrder === 'asc' ? asc(orderField) : desc(orderField);
        const offset = (page - 1) * limit;

        let query = db.select().from(financialReports);
        if (all.length > 0) query = query.where(and(...all));
        const data = await query.orderBy(orderDir).limit(limit).offset(offset);

        let countQ = db.select({ count: sql`count(*)` }).from(financialReports);
        if (all.length > 0) countQ = countQ.where(and(...all));
        const countResult = await countQ;

        return { data, total: Number(countResult[0].count), page, limit };
    },

    async findById(id, user) {
        const result = await db.select().from(financialReports).where(and(eq(financialReports.id, id), ...withScope(user)));
        return result[0] || null;
    },

    async create(data) {
        const result = await db.insert(financialReports).values(data).returning();
        return result[0];
    },

    async update(id, data, user) {
        const { id: _i, createdBy: _c, createdAt: _a, ...rest } = data || {};
        const result = await db.update(financialReports)
            .set({ ...rest, updatedAt: new Date() })
            .where(and(eq(financialReports.id, id), ...withScope(user)))
            .returning();
        return result[0];
    },

    async delete(id, user) {
        const result = await db.delete(financialReports).where(and(eq(financialReports.id, id), ...withScope(user))).returning();
        return result[0];
    },

    async findAllRaw(user) {
        const s = scopeCond(user);
        const q = db.select().from(financialReports);
        return (s ? q.where(s) : q).orderBy(desc(financialReports.createdAt));
    },

    async getStats(user) {
        const s = scopeCond(user);
        const q = db.select().from(financialReports);
        const all = await (s ? q.where(s) : q);
        return {
            total: all.length,
            draft: all.filter(r => r.status === 'draft').length,
            submitted: all.filter(r => r.status === 'submitted').length,
            final: all.filter(r => r.status === 'final').length,
        };
    },
};
