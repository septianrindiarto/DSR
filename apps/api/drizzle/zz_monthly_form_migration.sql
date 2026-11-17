-- ─────────────────────────────────────────────────────────────────────────────
-- Form → Kontrak = the monthly M detail form (owner 2026-11-13)
--   Each M row (contract × unit × contract month) is filled (km awal / akhir,
--   nama user, tujuan, keterangan, bukti), then approved by BOTH sides like
--   the L/T/O forms. Only approved M codes can be invoiced in Dokumen.
--   status: open (made by the system, not filled) → submitted → approved;
--           rejected (with reason) goes back to the filler. "Billed" is read
--           from the order's invoice, not stored.
-- DDL only, idempotent. Existing rows start as 'open'.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS status             VARCHAR(12) NOT NULL DEFAULT 'open';
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS km_start           INTEGER;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS km_end             INTEGER;
-- KM per segment: the unit, and a replacement car while one runs (maintenance days without one don't count).
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS km_segments        JSONB;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS pic_name           VARCHAR(120);
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS destination        VARCHAR(200);
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS note               TEXT;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS evidence           JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS comments           JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS submitted_at       TIMESTAMP;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS submitted_by       TEXT;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS agency_approved_at TIMESTAMP;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS agency_approved_by TEXT;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMP;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS client_approved_by TEXT;
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS reject_reason      VARCHAR(300);
ALTER TABLE lease_unit_billings ADD COLUMN IF NOT EXISTS updated_by         TEXT;
CREATE INDEX IF NOT EXISTS lease_unit_billings_status_idx ON lease_unit_billings (status);
