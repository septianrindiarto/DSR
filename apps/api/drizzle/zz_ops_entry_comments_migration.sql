-- ─────────────────────────────────────────────────────────────────────────────
-- Feedback thread on lembur / perjalanan dinas / operasional forms (2026-11-13)
--   ops_entries.comments: [{ at, by, side, text }] — agency, client and driver
--   can leave notes on a form (e.g. why a client wants a change). DDL only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS comments JSONB NOT NULL DEFAULT '[]'::jsonb;
