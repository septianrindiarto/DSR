#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// One-shot CLI migration: Rekap 2026.xlsx → Neon Postgres
//
// Usage:
//   npm run sync:rekap
//   node src/scripts/sync-rekap.js
//   node src/scripts/sync-rekap.js --path "D:\path\to\Rekap 2026.xlsx"
//
// Idempotent — re-running only updates rows that changed and never overwrites
// orders that were created through the web admin (sourceOrigin='web').
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { runRekapSync } from '../services/sync.service.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path' && argv[i + 1]) { args.path = argv[++i]; }
    else if (a === '--help' || a === '-h') { args.help = true; }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log(`
DSR Rekap 2026 → Neon Postgres migration

Usage:
  npm run sync:rekap                    # use REKAP_XLSX_PATH from .env (default Windows path)
  node src/scripts/sync-rekap.js --path "/abs/path/to/Rekap 2026.xlsx"

Environment:
  REKAP_XLSX_PATH   Override the default xlsx path
  DATABASE_URL      Neon Postgres connection string (required)
`);
  process.exit(0);
}

(async () => {
  console.log('━'.repeat(70));
  console.log('  DSR REKAP 2026 → NEON POSTGRES — ONE-SHOT MIGRATION');
  console.log('━'.repeat(70));
  const t0 = Date.now();
  try {
    const summary = await runRekapSync({
      filePath: args.path,
      trigger: 'manual',
    });
    console.log('\nSTATUS:', summary.status.toUpperCase());
    console.log('File:', summary.filePath, `(${summary.fileSize} bytes)`);
    console.log('Rows read:', summary.rowsRead);
    console.log(`Customers: +${summary.customersInserted}  ~${summary.customersUpdated}`);
    console.log(`Drivers:   +${summary.driversInserted}  ~${summary.driversUpdated}`);
    console.log(`Cars:      +${summary.carsInserted}  ~${summary.carsUpdated}`);
    console.log(`Orders:    +${summary.ordersInserted}  ~${summary.ordersUpdated}`);
    if (summary.errors.length > 0) {
      console.log(`\nErrors (${summary.errors.length}):`);
      summary.errors.slice(0, 20).forEach((e, i) => console.log(`  ${i + 1}.`, e));
      if (summary.errors.length > 20) console.log(`  … and ${summary.errors.length - 20} more`);
    }
    console.log(`\nDuration: ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(summary.status === 'failed' ? 1 : 0);
  } catch (err) {
    console.error('\nFATAL:', err.message);
    console.error(err.stack);
    process.exit(2);
  }
})();
