// ────────────────────────────────────────────────────────────────────────────
//  ⚠  DESTRUCTIVE SEED  ⚠
// ────────────────────────────────────────────────────────────────────────────
//  This script TRUNCATES every operational table — real and demo — and
//  re-populates the database with demo fixtures only.  Use only when you
//  explicitly want a clean slate (fresh dev environment, throwaway local
//  branch, etc.).
//
//  For day-to-day demo refresh, use the non-destructive `npm run db:seed`
//  instead — it only touches is_demo = true rows.
//
//  Run with:    npm run db:seed:reset
// ────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
import readline from 'readline';
import { db } from './db/index.js';
import { sql } from 'drizzle-orm';

dotenv.config();

async function confirm() {
    if (process.env.SEED_RESET_CONFIRM === 'yes' || process.argv.includes('--yes')) return true;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('\n⚠  This will DELETE ALL data (real + demo). Type "RESET" to continue: ', (answer) => {
            rl.close();
            resolve(answer.trim() === 'RESET');
        });
    });
}

async function main() {
    console.log('⚠️  DESTRUCTIVE seed (resets everything)');

    if (!(await confirm())) {
        console.log('❌ Cancelled.');
        process.exit(1);
    }

    try {
        console.log('🗑️  Truncating all operational tables...');
        await db.execute(sql`TRUNCATE TABLE
            journal_entries, chart_of_accounts, reviews, activity_logs,
            dashboard_prefs, maintenance, orders, drivers, customers, cars
            RESTART IDENTITY CASCADE`);
        console.log('   ✅ Tables truncated');

        console.log('\n🌱 Now seeding demo data...');
        // Defer to the non-destructive seed for the actual data inserts.
        await import('./seed.js');
    } catch (error) {
        console.error('\n❌ Reset failed:', error);
        process.exit(1);
    }
}

main();
