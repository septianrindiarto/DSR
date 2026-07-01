-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 2 P2 — affiliate & agency codes + link approval token
--
--   user.affiliate_code        — per-agent code; public landing /?ref=<code>
--                                ties a private order to that agent's agency.
--   organizations.agency_code  — per-agency code; a client enters it at
--                                registration or in Pengaturan to link.
--   client_agency_links.approval_token — when an agency adds a COMPANY client,
--                                the link is 'pending' until the client clicks
--                                the email approve link carrying this token.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: client_agency_links.approval_token lives in
-- client_agency_links_migration.sql so this file has no cross-table dependency
-- and can run in any order. Here we only touch the pre-existing user + orgs.
ALTER TABLE "user"        ADD COLUMN IF NOT EXISTS affiliate_code VARCHAR(20);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS agency_code    VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_affiliate_code ON "user" (affiliate_code) WHERE affiliate_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_agency_code     ON organizations (agency_code) WHERE agency_code IS NOT NULL;
