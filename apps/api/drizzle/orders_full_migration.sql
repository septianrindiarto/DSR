-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: ensure all orders columns exist (comprehensive, idempotent)
--
-- WHY: the Drizzle schema for `orders` includes several columns that were added
-- incrementally (invoice fields, source_origin, is_demo) but may not have been
-- applied to the live database.  Drizzle always generates SELECT with every
-- schema column, so a single missing column causes every orders query to fail
-- with a PostgreSQL "column does not exist" error, making the Rekap Order page
-- appear empty with no visible error.
--
-- COVERS (all idempotent — safe to re-run even if already applied):
--   1. Invoice / billing fields (from sync_migration.sql)
--   2. source_origin tracking field (from sync_migration.sql)
--   3. is_demo isolation flag (from demo_isolation_migration.sql)
--   4. sync_logs table (from sync_migration.sql)
--   5. is_demo on supporting tables joined in orders queries (cars, customers, drivers)
--
-- Apply with:   cd apps/api && npm run migrate -- orders_full
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Orders: invoice / billing fields ───────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_number          varchar(50),
  ADD COLUMN IF NOT EXISTS invoice_letter_number   varchar(50),
  ADD COLUMN IF NOT EXISTS invoice_sent_date       timestamp,
  ADD COLUMN IF NOT EXISTS invoice_due_date        timestamp,
  ADD COLUMN IF NOT EXISTS invoice_paid_date       timestamp,
  ADD COLUMN IF NOT EXISTS invoice_payment_status  varchar(20),
  ADD COLUMN IF NOT EXISTS source_origin           varchar(20) DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS is_demo                 boolean NOT NULL DEFAULT false;

-- Backfill source_origin for existing web-created orders
UPDATE orders SET source_origin = 'web' WHERE source_origin IS NULL;

-- ── 2. Indexes for orders ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS orders_invoice_number_idx    ON orders (invoice_number);
CREATE INDEX IF NOT EXISTS orders_status_invoice_idx    ON orders (status) WHERE invoice_number IS NULL;
CREATE INDEX IF NOT EXISTS orders_is_demo_idx           ON orders (is_demo);

-- ── 3. is_demo on ALL operational tables (orders, schedule, finance queries) ────
ALTER TABLE cars              ADD COLUMN IF NOT EXISTS available_count integer NOT NULL DEFAULT 1;
ALTER TABLE cars              ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE customers         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE drivers           ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE maintenance       ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS cars_is_demo_idx              ON cars (is_demo);
CREATE INDEX IF NOT EXISTS customers_is_demo_idx         ON customers (is_demo);
CREATE INDEX IF NOT EXISTS drivers_is_demo_idx           ON drivers (is_demo);
CREATE INDEX IF NOT EXISTS maintenance_is_demo_idx       ON maintenance (is_demo);

-- ── 4. sync_logs table (needed by sync status endpoint) ───────────────────────
CREATE TABLE IF NOT EXISTS sync_logs (
  id                    serial PRIMARY KEY,
  source                varchar(50) NOT NULL,
  trigger               varchar(20) NOT NULL,
  status                varchar(20) NOT NULL,
  file_path             text,
  file_size             integer,
  rows_read             integer DEFAULT 0,
  customers_inserted    integer DEFAULT 0,
  customers_updated     integer DEFAULT 0,
  drivers_inserted      integer DEFAULT 0,
  drivers_updated       integer DEFAULT 0,
  cars_inserted         integer DEFAULT 0,
  cars_updated          integer DEFAULT 0,
  orders_inserted       integer DEFAULT 0,
  orders_updated        integer DEFAULT 0,
  errors                json,
  duration_ms           integer,
  triggered_by          text REFERENCES "user"(id),
  created_at            timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_logs_created_at_idx ON sync_logs (created_at DESC);

-- ── 5. companies table (needed by order form company dropdown) ─────────────────
CREATE TABLE IF NOT EXISTS companies (
  id         serial PRIMARY KEY,
  name       varchar(255) NOT NULL UNIQUE,
  address    text,
  phone      varchar(50),
  email      varchar(255),
  notes      text,
  created_at timestamp DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);
