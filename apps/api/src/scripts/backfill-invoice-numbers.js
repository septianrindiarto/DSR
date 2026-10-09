// ─────────────────────────────────────────────────────────────────────────────
// Rewrite legacy auto-fallback invoice numbers (INV-YYYYMM-NNNN) to the
// configured format "{year}/{invoicePrefix}{kodeTransaksi}" — e.g.
// "26/DSR/INV/C086" — using each order's org doc_numbering (falls back to
// 26 / DSR/INV/). Only rows matching the exact old auto pattern are touched;
// manually-set invoice numbers are left alone.
//
// ⚠️ DML: with --confirm this UPDATEs orders.invoice_number. Dry-run by default.
//
// Usage (from apps/api, against whatever DB your .env points to):
//   node src/scripts/backfill-invoice-numbers.js            # preview only
//   node src/scripts/backfill-invoice-numbers.js --confirm   # apply
//
// Note: multi-car bookings (rows sharing an order_number) will all get the same
// new number (one invoice per booking), which is the intended behavior.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const CONFIRM = process.argv.includes('--confirm');
const rows = (r) => r?.rows ?? r ?? [];
const DEFAULT = { yearPrefix: '26', invoicePrefix: 'DSR/INV/' };

// Per-org numbering config (doc_numbering) so each order uses its company's prefix.
const orgs = rows(await db.execute(sql`SELECT id, doc_numbering FROM organizations`));
const orgNum = new Map(orgs.map((o) => [o.id, o.doc_numbering || null]));

function fmt(orderNumber, orgId) {
  const n = orgNum.get(orgId) || {};
  const year = n.yearPrefix || DEFAULT.yearPrefix;
  const pfx = n.invoicePrefix || DEFAULT.invoicePrefix;
  return `${year}/${pfx}${orderNumber || ''}`;
}

// Only the auto-fallback shape INV-YYYYMM-NNNN — nothing hand-entered.
const targets = rows(await db.execute(sql`
  SELECT id, order_number, organization_id, invoice_number
  FROM orders
  WHERE invoice_number ~ '^INV-[0-9]{6}-[0-9]+$'
  ORDER BY id
`));

if (targets.length === 0) {
  console.log('No INV-YYYYMM-* invoice numbers found. Nothing to do.');
  process.exit(0);
}

console.log(`\nFound ${targets.length} order(s) with the old auto format:\n`);
for (const t of targets.slice(0, 50)) {
  console.log(`  ${t.invoice_number}  →  ${fmt(t.order_number, t.organization_id)}`);
}
if (targets.length > 50) console.log(`  … and ${targets.length - 50} more`);

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing changed. Re-run with --confirm to apply.\n');
  process.exit(0);
}

let updated = 0;
for (const t of targets) {
  await db.execute(sql`
    UPDATE orders SET invoice_number = ${fmt(t.order_number, t.organization_id)}, updated_at = NOW()
    WHERE id = ${t.id}
  `);
  updated++;
}
console.log(`\n✓ Rewrote ${updated} invoice number(s).\n`);
process.exit(0);
