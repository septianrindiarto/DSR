#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// One-off script — mark every EXISTING user as email-verified.
//
// Why this exists:
//   Phase 1 of the access-control work introduced email verification (Better
//   Auth `requireEmailVerification: true`). Accounts that existed BEFORE this
//   change were created with `email_verified = false` AND have fake/test
//   addresses that cannot actually receive a Resend message — so without this
//   script they would be permanently locked out.
//
// What it does:
//   UPDATE "user" SET email_verified = TRUE WHERE email_verified = FALSE;
//   Logs the affected row count. Idempotent — safe to re-run (second run
//   updates zero rows because the predicate no longer matches).
//
// What it does NOT do:
//   • Does not touch any other column (role, organizationId, isActive, …).
//   • Does not create or delete any rows.
//   • Does not affect future signups — they will still need to verify.
//
// Usage:
//   cd apps/api
//   node src/scripts/grandfather-verified.js
//
// Requires DATABASE_URL in .env (same as the running API).
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import postgres from 'postgres';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error('ERROR: DATABASE_URL is not set. Make sure apps/api/.env is configured.');
    process.exit(1);
}

const sql = postgres(dbUrl, { max: 1 });

try {
    // Show the rows that will change BEFORE updating, so the operator can
    // sanity-check the list.
    const candidates = await sql`
        SELECT id, email, name, role, created_at
        FROM "user"
        WHERE email_verified = FALSE
        ORDER BY created_at ASC
    `;

    if (candidates.length === 0) {
        console.log('No unverified users found. Nothing to do.');
        process.exit(0);
    }

    console.log(`Found ${candidates.length} unverified user(s):`);
    for (const u of candidates) {
        console.log(`  • ${u.email}  (${u.role || '—'}, created ${new Date(u.created_at).toISOString().slice(0, 10)})`);
    }
    console.log('');

    // Apply the update.
    const updated = await sql`
        UPDATE "user"
        SET email_verified = TRUE,
            updated_at     = NOW()
        WHERE email_verified = FALSE
        RETURNING id
    `;

    console.log(`✓ Marked ${updated.length} user(s) as email-verified.`);
    console.log('These accounts can now log in without going through the email link.');
} catch (err) {
    console.error('ERROR while running grandfather migration:', err.message);
    process.exit(1);
} finally {
    await sql.end({ timeout: 5 });
}
