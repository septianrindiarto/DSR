-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: multi-tenancy + user management
--
-- WHY: introduce organisation-level data isolation so each partner company
-- only sees its own records.  Also expands roles to include `agent` and `demo`
-- and adds `is_active` / `is_demo` on the user table.
--
-- SAFE TO RE-RUN — every statement uses IF NOT EXISTS / IF NOT EXISTS.
--
-- Apply with:   cd apps/api && npm run migrate -- tenancy
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Expand user_role enum ──────────────────────────────────────────────────
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'demo';

-- ── 2. organizations (tenant companies) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id         serial PRIMARY KEY,
  name       varchar(255) NOT NULL UNIQUE,
  slug       varchar(100) UNIQUE,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT NOW(),
  updated_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS organizations_slug_idx ON organizations(slug);

-- ── 3. user table extensions ──────────────────────────────────────────────────
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_demo         boolean NOT NULL DEFAULT false;

-- Mark the demo account
UPDATE "user" SET is_demo = true WHERE email = 'demo@dsrsolution.com';

CREATE INDEX IF NOT EXISTS user_organization_id_idx ON "user"(organization_id);

-- ── 4. Add organization_id + created_by to all isolated tables ────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE maintenance
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by      text REFERENCES "user"(id) ON DELETE SET NULL;

-- ── 5. Indexes on organization_id for fast tenant queries ─────────────────────
CREATE INDEX IF NOT EXISTS orders_organization_id_idx          ON orders(organization_id);
CREATE INDEX IF NOT EXISTS cars_organization_id_idx            ON cars(organization_id);
CREATE INDEX IF NOT EXISTS customers_organization_id_idx       ON customers(organization_id);
CREATE INDEX IF NOT EXISTS drivers_organization_id_idx         ON drivers(organization_id);
CREATE INDEX IF NOT EXISTS companies_organization_id_idx       ON companies(organization_id);
CREATE INDEX IF NOT EXISTS maintenance_organization_id_idx     ON maintenance(organization_id);
CREATE INDEX IF NOT EXISTS journal_entries_organization_id_idx ON journal_entries(organization_id);
CREATE INDEX IF NOT EXISTS chart_of_accounts_org_id_idx        ON chart_of_accounts(organization_id);
CREATE INDEX IF NOT EXISTS reviews_organization_id_idx         ON reviews(organization_id);
