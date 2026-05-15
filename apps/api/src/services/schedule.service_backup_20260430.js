import { db } from '../db/index.js';
import { orders, cars, customers, drivers, maintenance } from '../db/schema.js';
import { eq, and, gte, lte, asc, desc, or } from 'drizzle-orm';

export const scheduleService = {
    /**
     * Get fleet schedule for a date range (weekly or monthly view).
     * Returns all cars with their bookings and maintenance in that range.
     */
    async getSchedule({ startDate, endDate }) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Get all cars
        const allCars = await db.select().from(cars).orderBy(asc(cars.name));

        // Get bookings that overlap with the range
        const bookings = await db
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
                    lte(orders.pickupDate, end),
                    gte(orders.returnDate, start),
                    or(
                        eq(orders.status, 'confirmed'),
                        eq(orders.status, 'active'),
                        eq(orders.status, 'pending'),
                        eq(orders.status, 'completed')
                    )
                )
            )
            .orderBy(asc(orders.pickupDate));

        // Get maintenance that overlaps
        const maintenanceRecords = await db
            .select()
            .from(maintenance)
            .where(
                and(
                    lte(maintenance.scheduledDate, end),
                    gte(maintenance.scheduledDate, start),
                    or(
                        eq(maintenance.status, 'scheduled'),
                        eq(maintenance.status, 'in_progress')
                    )
                )
            );

        // Map bookings and maintenance to cars
        return allCars.map(car => ({
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
