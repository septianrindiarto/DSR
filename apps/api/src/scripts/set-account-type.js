// ─────────────────────────────────────────────────────────────────────────────
// Flip an account between client and agency (and optionally set role / org).
// Safer than hand-writing SQL, and dry-run by default.
//
// The login guard enforces account_type ⇄ login-menu matching, so a mislabeled
// account can't sign in via the wrong menu — this fixes those.
//
// Usage (from apps/api, against whatever DB your .env points to):
//   node src/scripts/set-account-type.js <email> <client|agency>            # dry run
//   node src/scripts/set-account-type.js <email> <client|agency> --confirm   # apply
//
// Optional:
//   --role admin|user|superadmin   (default: admin for agency, unchanged for client)
//   --org <id> | --org null        (set/clear organization_id)
//
// Examples:
//   node src/scripts/set-account-type.js dsrjayakarya@gmail.com client --confirm
//   node src/scripts/set-account-type.js ops@acme.com agency --org 3 --confirm
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const args = process.argv.slice(2);
const email = (args[0] || '').trim();
const type = (args[1] || '').trim().toLowerCase();
const CONFIRM = args.includes('--confirm');

function flagVal(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const roleArg = flagVal('--role');
const orgArg = flagVal('--org'); // "null" clears it

if (!email || !['client', 'agency'].includes(type)) {
  console.error('Usage: node src/scripts/set-account-type.js <email> <client|agency> [--role r] [--org id|null] [--confirm]');
  process.exit(1);
}

const rows = (r) => r?.rows ?? r ?? [];
const found = rows(await db.execute(sql`
  SELECT id, email, role, account_type, organization_id FROM "user" WHERE LOWER(email) = ${email.toLowerCase()}
`));
if (!found.length) {
  console.error(`✗ No user with email "${email}".`);
  process.exit(1);
}
const cur = found[0];

// Resolve target values.
const newType = type;
const newRole = roleArg || (type === 'agency' ? 'admin' : cur.role) || 'admin';
let newOrg = cur.organization_id;
if (orgArg != null) newOrg = orgArg.toLowerCase() === 'null' ? null : Number(orgArg);

console.log('\nCurrent :', { role: cur.role, account_type: cur.account_type, organization_id: cur.organization_id });
console.log('Target  :', { role: newRole, account_type: newType, organization_id: newOrg });

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing changed. Re-run with --confirm to apply.\n');
  process.exit(0);
}

const updated = rows(await db.execute(sql`
  UPDATE "user"
     SET role = ${newRole}, account_type = ${newType}, organization_id = ${newOrg}, updated_at = NOW()
   WHERE id = ${cur.id}
   RETURNING id, email, role, account_type, organization_id
`));
console.log('\n✓ Updated:', updated[0], '\n');
process.exit(0);
