-- ─── Access Requests table ─────────────────────────────────────────────────
-- Phase 3: a logged-in client can ask for access to a feature their role
-- doesn't currently grant. Admins see a queue and approve / reject.
--
-- On approve, the user.permissions JSONB gets a new flag (e.g.
-- {"grant_fleet": true}) — backend route guards and the frontend permission
-- helper check it as a per-user override on top of the role's default access.
--
-- NOTE: CREATE TYPE doesn't support IF NOT EXISTS in older Postgres, so on
-- re-runs the runner will log an "already exists" error for statement [1].
-- That's harmless — the table + index statements are guarded with IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "access_request_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS "access_requests" (
    "id"            serial PRIMARY KEY,
    "user_id"       text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "feature_key"   varchar(50) NOT NULL,
    "status"        "access_request_status" NOT NULL DEFAULT 'pending',
    "note"          text,
    "requested_at"  timestamp NOT NULL DEFAULT NOW(),
    "decided_by"    text REFERENCES "user"("id") ON DELETE SET NULL,
    "decided_at"    timestamp
);

CREATE INDEX IF NOT EXISTS "idx_access_requests_user_id" ON "access_requests"("user_id");
CREATE INDEX IF NOT EXISTS "idx_access_requests_status" ON "access_requests"("status");

-- Apply via:  cd apps/api && npm run migrate -- access_requests
