// ─────────────────────────────────────────────────────────────────────────────
// Promote a user to superadmin by email.
//
// Bootstrapping the FIRST superadmin can only happen at the DB level: the
// admin "create user" route forbids minting superadmins, and there is no
// existing superadmin to do it through the UI. Run this once after deploy.
//
// Usage (from apps/api, against whatever DB your .env points to):
//   node src/scripts/promote-superadmin.js you@yourcompany.com
//
// The target account must already be registered (and ideally email-verified).
// Idempotent — running it again on an already-superadmin account is a no-op.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const email = (process.argv[2] || '').trim();
if (!email) {
  console.error('Usage: node src/scripts/promote-superadmin.js <email>');
  process.exit(1);
}

const found = await db.execute(sql`SELECT id, email, role FROM "user" WHERE email = ${email}`);
const rows = found.rows ?? found;
if (!rows.length) {
  console.error(`✗ No user found with email "${email}". Register and verify the account first.`);
  process.exit(1);
}

const current = rows[0];
if (current.role === 'superadmin') {
  console.log(`✓ Already a superadmin: ${current.email} (id ${current.id}). Nothing to do.`);
  process.exit(0);
}

const updated = await db.execute(sql`
  UPDATE "user" SET role = 'superadmin', updated_at = NOW()
  WHERE email = ${email}
  RETURNING id, email, role
`);
console.log('✓ Promoted to superadmin:', (updated.rows ?? updated)[0]);
process.exit(0);
