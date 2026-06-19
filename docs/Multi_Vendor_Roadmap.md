# Multi-vendor (m2m client ↔ agency) — design note

**Status:** Phase 2 enhancement (not yet implemented)
**Phase 1 (current):** Every client org has exactly one agency, identified
by `organizations.parent_agency_id`. Today there is one agency
(DSR Rent Car, `org_id=1`); every client points at it.

This note describes the data and code changes required when the platform
needs to support **many clients ↔ many agencies**.

---

## Domain model summary

A client (the customer company) can engage one or more agencies (vendor /
rental companies that serve them). An agency can have many clients. The
relationship is therefore **many-to-many**.

Key user-facing rule:

> A Rekap Order for client `C` is visible to **every member of every
> agency `C` has listed as a vendor**, and to every member of `C` itself.

So when PT Foo lists DSR Rent Car AND Jaya Rental as vendors, an order PT
Foo creates appears in the Rekap Order of DSR Rent Car admins, Jaya Rental
admins, and PT Foo's own users. When PT Foo later removes Jaya Rental,
historical orders stay visible to Jaya Rental (read-only) but new orders
do not appear to them.

---

## Phase 1 → Phase 2 deltas

### Schema

Drop the single-agency assumption baked into
`organizations.parent_agency_id` and replace it with a junction table:

```sql
CREATE TABLE client_agency_links (
    id              SERIAL PRIMARY KEY,
    client_org_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agency_org_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    relationship    VARCHAR(20) NOT NULL DEFAULT 'active',
                    -- one of: 'active', 'archived'
                    -- archived links keep historical visibility but
                    -- exclude new orders.
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by      TEXT REFERENCES "user"(id),
    UNIQUE (client_org_id, agency_org_id)
);

CREATE INDEX idx_client_agency_links_agency ON client_agency_links (agency_org_id, relationship);
CREATE INDEX idx_client_agency_links_client ON client_agency_links (client_org_id, relationship);
```

Backfill on rollout:

```sql
INSERT INTO client_agency_links (client_org_id, agency_org_id, relationship)
SELECT id, parent_agency_id, 'active'
FROM organizations
WHERE parent_agency_id IS NOT NULL;
```

`organizations.parent_agency_id` stays for one release as a denormalised
read-cache of "primary agency" so existing UI keeps working, then gets
dropped.

### Scope middleware

`apps/api/src/middleware/scope.js` — replace the inline subquery:

```js
// Phase 1
const clientOrgsSubquery = sql`(SELECT id FROM organizations WHERE parent_agency_id = ${orgId})`;

// Phase 2
const clientOrgsSubquery = sql`(
    SELECT client_org_id
    FROM client_agency_links
    WHERE agency_org_id = ${orgId} AND relationship = 'active'
)`;
```

Nothing else in `scope.js` changes — the OR clause and the surrounding
agency/client branches are already correct.

### Order creation

`apps/api/src/routes/orders.routes.js` — the Tambah Rekap matcher
already resolves a `companyName` to an org and writes that org's id into
`organizationId`. No change needed; the new scope subquery will pick up
the order through any of the client's listed agencies.

### Org admin UI

Add a Vendor list to the client's Pengaturan page:

```
Pengaturan → Vendor Anda
┌────────────────────────────────────────────────┐
│ DSR Rent Car        [Aktif]   [Arsipkan]       │
│ Jaya Rental         [Aktif]   [Arsipkan]       │
│ Sumber Jaya         [Diarsip] [Aktifkan ulang] │
│                                                │
│ + Tambah vendor: [____________] [+ Tambah]     │
└────────────────────────────────────────────────┘
```

Add a Client list to the agency's Pengaturan page (read-only, just for
visibility):

```
Pengaturan → Klien Anda
┌────────────────────────────────────────────────┐
│ PT Superintending Co     27 order              │
│ PT XYZ Indonesia         12 order              │
│ Arhent Group             5 order               │
└────────────────────────────────────────────────┘
```

### Permission rule

A client admin can add or remove vendors for their own org. An agency
admin cannot self-add themselves to a client (this prevents an agency
from claiming visibility into a client that hasn't opted in).

### API surface

```
GET    /api/orgs/my-vendors          (client admin)
POST   /api/orgs/my-vendors          (client admin) — link by display_id
DELETE /api/orgs/my-vendors/:linkId  (client admin) — soft archive
GET    /api/orgs/my-clients          (agency admin) — read-only list
```

---

## What we are deliberately NOT doing in Phase 1

- No per-order vendor override. An order is always visible to every
  active vendor of its client; you cannot route a single order to only
  one of three vendors. If that need surfaces, add an
  `orders.preferred_agency_id` column and let the scope filter prefer it
  when set.
- No "request to join" flow. In Phase 2 the client adds the vendor
  unilaterally; the vendor has no acceptance step. This matches how
  email contact lists work and avoids onboarding friction.
- No vendor-side commenting / pricing per client. That is a Phase 3
  topic alongside per-client price lists.

---

## Migration risk

The Phase 2 cutover is read-side only — every existing order keeps its
current `organization_id`. The only risk is the brief window where
`scope.js` queries `client_agency_links` but a few rows haven't been
backfilled. Mitigate by:

1. Run the backfill SQL **before** deploying the new `scope.js`.
2. Keep `parent_agency_id` populated for one release so a rollback is a
   single revert without touching data.
3. Add an integration test that loads a known fixture and asserts both
   PT Foo's order and DSR Rent Car admin's Rekap return the same row.

---

## Where this lives in the codebase

- `apps/api/src/db/schema.js` — add `clientAgencyLinks` table
- `apps/api/src/middleware/scope.js` — swap subquery (see above)
- `apps/api/src/routes/org.routes.js` — vendor CRUD
- `apps/api/src/services/permissions.service.js` — link-management gate
- `apps/web/src/pages/AdminSettings.jsx` — Vendor list section
- `drizzle/phase2_client_agency_links.sql` — schema + backfill migration
