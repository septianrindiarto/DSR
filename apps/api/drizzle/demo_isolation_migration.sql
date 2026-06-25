-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: add `is_demo` flag to operational tables for demo-data isolation.
--
-- WHY: the "Try Demo" button on /admin/login auto-logs in a public demo
-- account.  We want demo-only fixtures to coexist with real production rows
-- in the same tables without polluting reports for real admins.
--
-- HOW: every relevant table gets a `is_demo BOOLEAN NOT NULL DEFAULT false`
-- column.  Existing rows are preserved as is_demo = false (real data).  The
-- demo seed script flips this flag to true on every row it inserts.  Future
-- API queries can filter by it based on the session user (out-of-scope for
-- this migration — see follow-up isolation refactor).
--
-- This migration is idempotent — safe to re-run; nothing is dropped.
--
-- Apply with:   cd apps/api && npm run migrate -- demo_isolation
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE cars              ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE customers         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE drivers           ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE orders            ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE maintenance       ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE reviews           ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE journal_entries   ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Indexes so demo-vs-real filtering stays fast even with millions of rows.
CREATE INDEX IF NOT EXISTS cars_is_demo_idx              ON cars (is_demo);
CREATE INDEX IF NOT EXISTS customers_is_demo_idx         ON customers (is_demo);
CREATE INDEX IF NOT EXISTS drivers_is_demo_idx           ON drivers (is_demo);
CREATE INDEX IF NOT EXISTS orders_is_demo_idx            ON orders (is_demo);
CREATE INDEX IF NOT EXISTS maintenance_is_demo_idx       ON maintenance (is_demo);
CREATE INDEX IF NOT EXISTS reviews_is_demo_idx           ON reviews (is_demo);
CREATE INDEX IF NOT EXISTS journal_entries_is_demo_idx   ON journal_entries (is_demo);
CREATE INDEX IF NOT EXISTS chart_of_accounts_is_demo_idx ON chart_of_accounts (is_demo);
