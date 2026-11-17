-- ─────────────────────────────────────────────────────────────────────────────
-- Audit trail for sensitive reads: new activity_action values.
--   view    opening a private document (SIM/KTP/photo, legal docs, finance file)
--   export  bulk data export (orders, customers, drivers, fleet, finance, own data)
-- DDL only. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'view';

ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'export';
