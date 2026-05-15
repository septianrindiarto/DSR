import { db } from '../db/index.js';
import { cars, orders, maintenance } from '../db/schema.js';
import { eq, and, ilike, or, asc, desc, sql, inArray } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

const sortFields = {
    name: cars.name,
    brand: cars.brand,
    price: cars.price,
    capacity: cars.capacity,
    status: cars.status,
    type: cars.type,
    category: cars.category,
    createdAt: cars.createdAt,
};

// Order statuses that block car deletion
const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'active'];

export const carService = {
    async findAll({ search, status, type, category, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20, scopeUser = null }) {
        const conditions = [];
        if (search) {
            conditions.push(or(ilike(cars.name, `%${search}%`), ilike(cars.brand, `%${search}%`)));
        }
        if (status) conditions.push(eq(cars.status, status));
        if (type) conditions.push(eq(cars.type, type));
        if (category) conditions.push(eq(cars.category, category));

        // Company-level isolation
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: cars.organizationId,
            isDemo: cars.isDemo,
            createdBy: cars.createdBy,
        });
        conditions.push(...scopeConds);

        const orderField = sortFields[sortBy] || cars.createdAt;
        const orderDir = sortOrder === 'asc' ? asc(orderField) : desc(orderField);
        const offset = (page - 1) * limit;

        let query = db.select().from(cars);
        let countQuery = db.select({ count: sql`count(*)` }).from(cars);
        if (conditions.length > 0) {
            query = query.where(and(...conditions));
            countQuery = countQuery.where(and(...conditions));
        }
        const results = await query.orderBy(orderDir).limit(limit).offset(offset);
        const countResult = await countQuery;
        return { data: results, total: Number(countResult[0].count), page, limit };
    },

    async findPublic() {
        return db.select().from(cars).where(eq(cars.status, 'available')).orderBy(desc(cars.createdAt));
    },

    async findById(id) {
        const result = await db.select().from(cars).where(eq(cars.id, id));
        return result[0] || null;
    },

    async findByPlate(licensePlate) {
        if (!licensePlate) return null;
        const result = await db.select().from(cars).where(eq(cars.licensePlate, licensePlate));
        return result[0] || null;
    },

    async create(data) {
        const result = await db.insert(cars).values(data).returning();
        return result[0];
    },

    async update(id, data) {
        const result = await db.update(cars).set({ ...data, updatedAt: new Date() }).where(eq(cars.id, id)).returning();
        return result[0];
    },

    async delete(id) {
        // Nullify carId on completed/cancelled orders so FK doesn't block
        await db.execute(
            sql`UPDATE orders SET car_id = NULL WHERE car_id = ${id} AND status IN ('completed', 'cancelled')`
        );
        // Delete related maintenance records
        await db.delete(maintenance).where(eq(maintenance.carId, id));
        // Now delete the car
        const result = await db.delete(cars).where(eq(cars.id, id)).returning();
        return result[0];
    },

    async hasActiveOrders(carId) {
        const result = await db.select({ count: sql`count(*)` }).from(orders)
            .where(and(
                eq(orders.carId, carId),
                inArray(orders.status, ACTIVE_ORDER_STATUSES)
            ));
        return Number(result[0].count) > 0;
    },

    async findAllRaw() {
        return db.select().from(cars).orderBy(desc(cars.createdAt));
    },

    async getStats() {
        const rows = await db.execute(sql`
            SELECT
                COUNT(*)::int                                          AS total,
                COUNT(*) FILTER (WHERE status = 'available')::int      AS available,
                COUNT(*) FILTER (WHERE status = 'rented')::int         AS rented,
                COUNT(*) FILTER (WHERE status = 'maintenance')::int    AS maintenance
            FROM cars
        `);
        const r = rows.rows ? rows.rows[0] : rows[0];
        return {
            total: Number(r.total || 0),
            available: Number(r.available || 0),
            rented: Number(r.rented || 0),
            maintenance: Number(r.maintenance || 0),
        };
    },
};
