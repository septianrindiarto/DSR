-- ─────────────────────────────────────────────────────────────────────────────
-- Configurable vehicle types per agency (owner 2026-11-11)
--   cars.type: Postgres enum car_type (MPV/SUV/Sedan/City Car/Sport) → VARCHAR(40)
--              so each agency can use its own list (Hiace, Bus, Pickup, …).
--              Existing values are kept as text (USING type::text).
--   organizations.fleet_options: { types: [...] } — the agency's list.
-- DDL only, idempotent. The car_type enum type is left in place (unused).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'cars' AND column_name = 'type' AND data_type = 'USER-DEFINED') THEN
        ALTER TABLE cars ALTER COLUMN type TYPE VARCHAR(40) USING type::text;
    END IF;
END $$;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS fleet_options JSONB;
