-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: add missing columns to `cars` table
--
-- WHY: `available_count` and `is_demo` are defined in the Drizzle schema
-- but were never applied to the database, causing every query that selects
-- from `cars` (including the public landing page) to fail with a column error.
--
-- This migration is idempotent — safe to re-run.
--
-- Apply with:   cd apps/api && npm run migrate -- cars_extra
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE cars ADD COLUMN IF NOT EXISTS available_count integer NOT NULL DEFAULT 1;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS cars_is_demo_idx ON cars (is_demo);
