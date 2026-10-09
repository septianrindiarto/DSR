// ─────────────────────────────────────────────────────────────────────────────
// Backfill the invoices table from existing invoiced orders (D.2).
//
// Groups every order that has an invoice_number but no invoice_id by
// (owning agency, invoice_number) → ONE invoice per group (a group invoice
// covering several kode transaksi becomes a single record), then links the
// orders via orders.invoice_id. Set-based SQL — a handful of statements total,
// fast even on a remote DB.
//
//   • due date: kept if the order already has one, else sent + payment term
//     (client term → agency default → 30 days).
//   • rows marked "Paid" without a Tgl Realisasi: paid date is filled with the
//     sent date (listed in the preview so you can review them).
//   • an active invoice that already holds the same number is reused.
//
// ⚠️ DML: with --confirm this INSERTs into invoices and UPDATEs orders.
//    Dry-run (preview only) by default. Run the migration first:
//      npm run migrate -- invoices
//
// Usage (from apps/api, against whatever DB your .env points to):
//   node src/scripts/backfill-invoices.js            # preview only
//   node src/scripts/backfill-invoices.js --confirm  # apply (one transaction)
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

const CONFIRM = process.argv.includes('--confirm');
const rows = (r) => r?.rows ?? r ?? [];
const NORM = (x) => `LOWER(REGEXP_REPLACE(TRIM(${x}), '\\s+', ' ', 'g'))`;

// Agency that owns an order: claimer, else the org itself when it is an
// agency, else the client org's parent agency.
const AGENCY_EXPR = `COALESCE(o.claimed_by_agency_id,
  CASE WHEN org.id IS NULL THEN NULL
       WHEN org.parent_agency_id IS NULL THEN org.id
       ELSE org.parent_agency_id END)`;

const SRC = `
  src AS (
    SELECT o.id, o.invoice_number, o.status,
      ${AGENCY_EXPR} AS agency_id,
      CASE WHEN org.parent_agency_id IS NOT NULL THEN org.id END AS order_client_org,
      NULLIF(TRIM(c.company_name), '') AS company_name,
      o.invoice_sent_date, o.invoice_due_date, o.invoice_paid_date,
      o.invoice_letter_number, o.invoice_payment_status, o.total_price
    FROM orders o
    LEFT JOIN organizations org ON org.id = o.organization_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.invoice_number IS NOT NULL AND TRIM(o.invoice_number) <> '' AND o.invoice_id IS NULL
  )`;

const PLAN = `
  WITH ${SRC},
  grp AS (
    SELECT agency_id, invoice_number,
      COUNT(*) AS n_rows,
      MAX(order_client_org) AS order_client_org,
      MAX(company_name) AS company_name,
      MAX(invoice_sent_date) AS sent,
      MAX(invoice_due_date) AS due,
      MAX(invoice_paid_date) AS paid,
      BOOL_OR(LOWER(COALESCE(invoice_payment_status, '')) = 'paid') AS paid_flag,
      MAX(invoice_letter_number) AS letter,
      COALESCE(SUM(total_price), 0) AS total
    FROM src GROUP BY agency_id, invoice_number
  ),
  matched AS (
    SELECT g.*,
      COALESCE(g.order_client_org, (
        SELECT co.id FROM organizations co
        WHERE co.parent_agency_id IS NOT NULL AND g.company_name IS NOT NULL
          AND (co.name_normalized = ${NORM('g.company_name')} OR ${NORM('co.name')} = ${NORM('g.company_name')})
        ORDER BY co.id LIMIT 1)) AS client_org_id
    FROM grp g
  ),
  plan AS (
    SELECT m.*,
      COALESCE((SELECT payment_term_days FROM organizations WHERE id = m.client_org_id),
               (SELECT payment_term_days FROM organizations WHERE id = m.agency_id), 30) AS term
    FROM matched m
  )`;

// ── Preview ─────────────────────────────────────────────────────────────────
const preview = rows(await db.execute(sql.raw(`${PLAN}
  SELECT agency_id, invoice_number, n_rows, company_name, client_org_id, term,
         sent, due, paid, paid_flag, total,
         (due IS NULL AND sent IS NOT NULL) AS due_computed,
         (paid IS NULL AND paid_flag) AS paid_fill,
         EXISTS (SELECT 1 FROM invoices i WHERE i.is_cancelled = FALSE
                 AND i.invoice_number = plan.invoice_number
                 AND i.organization_id IS NOT DISTINCT FROM plan.agency_id) AS reuse
  FROM plan ORDER BY invoice_number`)));

if (preview.length === 0) {
  console.log('No invoiced orders without an invoice record. Nothing to do.');
  process.exit(0);
}

const totalRows = preview.reduce((n, p) => n + Number(p.n_rows), 0);
const groups = preview.filter((p) => Number(p.n_rows) > 1).length;
const dueComputed = preview.filter((p) => p.due_computed);
const paidFill = preview.filter((p) => p.paid_fill);
const reuse = preview.filter((p) => p.reuse);
const noClient = preview.filter((p) => !p.client_org_id);

console.log(`\nInvoices to create : ${preview.length - reuse.length}  (+${reuse.length} existing reused)`);
console.log(`Order rows to link : ${totalRows}`);
console.log(`Multi-row invoices : ${groups}`);
console.log(`Due date computed  : ${dueComputed.length} (sent + term)`);
console.log(`Paid w/o date      : ${paidFill.length} (paid date ← sent date)`);
console.log(`No matched company : ${noClient.length} (use agency default term)\n`);

const fmtD = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
for (const p of preview.slice(0, 40)) {
  console.log(`  ${String(p.invoice_number).padEnd(22)} rows=${String(p.n_rows).padStart(2)}  ` +
    `${(p.company_name || 'Private').slice(0, 28).padEnd(28)} term=${String(p.term).padStart(3)}  ` +
    `sent=${fmtD(p.sent)} due=${fmtD(p.due)}${p.due_computed ? '*' : ' '} paid=${fmtD(p.paid)}${p.paid_fill ? '!' : ''}`);
}
if (preview.length > 40) console.log(`  … and ${preview.length - 40} more`);
console.log('\n  * = due computed   ! = paid date filled from sent date');

if (!CONFIRM) {
  console.log('\nDRY RUN — nothing changed. Re-run with --confirm to apply.\n');
  process.exit(0);
}

// ── Apply (single transaction) ──────────────────────────────────────────────
await db.transaction(async (tx) => {
  await tx.execute(sql.raw(`${PLAN}
    INSERT INTO invoices (invoice_number, organization_id, client_org_id, company_name, letter_number,
                          sent_date, due_date, paid_date, payment_term_days, total_amount)
    SELECT invoice_number, agency_id, client_org_id, company_name, letter,
           sent,
           COALESCE(due, sent + make_interval(days => term)),
           COALESCE(paid, CASE WHEN paid_flag THEN sent END),
           term, total
    FROM plan
    ON CONFLICT (organization_id, invoice_number) WHERE is_cancelled = FALSE DO NOTHING`));

  await tx.execute(sql.raw(`
    WITH ${SRC}
    UPDATE orders o SET
      invoice_id = i.id,
      invoice_due_date = i.due_date,
      invoice_paid_date = i.paid_date,
      invoice_payment_status = CASE WHEN i.paid_date IS NOT NULL THEN 'Paid' ELSE 'Pending' END,
      updated_at = NOW()
    FROM src
    JOIN invoices i ON i.is_cancelled = FALSE
      AND i.invoice_number = src.invoice_number
      AND i.organization_id IS NOT DISTINCT FROM src.agency_id
    WHERE o.id = src.id`));

  await tx.execute(sql.raw(`
    UPDATE invoices i SET total_amount = s.t, updated_at = NOW()
    FROM (SELECT invoice_id, COALESCE(SUM(total_price), 0) AS t FROM orders
          WHERE invoice_id IS NOT NULL GROUP BY invoice_id) s
    WHERE i.id = s.invoice_id`));
});

const [after] = rows(await db.execute(sql.raw(
  `SELECT COUNT(*)::int AS linked FROM orders WHERE invoice_id IS NOT NULL`)));
console.log(`\n✓ Done. Orders linked to an invoice: ${after?.linked ?? '?'}\n`);
process.exit(0);
