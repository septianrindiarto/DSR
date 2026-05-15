// One-shot migration runner.
// Run from repo root:  node apps/api/migrations/run-rekap-migration.js
// Or from apps/api:    node migrations/run-rekap-migration.js
//
// Applies the missing Rekap Order columns to the live database.

import 'dotenv/config';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
    console.error('DATABASE_URL is missing. Make sure apps/api/.env is loaded.');
    process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: 'require' });

const statements = [
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS package VARCHAR(50)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination VARCHAR(255)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS overnight_nights INTEGER DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS overtime_hours DECIMAL(5,2) DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS bailout DECIMAL(12,2) DEFAULT 0`,
];

try {
    console.log('Connecting to database…');
    for (const stmt of statements) {
        process.stdout.write(`  → ${stmt} … `);
        await sql.unsafe(stmt);
        console.log('OK');
    }

    // Verify
    const customerCols = await sql`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'customers' AND column_name = 'company_name'
    `;
    const orderCols = await sql`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'orders'
           AND column_name IN ('package','destination','overnight_nights','overtime_hours','bailout')
         ORDER BY column_name
    `;

    console.log('\n✅ Migration applied successfully.');
    console.log('Customers.company_name present:', customerCols.length === 1);
    console.log('Orders new columns present:', orderCols.map(r => r.column_name).join(', '));
} catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exitCode = 1;
} finally {
    await sql.end({ timeout: 5 });
}
