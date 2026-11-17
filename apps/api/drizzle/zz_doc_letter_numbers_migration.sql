-- ─────────────────────────────────────────────────────────────────────────────
-- One surat pengantar number per kode transaksi (owner 2026-11-13)
--   The first time a code (C142, M003, L007 …) gets a surat pengantar, the next
--   company letter number is reserved and remembered here; every later print
--   of that code reuses it. DDL only, idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_letter_numbers (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    code            VARCHAR(30) NOT NULL,
    letter_number   VARCHAR(50) NOT NULL,
    created_by      TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS doc_letter_numbers_org_code_uq ON doc_letter_numbers (organization_id, code);
