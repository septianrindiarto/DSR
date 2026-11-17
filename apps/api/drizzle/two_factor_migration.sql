-- ─────────────────────────────────────────────────────────────────────────────
-- Optional two-step verification (Better Auth twoFactor plugin, TOTP).
--   user.two_factor_enabled  flag set by Better Auth after the user verifies
--   two_factor               encrypted TOTP secret + backup codes per user
-- DDL only. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS two_factor (
    id TEXT PRIMARY KEY,
    secret TEXT NOT NULL,
    backup_codes TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    verified BOOLEAN DEFAULT TRUE,
    failed_verification_count INTEGER DEFAULT 0,
    locked_until TIMESTAMP
);

CREATE INDEX IF NOT EXISTS two_factor_user_idx ON two_factor (user_id);

CREATE INDEX IF NOT EXISTS two_factor_secret_idx ON two_factor (secret);
