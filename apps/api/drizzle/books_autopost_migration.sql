-- ─────────────────────────────────────────────────────────────────────────────
-- Books auto-posting (invoices & payments → journal).
--   book_transactions.source_type / source_id  link an auto entry to the
--     business record that produced it ('invoice' | 'payment' | 'quick').
--   invoice_payments.account_id  which Kas/Bank account received the money.
-- DDL only — no data is inserted or changed. Existing invoices are posted
-- only when a finance user clicks "Sinkronkan" in Keuangan → Otomatis.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE book_transactions ADD COLUMN IF NOT EXISTS source_type VARCHAR(20);

ALTER TABLE book_transactions ADD COLUMN IF NOT EXISTS source_id INTEGER;

CREATE INDEX IF NOT EXISTS book_tx_source_idx ON book_transactions (organization_id, source_type, source_id);

ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
