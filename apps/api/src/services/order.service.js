import { db } from '../db/index.js';
import { orders, cars, customers, drivers } from '../db/schema.js';
import { eq, ilike, or, and, asc, desc, sql, gte, lte, like } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

/**
 * Generate a sequential order number based on customer type.
 *   - customer.customerType === 'company' → prefix "C" (e.g. C001, C002)
 *   - otherwise                           → prefix "P" (e.g. P001, P002)
 *
 * Falls back to "P" when the customer cannot be loaded.
 */
async function generateOrderNumber(customerId) {
    let prefix = 'P';
    try {
        if (customerId) {
            const rows = await db
                .select({ customerType: customers.customerType })
                .from(customers)
                .where(eq(customers.id, customerId))
                .limit(1);
            if (rows.length && rows[0].customerType === 'company') {
                prefix = 'C';
            }
        }
    } catch {
        // leave prefix as default
    }

    // Find max existing sequence for this prefix (e.g. C001, C002, ...)
    const rows = await db
        .select({ orderNumber: orders.orderNumber })
        .from(orders)
        .where(like(orders.orderNumber, `${prefix}%`));

    let max = 0;
    for (const r of rows) {
        const match = /^[CP](\d+)$/.exec(r.orderNumber || '');
        if (match) {
            const n = parseInt(match[1], 10);
            if (n > max) max = n;
        }
    }
    const next = String(max + 1).padStart(3, '0');
    return `${prefix}${next}`;
}

// Map Indonesian (and a few common English) labels back to the canonical enum
// values stored in the DB, so a free-text search like "selesai" or "perusahaan"
// also hits rows whose status / customerType is "completed" / "company".
const SEARCH_SYNONYMS = {
    // order.status
    'selesai': 'completed',
    'menunggu': 'pending',
    'dikonfirmasi': 'confirmed',
    'konfirmasi': 'confirmed',
    'aktif': 'active',
    'berjalan': 'active',
    'dibatalkan': 'cancelled',
    'batal': 'cancelled',
    // customers.customerType
    'pribadi': 'private',
    'perusahaan': 'company',
};

function expandSearchTerms(input) {
    const terms = new Set([input]);
    const lower = String(input || '').trim().toLowerCase();
    if (SEARCH_SYNONYMS[lower]) terms.add(SEARCH_SYNONYMS[lower]);
    return Array.from(terms);
}

const sortFields = {
    orderNumber: orders.orderNumber,
    totalPrice: orders.totalPrice,
    status: orders.status,
    pickupDate: orders.pickupDate,
    returnDate: orders.returnDate,
    createdAt: orders.createdAt,
    totalDays: orders.totalDays,
    package: orders.package,
    destination: orders.destination,
    bailout: orders.bailout,
};

export const orderService = {
    async findAll({ search, status, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20, scopeUser = null }) {
        const offset = (page - 1) * limit;
        const conditions = [];
        if (status && status !== 'all') conditions.push(eq(orders.status, status));

        // Company-level isolation
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
        });
        conditions.push(...scopeConds);

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
            // Expand the user's term to include enum synonyms (e.g. "selesai" → "completed")
            const expanded = expandSearchTerms(search);
            const perTermClauses = expanded.map(raw => {
                const term = `%${raw}%`;
                return or(
                    // Order columns
                    ilike(orders.orderNumber, term),
                    ilike(orders.package, term),
                    ilike(orders.destination, term),
                    ilike(orders.notes, term),
                    ilike(orders.pickupLocation, term),
                    sql`CAST(${orders.status} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.totalDays} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.totalPrice} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.dailyRate} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.overnightNights} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.overtimeHours} AS TEXT) ILIKE ${term}`,
                    sql`CAST(${orders.bailout} AS TEXT) ILIKE ${term}`,
                    sql`TO_CHAR(${orders.pickupDate}, 'YYYY-MM-DD') ILIKE ${term}`,
                    sql`TO_CHAR(${orders.returnDate}, 'YYYY-MM-DD') ILIKE ${term}`,
                    // Customer columns
                    ilike(customers.name, term),
                    ilike(customers.companyName, term),
                    ilike(customers.phone, term),
                    ilike(customers.whatsapp, term),
                    ilike(customers.email, term),
                    sql`CAST(${customers.customerType} AS TEXT) ILIKE ${term}`,
                    // Car columns
                    ilike(cars.name, term),
                    ilike(cars.brand, term),
                    ilike(cars.licensePlate, term),
                    // Driver columns
                    ilike(drivers.name, term),
                    ilike(drivers.phone, term)
                );
            });
            conditions.push(perTermClauses.length === 1 ? perTermClauses[0] : or(...perTermClauses));
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

    async findAllRaw(scopeUser = null) {
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
        });

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

        if (scopeConds.length > 0) query = query.where(and(...scopeConds));
        const results = await query.orderBy(desc(orders.createdAt));

        return results.map(r => ({
            ...r.order,
            car: r.car,
            customer: r.customer,
            driver: r.driver,
        }));
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
        const orderNumber = data.orderNumber || (await generateOrderNumber(data.customerId));
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

    async update(id, data) {
        const updateData = { ...data, updatedAt: new Date() };
        // Never allow orderNumber / id to be overwritten via update
        delete updateData.id;
        delete updateData.orderNumber;
        delete updateData.createdAt;
        const result = await db.update(orders).set(updateData).where(eq(orders.id, id)).returning();
        return result[0];
    },

    async remove(id) {
        const existing = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
        if (existing.length === 0) return null;
        await db.delete(orders).where(eq(orders.id, id));
        return existing[0];
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

    async getStats(scopeUser = null) {
        // Build a scoped base query using Drizzle so the aggregation respects
        // company-level isolation — no raw SQL interpolation needed.
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
        });

        let baseQuery = db.select({ count: sql`1` }).from(orders);
        const whereClause = scopeConds.length > 0 ? and(...scopeConds) : undefined;

        const [total, pending, confirmed, active, completed, cancelled, thisMonth, revenueRows] =
            await Promise.all([
                db.select({ n: sql`count(*)::int` }).from(orders).where(whereClause).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'pending'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'confirmed'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'active'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'completed'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(orders.status, 'cancelled'))).then(r => Number(r[0]?.n || 0)),
                db.select({ n: sql`count(*)::int` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), sql`date_trunc('month', ${orders.createdAt}) = date_trunc('month', NOW())`)).then(r => Number(r[0]?.n || 0)),
                db.select({ rev: sql`coalesce(sum(${orders.totalPrice})::float, 0)` }).from(orders).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), sql`${orders.status} <> 'cancelled'`)),
            ]);

        return {
            total,
            pending,
            confirmed,
            active,
            completed,
            cancelled,
            thisMonth,
            revenue: Number(revenueRows[0]?.rev || 0),
        };
    },
};
