-- ─────────────────────────────────────────────────────────────────────────────
-- Driver join date (tanggal bergabung). DDL only — existing drivers keep NULL
-- (the UI shows their record creation date as a hint). New drivers default to
-- the day they are added. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS join_date DATE;
