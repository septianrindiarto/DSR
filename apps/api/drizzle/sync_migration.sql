-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: add invoice + sync_logs schema for Rekap 2026.xlsx → DB sync
--
-- Apply once with:    psql $DATABASE_URL -f drizzle/sync_migration.sql
-- Or via Drizzle:     npm run db:push
-- ──────────────────────────────────────────────────────────────────────────────

-- 1) Extend orders with invoice / billing fields populated from Logbook sheet.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS invoice_number          varchar(50),
  ADD COLUMN IF NOT EXISTS invoice_letter_number   varchar(50),
  ADD COLUMN IF NOT EXISTS invoice_sent_date       timestamp,
  ADD COLUMN IF NOT EXISTS invoice_due_date        timestamp,
  ADD COLUMN IF NOT EXISTS invoice_paid_date       timestamp,
  ADD COLUMN IF NOT EXISTS invoice_payment_status  varchar(20),
  ADD COLUMN IF NOT EXISTS source_origin           varchar(20) DEFAULT 'web';

-- Backfill — existing rows are web-created
UPDATE orders SET source_origin = 'web' WHERE source_origin IS NULL;

-- Index for fast "needs invoice" lookups in the Dokumen page
CREATE INDEX IF NOT EXISTS orders_invoice_number_idx ON orders (invoice_number);
CREATE INDEX IF NOT EXISTS orders_status_invoice_idx ON orders (status) WHERE invoice_number IS NULL;

-- 2) Sync logs — one row per sync attempt
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
