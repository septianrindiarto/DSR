// ─────────────────────────────────────────────────────────────────────────────
// Repair an agency admin that was created before agency-signup made an org.
//
// Symptom: the agency admin has organization_id = NULL, so the order/user scope
// (which keys off their org id) returns nothing — they can't see client orders
// and the Pengguna list is empty.
//
// This script ensures the agency's organization exists (agency = parent_agency_id
// NULL) and attaches the admin to it with account_type='agency', role='admin'.
//
// Usage (from apps/api, against whatever DB .env points to):
//   node src/scripts/fix-agency-admin.js admin@dsrappai.com "DSR Rent Car"
//
// Idempotent. The agency name defaults to "DSR Rent Car".
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const email = (process.argv[2] || '').trim();
const agencyName = (process.argv[3] || 'DSR Rent Car').trim();
if (!email) {
  console.error('Usage: node src/scripts/fix-agency-admin.js <admin-email> ["Agency Name"]');
  process.exit(1);
}
const rowsOf = (r) => r.rows ?? r;

// 1. The user must exist.
const users = rowsOf(await db.execute(sql`SELECT id, email FROM "user" WHERE email = ${email} LIMIT 1`));
if (!users.length) {
  console.error(`✗ No user with email "${email}". Register the account first.`);
  process.exit(1);
}
const userId = users[0].id;

// 2. Ensure the agency org (agency = parent_agency_id IS NULL).
let orgs = rowsOf(await db.execute(
  sql`SELECT id FROM organizations WHERE LOWER(TRIM(name)) = ${agencyName.toLowerCase()} LIMIT 1`
));
let orgId = orgs[0]?.id;
if (!orgId) {
  const created = rowsOf(await db.execute(sql`
    INSERT INTO organizations (name, name_normalized, is_active, admin_user_id, parent_agency_id)
    VALUES (${agencyName}, ${agencyName.toLowerCase()}, true, ${userId}, NULL)
    RETURNING id
  `));
  orgId = created[0].id;
  console.log(`✓ Created agency org "${agencyName}" (id ${orgId}).`);
} else {
  console.log(`✓ Found agency org "${agencyName}" (id ${orgId}).`);
}

// 3. Attach the admin to it.
const updated = rowsOf(await db.execute(sql`
  UPDATE "user"
  SET organization_id = ${orgId}, account_type = 'agency', role = 'admin', updated_at = NOW()
  WHERE email = ${email}
  RETURNING id, email, role, account_type, organization_id
`));
console.log('✓ Fixed admin:', updated[0]);
console.log(`ℹ To make EXISTING client orgs visible to this agency, set their parent_agency_id = ${orgId} (part of the Stage 2 migration procedure).`);
process.exit(0);
