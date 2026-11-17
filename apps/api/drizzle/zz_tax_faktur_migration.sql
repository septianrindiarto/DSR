-- ─────────────────────────────────────────────────────────────────────────────
-- Tax on invoices, Faktur Pajak (gabungan), contract mapping, default policy
-- (owner 2026-11-09)
--   organizations.tax_profile          agency default (PKP/PPN, PPh mode/rate)
--   client_agency_links.tax_profile    per client of an agency (overrides)
--   invoices.*                         stored breakdown = what is printed and
--                                      what the faktur pajak carries
--   invoice_payments.kind / ref        'cash' or 'pph23' (bukti potong)
--   faktur_pajak                       one faktur = one or more invoices of the
--                                      same buyer in the same masa pajak
--   orders.contract_id                 which contract a row belongs to (M/L/R)
--   organizations.ops_policy_default   agency default lembur & perjalanan dinas
-- DDL only — no data is inserted or changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tax_profile JSONB;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ops_policy_default JSONB;
ALTER TABLE client_agency_links ADD COLUMN IF NOT EXISTS tax_profile JSONB;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal DECIMAL(15,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dpp DECIMAL(15,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dpp_other DECIMAL(15,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ppn_amount DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pph_mode VARCHAR(10) NOT NULL DEFAULT 'none';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pph_rate DECIMAL(5,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pph_amount DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_profile JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS faktur_id INTEGER;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contract_id INTEGER;

ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'cash';
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS withholding_ref VARCHAR(80);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS contract_id INTEGER;
CREATE INDEX IF NOT EXISTS orders_contract_idx ON orders (contract_id);

CREATE TABLE IF NOT EXISTS faktur_pajak (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL,          -- agency (penjual)
    client_org_id   INTEGER,                   -- pembeli (company)
    buyer_name      VARCHAR(255),
    buyer_npwp      VARCHAR(40),
    buyer_address   TEXT,
    masa            VARCHAR(7) NOT NULL,       -- YYYY-MM
    kind            VARCHAR(10) NOT NULL DEFAULT 'tunggal',   -- tunggal | gabungan
    nsfp            VARCHAR(40),               -- nomor seri faktur (Coretax)
    faktur_date     DATE,
    status          VARCHAR(12) NOT NULL DEFAULT 'draft',     -- draft | terbit | diganti | batal
    replaces_id     INTEGER,
    dpp             DECIMAL(15,2) NOT NULL DEFAULT 0,
    dpp_other       DECIMAL(15,2) NOT NULL DEFAULT 0,
    ppn_amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_profile     JSONB,
    file_ref        TEXT,
    file_name       VARCHAR(200),
    notes           TEXT,
    created_by      TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS faktur_pajak_org_masa_idx ON faktur_pajak (organization_id, masa);
CREATE UNIQUE INDEX IF NOT EXISTS faktur_pajak_nsfp_uq ON faktur_pajak (organization_id, nsfp) WHERE nsfp IS NOT NULL AND status <> 'batal';
