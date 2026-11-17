// READ-ONLY diagnostic: why does an agency's Rekap Order show fewer bookings
// than the superadmin's? Runs SELECTs only — it changes nothing.
//
//   cd apps/api
//   node src/scripts/diag-order-visibility.js            # agency = DSR Rent Car (first agency)
//   node src/scripts/diag-order-visibility.js 1          # agency by organisation id
//
// Rekap Order rule for an agency (middleware/scope.js): it sees orders of its
// own organisation OR orders claimed by it (claimed_by_agency_id), excluding
// demo rows. Everything else is listed below with the reason, so you can
// decide what (if anything) to reassign. Reassigning is a data change (DML):
// ask clo first.
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', idle_timeout: 5 });

try {
    const arg = process.argv[2] ? Number(process.argv[2]) : null;
    const [agency] = arg
        ? await sql`SELECT id, name FROM organizations WHERE id = ${arg} AND parent_agency_id IS NULL`
        : await sql`SELECT id, name FROM organizations WHERE parent_agency_id IS NULL ORDER BY id LIMIT 1`;
    if (!agency) throw new Error('Agency not found (give an organisation id with parent_agency_id NULL).');
    const A = agency.id;

    const [tot] = await sql`SELECT count(*)::int AS rows, count(DISTINCT order_number)::int AS bookings FROM orders`;
    const [vis] = await sql`SELECT count(*)::int AS rows, count(DISTINCT order_number)::int AS bookings FROM orders
                            WHERE (organization_id = ${A} OR claimed_by_agency_id = ${A}) AND is_demo = false`;
    console.log(`\nAgency: ${agency.name} (id ${A})`);
    console.log(`Superadmin sees : ${tot.bookings} bookings / ${tot.rows} rows`);
    console.log(`This agency sees: ${vis.bookings} bookings / ${vis.rows} rows   (Rekap counts bookings)\n`);

    const hidden = await sql`
        SELECT
          CASE
            WHEN o.is_demo THEN '1 demo data (only demo accounts see it)'
            WHEN o.client_approval_status = 'waiting' THEN '2 waiting for client approval (agencies never see it until approved)'
            WHEN o.claimed_by_agency_id IS NULL AND (o.claim_status = 'agency_claimed'
                 OR o.created_by IN (SELECT id FROM "user" WHERE role = 'superadmin'))
              THEN '3 NO owning agency — entered/imported by superadmin (repair: fix-unowned-orders.js)'
            WHEN o.claim_status IS NULL OR o.claim_status = 'unclaimed' THEN '3 unclaimed (shown in Klaim Order, not Rekap)'
            WHEN o.claimed_by_agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organizations x WHERE x.id = o.claimed_by_agency_id)
              THEN '4 claimed by a DELETED agency (orphan)'
            WHEN o.claimed_by_agency_id IS NOT NULL AND o.claimed_by_agency_id <> ${A} THEN '5 claimed by another agency'
            ELSE '7 other'
          END AS reason,
          count(DISTINCT o.order_number)::int AS bookings,
          count(*)::int AS rows,
          string_agg(DISTINCT o.order_number, ', ') AS codes
        FROM orders o
        WHERE NOT (COALESCE(o.organization_id = ${A} OR o.claimed_by_agency_id = ${A}, false) AND o.is_demo = false)
        GROUP BY 1 ORDER BY 1`;
    if (hidden.length === 0) console.log('Nothing hidden — the counts should match.');
    for (const h of hidden) {
        const codes = (h.codes || '').split(', ');
        console.log(`- ${h.reason.slice(2)}: ${h.bookings} bookings / ${h.rows} rows`);
        console.log(`    codes: ${codes.slice(0, 15).join(', ')}${codes.length > 15 ? ` … (+${codes.length - 15})` : ''}`);
    }
    const other = await sql`
        SELECT o.claimed_by_agency_id AS id, g.name, count(DISTINCT o.order_number)::int AS bookings
        FROM orders o LEFT JOIN organizations g ON g.id = o.claimed_by_agency_id
        WHERE o.claimed_by_agency_id IS NOT NULL AND o.claimed_by_agency_id <> ${A} AND o.is_demo = false
        GROUP BY 1, 2 ORDER BY 3 DESC`;
    if (other.length) {
        console.log('\nClaimed by other / deleted agencies:');
        for (const r of other) console.log(`  #${r.id} ${r.name || '(deleted)'}: ${r.bookings} bookings`);
    }
    console.log('\nNo data was changed. To move any group to this agency, tell clo which group(s).');
} catch (e) {
    console.error('Diagnostic failed:', e.message);
    process.exitCode = 1;
} finally {
    await sql.end();
}
