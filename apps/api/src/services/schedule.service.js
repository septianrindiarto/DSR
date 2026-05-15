import { db } from '../db/index.js';
import { orders, cars, customers, drivers, maintenance } from '../db/schema.js';
import { eq, and, gte, lte, asc, or, sql, ne, inArray } from 'drizzle-orm';
import { buildScopeConditions } from '../middleware/scope.js';

export const scheduleService = {
    /**
     * Get fleet schedule for a date range (weekly or monthly view).
     *
     * Inclusion rules:
     *   1. Cars that have bookings within the date range
     *   2. Cars with status 'available' or 'maintenance' that have ANY historical order
     *   3. Inactive cars that still have ANY historical order
     *   4. EXCLUDE cars with zero orders ever AND inactive cars with no history
     *
     * All queries are scoped to the user's organization. Demo data is only
     * visible to demo users.
     */
    async getSchedule({ startDate, endDate, scopeUser = null }) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        // ── Scope conditions ─────────────────────────────────────────
        const carScope = buildScopeConditions(scopeUser, {
            organizationId: cars.organizationId,
            isDemo: cars.isDemo,
            createdBy: cars.createdBy,
        });
        const orderScope = buildScopeConditions(scopeUser, {
            organizationId: orders.organizationId,
            isDemo: orders.isDemo,
            createdBy: orders.createdBy,
        });
        const maintScope = buildScopeConditions(scopeUser, {
            organizationId: maintenance.organizationId,
            isDemo: maintenance.isDemo,
            createdBy: maintenance.createdBy,
        });

        // ── 1. Get IDs of cars that have EVER had an order (scoped) ──
        let carsWithOrdersQ = db
            .selectDistinct({ carId: orders.carId })
            .from(orders);
        if (orderScope.length) carsWithOrdersQ = carsWithOrdersQ.where(and(...orderScope));
        const carsWithOrderRows = await carsWithOrdersQ;
        const carsWithOrderIds = new Set(
            carsWithOrderRows.map(r => r.carId).filter(Boolean)
        );

        // ── 2. Get ALL scoped cars ───────────────────────────────────
        let carQuery = db.select().from(cars);
        if (carScope.length) carQuery = carQuery.where(and(...carScope));
        const allCars = await carQuery.orderBy(asc(cars.name));

        // ── 3. Apply filtering rules ─────────────────────────────────
        // Rule: include car IF it has at least one historical order,
        //       EXCLUDE if no orders AND (status = anything, but especially
        //       inactive with no history).
        const eligibleCars = allCars.filter(car => carsWithOrderIds.has(car.id));

        // ── 4. Get bookings overlapping with the requested range ─────
        const bookingConditions = [
            lte(orders.pickupDate, end),
            gte(orders.returnDate, start),
            or(
                eq(orders.status, 'confirmed'),
                eq(orders.status, 'active'),
                eq(orders.status, 'pending'),
                eq(orders.status, 'completed')
            ),
        ];
        if (orderScope.length) bookingConditions.push(...orderScope);

        const bookings = await db
            .select({
                order: orders,
                customer: customers,
                driver: drivers,
            })
            .from(orders)
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id))
            .where(and(...bookingConditions))
            .orderBy(asc(orders.pickupDate));

        // ── 5. Get maintenance overlapping with range ────────────────
        const maintConditions = [
            lte(maintenance.scheduledDate, end),
            gte(maintenance.scheduledDate, start),
            or(
                eq(maintenance.status, 'scheduled'),
                eq(maintenance.status, 'in_progress')
            ),
        ];
        if (maintScope.length) maintConditions.push(...maintScope);

        const maintenanceRecords = await db
            .select()
            .from(maintenance)
            .where(and(...maintConditions));

        // ── 6. Build per-car rows ────────────────────────────────────
        const carRows = eligibleCars.map(car => ({
            car,
            bookings: bookings
                .filter(b => b.order.carId === car.id)
                .map(b => ({
                    ...b.order,
                    customer: b.customer,
                    driver: b.driver,
                })),
            maintenance: maintenanceRecords.filter(m => m.carId === car.id),
        }));

        // ── 7. Collect unassigned orders (car_id IS NULL) ────────────
        const assignedIds = new Set(carRows.flatMap(r => r.bookings.map(b => b.id)));
        const unassigned = bookings
            .filter(b => !assignedIds.has(b.order.id))
            .map(b => ({ ...b.order, customer: b.customer, driver: b.driver }));

        if (unassigned.length > 0) {
            carRows.push({ car: null, bookings: unassigned, maintenance: [] });
        }

        return carRows;
    },

    /**
     * Get schedule for a specific car.
     */
    async getCarSchedule(carId, { startDate, endDate }) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        const carBookings = await db
            .select({
                order: orders,
                customer: customers,
                driver: drivers,
            })
            .from(orders)
            .leftJoin(customers, eq(orders.customerId, customers.id))
            .leftJoin(drivers, eq(orders.driverId, drivers.id))
            .where(
                and(
                    eq(orders.carId, carId),
                    lte(orders.pickupDate, end),
                    gte(orders.returnDate, start)
                )
            )
            .orderBy(asc(orders.pickupDate));

        const carMaintenance = await db
            .select()
            .from(maintenance)
            .where(
                and(
                    eq(maintenance.carId, carId),
                    lte(maintenance.scheduledDate, end),
                    gte(maintenance.scheduledDate, start)
                )
            );

        return { bookings: carBookings, maintenance: carMaintenance };
    },
};

