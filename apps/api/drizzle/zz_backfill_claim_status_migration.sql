-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 2 backfill — stamp PRE-EXISTING orders as already-owned.
--
-- Orders created before the auto-claim logic have claim_status = NULL, which
-- the Klaim Order view treats as "unclaimed" — so the entire back catalogue
-- shows up as claimable even though those orders are already live in Rekap.
--
-- This marks every legacy (NULL / 'unclaimed') order as 'agency_claimed' and
-- assigns the owning agency:
--   1. if the order belongs to a CLIENT company org → that client's parent
--      agency (organizations.parent_agency_id);
--   2. otherwise (agency-own or org-less order) → the first/default agency
--      (the org with parent_agency_id IS NULL).
--
-- Single statement (no DO block) so the naive migration splitter handles it.
-- Idempotent: after running, no rows match the WHERE, so re-running is a no-op.
-- Filename prefixed `zz_` so it sorts AFTER order_claim_migration.sql (which
-- creates the claim_status / claimed_by_agency_id columns).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE orders o
SET claim_status = 'agency_claimed',
    claimed_by_agency_id = COALESCE(
        o.claimed_by_agency_id,
        (SELECT org.parent_agency_id
           FROM organizations org
          WHERE org.id = o.organization_id
            AND org.parent_agency_id IS NOT NULL),
        (SELECT id FROM organizations
          WHERE parent_agency_id IS NULL
          ORDER BY id
          LIMIT 1)
    )
WHERE o.claim_status IS NULL
   OR o.claim_status = 'unclaimed';
