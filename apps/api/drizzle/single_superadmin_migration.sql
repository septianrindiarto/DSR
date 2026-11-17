-- ─────────────────────────────────────────────────────────────────────────────
-- Exactly ONE superadmin for the whole platform (owner decision 2026-10-28).
-- A partial unique index makes a second superadmin impossible at the database
-- level, whatever code path tries it. DDL only — no data changes. Idempotent.
-- (Fails only if two superadmin rows already exist — then fix the data first.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS user_single_superadmin_uq ON "user" ((role)) WHERE role = 'superadmin';
