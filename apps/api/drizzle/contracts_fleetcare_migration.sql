-- ─────────────────────────────────────────────────────────────────────────────
-- Long-term contracts, fleet care (service & document reminders), job runs.
--   lease_contracts / lease_contract_units  monthly/yearly corporate contracts
--   lease_billings                          one row per contract × month billed
--   odometer_readings                       manual / trip / service km readings
--   cars.*_expiry, odometer, service plan   fleet care
--   maintenance.odometer                    km at the service
--   job_runs                                last run of daily/monthly jobs
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lease_contracts (
    id SERIAL PRIMARY KEY,
    agency_org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contract_number VARCHAR(40) NOT NULL,
    title VARCHAR(200),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    billing_day SMALLINT NOT NULL DEFAULT 1,
    km_allowance_month INTEGER,
    excess_km_rate DECIMAL(12, 2),
    includes JSONB,
    package VARCHAR(40),
    status VARCHAR(12) NOT NULL DEFAULT 'draft',
    notes TEXT,
    reminders_sent JSONB,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lease_contracts_no_uq ON lease_contracts (agency_org_id, contract_number);

CREATE INDEX IF NOT EXISTS lease_contracts_client_idx ON lease_contracts (client_org_id, status);

CREATE TABLE IF NOT EXISTS lease_contract_units (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES lease_contracts(id) ON DELETE CASCADE,
    car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
    driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
    monthly_fee DECIMAL(12, 2) NOT NULL,
    start_date DATE,
    end_date DATE,
    notes VARCHAR(300)
);

CREATE INDEX IF NOT EXISTS lease_units_contract_idx ON lease_contract_units (contract_id);

CREATE TABLE IF NOT EXISTS lease_billings (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES lease_contracts(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    order_number VARCHAR(20),
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    detail JSONB,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lease_billings_uq ON lease_billings (contract_id, period);

CREATE TABLE IF NOT EXISTS odometer_readings (
    id SERIAL PRIMARY KEY,
    car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
    reading_date TIMESTAMP NOT NULL DEFAULT NOW(),
    km INTEGER NOT NULL,
    source VARCHAR(12) NOT NULL DEFAULT 'manual',
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS odometer_car_date_idx ON odometer_readings (car_id, reading_date);

ALTER TABLE cars ADD COLUMN IF NOT EXISTS stnk_expiry DATE;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS tax_expiry DATE;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS kir_expiry DATE;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS insurance_expiry DATE;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS current_odometer INTEGER;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS odometer_updated_at TIMESTAMP;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS service_interval_km INTEGER;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS service_interval_months SMALLINT;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS last_service_km INTEGER;

ALTER TABLE cars ADD COLUMN IF NOT EXISTS last_service_date DATE;

ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS odometer INTEGER;

CREATE TABLE IF NOT EXISTS job_runs (
    job_key VARCHAR(80) PRIMARY KEY,
    last_run_at TIMESTAMP NOT NULL,
    detail JSONB
);
