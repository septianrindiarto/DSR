#!/usr/bin/env node
// Adds 'user' to the user_role enum if not already present. Required by the
// /register-extended handler which sets role='user' on client teammate
// signups, and by normalize-client-roles.js which converts legacy
// role='client' rows to role='user'. Idempotent.
//
// Run with:
//   cd apps/api
//   node src/scripts/add-user-role-enum.js
//
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
    const before = await db.execute(sql`
        SELECT unnest(enum_range(NULL::user_role))::text AS value
    `);
    const values = (before.rows || before).map(r => r.value);
    console.log('Current user_role enum values:', values.join(', '));

    if (values.includes('user')) {
        console.log('Enum already has "user" - nothing to do.');
        return;
    }

    // ALTER TYPE ADD VALUE can run in a transaction starting PG 12.
    await db.execute(sql`ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'user'`);
    console.log('Added "user" to the user_role enum.');

    const after = await db.execute(sql`
        SELECT unnest(enum_range(NULL::user_role))::text AS value
    `);
    console.log('New enum values:', (after.rows || after).map(r => r.value).join(', '));
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Failed:', err?.message || err); process.exit(1); });
