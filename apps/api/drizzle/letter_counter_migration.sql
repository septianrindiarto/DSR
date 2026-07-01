-- ─────────────────────────────────────────────────────────────────────────────
-- Company-wide letter-number register
--
-- Every formal document a company issues (surat pengantar tagihan, surat
-- penawaran, invoice cover, etc.) shares ONE incrementing letter number per
-- year, e.g. "No.26/DSR/070". This is distinct from the invoice number
-- (e.g. 26/DSR/INV/C001). The counter is per organization + per calendar year
-- so the sequence naturally resets each January (No.27/DSR/001).
--
-- next-number generation is atomic via INSERT ... ON CONFLICT DO UPDATE
-- (see document.service.js getNextLetterNumber).
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS letter_counters (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,
    year            INTEGER NOT NULL,
    last_seq        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT letter_counters_org_year_unique UNIQUE (organization_id, year)
);

-- Seed the current sequence so the next issued number continues the real-world
-- series. As of this migration the last manually-issued letter was No.26/DSR/069,
-- so 2026 starts at 69 and the next generated number is 070. Adjust if your
-- agency's org id is not 1.
INSERT INTO letter_counters (organization_id, year, last_seq)
VALUES (1, 2026, 69)
ON CONFLICT (organization_id, year) DO NOTHING;
