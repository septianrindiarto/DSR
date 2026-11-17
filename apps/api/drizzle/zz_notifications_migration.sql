-- ─────────────────────────────────────────────────────────────────────────────
-- In-app notifications (owner 2026-11-13): per user, privilege based, shown on
-- the dashboard and the header bell for the whole app. A notification targets
-- an organisation, optionally narrowed to one permission (e.g. opsrecap.approve)
-- or one person. Read state is per user.
-- Also: invoices.cancelled_by / cancelled_meta (who cancelled an invoice and
-- which codes / contracts it had — its rows are unlinked when cancelled).
-- DDL only, idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER,
    user_id         TEXT,
    perm            VARCHAR(60),
    kind            VARCHAR(30) NOT NULL,
    severity        VARCHAR(10) NOT NULL DEFAULT 'info',
    title           VARCHAR(200) NOT NULL,
    body            TEXT,
    link            VARCHAR(300),
    ref             VARCHAR(60),
    created_by      TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_org_idx ON notifications (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id INTEGER NOT NULL,
    user_id         TEXT NOT NULL,
    read_at         TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_meta JSONB;
