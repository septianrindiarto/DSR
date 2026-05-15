import { db } from '../db/index.js';
import { dashboardPrefs, orders, cars, customers, drivers } from '../db/schema.js';
import { eq, desc, sql, and } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

const DEFAULT_WIDGETS = [
    { id: 'total_cars', label: 'Total Mobil', enabled: true, order: 0 },
    { id: 'pending_orders', label: 'Order Menunggu', enabled: true, order: 1 },
    { id: 'monthly_orders', label: 'Order Bulan Ini', enabled: true, order: 2 },
    { id: 'revenue', label: 'Pendapatan', enabled: true, order: 3 },
    { id: 'recent_orders', label: 'Order Terbaru', enabled: true, order: 4 },
    { id: 'fleet_status', label: 'Status Armada', enabled: true, order: 5 },
    { id: 'customer_summary', label: 'Pelanggan', enabled: false, order: 6 },
    { id: 'driver_summary', label: 'Driver', enabled: false, order: 7 },
    { id: 'schedule_preview', label: 'Jadwal Minggu Ini', enabled: false, order: 8 },
];

export const dashboardService = {
    async getStats(scopeUser = null) {
        const orderScope = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
        });
        const carScope = buildScopeConditions(scopeUser, {
            organizationId: cars.organizationId,
            isDemo: cars.isDemo,
            createdBy: cars.createdBy,
        });
        const custScope = buildScopeConditions(scopeUser, {
            organizationId: customers.organizationId,
            isDemo: customers.isDemo,
            createdBy: customers.createdBy,
        });
        const drvScope = buildScopeConditions(scopeUser, {
            organizationId: drivers.organizationId,
            isDemo: drivers.isDemo,
            createdBy: drivers.createdBy,
        });

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const base = (conds) => conds.length ? and(...conds) : undefined;

        const [
            carCount, customerCount, driverCount,
            allOrders, allCars,
            pendingCount, activeCount, monthlyCount,
        ] = await Promise.all([
            db.select({ count: sql`count(*)::int` }).from(cars).where(base(carScope)).then(r => Number(r[0]?.count || 0)),
            db.select({ count: sql`count(*)::int` }).from(customers).where(base(custScope)).then(r => Number(r[0]?.count || 0)),
            db.select({ count: sql`count(*)::int` }).from(drivers).where(base(drvScope)).then(r => Number(r[0]?.count || 0)),
            db.select({ status: orders.status, totalPrice: orders.totalPrice }).from(orders).where(base(orderScope)),
            db.select({ status: cars.status }).from(cars).where(base(carScope)),
            db.select({ count: sql`count(*)::int` }).from(orders).where(and(...(orderScope.length ? orderScope : [sql`true`]), eq(orders.status, 'pending'))).then(r => Number(r[0]?.count || 0)),
            db.select({ count: sql`count(*)::int` }).from(orders).where(and(...(orderScope.length ? orderScope : [sql`true`]), eq(orders.status, 'active'))).then(r => Number(r[0]?.count || 0)),
            db.select({ count: sql`count(*)::int` }).from(orders).where(and(...(orderScope.length ? orderScope : [sql`true`]), sql`${orders.createdAt} >= ${monthStart}`)).then(r => Number(r[0]?.count || 0)),
        ]);

        const totalRevenue = allOrders
            .filter(o => o.status !== 'cancelled')
            .reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);

        const monthlyRevenue = allOrders
            .filter(o => {
                const d = new Date(o.createdAt);
                return o.status !== 'cancelled' && d >= monthStart;
            })
            .reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);

        return {
            totalCars: carCount,
            totalCustomers: customerCount,
            totalDrivers: driverCount,
            totalOrders: allOrders.length,
            pendingOrders: pendingCount,
            activeOrders: activeCount,
            monthlyOrders: monthlyCount,
            totalRevenue,
            monthlyRevenue,
            availableCars: allCars.filter(c => c.status === 'available').length,
            rentedCars: allCars.filter(c => c.status === 'rented').length,
            maintenanceCars: allCars.filter(c => c.status === 'maintenance').length,
        };
    },

    async getRecentOrders(limit = 5, scopeUser = null) {
        const orderScope = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
        });

        let query = db
            .select({ order: orders, car: cars, customer: customers })
            .from(orders)
            .leftJoin(cars, eq(orders.carId, cars.id))
            .leftJoin(customers, eq(orders.customerId, customers.id));

        if (orderScope.length) query = query.where(and(...orderScope));

        const result = await query.orderBy(desc(orders.createdAt)).limit(limit);
        return result.map(r => ({ ...r.order, car: r.car, customer: r.customer }));
    },

    async getPreferences(userId) {
        const result = await db.select().from(dashboardPrefs).where(eq(dashboardPrefs.userId, userId));
        if (result.length === 0) {
            return DEFAULT_WIDGETS;
        }
        return result[0].widgetConfig;
    },

    async savePreferences(userId, widgetConfig) {
        const existing = await db.select().from(dashboardPrefs).where(eq(dashboardPrefs.userId, userId));
        if (existing.length > 0) {
            await db.update(dashboardPrefs).set({ widgetConfig, updatedAt: new Date() }).where(eq(dashboardPrefs.userId, userId));
        } else {
            await db.insert(dashboardPrefs).values({ userId, widgetConfig });
        }
        return widgetConfig;
    },
};
