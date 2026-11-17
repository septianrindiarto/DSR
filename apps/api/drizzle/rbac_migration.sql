-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC v2 — feature × action permissions, templates, audit, agency legal docs.
--
--   user.template_key       which template the user starts from:
--                           'sys:<key>' (built-in, see access.service.js) or
--                           'org:<id>' (permission_templates row). NULL =
--                           derived from role + account_type at runtime, so
--                           existing users keep working with NO data change.
--   user.perm_grants        extra permissions on top of the template
--   user.perm_revokes       permissions removed from the template
--   permission_templates    org-editable templates
--   permission_audit        who changed whose access, before/after
--   organizations.default_template   template for new members of this org
--   organizations.legal_status       'active' | 'setup' (agency without
--                                    complete legal documents). Existing
--                                    rows default to 'active'.
--   organizations.legal_docs         { nib, akta, npwp, ktp } → { url, number?, uploadedAt }
--   organizations.nib                NIB number (NPWP already exists)
--
-- DDL only — no rows are changed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS template_key VARCHAR(60);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS perm_grants JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS perm_revokes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_template VARCHAR(60);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_status VARCHAR(12) NOT NULL DEFAULT 'active';

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_docs JSONB;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS nib VARCHAR(30);

CREATE TABLE IF NOT EXISTS permission_templates (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS permission_templates_org_idx ON permission_templates (organization_id);

CREATE TABLE IF NOT EXISTS permission_audit (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    target_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
    target_template_id INTEGER,
    action VARCHAR(40) NOT NULL,
    before JSONB,
    after JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS permission_audit_org_idx ON permission_audit (organization_id, created_at);
