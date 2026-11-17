-- ─────────────────────────────────────────────────────────────────────────────
-- One live login per user + 15-minute idle timeout (owner 2026-11-13)
--   session.last_seen_at   last real activity (clicks / API use; background
--                          polling does not count). Written at most every 30 s.
--   session_ends           why a browser's session ended (expired by idle /
--                          kicked by a login elsewhere) so that browser can be
--                          told the reason. Keyed by a SHA-256 of the token.
-- DDL only, idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT NOW();
CREATE INDEX IF NOT EXISTS session_user_idx ON "session" (user_id);

CREATE TABLE IF NOT EXISTS session_ends (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id    TEXT,
    reason     VARCHAR(12) NOT NULL,      -- expired | kicked
    device     VARCHAR(80),               -- the device that took over (kicked)
    at         TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS session_ends_at_idx ON session_ends (at);
