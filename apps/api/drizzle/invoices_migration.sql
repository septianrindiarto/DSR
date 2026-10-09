-- ─────────────────────────────────────────────────────────────────────────────
-- Invoices as a first-class record (D.2).
--
--   invoices                 one row per issued invoice. A group invoice
--                            (several kode transaksi) is ONE invoice linked
--                            to many order rows via orders.invoice_id.
--   orders.invoice_id        indexed FK → invoices.id. The existing
--                            orders.invoice_* columns stay as a denormalized
--                            read copy (kept in sync by invoice.service) so
--                            list/export queries stay join-free and fast.
--   organizations.payment_term_days
--                            payment term (days). On a CLIENT org (company
--                            directory) = that client's term; on the AGENCY
--                            org = the default term. Due date = sent + term.
--
-- invoice_number never changes on cancel & re-issue: only one NON-cancelled
-- invoice may hold a given number per agency (partial unique index); the
-- cancelled one stays as history (replaces_invoice_id points back to it).
--
-- DDL only — no data is changed. Linking existing invoiced orders is done by
-- src/scripts/backfill-invoices.js (dry-run by default).
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    client_org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    company_name VARCHAR(255),
    letter_number VARCHAR(50),
    sent_date TIMESTAMP,
    due_date TIMESTAMP,
    paid_date TIMESTAMP,
    payment_term_days INTEGER,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMP,
    cancel_reason TEXT,
    replaces_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    notes TEXT,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_active_uq
    ON invoices (organization_id, invoice_number) WHERE is_cancelled = FALSE;

CREATE INDEX IF NOT EXISTS invoices_client_org_idx ON invoices (client_org_id);

CREATE INDEX IF NOT EXISTS invoices_org_sent_idx ON invoices (organization_id, sent_date);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_invoice_id_idx ON orders (invoice_id);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_term_days INTEGER;
