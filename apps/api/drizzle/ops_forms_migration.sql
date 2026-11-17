-- ─────────────────────────────────────────────────────────────────────────────
-- Rekap Operasional & Lembur — forms (SPKL lembur, SPPD perjalanan dinas)
--   ops_entries.detail         form data: SPKL rows (start/end/driving/waiting),
--                              SPPD legs (arrival, date, lodging), calc snapshot
--   lease_contracts.ops_policy per-contract overtime & SPPD policy (base salary,
--                              tiers, waiting compensation, daily allowance …)
-- New kind 'trip' and status 'draft' are plain values (no DDL needed).
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_entries ADD COLUMN IF NOT EXISTS detail JSONB;
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS ops_policy JSONB;
