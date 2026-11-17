-- ─────────────────────────────────────────────────────────────────────────────
-- Contract workflow (owner request 2026-11-05)
--   create (agency OR client) → required documents → both sides approve → active
--   lease_contracts.created_side          'agency' | 'client'
--   lease_contracts.agency_/client_approved_at/_by
--                                         approval of the CURRENT terms; any
--                                         change to terms or documents clears both
--   contract_documents                    a document one side requires from the
--                                         other (penawaran harga, kontrak tender,
--                                         akta, NIB …): requester defines it,
--                                         the other side uploads, requester
--                                         approves/rejects. Files are encrypted
--                                         private refs (never public URLs).
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS created_side VARCHAR(10) NOT NULL DEFAULT 'agency';
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS agency_approved_at TIMESTAMP;
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS agency_approved_by TEXT;
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMP;
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS client_approved_by TEXT;

CREATE TABLE IF NOT EXISTS contract_documents (
    id            SERIAL PRIMARY KEY,
    contract_id   INTEGER NOT NULL,
    required_from VARCHAR(10) NOT NULL,          -- side that must upload: agency | client
    title         VARCHAR(150) NOT NULL,
    note          TEXT,
    mandatory     BOOLEAN NOT NULL DEFAULT TRUE,
    due_date      DATE,
    status        VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | uploaded | approved | rejected
    file_ref      TEXT,
    file_name     VARCHAR(200),
    review_note   TEXT,
    uploaded_by   TEXT,
    uploaded_at   TIMESTAMP,
    reviewed_by   TEXT,
    reviewed_at   TIMESTAMP,
    created_by    TEXT,
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contract_documents_contract_idx ON contract_documents (contract_id);
