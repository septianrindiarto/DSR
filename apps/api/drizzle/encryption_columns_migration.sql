-- ─────────────────────────────────────────────────────────────────────────────
-- AES-256-GCM field encryption needs room for ciphertext ("enc:v1:…", ~100
-- chars): widen the encrypted columns to TEXT. DDL only — values unchanged.
-- Existing plain values are converted by `node src/scripts/encrypt-existing.js`
-- (dry-run by default; ask before --apply). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizations ALTER COLUMN npwp TYPE TEXT;

ALTER TABLE organizations ALTER COLUMN nib TYPE TEXT;

ALTER TABLE drivers ALTER COLUMN license_number TYPE TEXT;
