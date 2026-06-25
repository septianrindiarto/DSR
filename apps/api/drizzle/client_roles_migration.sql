-- ─── Add new role values to user_role enum ─────────────────────────────────
-- Required by Phase 1: new registrations default to role='client' (clients)
-- and the multi-tenant work (Phase 4) uses 'client_admin' for company admins.
--
-- Postgres ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent — safe to
-- re-run; existing enum values are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'client';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'client_admin';

-- Apply via:  cd apps/api && npm run migrate -- client_roles
