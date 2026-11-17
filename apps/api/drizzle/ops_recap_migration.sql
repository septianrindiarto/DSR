-- ─────────────────────────────────────────────────────────────────────────────
-- Rekap Operasional & Lembur (monthly contracts)
--   lease_contracts.extras_mode   included | separate | none   (X-02)
--   lease_contracts.cutoff_day    1–28, NULL = end of month   (cut-off per contract)
--   lease_contracts.work_start/_end  working window, default 08:00–17:00 (X-08)
--   drivers.employment_type       employee | freelance (overtime method, phase 2)
--   ops_entries                   one overtime / operational-cost activity
--   ops_recaps                    R001… recap per contract × period × kind
--   holidays                      national (organization_id NULL) or agency holidays
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS extras_mode VARCHAR(10) NOT NULL DEFAULT 'none';
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS cutoff_day SMALLINT;
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS work_start VARCHAR(5) NOT NULL DEFAULT '08:00';
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS work_end VARCHAR(5) NOT NULL DEFAULT '17:00';

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS employment_type VARCHAR(12);

CREATE TABLE IF NOT EXISTS ops_recaps (
    id SERIAL PRIMARY KEY,
    code VARCHAR(12) NOT NULL,
    contract_id INTEGER NOT NULL REFERENCES lease_contracts(id) ON DELETE CASCADE,
    agency_org_id INTEGER NOT NULL,
    client_org_id INTEGER NOT NULL,
    period VARCHAR(7) NOT NULL,
    kind VARCHAR(10) NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'waiting',
    entry_count INTEGER NOT NULL DEFAULT 0,
    total_hours DECIMAL(8, 2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    submitted_at TIMESTAMP DEFAULT NOW(),
    reminders JSONB,
    approved_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    invoice_id INTEGER,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ops_recaps_code_uq ON ops_recaps (code);
CREATE INDEX IF NOT EXISTS ops_recaps_period_idx ON ops_recaps (contract_id, period, kind);
CREATE INDEX IF NOT EXISTS ops_recaps_status_idx ON ops_recaps (status, client_org_id);

CREATE TABLE IF NOT EXISTS ops_entries (
    id SERIAL PRIMARY KEY,
    agency_org_id INTEGER NOT NULL,
    client_org_id INTEGER NOT NULL,
    contract_id INTEGER NOT NULL REFERENCES lease_contracts(id) ON DELETE CASCADE,
    contract_unit_id INTEGER,
    car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
    driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
    kind VARCHAR(10) NOT NULL,
    type VARCHAR(16) NOT NULL,
    entry_date DATE NOT NULL,
    start_time VARCHAR(5),
    end_time VARCHAR(5),
    day_type VARCHAR(10) NOT NULL DEFAULT 'workday',
    hours DECIMAL(6, 2),
    amount DECIMAL(14, 2),
    note VARCHAR(500),
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    source VARCHAR(10) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'submitted',
    billable BOOLEAN NOT NULL DEFAULT TRUE,
    reject_reason VARCHAR(300),
    recap_id INTEGER REFERENCES ops_recaps(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    verified_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    decided_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    decided_at TIMESTAMP,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ops_entries_contract_idx ON ops_entries (contract_id, entry_date);
CREATE INDEX IF NOT EXISTS ops_entries_recap_idx ON ops_entries (recap_id);
CREATE INDEX IF NOT EXISTS ops_entries_driver_idx ON ops_entries (driver_id, entry_date);
CREATE INDEX IF NOT EXISTS ops_entries_status_idx ON ops_entries (agency_org_id, status);

CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    name VARCHAR(120) NOT NULL,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS holidays_date_org_uq ON holidays (date, COALESCE(organization_id, 0));
