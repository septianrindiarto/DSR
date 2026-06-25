-- ─── Phase 4C-1 — Display ID + multi-agency hierarchy ─────────────────────
-- Adds:
--   1. display_id  — human-readable org identifier (e.g. "DRC_20260614").
--                    UNIQUE so it can be the user-facing handle. Replaces
--                    raw numeric ids in everything users see (invoice
--                    headers, invite cards, dropdowns, etc.).
--   2. parent_agency_id — points to the AGENCY org that owns this client.
--                         Today every client → DSR (org id 1). Future-proofs
--                         for multiple agencies each with their own clients.
--   3. notes       — free-text field that companies table had but
--                    organizations didn't (needed for Phase 4C-2 merge).
--
-- All additive (IF NOT EXISTS). Backfill is deferred to
-- src/scripts/backfill-display-ids.js so column generation logic stays in
-- JavaScript with the rest of the application code.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "display_id"       varchar(20);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "parent_agency_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "notes"            text;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_organizations_display_id"
    ON "organizations"("display_id") WHERE "display_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_organizations_parent_agency_id"
    ON "organizations"("parent_agency_id");

-- Apply via:  cd apps/api && npm run migrate -- org_display_id
-- Then backfill: node src/scripts/backfill-display-ids.js
