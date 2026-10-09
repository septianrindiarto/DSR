-- ─────────────────────────────────────────────────────────────────────────────
-- cars.is_owned — marks company-owned units (vs. vendor/partner units).
-- Drives Analytics → "Pendapatan Unit Milik Sendiri". Set it per car in
-- Armada (edit car → "Unit milik sendiri"). Defaults to FALSE; this migration
-- does NOT flag any car (no DML) — tick the owned units in Armada.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_owned BOOLEAN NOT NULL DEFAULT FALSE;
