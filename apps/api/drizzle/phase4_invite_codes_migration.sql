-- ─── Phase 4A — Account type split + Organization invite codes ─────────────
-- Adds the schema pieces needed to model:
--   • account_type on user — separates "agency vs client" from "admin vs user"
--   • organizations.admin_user_id — one admin per company (UNIQUE)
--   • organizations.invite_code — 8-char code emailed to new admins; team
--     members register by entering it instead of typing the company name
--   • organizations.name_normalized — informational lookup column for soft
--     duplicate detection (not currently enforced UNIQUE — invite codes are
--     the canonical join mechanism)
--
-- All statements are additive and idempotent (IF NOT EXISTS guards).
-- Backfill at the bottom is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. user.account_type
ALTER TABLE "user"
    ADD COLUMN IF NOT EXISTS "account_type" varchar(20) NOT NULL DEFAULT 'client';

CREATE INDEX IF NOT EXISTS "idx_user_account_type" ON "user"("account_type");

-- 2. organizations.admin_user_id  — at most one admin per org via UNIQUE INDEX
--    (CONSTRAINT … UNIQUE doesn't support IF NOT EXISTS, but a UNIQUE INDEX does.)
ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "admin_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_organizations_admin_user_id"
    ON "organizations"("admin_user_id") WHERE "admin_user_id" IS NOT NULL;

-- 3. organizations.invite_code  — short string, UNIQUE
ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "invite_code" varchar(12) UNIQUE;

-- 4. organizations.name_normalized  — lower + trimmed name for soft-dup checks
ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "name_normalized" text;

CREATE INDEX IF NOT EXISTS "idx_organizations_name_normalized"
    ON "organizations"("name_normalized");

-- ─── Backfill ──────────────────────────────────────────────────────────────

-- Pre-existing roles map to an account_type. NULL → 'client' via DEFAULT, but
-- explicit set keeps the data clean for rows inserted before the DEFAULT was added.
UPDATE "user"
SET "account_type" = 'agency'
WHERE "role" IN ('admin', 'superadmin', 'agent', 'demo')
  AND ("account_type" IS NULL OR "account_type" = 'client');

UPDATE "user"
SET "account_type" = 'client'
WHERE "role" IN ('client', 'client_admin')
  AND ("account_type" IS NULL OR "account_type" = 'agency');

-- Normalize existing org names
UPDATE "organizations"
SET "name_normalized" = lower(regexp_replace(trim("name"), '\s+', ' ', 'g'))
WHERE "name_normalized" IS NULL;

-- Apply via:  cd apps/api && npm run migrate -- phase4_invite_codes
