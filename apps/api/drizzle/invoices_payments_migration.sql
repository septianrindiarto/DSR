-- ─────────────────────────────────────────────────────────────────────────────
-- Partial invoice payments (#10).
--   invoice_payments      one row per received payment (amount + date).
--   invoices.paid_amount  running total (denormalized, kept in sync by
--                         invoice.service) so list/status reads stay join-free.
-- An invoice is Paid when paid_date (Tgl Realisasi) is set — always entered
-- manually. Payments never set it. With some amount recorded but no Tgl
-- Realisasi yet it shows "Sebagian" (partial). is_final is unused (kept for
-- compatibility).
-- DDL only, no data changed. Idempotent. Runs after invoices_migration.sql.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_payments (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount DECIMAL(15, 2) NOT NULL,
    paid_date TIMESTAMP NOT NULL,
    is_final BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON invoice_payments (invoice_id);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(15, 2) NOT NULL DEFAULT 0;
