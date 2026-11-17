-- ─────────────────────────────────────────────────────────────────────────────
-- Maintenance schedule, replacement units, emergency reports (owner 2026-11-13)
--   maintenance.end_date      planned finish (schedule, contracts and
--                             availability treat the unit as busy start → end)
--   lease_unit_replacements   a replacement car for a contract unit for a date
--                             range (maintenance, emergency or other reason)
--   unit_incidents            emergency / problem report by admin or driver;
--                             stakeholders (agency + contract client) notified
-- DDL only, idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS end_date TIMESTAMP;

CREATE TABLE IF NOT EXISTS lease_unit_replacements (
    id                  SERIAL PRIMARY KEY,
    contract_id         INTEGER NOT NULL,
    contract_unit_id    INTEGER NOT NULL,
    original_car_id     INTEGER,
    replacement_car_id  INTEGER NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE,
    reason              VARCHAR(20) NOT NULL DEFAULT 'maintenance',
    note                VARCHAR(300),
    maintenance_id      INTEGER,
    incident_id         INTEGER,
    status              VARCHAR(10) NOT NULL DEFAULT 'active',
    created_by          TEXT,
    created_at          TIMESTAMP DEFAULT NOW(),
    ended_at            TIMESTAMP,
    ended_by            TEXT
);
CREATE INDEX IF NOT EXISTS lease_unit_replacements_unit_idx ON lease_unit_replacements (contract_unit_id, start_date);
CREATE INDEX IF NOT EXISTS lease_unit_replacements_car_idx ON lease_unit_replacements (replacement_car_id);

CREATE TABLE IF NOT EXISTS unit_incidents (
    id                SERIAL PRIMARY KEY,
    car_id            INTEGER NOT NULL,
    organization_id   INTEGER,
    contract_id       INTEGER,
    contract_unit_id  INTEGER,
    kind              VARCHAR(20) NOT NULL DEFAULT 'breakdown',
    severity          VARCHAR(10) NOT NULL DEFAULT 'urgent',
    description       TEXT NOT NULL,
    location          VARCHAR(200),
    off_road          BOOLEAN NOT NULL DEFAULT FALSE,
    status            VARCHAR(10) NOT NULL DEFAULT 'open',
    reported_by       TEXT,
    reported_at       TIMESTAMP DEFAULT NOW(),
    resolution        TEXT,
    resolved_by       TEXT,
    resolved_at       TIMESTAMP
);
CREATE INDEX IF NOT EXISTS unit_incidents_org_idx ON unit_incidents (organization_id, status);
CREATE INDEX IF NOT EXISTS unit_incidents_car_idx ON unit_incidents (car_id, reported_at DESC);
