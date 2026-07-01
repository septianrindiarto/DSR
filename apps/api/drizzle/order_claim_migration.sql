-- ─────────────────────────────────────────────────────────────────────────────
-- Order claim model (Stage 2)
--
-- An unassigned order (anonymous landing, or a company client with no agency)
-- is *claimed* by an admin — the claimer/agency becomes responsible. Distinct
-- from cancel/delete. claim_status:
--   unclaimed      — open, claimable
--   client_claimed — a client admin linked it to their company
--   agency_claimed — an agency took responsibility (fulfils it)
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_by_user_id   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_by_agency_id INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claim_status         VARCHAR(20) DEFAULT 'unclaimed';

CREATE INDEX IF NOT EXISTS idx_orders_claim_status ON orders (claim_status);
