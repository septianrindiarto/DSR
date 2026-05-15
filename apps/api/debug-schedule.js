import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);

async function debug() {
    // Non-demo cars with order counts
    const nonDemoCars = await sql`
        SELECT c.id, c.name, c.is_demo, c.organization_id, c.created_by, COUNT(o.id) as order_count
        FROM cars c LEFT JOIN orders o ON o.car_id = c.id
        WHERE c.is_demo = false
        GROUP BY c.id ORDER BY c.id
    `;
    console.log('=== NON-DEMO CARS ===');
    console.log(JSON.stringify(nonDemoCars, null, 2));

    // Non-demo orders with dates in 2026
    const nonDemoOrders2026 = await sql`
        SELECT o.id, o.order_number, o.car_id, o.status, o.is_demo, o.organization_id, o.pickup_date, o.return_date
        FROM orders o
        WHERE o.is_demo = false AND o.pickup_date >= '2026-01-01'
        ORDER BY o.pickup_date DESC LIMIT 15
    `;
    console.log('\n=== NON-DEMO ORDERS (2026) ===');
    console.log(JSON.stringify(nonDemoOrders2026, null, 2));

    // Demo cars with orders in current month (Apr 2026)
    const demoCarsCurrentMonth = await sql`
        SELECT c.id, c.name, c.is_demo as car_demo, o.order_number, o.status, o.is_demo as order_demo, o.pickup_date, o.return_date
        FROM cars c
        INNER JOIN orders o ON o.car_id = c.id
        WHERE o.pickup_date <= '2026-05-31' AND o.return_date >= '2026-04-01'
        ORDER BY o.pickup_date
    `;
    console.log('\n=== ALL CARS WITH ORDERS IN APR-MAY 2026 ===');
    console.log(JSON.stringify(demoCarsCurrentMonth, null, 2));

    await sql.end();
}
debug().catch(e => { console.error(e); process.exit(1); });
