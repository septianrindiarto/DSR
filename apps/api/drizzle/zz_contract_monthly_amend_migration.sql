-- ─────────────────────────────────────────────────────────────────────────────
-- Monthly code per unit + contract amendments (owner 2026-11-13)
--   lease_unit_billings: one M code per contract × unit × month, created
--     automatically at the start of each running month (and on activation).
--   lease_contracts.amends_contract_id: an amendment is a new contract (same
--     workflow: draft → documents → both approve) pointing at the one it
--     replaces; when approved the old contract must be stopped.
-- DDL only, idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lease_unit_billings (
    id            SERIAL PRIMARY KEY,
    contract_id   INTEGER NOT NULL,
    unit_id       INTEGER NOT NULL,
    period        VARCHAR(7) NOT NULL,
    month_index   INTEGER NOT NULL DEFAULT 1,
    order_id      INTEGER,
    order_number  VARCHAR(20),
    amount        DECIMAL(15,2) NOT NULL DEFAULT 0,
    detail        JSONB,
    created_by    TEXT,
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS lease_unit_billings_uq ON lease_unit_billings (contract_id, unit_id, period);
CREATE INDEX IF NOT EXISTS lease_unit_billings_order_idx ON lease_unit_billings (order_number);

ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS amends_contract_id INTEGER;
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS amendment_no SMALLINT;
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS superseded_by INTEGER;
