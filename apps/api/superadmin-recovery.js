/**
 * DSR Superadmin Recovery Tool
 * ─────────────────────────────────────────────────────────────
 * USAGE:
 *   node superadmin-recovery.js
 *                          → List all users (name, email, role)
 *
 *   node superadmin-recovery.js --reset "NewPassword123"
 *                          → Reset the superadmin password
 * ─────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import postgres from 'postgres';
import { hashPassword } from '@better-auth/utils/password';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

// ── CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const resetIndex   = args.indexOf('--reset');
const promoteIndex = args.indexOf('--promote');
const newPassword  = resetIndex   !== -1 ? args[resetIndex + 1]   : null;
const promoteEmail = promoteIndex !== -1 ? args[promoteIndex + 1] : null;

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('         DSR  —  User Account Report               ');
  console.log('═══════════════════════════════════════════════════\n');

  // ── 1. List all users ───────────────────────────────────────
  const users = await sql`
    SELECT
      u.name,
      u.email,
      u.role,
      u.is_active   AS "isActive",
      u.created_at  AS "createdAt",
      a.id          AS "hasPassword"
    FROM "user" u
    LEFT JOIN account a ON a.user_id = u.id AND a.provider_id = 'credential'
    ORDER BY
      CASE u.role
        WHEN 'superadmin' THEN 1
        WHEN 'admin'      THEN 2
        WHEN 'agent'      THEN 3
        WHEN 'demo'       THEN 4
        ELSE 5
      END
  `;

  if (users.length === 0) {
    console.log('⚠️  No users found in the database.\n');
  } else {
    users.forEach((u, i) => {
      const badge =
        u.role === 'superadmin' ? '👑 SUPERADMIN' :
        u.role === 'admin'      ? '🔑 ADMIN'      :
        u.role === 'agent'      ? '🧑 AGENT'      : '🔵 DEMO';

      console.log(`${i + 1}. ${badge}`);
      console.log(`   Name        : ${u.name}`);
      console.log(`   Email       : ${u.email}`);
      console.log(`   Active      : ${u.isActive ? 'Yes ✅' : 'No ❌'}`);
      console.log(`   Password Set: ${u.hasPassword ? 'Yes ✅' : 'Not set ❌'}`);
      console.log(`   Created     : ${new Date(u.createdAt).toLocaleString('id-ID')}`);
      console.log();
    });
  }

  // ── 2. Reset superadmin password ───────────────────────────
  if (newPassword) {
    console.log('─── Password Reset ──────────────────────────────────');

    if (newPassword.length < 6) {
      console.log('❌  Password must be at least 6 characters. Aborted.\n');
      await sql.end();
      return;
    }

    const [superadmin] = await sql`
      SELECT id, name, email FROM "user"
      WHERE role = 'superadmin'
      LIMIT 1
    `;

    if (!superadmin) {
      console.log('❌  No superadmin user found. Cannot reset.\n');
      await sql.end();
      return;
    }

    const hashed = await hashPassword(newPassword);

    const [existingAccount] = await sql`
      SELECT id FROM account
      WHERE user_id = ${superadmin.id} AND provider_id = 'credential'
    `;

    if (existingAccount) {
      await sql`
        UPDATE account
        SET password = ${hashed}, updated_at = NOW()
        WHERE user_id = ${superadmin.id} AND provider_id = 'credential'
      `;
    } else {
      await sql`
        INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
        VALUES (
          gen_random_uuid()::text,
          ${superadmin.id},
          'credential',
          ${superadmin.id},
          ${hashed},
          NOW(), NOW()
        )
      `;
    }

    console.log(`✅  Password reset successful for:`);
    console.log(`   Name  : ${superadmin.name}`);
    console.log(`   Email : ${superadmin.email}`);
    console.log(`\n⚠️  New password : ${newPassword}`);
    console.log('   Save this somewhere safe!\n');
  }

  // ── 3. Promote user to superadmin ──────────────────────────
  if (promoteEmail) {
    console.log('─── Promote to Superadmin ───────────────────────────');

    const [target] = await sql`
      SELECT id, name, email, role FROM "user"
      WHERE email = ${promoteEmail}
    `;

    if (!target) {
      console.log(`❌  No user found with email: ${promoteEmail}\n`);
      await sql.end();
      return;
    }

    if (target.role === 'superadmin') {
      console.log(`ℹ️   ${target.name} is already a superadmin.\n`);
      await sql.end();
      return;
    }

    await sql`
      UPDATE "user"
      SET role = 'superadmin', updated_at = NOW()
      WHERE id = ${target.id}
    `;

    console.log(`✅  Successfully promoted to SUPERADMIN:`);
    console.log(`   Name  : ${target.name}`);
    console.log(`   Email : ${target.email}`);
    console.log(`   Before: ${target.role} → After: superadmin\n`);
  }

  await sql.end();
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
