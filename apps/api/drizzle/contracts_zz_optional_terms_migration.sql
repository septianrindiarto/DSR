-- ─────────────────────────────────────────────────────────────────────────────
-- Contract terms without silent defaults (owner 2026-11-06): a new contract
-- starts EMPTY (placeholders show samples only). Billing day and working hours
-- may be saved empty; the contract cannot be approved until they are filled
-- (contracts-core.js termBlockers). Existing rows keep their values.
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lease_contracts ALTER COLUMN billing_day DROP NOT NULL;
ALTER TABLE lease_contracts ALTER COLUMN billing_day DROP DEFAULT;
ALTER TABLE lease_contracts ALTER COLUMN work_start DROP NOT NULL;
ALTER TABLE lease_contracts ALTER COLUMN work_start DROP DEFAULT;
ALTER TABLE lease_contracts ALTER COLUMN work_end DROP NOT NULL;
ALTER TABLE lease_contracts ALTER COLUMN work_end DROP DEFAULT;
