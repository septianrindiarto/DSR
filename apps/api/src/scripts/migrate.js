#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Migration runner — applies *.sql files from apps/api/drizzle/ to the DB
// using the same postgres-js client the app uses. No psql required.
//
// Usage:
//   npm run migrate                       # apply ALL .sql files in drizzle/
//   npm run migrate -- companies          # apply only files matching "companies"
//   node src/scripts/migrate.js sync      # apply only files matching "sync"
//
// All shipped migrations are idempotent (CREATE IF NOT EXISTS,
// ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING) so re-running is safe.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(__dirname, '../../drizzle');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set in .env');
  process.exit(1);
}

const filter = (process.argv[2] || '').toLowerCase();

function listSqlFiles() {
  let entries;
  try { entries = fs.readdirSync(DRIZZLE_DIR); }
  catch (err) {
    console.error(`Cannot read ${DRIZZLE_DIR}:`, err.message);
    process.exit(1);
  }
  const sqls = entries
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .filter(f => !filter || f.toLowerCase().includes(filter))
    .sort(); // alphabetical = same order every run
  return sqls.map(f => path.join(DRIZZLE_DIR, f));
}

// Strip line-comments and split into statements on `;` — but never inside a
// dollar-quoted body ($$ … $$, e.g. DO blocks / functions), whose inner `;`
// belong to the block. (The old line-based split broke DO blocks into pieces
// that all failed.)
function splitStatements(text) {
  const cleaned = text
    .split('\n')
    .map(l => l.replace(/^--.*$/, '').replace(/\s+--.*$/, ''))
    .join('\n');
  const out = [];
  let cur = '', inDollar = null, inQuote = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (!inQuote) {
      const m = cleaned.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (m) {
        if (!inDollar) inDollar = m[0];
        else if (m[0] === inDollar) inDollar = null;
        cur += m[0]; i += m[0].length - 1; continue;
      }
    }
    if (!inDollar && ch === "'") inQuote = !inQuote;
    if (!inDollar && !inQuote && ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

(async () => {
  const files = listSqlFiles();
  if (files.length === 0) {
    console.log(filter ? `No SQL files match "${filter}".` : 'No SQL files found in drizzle/.');
    process.exit(0);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 30 });
  console.log('━'.repeat(70));
  console.log(`  DSR DB MIGRATION RUNNER — ${files.length} file(s)`);
  console.log('━'.repeat(70));

  let totalOk = 0, totalErr = 0;
  for (const file of files) {
    const name = path.basename(file);
    const text = fs.readFileSync(file, 'utf8');
    const stmts = splitStatements(text);
    console.log(`\n▸ ${name} (${stmts.length} statement${stmts.length === 1 ? '' : 's'})`);

    let okN = 0, errN = 0;
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 90);
      try {
        await sql.unsafe(stmt);
        console.log(`  ✓ [${i + 1}] ${preview}…`);
        okN++;
      } catch (e) {
        console.error(`  ✗ [${i + 1}] ${preview}…`);
        console.error(`      ${e.message}`);
        errN++;
      }
    }
    console.log(`   → ${okN} ok, ${errN} errors`);
    totalOk += okN;
    totalErr += errN;
  }

  await sql.end();
  console.log(`\nTotal: ${totalOk} ok, ${totalErr} errors across ${files.length} file(s).`);
  process.exit(totalErr > 0 ? 1 : 0);
})();
