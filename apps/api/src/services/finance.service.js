import { db } from '../db/index.js';
import { financialReports } from '../db/schema.js';
import { eq, ilike, desc, asc, sql, and } from 'drizzle-orm';

export const financeService = {
    async findAll({ search, category, status, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20 }) {
        const conditions = [];
        if (search) conditions.push(ilike(financialReports.name, `%${search}%`));
        if (category) conditions.push(eq(financialReports.category, category));
        if (status) conditions.push(eq(financialReports.status, status));

        const orderField = sortBy === 'name' ? financialReports.name : financialReports.createdAt;
        const orderDir = sortOrder === 'asc' ? asc(orderField) : desc(orderField);
        const offset = (page - 1) * limit;

        let query = db.select().from(financialReports);
        if (conditions.length > 0) query = query.where(and(...conditions));
        const data = await query.orderBy(orderDir).limit(limit).offset(offset);

        let countQ = db.select({ count: sql`count(*)` }).from(financialReports);
        if (conditions.length > 0) countQ = countQ.where(and(...conditions));
        const countResult = await countQ;

        return { data, total: Number(countResult[0].count), page, limit };
    },

    async findById(id) {
        const result = await db.select().from(financialReports).where(eq(financialReports.id, id));
        return result[0] || null;
    },

    async create(data) {
        const result = await db.insert(financialReports).values(data).returning();
        return result[0];
    },

    async update(id, data) {
        const result = await db.update(financialReports)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(financialReports.id, id))
            .returning();
        return result[0];
    },

    async delete(id) {
        const result = await db.delete(financialReports).where(eq(financialReports.id, id)).returning();
        return result[0];
    },

    async findAllRaw() {
        return db.select().from(financialReports).orderBy(desc(financialReports.createdAt));
    },

    async getStats() {
        const all = await db.select().from(financialReports);
        return {
            total: all.length,
            draft: all.filter(r => r.status === 'draft').length,
            submitted: all.filter(r => r.status === 'submitted').length,
            final: all.filter(r => r.status === 'final').length,
        };
    },
};
