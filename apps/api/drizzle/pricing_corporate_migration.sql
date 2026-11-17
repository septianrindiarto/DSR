-- ─────────────────────────────────────────────────────────────────────────────
-- Priority 1 — Pricing engine (rate cards, city zones, corporate rates)
-- Priority 2 — Corporate portal (approval, cost centres)
--
--   rate_cards        agency price per day: category × package × zone (1–4),
--                     optional car_model override (e.g. "Innova Zenix").
--   zone_cities       agency's city → zone tier list (destination → tier).
--   corporate_rates   negotiated price / discount for one client company.
--   cost_centers      a client company's divisions / cost centres.
--   organizations.pricing_settings    { overtimePerHour, overnightPerNight,
--                                       rounding, publicPrices, defaultZone }
--   organizations.corporate_settings  { requireApproval, costCenterRequired }
--   orders.cost_center, client approval columns, price_source, price_zone.
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_cards (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category VARCHAR(40) NOT NULL,
    package VARCHAR(20) NOT NULL,
    zone SMALLINT NOT NULL,
    car_model VARCHAR(100) NOT NULL DEFAULT '',
    price_per_day DECIMAL(12, 2) NOT NULL,
    updated_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS rate_cards_uq ON rate_cards (organization_id, category, package, zone, car_model);

CREATE TABLE IF NOT EXISTS zone_cities (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    city VARCHAR(100) NOT NULL,
    city_norm VARCHAR(100) NOT NULL,
    zone SMALLINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS zone_cities_uq ON zone_cities (organization_id, city_norm);

CREATE TABLE IF NOT EXISTS corporate_rates (
    id SERIAL PRIMARY KEY,
    agency_org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category VARCHAR(40) NOT NULL,
    package VARCHAR(20) NOT NULL,
    zone SMALLINT NOT NULL DEFAULT 0,
    price_per_day DECIMAL(12, 2),
    discount_pct DECIMAL(5, 2),
    valid_until DATE,
    updated_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS corporate_rates_uq ON corporate_rates (agency_org_id, client_org_id, category, package, zone);

CREATE TABLE IF NOT EXISTS cost_centers (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(30),
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_uq ON cost_centers (organization_id, name);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pricing_settings JSONB;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS corporate_settings JSONB;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_center VARCHAR(100);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_approval_status VARCHAR(12);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_approved_by TEXT REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMP;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_approval_note VARCHAR(500);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_source VARCHAR(20);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_zone SMALLINT;

CREATE INDEX IF NOT EXISTS orders_client_approval_idx ON orders (organization_id, client_approval_status);
