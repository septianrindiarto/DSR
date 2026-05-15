import { db } from '../db/index.js';
import { chartOfAccounts } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';

export const accountsService = {
    async list() {
        return db.select().from(chartOfAccounts).orderBy(asc(chartOfAccounts.code));
    },

    async get(id) {
        const rows = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, id));
        return rows[0] || null;
    },

    async create({ code, name, type, normalBalance, description }) {
        const rows = await db.insert(chartOfAccounts)
            .values({ code, name, type, normalBalance, description: description || null })
            .returning();
        return rows[0];
    },

    async update(id, { code, name, type, normalBalance, description, isActive }) {
        const rows = await db.update(chartOfAccounts)
            .set({
                ...(code !== undefined && { code }),
                ...(name !== undefined && { name }),
                ...(type !== undefined && { type }),
                ...(normalBalance !== undefined && { normalBalance }),
                ...(description !== undefined && { description }),
                ...(isActive !== undefined && { isActive }),
                updatedAt: new Date(),
            })
            .where(eq(chartOfAccounts.id, id))
            .returning();
        return rows[0];
    },

    async delete(id) {
        const rows = await db.delete(chartOfAccounts).where(eq(chartOfAccounts.id, id)).returning();
        return rows[0];
    },
};
