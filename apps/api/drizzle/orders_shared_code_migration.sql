-- ─────────────────────────────────────────────────────────────────────────────
-- Tier 2 multi-car booking — shared orderNumber model
--
-- Removes the UNIQUE constraint on orders.order_number so that multi-car
-- bookings can write N rows with the same code. The code becomes the
-- BOOKING identifier (not the per-car identifier): a customer who books
-- 2 Avanzas + 1 Pickup gets ONE code (e.g. "C073"), and three order rows
-- are inserted sharing that code, differentiated by their primary key id
-- and per-car fields (car_id, driver_id, total_price, etc.).
--
-- For single-car bookings the behaviour is unchanged from before — one
-- code, one row.
--
-- A non-unique index is added in place of the dropped constraint so that
-- queries like "WHERE order_number = 'C073'" stay fast even when N rows
-- share that value.
--
-- IMPORTANT: existing rows are NOT modified. Every historical order keeps
-- its existing unique code (those rows happen to be unique because the
-- old constraint enforced it). Future multi-car bookings produce repeats.
-- The application handles both cases naturally via findMany on order_number.
--
-- Idempotent — re-running this migration is safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the named unique constraint that drizzle-kit produced in 0000_short_sumo.sql.
-- We use IF EXISTS so re-running this migration after the constraint is
-- already gone produces no error.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_number_unique;

-- Some Postgres versions auto-name the underlying unique index. Drop it
-- defensively in case the constraint name differed. The constraint above
-- usually takes the index with it, but this is belt-and-braces.
DROP INDEX IF EXISTS orders_order_number_unique;
DROP INDEX IF EXISTS orders_order_number_key;

-- Replace with a non-unique index so lookups by order_number stay O(log N)
-- even when multiple rows share a code.
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders (order_number);
