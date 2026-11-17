// Give an owning agency to orders that have none (data repair, owner test 2026-10-28).
//
// Cause: orders entered or imported by the SUPERADMIN (who has no organisation)
// were saved with claimed_by_agency_id = NULL, so no agency's Rekap showed them
// (DSR Rent Car admin saw up to C080; C081… were missing). The code is fixed;
// this repairs the existing rows.
//
//   cd apps/api
//   node src/scripts/fix-unowned-orders.js           # DRY RUN — shows what would change
//   node src/scripts/fix-unowned-orders.js --apply   # writes (make a Neon branch first)
//
// Rows touched: non-demo orders with no owning agency that are either marked
// 'agency_claimed' or were created by a superadmin. Owner = the client org's
// single active agency link → its parent agency → the org itself if it is an
// agency → the default agency (DEFAULT_AGENCY_ID or the first agency).
// Genuine unclaimed public/client orders (not created by a superadmin) are left
// alone — they belong in Klaim Order.
import 'dotenv/config';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', idle_timeout: 5 });

const OWNER = (defaultId) => sql`
    COALESCE(
      (SELECT min(l.agency_org_id) FROM client_agency_links l
         WHERE l.client_org_id = o.organization_id AND l.status = 'active'
         HAVING count(*) = 1),
      (SELECT g.parent_agency_id FROM organizations g WHERE g.id = o.organization_id AND g.parent_agency_id IS NOT NULL),
      (SELECT g.id FROM organizations g WHERE g.id = o.organization_id AND g.parent_agency_id IS NULL),
      ${defaultId}
    )`;

const WHERE = sql`
    o.is_demo = false
    AND o.claimed_by_agency_id IS NULL
    AND (o.claim_status = 'agency_claimed'
         OR o.created_by IN (SELECT id FROM "user" WHERE role = 'superadmin'))`;

try {
    const envId = Number(process.env.DEFAULT_AGENCY_ID) || null;
    const [def] = envId
        ? await sql`SELECT id, name FROM organizations WHERE id = ${envId} AND parent_agency_id IS NULL`
        : await sql`SELECT id, name FROM organizations WHERE parent_agency_id IS NULL AND is_active = true ORDER BY id LIMIT 1`;
    if (!def) throw new Error('No agency found to use as default.');

    const preview = await sql`
        SELECT ${OWNER(def.id)} AS owner, count(*)::int AS rows, count(DISTINCT o.order_number)::int AS bookings,
               min(o.order_number) AS first_code, max(o.order_number) AS last_code
        FROM orders o WHERE ${WHERE} GROUP BY 1 ORDER BY 1`;
    const names = Object.fromEntries((await sql`SELECT id, name FROM organizations`).map((r) => [r.id, r.name]));

    console.log(`\nDefault agency: ${def.name} (id ${def.id})`);
    if (!preview.length) { console.log('Nothing to repair.'); }
    for (const p of preview) {
        console.log(`→ ${names[p.owner] || p.owner}: ${p.bookings} bookings / ${p.rows} rows (codes ${p.first_code} … ${p.last_code})`);
    }

    if (preview.length && APPLY) {
        const res = await sql`
            UPDATE orders o
               SET claimed_by_agency_id = ${OWNER(def.id)},
                   claim_status = 'agency_claimed',
                   claimed_at = COALESCE(o.claimed_at, o.created_at, NOW()),
                   updated_at = NOW()
             WHERE ${WHERE}`;
        console.log(`\nUpdated ${res.count} rows.`);
    } else if (preview.length) {
        console.log('\nDRY RUN — nothing changed. Re-run with --apply after making a Neon backup branch.');
    }
} catch (e) {
    console.error('Repair failed:', e.message);
    process.exitCode = 1;
} finally {
    await sql.end();
}
