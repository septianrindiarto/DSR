-- ─── Phase 4B — Per-org company info columns ─────────────────────────────
-- Lets every organization store its own invoice/document header fields.
-- Replaces the hardcoded "DSR Solution" defaults in AdminSettings.jsx so
-- newly registered client orgs see blank fields (their own data) instead
-- of someone else's contact info.
--
-- All additive (ADD COLUMN IF NOT EXISTS). Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "address"   text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "phone1"    varchar(50);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "phone2"    varchar(50);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "email"     varchar(255);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "signatory" varchar(255);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brand"     varchar(100);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "npwp"      varchar(30);

-- Apply via:  cd apps/api && npm run migrate -- org_company_info
