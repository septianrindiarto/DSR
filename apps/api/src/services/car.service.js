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

const PUBLIC_CAR_COLUMNS = {
    id: cars.id, name: cars.name, brand: cars.brand, type: cars.type, category: cars.category,
    year: cars.year, color: cars.color, image: cars.image, gallery: cars.gallery,
    price: cars.price, maxPrice: cars.maxPrice, capacity: cars.capacity,
    transmission: cars.transmission, fuel: cars.fuel, description: cars.description,
    features: cars.features, status: cars.status, availableCount: cars.availableCount,
};

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

    // Public catalogue: only marketing fields. Plates, documents, odometer,
    // owner org and audit columns never leave the API on public routes.
    async findPublic() {
        return db.select(PUBLIC_CAR_COLUMNS).from(cars)
            .where(and(eq(cars.status, 'available'), eq(cars.isDemo, false)))
            .orderBy(desc(cars.createdAt));
    },

    async findPublicById(id) {
        const [car] = await db.select(PUBLIC_CAR_COLUMNS).from(cars).where(eq(cars.id, id)).limit(1);
        return car || null;
    },

    // Public weekly availability for the landing whiteboard. Returns COUNTS
    // only (per car type, per day): no customer, order or plate data.
    async publicAvailability(days = 7) {
        const n = Math.min(Math.max(Number(days) || 7, 1), 14);
        const fleet = await db.select({ type: cars.type, units: sql`COALESCE(SUM(GREATEST(${cars.availableCount}, 1)), 0)::int` })
            .from(cars)
            .where(and(eq(cars.isDemo, false), sql`${cars.status} <> 'maintenance'`))
            .groupBy(cars.type);
        const rows = await db.execute(sql`
            SELECT c.type AS type, (d.day)::date::text AS day, COUNT(DISTINCT o.id)::int AS booked
            FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date,
                                 (now() AT TIME ZONE 'Asia/Jakarta')::date + ${n - 1}::int, interval '1 day') AS d(day)
            JOIN orders o ON (o.pickup_date AT TIME ZONE 'Asia/Jakarta')::date <= d.day::date
                         AND (o.return_date AT TIME ZONE 'Asia/Jakarta')::date >= d.day::date
                         AND o.status IN ('pending', 'confirmed', 'active') AND o.is_demo = false
            JOIN cars c ON c.id = o.car_id AND c.is_demo = false
            GROUP BY c.type, d.day`);
        const list = Array.isArray(rows) ? rows : (rows?.rows || []);
        const booked = new Map(list.map((r) => [`${r.type}|${r.day}`, Number(r.booked) || 0]));
        const start = new Date(Date.now() + 7 * 3600 * 1000); // WIB "today"
        const dates = Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
        return {
            days: dates,
            types: fleet.filter((f) => f.units > 0).map((f) => ({
                type: f.type,
                units: f.units,
                free: dates.map((d) => Math.max(0, f.units - (booked.get(`${f.type}|${d}`) || 0))),
            })),
        };
    },

    // Public trust numbers for the landing photo wall (aggregates only).
    async publicSummary() {
        const rows = await db.execute(sql`
            SELECT
              (SELECT COALESCE(SUM(GREATEST(available_count, 1)), 0)::int FROM cars WHERE is_demo = false AND status <> 'maintenance') AS units,
              (SELECT COUNT(DISTINCT order_number)::int FROM orders WHERE status = 'completed' AND is_demo = false) AS trips,
              (SELECT ROUND(AVG(rating)::numeric, 1)::float FROM reviews WHERE is_demo = false) AS rating,
              (SELECT COUNT(*)::int FROM reviews WHERE is_demo = false) AS reviews`);
        const r = (Array.isArray(rows) ? rows : rows?.rows || [])[0] || {};
        return { units: r.units || 0, trips: r.trips || 0, rating: r.rating ?? null, reviews: r.reviews || 0 };
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

    // Bulk status change for several units at once. `status` must be a valid
    // car_status enum value; invalid values / empty id lists are no-ops.
    async bulkUpdateStatus(ids, status) {
        const valid = ['available', 'rented', 'maintenance'];
        const cleanIds = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
        if (!cleanIds.length || !valid.includes(status)) return [];
        const result = await db.update(cars)
            .set({ status, updatedAt: new Date() })
            .where(inArray(cars.id, cleanIds))
            .returning();
        return result;
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

    // Bulk delete several units. A car with an ACTIVE order (pending/confirmed/
    // active) is SKIPPED so we never orphan a live booking; the rest are
    // deleted. Returns { deleted, skipped, skippedNames } for the toast.
    async bulkDelete(ids) {
        const cleanIds = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
        let deleted = 0, skipped = 0;
        const skippedNames = [];
        for (const id of cleanIds) {
            try {
                if (await this.hasActiveOrders(id)) {
                    const c = await this.findById(id);
                    skippedNames.push(c?.name || `#${id}`);
                    skipped++;
                    continue;
                }
                await this.delete(id);
                deleted++;
            } catch { skipped++; }
        }
        return { deleted, skipped, skippedNames };
    },

    async hasActiveOrders(carId) {
        const result = await db.select({ count: sql`count(*)` }).from(orders)
            .where(and(
                eq(orders.carId, carId),
                inArray(orders.status, ACTIVE_ORDER_STATUSES)
            ));
        return Number(result[0].count) > 0;
    },

    async findAllRaw(scopeUser = null) {
        const conds = buildScopeConditions(scopeUser, { organizationId: cars.organizationId, isDemo: cars.isDemo, createdBy: cars.createdBy });
        const q = db.select().from(cars);
        return (conds.length ? q.where(and(...conds)) : q).orderBy(desc(cars.createdAt));
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
