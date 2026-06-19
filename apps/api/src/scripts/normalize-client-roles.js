#!/usr/bin/env node
// One-off normalize: role='client' -> 'user', role='client_admin' -> 'admin'
// for accounts where account_type='client'. Idempotent. Run with:
//
//   cd apps/api
//   node src/scripts/normalize-client-roles.js
//
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Connecting to', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'));

    const beforeClient = await db.execute(sql`SELECT COUNT(*)::int AS n FROM "user" WHERE role = 'client'       AND account_type = 'client'`);
    const beforeCAdmin = await db.execute(sql`SELECT COUNT(*)::int AS n FROM "user" WHERE role = 'client_admin' AND account_type = 'client'`);
    console.log(`Before: role='client' -> ${beforeClient.rows?.[0]?.n ?? beforeClient[0]?.n} rows, role='client_admin' -> ${beforeCAdmin.rows?.[0]?.n ?? beforeCAdmin[0]?.n} rows`);

    const u1 = await db.execute(sql`
        UPDATE "user"
        SET role = 'user', updated_at = NOW()
        WHERE role = 'client'
          AND account_type = 'client'
    `);
    const u2 = await db.execute(sql`
        UPDATE "user"
        SET role = 'admin', updated_at = NOW()
        WHERE role = 'client_admin'
          AND account_type = 'client'
    `);

    const after = await db.execute(sql`
        SELECT role, account_type, COUNT(*)::int AS n
        FROM "user"
        GROUP BY role, account_type
        ORDER BY account_type, role
    `);
    const rows = after.rows || after;
    console.log('\nAfter:');
    for (const r of rows) console.log(`  ${r.account_type ?? '(null)'} / ${r.role ?? '(null)'} : ${r.n}`);
    console.log('\nDone.');
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Normalize failed:', err?.message || err); process.exit(1); });
