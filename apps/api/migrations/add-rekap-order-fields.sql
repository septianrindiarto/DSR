-- Migration: Add Rekap Order fields
-- Adds company_name to customers; package, destination, overnight_nights,
-- overtime_hours, bailout to orders.
--
-- Run either:
--   1. From apps/api:  npm run db:push   (drizzle-kit picks it up from schema.js)
--   2. Or execute this SQL directly against the database.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS package VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS overnight_nights INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS overtime_hours DECIMAL(5,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bailout DECIMAL(12,2) DEFAULT 0;
