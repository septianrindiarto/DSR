-- ─────────────────────────────────────────────────────────────────────────────
-- Phase B — online payment (Xendit) + driver app
-- Phase C — ratings, agency profile, claim reminders
--   payment_links      one Xendit payment link (invoice) per request, webhook-updated
--   driver_trips       start/finish log per order row (time, odometer, fuel, photos)
--   driver_expenses    BBM/tol/parkir entered by drivers (→ Books draft)
--   drivers.user_id    login account of the driver (driver app)
--   reviews.agency_org_id  which agency the rating is for
--   orders.claimed_at / claim_reminder_count / last_claim_reminder_at
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_links (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    organization_id INTEGER,
    provider VARCHAR(20) NOT NULL DEFAULT 'xendit',
    external_id VARCHAR(100) NOT NULL,
    provider_id VARCHAR(100),
    url TEXT,
    amount DECIMAL(15, 2) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMP,
    paid_at TIMESTAMP,
    paid_amount DECIMAL(15, 2),
    channel VARCHAR(60),
    payment_id INTEGER,
    raw JSONB,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_links_external_uq ON payment_links (external_id);

CREATE INDEX IF NOT EXISTS payment_links_invoice_idx ON payment_links (invoice_id);

CREATE TABLE IF NOT EXISTS driver_trips (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    organization_id INTEGER,
    status VARCHAR(12) NOT NULL DEFAULT 'started',
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    start_odometer INTEGER,
    start_fuel SMALLINT,
    start_photos JSONB,
    start_lat DECIMAL(10, 7),
    start_lng DECIMAL(10, 7),
    ended_at TIMESTAMP,
    end_odometer INTEGER,
    end_fuel SMALLINT,
    end_photos JSONB,
    end_lat DECIMAL(10, 7),
    end_lng DECIMAL(10, 7),
    overtime_hours_suggested DECIMAL(5, 2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_trips_order_uq ON driver_trips (order_id);

CREATE TABLE IF NOT EXISTS driver_expenses (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER,
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    spent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    receipt TEXT,
    note VARCHAR(300),
    book_transaction_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS driver_expenses_driver_idx ON driver_expenses (driver_id, spent_at);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_user_uq ON drivers (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS agency_org_id INTEGER;

CREATE INDEX IF NOT EXISTS reviews_order_idx ON reviews (order_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS claim_reminder_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_claim_reminder_at TIMESTAMP;
