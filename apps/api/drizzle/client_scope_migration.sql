-- ─── Client-side scoping migration ──────────────────────────────────────────
-- Adds two ADDITIVE columns needed by Phase 2 (role-based data scoping):
--
--   1. customers.user_id  → links a customer record back to a logged-in user.
--                           Populated when a client books an order themselves.
--                           NULL for legacy customer rows (which means clients
--                           cannot see them — those orders aren't theirs).
--
--   2. user.permissions   → JSONB bag for per-user permission overrides.
--                           Example: {"view_all_orders": true} lets a plain
--                           client see every order in the system, bypassing
--                           the "own orders only" scope. Granted by an admin
--                           via the access-request flow (Phase 3).
--
-- Both changes are idempotent (IF NOT EXISTS). Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. customers.user_id
ALTER TABLE "customers"
    ADD COLUMN IF NOT EXISTS "user_id" text
    REFERENCES "user"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_customers_user_id" ON "customers"("user_id");

-- 2. user.permissions  (JSONB, default empty object)
ALTER TABLE "user"
    ADD COLUMN IF NOT EXISTS "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Apply via:  cd apps/api && npm run migrate -- client_scope
