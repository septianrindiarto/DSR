import { db } from '../db/index.js';
import { orders, cars, customers, drivers } from '../db/schema.js';
import { eq, ilike, or, and, asc, desc, sql, gte, lte, between } from 'drizzle-orm';

function generateOrderNumber() {
    const prefix = 'ORD';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}${random}`.substring(0, 12);
}

const sortFields = {
    orderNumber: orders.orderNumber,
    totalPrice: orders.totalPrice,
    status: orders.status,
    pickupDate: orders.pickupDate,
    createdAt: orders.createdAt,
    totalDays: orders.totalDays,
};

export const orderService = {
    async findAll({ search, status, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20 }) {
        const offset = (page - 1) * limit;
        const conditions = [];
        if (status && status !== 'all') conditions.push(eq(orders.status, status));

        let query = db
            .select({
                order: orders,
                car: cars,
                customer: customers,
                driver: drivers,
            })
            .from(orders)
            .leftJoin(cars, eq(orders.carId, cars.id))
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id));

        if (search) {
            conditions.push(
                or(
                    ilike(orders.orderNumber, `%${search}%`),
                    ilike(customers.name, `%${search}%`),
                    ilike(cars.name, `%${search}%`)
                )
            );
        }

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
        }

        const orderField = sortFields[sortBy] || orders.createdAt;
        const orderDir = sortOrder === 'asc' ? asc(orderField) : desc(orderField);

        const results = await query.orderBy(orderDir).limit(limit).offset(offset);

        // Count total
        let countQuery = db.select({ count: sql`count(*)` }).from(orders);
        if (status && status !== 'all') {
            countQuery = countQuery.where(eq(orders.status, status));
        }
        const countResult = await countQuery;

        return {
            data: results.map(r => ({
                ...r.order,
                car: r.car,
                customer: r.customer,
                driver: r.driver,
            })),
            total: Number(countResult[0].count),
            page,
            limit,
        };
    },

    async findById(id) {
        const result = await db
            .select({
                order: orders,
                car: cars,
                customer: customers,
                driver: drivers,
            })
            .from(orders)
            .leftJoin(cars, eq(orders.carId, cars.id))
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id))
            .where(eq(orders.id, id));

        if (result.length === 0) return null;
        const r = result[0];
        return { ...r.order, car: r.car, customer: r.customer, driver: r.driver };
    },

    async create(data) {
        const orderNumber = generateOrderNumber();
        const result = await db.insert(orders).values({
            ...data,
            orderNumber,
        }).returning();

        // Update customer total orders
        if (data.customerId) {
            await db.execute(sql`
                UPDATE customers
                SET total_orders = total_orders + 1,
                    last_order_date = NOW(),
                    updated_at = NOW()
                WHERE id = ${data.customerId}
            `);
        }

        return result[0];
    },

    async updateStatus(id, status, userId) {
        const updateData = { status, updatedAt: new Date() };
        if (status === 'confirmed' && userId) {
            updateData.approvedBy = userId;
            updateData.approvedAt = new Date();
        }
        const result = await db.update(orders).set(updateData).where(eq(orders.id, id)).returning();
        return result[0];
    },

    async assignDriver(id, driverId) {
        const result = await db.update(orders).set({ driverId, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
        return result[0];
    },

    async markWhatsAppSent(id) {
        const result = await db.update(orders).set({ whatsappSent: true, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
        return result[0];
    },

    async getByDateRange(startDate, endDate) {
        return db.select({
            order: orders,
            car: cars,
            customer: customers,
            driver: drivers,
        })
        .from(orders)
        .leftJoin(cars, eq(orders.carId, cars.id))
        .leftJoin(customers, eq(orders.customerId, customers.id))
        .leftJoin(drivers, eq(orders.driverId, drivers.id))
        .where(
            and(
                gte(orders.pickupDate, new Date(startDate)),
                lte(orders.returnDate, new Date(endDate))
            )
        )
        .orderBy(asc(orders.pickupDate));
    },

    async getStats() {
        const all = await db.select().from(orders);
        const thisMonth = all.filter(o => {
            const d = new Date(o.createdAt);
            const now = new Date();
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        return {
            total: all.length,
            pending: all.filter(o => o.status === 'pending').length,
            confirmed: all.filter(o => o.status === 'confirmed').length,
            active: all.filter(o => o.status === 'active').length,
            completed: all.filter(o => o.status === 'completed').length,
            cancelled: all.filter(o => o.status === 'cancelled').length,
            thisMonth: thisMonth.length,
            revenue: all.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.totalPrice || 0), 0),
        };
    },
};
