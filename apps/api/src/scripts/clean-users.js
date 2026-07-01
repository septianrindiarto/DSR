// ─────────────────────────────────────────────────────────────────────────────
// Delete ALL users except superadmin(s).  ⚠️  DESTRUCTIVE — dev/reset use only.
//
// Keeps every account with role = 'superadmin' and removes everyone else
// (agency admins, client admins, client users, demo users…). It first detaches
// or deletes every row that points at the doomed users so the final DELETE
// can't trip a foreign-key constraint:
//   • nullable references (created_by / approved_by / user_id / admin_user_id …)
//     are set to NULL — the business rows (cars, orders, customers…) survive.
//   • rows that belong to a user (sessions, accounts, access requests, activity
//     logs, dashboard prefs) are deleted.
//
// SAFE BY DEFAULT: prints a plan and changes nothing. Add --confirm to execute.
//
// Usage (from apps/api, against whatever DB your .env points to):
//   node src/scripts/clean-users.js            # dry run — shows what it WOULD do
//   node src/scripts/clean-users.js --confirm   # actually delete
//
// Optionally keep extra accounts by email (in addition to all superadmins):
//   node src/scripts/clean-users.js --confirm --keep you@x.com --keep ops@x.com
//
// For a from-ZERO smoke test you usually also want orders to be claimable
// again and the agency↔client links cleared (deleting a user does NOT do
// either — claims are owned by the agency ORG, not the user):
//   --release-claims   reset every order back to 'unclaimed' (clears
//                      claim_status + claimed_by_agency_id + claimed_by_user_id)
//   --reset-links      delete all client_agency_links (relationships reset)
// Both flags also require --confirm to actually run.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const RELEASE_CLAIMS = args.includes('--release-claims');
const RESET_LINKS = args.includes('--reset-links');
const keepEmails = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--keep' && args[i + 1]) keepEmails.push(args[i + 1].trim().toLowerCase());
}

const rows = (r) => r?.rows ?? r ?? [];

// Who survives: every superadmin, plus any explicitly kept emails.
// NB: binding a JS array to ALL()/ANY() is unreliable here (drizzle passes it
// as one scalar param → "malformed array literal"), so we expand into an
// IN (...) list of individually-bound params instead.
const inList = (vals) => sql.join(vals.map((v) => sql`${v}`), sql`, `);
const emailFilter = keepEmails.length ? sql` OR LOWER(email) IN (${inList(keepEmails)})` : sql``;
const keepers = rows(await db.execute(sql`
  SELECT id, email, role FROM "user"
  WHERE role = 'superadmin'${emailFilter}
`));
if (keepers.length === 0) {
  console.error('✗ Refusing to run: no superadmin (or --keep) account found — that would wipe every user.');
  process.exit(1);
}
const keepIds = keepers.map((k) => k.id);
const idList = inList(keepIds); // reusable "$1, $2, …" fragment for NOT IN (…)

const targets = rows(await db.execute(sql`
  SELECT id, email, role FROM "user" WHERE id NOT IN (${idList})
`));

console.log(`\nKeeping ${keepers.length} account(s):`);
for (const k of keepers) console.log(`  ✓ ${k.email}  (${k.role || 'no-role'})`);
console.log(`\nWill DELETE ${targets.length} account(s):`);
for (const t of targets.slice(0, 50)) console.log(`  ✗ ${t.email}  (${t.role || 'no-role'})`);
if (targets.length > 50) console.log(`  … and ${targets.length - 50} more`);

if (RELEASE_CLAIMS) console.log('\nWill RELEASE all order claims → every order becomes claimable again.');
if (RESET_LINKS)    console.log('Will DELETE all client_agency_links → agency↔client relationships reset.');

if (targets.length === 0 && !RELEASE_CLAIMS && !RESET_LINKS) {
  console.log('\nNothing to do.'); process.exit(0);
}
if (!CONFIRM) {
  console.log('\nDRY RUN — nothing changed. Re-run with --confirm to execute.\n');
  process.exit(0);
}

// Run one statement, tolerating tables/columns that don't exist in this DB
// (undefined_table 42P01 / undefined_column 42703). Each runs on its own so a
// missing optional table can't abort the rest.
async function step(label, query) {
  try {
    await db.execute(query);
    console.log(`  • ${label}`);
  } catch (e) {
    const code = e?.cause?.code || e?.code;
    if (code === '42P01' || code === '42703') return; // table/column not present — skip
    console.warn(`  ! ${label} — ${e?.message || e}`);
  }
}

let deletedCount = 0;
if (targets.length > 0) {
console.log('\nDetaching references …');
// Null out every nullable column that may point at a doomed user.
await step('orders.approved_by',            sql`UPDATE orders            SET approved_by        = NULL WHERE approved_by        NOT IN (${idList})`);
await step('orders.created_by',             sql`UPDATE orders            SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('orders.claimed_by_user_id',     sql`UPDATE orders            SET claimed_by_user_id = NULL WHERE claimed_by_user_id NOT IN (${idList})`);
await step('customers.user_id',             sql`UPDATE customers         SET user_id            = NULL WHERE user_id            NOT IN (${idList})`);
await step('customers.created_by',          sql`UPDATE customers         SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('cars.created_by',               sql`UPDATE cars              SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('drivers.created_by',            sql`UPDATE drivers           SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('companies.created_by',          sql`UPDATE companies         SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('maintenance.created_by',        sql`UPDATE maintenance       SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('reviews.created_by',            sql`UPDATE reviews           SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('journal_entries.created_by',    sql`UPDATE journal_entries   SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('chart_of_accounts.created_by',  sql`UPDATE chart_of_accounts SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('financial_reports.created_by',  sql`UPDATE financial_reports SET created_by         = NULL WHERE created_by         NOT IN (${idList})`);
await step('locked_periods.locked_by',      sql`UPDATE locked_periods    SET locked_by          = NULL WHERE locked_by          NOT IN (${idList})`);
await step('sync_logs.triggered_by',        sql`UPDATE sync_logs         SET triggered_by       = NULL WHERE triggered_by       NOT IN (${idList})`);
await step('organizations.admin_user_id',   sql`UPDATE organizations     SET admin_user_id      = NULL WHERE admin_user_id      NOT IN (${idList})`);
await step('access_requests.decided_by',    sql`UPDATE access_requests   SET decided_by         = NULL WHERE decided_by         NOT IN (${idList})`);
await step('client_agency_links.created_by',sql`UPDATE client_agency_links SET created_by       = NULL WHERE created_by         NOT IN (${idList})`);

console.log('Deleting user-owned rows …');
await step('access_requests',  sql`DELETE FROM access_requests WHERE user_id      NOT IN (${idList})`);
await step('activity_logs',    sql`DELETE FROM activity_logs   WHERE user_id      NOT IN (${idList})`);
await step('dashboard_prefs',  sql`DELETE FROM dashboard_prefs WHERE user_id      NOT IN (${idList})`);
await step('session',          sql`DELETE FROM session         WHERE user_id      NOT IN (${idList})`);
await step('account',          sql`DELETE FROM account         WHERE user_id      NOT IN (${idList})`);

console.log('Deleting users …');
const deleted = rows(await db.execute(sql`
  DELETE FROM "user" WHERE id NOT IN (${idList}) RETURNING id, email
`));
deletedCount = deleted.length;
}

if (RELEASE_CLAIMS) {
  console.log('Releasing all order claims …');
  await step('orders → unclaimed', sql`
    UPDATE orders SET claim_status = 'unclaimed', claimed_by_agency_id = NULL, claimed_by_user_id = NULL
  `);
}
if (RESET_LINKS) {
  console.log('Resetting client_agency_links …');
  await step('client_agency_links cleared', sql`DELETE FROM client_agency_links`);
}

console.log(`\n✓ Done. Deleted ${deletedCount} user(s). ${keepers.length} superadmin/kept account(s) remain.` +
  (RELEASE_CLAIMS ? ' All orders released for re-claim.' : '') +
  (RESET_LINKS ? ' Relationships reset.' : '') + '\n');
process.exit(0);
