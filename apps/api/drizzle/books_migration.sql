-- ─────────────────────────────────────────────────────────────────────────────
-- Books v2 — professional double-entry journal (SAK EMKM, accrual basis).
--
--   chart_of_accounts         gains is_cash (Kas/Bank accounts drive Arus Kas)
--                             and cash_flow_class (operating|investing|
--                             financing). Account codes become unique PER
--                             ORGANIZATION (was globally unique).
--   book_transactions         one header per journal entry (JU-YYYYMM-NNNN),
--                             status draft → posted → reversed.
--   book_lines                debit/credit lines; optional order/car tag for
--                             per-booking / per-unit analysis.
--   book_import_mappings      remembered "label → account" choices from the
--                             cash-book import wizard.
--   book_period_locks         month locks per organization.
--
-- The legacy journal_entries table is left untouched (read-only archive).
-- DDL only — no data is inserted or changed. The default chart of accounts is
-- created from the UI (Keuangan → Daftar Akun → "Pakai Daftar Akun Standar").
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS cash_flow_class VARCHAR(20);

ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS chart_of_accounts_code_unique;

CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_org_code_uq ON chart_of_accounts (organization_id, code);

CREATE TABLE IF NOT EXISTS book_transactions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    journal_no VARCHAR(30) NOT NULL,
    entry_date DATE NOT NULL,
    description VARCHAR(500) NOT NULL,
    reference VARCHAR(100),
    source VARCHAR(20) NOT NULL DEFAULT 'manual',
    status VARCHAR(12) NOT NULL DEFAULT 'draft',
    reversal_of INTEGER REFERENCES book_transactions(id) ON DELETE SET NULL,
    batch_id VARCHAR(50),
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    posted_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    posted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS book_tx_org_no_uq ON book_transactions (organization_id, journal_no);

CREATE INDEX IF NOT EXISTS book_tx_org_date_idx ON book_transactions (organization_id, entry_date);

CREATE INDEX IF NOT EXISTS book_tx_batch_idx ON book_transactions (batch_id);

CREATE TABLE IF NOT EXISTS book_lines (
    id SERIAL PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES book_transactions(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL DEFAULT 1,
    account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
    debit DECIMAL(15, 2) NOT NULL DEFAULT 0,
    credit DECIMAL(15, 2) NOT NULL DEFAULT 0,
    memo VARCHAR(300),
    order_number VARCHAR(20),
    car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS book_lines_tx_idx ON book_lines (transaction_id);

CREATE INDEX IF NOT EXISTS book_lines_account_idx ON book_lines (account_id);

CREATE TABLE IF NOT EXISTS book_import_mappings (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    label VARCHAR(200) NOT NULL,
    direction VARCHAR(3) NOT NULL,
    account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS book_import_map_uq ON book_import_mappings (organization_id, direction, label);

CREATE TABLE IF NOT EXISTS book_period_locks (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    locked_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    locked_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS book_period_locks_uq ON book_period_locks (organization_id, year, month);
