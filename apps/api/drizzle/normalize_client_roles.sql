-- normalize_client_roles.sql
--
-- Collapses two legacy role strings ('client', 'client_admin') into the
-- canonical pair (user, admin) for accounts where account_type='client'.
-- Idempotent: re-running is a no-op.

BEGIN;

UPDATE "user"
SET role = 'user', updated_at = NOW()
WHERE role = 'client'
  AND account_type = 'client';

UPDATE "user"
SET role = 'admin', updated_at = NOW()
WHERE role = 'client_admin'
  AND account_type = 'client';

-- Sanity check: report what's left for visibility.
DO $$
DECLARE
    n_client_legacy   INT;
    n_clientadm_legacy INT;
BEGIN
    SELECT COUNT(*) INTO n_client_legacy   FROM "user" WHERE role = 'client';
    SELECT COUNT(*) INTO n_clientadm_legacy FROM "user" WHERE role = 'client_admin';
    IF n_client_legacy > 0 OR n_clientadm_legacy > 0 THEN
        RAISE NOTICE 'WARN: % rows still have role=client and % rows still have role=client_admin (likely account_type != client).',
            n_client_legacy, n_clientadm_legacy;
    ELSE
        RAISE NOTICE 'OK: no legacy role values remain.';
    END IF;
END $$;

COMMIT;
