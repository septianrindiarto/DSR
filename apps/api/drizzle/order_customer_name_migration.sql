-- ─────────────────────────────────────────────────────────────────────────────
-- orders.customer_name — snapshot of the "Nama" field from the Rekap/booking
-- form, stored verbatim on the order row.
--
-- The order table is the storehouse for the booking form: the name typed by the
-- user must be recorded exactly, independent of the customers table (which is a
-- deduplicated entity keyed by name+phone+customer_type+company_name). Display
-- in Rekap / Klaim / Telegram / invoice reads this column first.
--
-- Backfill: seed from the currently-linked customer so existing rows keep a name.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);

UPDATE orders o
SET customer_name = c.name
FROM customers c
WHERE o.customer_id = c.id
  AND (o.customer_name IS NULL OR o.customer_name = '');
