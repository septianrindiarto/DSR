-- ─────────────────────────────────────────────────────────────────────────────
-- Client ↔ Agency links (Stage 2) — many-to-many
--
-- A client company can be served by several agencies and vice-versa. This
-- junction replaces the single `organizations.parent_agency_id` as the source
-- of truth for "which agencies serve this client". status:
--   active   — live relationship
--   pending  — agency added a company client; awaiting the client's approval
--   archived — historical (kept for visibility into past orders)
--
-- Backfill seeds links from the existing parent_agency_id so nothing is lost.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_agency_links (
    id             SERIAL PRIMARY KEY,
    client_org_id  INTEGER NOT NULL,
    agency_org_id  INTEGER NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'active',
    approval_token VARCHAR(64),
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by     TEXT,
    CONSTRAINT client_agency_links_unique UNIQUE (client_org_id, agency_org_id)
);

-- Defensive (idempotent) in case the table pre-existed without this column.
ALTER TABLE client_agency_links ADD COLUMN IF NOT EXISTS approval_token VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_cal_agency ON client_agency_links (agency_org_id, status);
CREATE INDEX IF NOT EXISTS idx_cal_client ON client_agency_links (client_org_id, status);
CREATE INDEX IF NOT EXISTS idx_cal_approval_token ON client_agency_links (approval_token) WHERE approval_token IS NOT NULL;

-- Seed from existing parent_agency_id relationships.
INSERT INTO client_agency_links (client_org_id, agency_org_id, status)
SELECT id, parent_agency_id, 'active'
FROM organizations
WHERE parent_agency_id IS NOT NULL
ON CONFLICT (client_org_id, agency_org_id) DO NOTHING;
