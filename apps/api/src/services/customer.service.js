import { db } from '../db/index.js';
import { customers, orders } from '../db/schema.js';
import { eq, ilike, or, asc, desc, sql, and, getTableColumns } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

export const customerService = {
    async findAll({ search, status, customerType, sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20, scopeUser = null }) {
        const conditions = [];
        if (search) {
            conditions.push(or(ilike(customers.name, `%${search}%`), ilike(customers.email, `%${search}%`), ilike(customers.phone, `%${search}%`)));
        }
        if (status) conditions.push(eq(customers.status, status));
        if (customerType) conditions.push(eq(customers.customerType, customerType));

        // Company-level isolation
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: customers.organizationId,
            isDemo: customers.isDemo,
            createdBy: customers.createdBy,
        });
        conditions.push(...scopeConds);

        // Live order metrics (match Rekap Order — count every order for the customer)
        const totalOrdersExpr = sql`COALESCE((SELECT COUNT(*)::int FROM ${orders} WHERE ${orders.customerId} = ${customers.id}), 0)`;
        const lastOrderDateExpr = sql`(SELECT MAX(${orders.createdAt}) FROM ${orders} WHERE ${orders.customerId} = ${customers.id})`;

        const sortFields = {
            name: customers.name,
            email: customers.email,
            totalOrders: totalOrdersExpr,
            lastOrderDate: lastOrderDateExpr,
            status: customers.status,
            customerType: customers.customerType,
            createdAt: customers.createdAt,
        };

        const orderField = sortFields[sortBy] || customers.createdAt;
        const orderDir = sortOrder === 'asc' ? asc(orderField) : desc(orderField);
        const offset = (page - 1) * limit;

        const customerCols = getTableColumns(customers);

        let query = db.select({
            ...customerCols,
            totalOrders: totalOrdersExpr.as('total_orders_live'),
            lastOrderDate: lastOrderDateExpr.as('last_order_date_live'),
        }).from(customers);
        let countQuery = db.select({ count: sql`count(*)` }).from(customers);

        if (conditions.length > 0) {
            query = query.where(and(...conditions));
            countQuery = countQuery.where(and(...conditions));
        }

        const results = await query.orderBy(orderDir).limit(limit).offset(offset);
        const countResult = await countQuery;

        return { data: results, total: Number(countResult[0].count), page, limit };
    },

    async findById(id) {
        const result = await db.select().from(customers).where(eq(customers.id, id));
        return result[0] || null;
    },

    async findByPhone(phone) {
        const result = await db.select().from(customers).where(eq(customers.phone, phone));
        return result[0] || null;
    },

    async findOrCreate(data) {
        // Try find by phone/whatsapp first
        if (data.phone || data.whatsapp) {
            const searchPhone = data.phone || data.whatsapp;
            const existing = await db.select().from(customers).where(
                or(eq(customers.phone, searchPhone), eq(customers.whatsapp, searchPhone))
            );
            if (existing.length > 0) return existing[0];
        }
        // Create new
        const result = await db.insert(customers).values(data).returning();
        return result[0];
    },

    async create(data) {
        const result = await db.insert(customers).values(data).returning();
        return result[0];
    },

    async update(id, data) {
        const result = await db.update(customers).set({ ...data, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
        return result[0];
    },

    async delete(id) {
        // Guard: cannot delete if customer has orders (FK is NOT NULL)
        const [countRow] = await db
            .select({ n: sql`COUNT(*)::int` })
            .from(orders)
            .where(eq(orders.customerId, id));
        if (Number(countRow?.n) > 0) {
            throw new Error(`Pelanggan ini memiliki ${countRow.n} pesanan. Hapus pesanan terlebih dahulu sebelum menghapus pelanggan.`);
        }
        const result = await db.delete(customers).where(eq(customers.id, id)).returning();
        return result[0];
    },

    async bulkDelete(ids) {
        let deleted = 0, skipped = 0;
        const skippedNames = [];
        for (const id of ids) {
            try {
                const [countRow] = await db
                    .select({ n: sql`COUNT(*)::int` })
                    .from(orders)
                    .where(eq(orders.customerId, id));
                if (Number(countRow?.n) > 0) {
                    const [cust] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, id));
                    skippedNames.push(cust?.name || `#${id}`);
                    skipped++;
                    continue;
                }
                await db.delete(customers).where(eq(customers.id, id));
                deleted++;
            } catch { skipped++; }
        }
        return { deleted, skipped, skippedNames };
    },

    async deduplicateByName() {
        // Find names with more than one customer record
        const dupes = await db.execute(sql`
            SELECT name, COUNT(*)::int AS cnt, ARRAY_AGG(id ORDER BY id ASC) AS ids
            FROM customers
            GROUP BY name
            HAVING COUNT(*) > 1
        `);
        const rows = dupes.rows ?? dupes;
        let mergedGroups = 0, removed = 0;
        for (const row of rows) {
            const allIds = row.ids;
            const keepId = allIds[0]; // keep oldest (lowest id)
            const dupIds = allIds.slice(1);
            for (const dupId of dupIds) {
                // Reassign this duplicate's orders to the kept record
                await db.update(orders).set({ customerId: keepId }).where(eq(orders.customerId, dupId));
                await db.delete(customers).where(eq(customers.id, dupId));
                removed++;
            }
            mergedGroups++;
        }
        return { mergedGroups, removed };
    },

    async getStats(scopeUser = null) {
        const scopeConds = buildScopeConditions(scopeUser, {
            organizationId: customers.organizationId,
            isDemo: customers.isDemo,
            createdBy: customers.createdBy,
        });

        const [total, active, vip, inactive, priv, company] = await Promise.all([
            db.select({ n: sql`count(*)::int` }).from(customers).where(scopeConds.length ? and(...scopeConds) : undefined).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(customers).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(customers.status, 'active'))).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(customers).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(customers.status, 'vip'))).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(customers).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(customers.status, 'inactive'))).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(customers).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(customers.customerType, 'private'))).then(r => Number(r[0]?.n || 0)),
            db.select({ n: sql`count(*)::int` }).from(customers).where(and(...(scopeConds.length ? scopeConds : [sql`true`]), eq(customers.customerType, 'company'))).then(r => Number(r[0]?.n || 0)),
        ]);

        return { total, active, vip, inactive, private: priv, company };
    },

    async getOrderHistory(customerId) {
        return db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt));
    },
};
