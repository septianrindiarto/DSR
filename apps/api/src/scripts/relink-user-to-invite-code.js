#!/usr/bin/env node
// Inspect and (optionally) repair a user's organization link via invite code.
//
// Usage:
//   node src/scripts/relink-user-to-invite-code.js <user-email> <invite-code>
//
// If the email exists and the invite code matches an org, writes the
// organization_id onto the user row. Safe to re-run; reports current state
// before doing anything.
//
// Example:
//   node src/scripts/relink-user-to-invite-code.js arhent.areloa@gmail.com NRNT-FYNP

import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const email = (process.argv[2] || '').trim().toLowerCase();
const codeArg = (process.argv[3] || '').trim().toUpperCase();

if (!email || !codeArg) {
    console.error('Usage: node relink-user-to-invite-code.js <email> <invite-code>');
    process.exit(2);
}

async function main() {
    const userRows = await db.execute(sql`
        SELECT id, email, name, role, account_type, organization_id, email_verified
        FROM "user"
        WHERE LOWER(email) = ${email}
        LIMIT 1
    `);
    const u = (userRows.rows || userRows)[0];
    if (!u) {
        console.error('User not found:', email);
        process.exit(1);
    }
    console.log('User row found:');
    console.log(`  id=${u.id} role=${u.role} account_type=${u.account_type} organization_id=${u.organization_id} verified=${u.email_verified}`);

    const orgRows = await db.execute(sql`
        SELECT id, name, display_id, invite_code
        FROM organizations
        WHERE invite_code = ${codeArg}
        LIMIT 1
    `);
    const o = (orgRows.rows || orgRows)[0];
    if (!o) {
        console.error('No organization matches invite code:', codeArg);
        process.exit(1);
    }
    console.log('Org for invite code:');
    console.log(`  id=${o.id} name=${o.name} display_id=${o.display_id}`);

    if (u.organization_id === o.id) {
        console.log('\nAlready linked. Nothing to do.');
        return;
    }

    console.log(`\nLinking user ${u.id} -> org ${o.id} (${o.name})`);
    await db.execute(sql`
        UPDATE "user"
        SET organization_id = ${o.id}, updated_at = NOW()
        WHERE id = ${u.id}
    `);
    console.log('Done. Tell the user to refresh the Pengaturan page.');
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Failed:', err?.message || err); process.exit(1); });
