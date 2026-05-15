import { db } from '../db/index.js';
import { maintenance, cars } from '../db/schema.js';
import { eq, asc, desc, sql, and } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

export const maintenanceService = {
    async findAll({ status, sortBy = 'scheduledDate', sortOrder = 'desc', page = 1, limit = 20, scopeUser = null }) {
        const offset = (page - 1) * limit;

        const conditions = [];
        if (status) conditions.push(eq(maintenance.status, status));

        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: maintenance.organizationId,
            isDemo: maintenance.isDemo,
            createdBy: maintenance.createdBy,
        });
        conditions.push(...scopeConds);

        let query = db
            .select({ maintenance, car: cars })
            .from(maintenance)
            .leftJoin(cars, eq(maintenance.carId, cars.id));

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
        }

        const orderField = sortOrder === 'asc' ? asc(maintenance.scheduledDate) : desc(maintenance.scheduledDate);
        const results = await query.orderBy(orderField).limit(limit).offset(offset);

        const countResult = await db.select({ count: sql`count(*)` }).from(maintenance);

        return {
            data: results.map(r => ({ ...r.maintenance, car: r.car })),
            total: Number(countResult[0].count),
            page,
            limit,
        };
    },

    async create(data) {
        const result = await db.insert(maintenance).values(data).returning();
        // If scheduling maintenance, update car status
        if (data.status === 'in_progress') {
            await db.update(cars).set({ status: 'maintenance', updatedAt: new Date() }).where(eq(cars.id, data.carId));
        }
        return result[0];
    },

    async update(id, data) {
        const result = await db.update(maintenance).set(data).where(eq(maintenance.id, id)).returning();
        // If completed, set car back to available
        if (data.status === 'completed' && result[0]) {
            await db.update(cars).set({ status: 'available', updatedAt: new Date() }).where(eq(cars.id, result[0].carId));
        }
        return result[0];
    },
};
