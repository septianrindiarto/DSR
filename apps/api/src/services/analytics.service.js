import { db } from '../db/index.js';
import { orders, cars, customers } from '../db/schema.js';
import { eq, sql, desc, asc, gte, and } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

/**
 * Build a Drizzle SQL fragment for scoping a table to the user's org/demo.
 * Returns a Drizzle sql`` object (safe for interpolation into other sql`` templates).
 * The `alias` param is a hardcoded table alias from our own code — safe to use in sql.raw().
 */
function buildScopeFragment(user, alias = '') {
    const p = alias ? `${alias}.` : '';
    if (!user || user.role === 'superadmin') return sql``;
    if (user.isDemo === true) {
        const userId = Number(user.id);
        return sql`AND ${sql.raw(`${p}is_demo`)} = true AND ${sql.raw(`${p}created_by`)} = ${userId}`;
    }
    const orgId = user.organizationId;
    if (!orgId) return sql`AND false`;
    if (user.role === 'admin') {
        return sql`AND (${sql.raw(`${p}organization_id`)} = ${Number(orgId)} OR ${sql.raw(`${p}organization_id`)} IS NULL) AND ${sql.raw(`${p}is_demo`)} = false`;
    }
    return sql`AND ${sql.raw(`${p}organization_id`)} = ${Number(orgId)} AND ${sql.raw(`${p}is_demo`)} = false`;
}

export const analyticsService = {
    /**
     * Monthly booking trend (last 12 months).
     */
    async getBookingTrends(scopeUser = null) {
        const scopeSnippet = buildScopeFragment(scopeUser, 'orders');
        const result = await db.execute(sql`
            SELECT
                TO_CHAR(created_at, 'YYYY-MM') as month,
                COUNT(*) as total_orders,
                SUM(CASE WHEN status != 'cancelled' THEN CAST(total_price AS NUMERIC) ELSE 0 END) as revenue,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled
            FROM orders
            WHERE created_at >= NOW() - INTERVAL '12 months'
            ${scopeSnippet}
            GROUP BY TO_CHAR(created_at, 'YYYY-MM')
            ORDER BY month ASC
        `);
        return result;
    },

    /**
     * Revenue breakdown by month.
     */
    async getRevenueAnalytics(scopeUser = null) {
        const scopeSnippet = buildScopeFragment(scopeUser, 'orders');
        const result = await db.execute(sql`
            SELECT
                TO_CHAR(created_at, 'YYYY-MM') as month,
                SUM(CASE WHEN status != 'cancelled' THEN CAST(total_price AS NUMERIC) ELSE 0 END) as revenue,
                COUNT(*) as order_count,
                AVG(CASE WHEN status != 'cancelled' THEN CAST(total_price AS NUMERIC) END) as avg_order_value
            FROM orders
            WHERE created_at >= NOW() - INTERVAL '12 months'
            ${scopeSnippet}
            GROUP BY TO_CHAR(created_at, 'YYYY-MM')
            ORDER BY month ASC
        `);
        return result;
    },

    /**
     * Most booked car categories.
     */
    async getCategoryBreakdown(scopeUser = null) {
        const scopeSnippet = buildScopeFragment(scopeUser, 'o');
        const result = await db.execute(sql`
            SELECT
                c.category,
                c.type,
                COUNT(o.id) as booking_count,
                SUM(CASE WHEN o.status != 'cancelled' THEN CAST(o.total_price AS NUMERIC) ELSE 0 END) as total_revenue
            FROM orders o
            JOIN cars c ON o.car_id = c.id
            WHERE true ${scopeSnippet}
            GROUP BY c.category, c.type
            ORDER BY booking_count DESC
        `);
        return result;
    },

    /**
     * Top cars by booking count.
     */
    async getTopCars(limit = 10, scopeUser = null) {
        const scopeSnippet = buildScopeFragment(scopeUser, 'o');
        const result = await db.execute(sql`
            SELECT
                c.id, c.name, c.brand, c.type, c.category, c.image,
                COUNT(o.id) as booking_count,
                SUM(CASE WHEN o.status != 'cancelled' THEN CAST(o.total_price AS NUMERIC) ELSE 0 END) as total_revenue
            FROM orders o
            JOIN cars c ON o.car_id = c.id
            WHERE true ${scopeSnippet}
            GROUP BY c.id, c.name, c.brand, c.type, c.category, c.image
            ORDER BY booking_count DESC
            LIMIT ${limit}
        `);
        return result;
    },

    /**
     * Customer analytics — top customers, retention.
     */
    async getCustomerAnalytics(scopeUser = null) {
        const scopeSnippet = buildScopeFragment(scopeUser, 'o');
        const result = await db.execute(sql`
            SELECT
                cu.id, cu.name, cu.customer_type, cu.status,
                COUNT(o.id) as total_orders,
                SUM(CASE WHEN o.status != 'cancelled' THEN CAST(o.total_price AS NUMERIC) ELSE 0 END) as total_spent,
                MAX(o.created_at) as last_order
            FROM customers cu
            LEFT JOIN orders o ON cu.id = o.customer_id
            WHERE true ${scopeSnippet}
            GROUP BY cu.id, cu.name, cu.customer_type, cu.status
            ORDER BY total_spent DESC
            LIMIT 20
        `);
        return result;
    },

    /**
     * General KPIs.
     */
    async getKPIs(scopeUser = null) {
        const scopeSnippet = buildScopeFragment(scopeUser, 'orders');
        const custScopeSnippet = buildScopeFragment(scopeUser, 'customers');
        const [orderStats] = await db.execute(sql`
            SELECT
                COUNT(*) as total_orders,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
                SUM(CASE WHEN status != 'cancelled' THEN CAST(total_price AS NUMERIC) ELSE 0 END) as total_revenue,
                AVG(CASE WHEN status != 'cancelled' THEN total_days END) as avg_rental_days,
                AVG(CASE WHEN status != 'cancelled' THEN CAST(total_price AS NUMERIC) END) as avg_order_value
            FROM orders
            WHERE true ${scopeSnippet}
        `);

        const [customerStats] = await db.execute(sql`
            SELECT
                COUNT(*) as total_customers,
                COUNT(CASE WHEN status = 'vip' THEN 1 END) as vip_customers,
                COUNT(CASE WHEN customer_type = 'company' THEN 1 END) as company_customers
            FROM customers
            WHERE true ${custScopeSnippet}
        `);

        return { ...orderStats, ...customerStats };
    },
};
