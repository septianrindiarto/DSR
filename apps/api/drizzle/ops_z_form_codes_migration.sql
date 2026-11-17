-- ─────────────────────────────────────────────────────────────────────────────
-- Lembur & operasional — one transaction code per FORM (owner 2026-11-05)
--   ops_entries.code               L001… for lembur (SPKL), R001… for operasional
--                                  (SPPD + biaya). Given when the form is
--                                  submitted (drafts have none). R numbers also
--                                  skip the old monthly recap codes in ops_recaps.
--   ops_entries.agency_/client_approved_at/_by
--                                  both sides approve each form; only forms
--                                  approved by BOTH can be invoiced in Dokumen.
-- Named ops_z_* so it runs after ops_recap_migration.sql (creates ops_entries).
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS code VARCHAR(12);
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS agency_approved_at TIMESTAMP;
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS agency_approved_by TEXT;
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMP;
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS client_approved_by TEXT;
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS invoice_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS ops_entries_code_uq ON ops_entries (code) WHERE code IS NOT NULL;
