# Stage 2 Design Note — Order Claim, Agency↔Client Foundation & Affiliate Links

**Status:** design / not yet built. Locks the approach before coding.
**Context:** clarification discussion in chat (4 scenarios). This supersedes the
read-side "broadcast to all vendors" idea in `Multi_Vendor_Roadmap.md` with an
explicit **claim** model.

---

## 1. Problem statement (verified in code)

1. **Agencies have no organization.** `auth-extra.routes.js` agency signup sets
   `role=admin, account_type=agency` but leaves `organization_id = NULL`. So an
   agency admin has no org id.
2. **Clients are force-pinned to a constant.** New client company orgs are
   created with `parent_agency_id = DEFAULT_AGENCY_ID` (hardcoded). There is no
   real per-agency assignment or choice.
3. **The invite code is intra-org only.** It joins a new user to an *existing
   client company* (`role=user, account_type=client`). It does **not** link a
   client to an agency.
4. **Consequences:**
   - The order-scope "my clients" subquery keys off the agency admin's own
     `organization_id` (NULL) → finds zero client orgs → the agency sees no
     client orders; the Pengguna (users) list returns empty for the same reason.
   - Anonymous landing orders are `organization_id = NULL`; only superadmin
     (no scope) reliably sees them.

**Net:** the agency↔client wiring is half-built. Any routing feature must fix
this foundation first, or "the agency tied to the client" is meaningless.

---

## 2. Decision

**Explicit claim over broadcast.** An unassigned order is *claimed*, not shown to
every possible vendor. This avoids the load-fairness problem and matches the
real responsibility model (whoever claims it, fulfils it).

---

## 3. Foundation fixes (do first)

### 3.1 Agency signup creates a real agency org
On `account_type=agency` signup, create an `organizations` row for the agency
(an agency org is identified by `parent_agency_id IS NULL` — it is itself a
top-level vendor) and set the new user's `organization_id` to it, `role=admin`,
`account_type=agency`.

### 3.2 Replace the hardcoded client→agency pin
Stop setting `parent_agency_id = DEFAULT_AGENCY_ID` blindly. A client's owning
agency is established by **how the order is routed** (claim/affiliate), not at
signup. Keep `parent_agency_id` as the "primary agency" cache if useful, but it
is no longer the source of truth for who handles an order.

### 3.3 One-time data fix for the current prod admin
`admin@dsrappai.com` currently can't see orders. Repair it: create the DSR
agency org and attach the admin. Documented SQL (run in Neon or as a script):

```sql
-- 1) create the agency org if missing (agency = parent_agency_id IS NULL)
INSERT INTO organizations (name, is_active, parent_agency_id)
SELECT 'DSR Rent Car', true, NULL
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE name = 'DSR Rent Car');

-- 2) attach the admin to it + ensure agency account type
UPDATE "user" u
SET organization_id = (SELECT id FROM organizations WHERE name = 'DSR Rent Car' LIMIT 1),
    account_type = 'agency',
    role = 'admin',
    updated_at = NOW()
WHERE u.email = 'admin@dsrappai.com';
```

(A reusable `src/scripts/fix-agency-admin.js` can wrap this.)

---

## 4. Order-claim mechanism

### 4.1 Data model — new columns on `orders`
- `claimed_by_user_id  TEXT NULL`     — who claimed it (client first, then agent)
- `claimed_by_agency_id INTEGER NULL` — agency that owns fulfilment
- `claim_status VARCHAR(20) DEFAULT 'unclaimed'` — `unclaimed | client_claimed | agency_claimed`
- (orders already have `organization_id`, `created_by`.)

Migration: `drizzle/order_claim_migration.sql` (idempotent `ADD COLUMN IF NOT EXISTS`).

### 4.2 States & flow
1. **Order created unassigned** (anonymous landing, or logged-in with no agency
   yet) → `claim_status = unclaimed`.
2. **Client claims** (logged-in client) → links the order to them + their org;
   `claim_status = client_claimed`. Now it surfaces to the agency/agencies
   attached to that client.
3. **Agent claims** → `claimed_by_user_id = agent`, `claimed_by_agency_id =
   agent's agency`, `claim_status = agency_claimed`. That agent/agency is now
   responsible.
4. **Logged-in submit** (client already authenticated) → skips step 2; appears
   directly in the agency's *Claim Order* tab (only the agency tied to that
   client).

### 4.3 Permissions
- **All roles except `demo`** can claim.
- Client claims surface to their agency; agents claim to take responsibility.

### 4.4 Notifications
On claim, send a **Telegram** message to the claimer's number **and** superadmin.
Reuse `telegram.service.js` (`notifyOrderClaimed({...})`, same no-throw pattern).

### 4.5 UI — repurpose *Permintaan Akses*
The access-requests tab is low-value. Replace it with **Claim Order**: a list of
claimable orders with a Claim button, filtered by role/visibility. (Keep the
`access_requests` table if used elsewhere; only the tab/route is repurposed.)

---

## 5. Private orders & agent affiliate links

- **Private (non-company) order with no affiliate** → superadmin assigns an agent
  to execute.
- **Agent affiliate link:** each agent (user) gets an `affiliate_code`. A public
  landing route `/?ref=<affiliate_code>` ties any order from that visit to the
  agent (and their agency). So an agency can take direct private business:
  the agent shares their link → random private client books through it → the
  order routes to that agent automatically.
- Data: `user.affiliate_code` (unique) + read `?ref=` on the landing/booking
  form → pass through to the order on submit → stamp `claimed_by_user_id` /
  `claimed_by_agency_id` (or a pending "preferred agent").

---

## 6. Endpoints & client (to add)

- `PUT  /api/orders/:id/claim`            — claim (role-gated, not demo)
- `PUT  /api/orders/:id/assign-agent`     — superadmin assigns an agent (private)
- `GET  /api/orders/claimable`            — list claimable orders for the caller
- `POST /api/orgs/affiliate-code`         — (re)generate the caller agent's code
- `api.orders.claim / claimable / assignAgent`, `api.myOrg.affiliateCode` in `api.js`
- Migrations: `order_claim_migration.sql`, `user_affiliate_code_migration.sql`

All literal paths registered **before** `/:id` (project convention).

---

## 7. Divergence from `Multi_Vendor_Roadmap.md`

- The roadmap's Phase 2 (`client_agency_links` junction + broadcast visibility)
  is **not built** — only the `parent_agency_id` column exists, half-wired.
- This claim model **replaces** the broadcast idea. If true many-to-many is
  needed later, the junction can be added, but the claim/affiliate flow is the
  primary assignment path.

---

## 8. Open decisions to confirm before coding

> **RESOLVED — see §10 (clarification round 2).** The items below are kept for
> history; §10 is the authoritative answer.

1. **Company client → agency link:** affiliate links handle private clients.
   How does a *company* client attach to an agency? Options:
   (a) a new **agency-level invite** (distinct from the intra-org code),
   (b) the affiliate link also works for company clients,
   (c) superadmin assigns. — pick one.
2. **Can an order be re-claimed / released** (agent drops it back to unclaimed)?
3. **Multiple agents in one agency** — does an agency-admin claim on behalf of
   the agency, then assign an internal agent? Or agents self-claim directly?
4. **Visibility of unclaimed orders** to agents — all agencies' agents, or only
   agents whose agency is somehow eligible?

---

## 9. Phased plan

1. **P0 — Foundation:** agency-org creation on signup (3.1), data fix (3.3),
   stop hardcoding the pin (3.2). Verify the agency admin can see orders + users.
2. **P1 — Claim core:** order claim columns + endpoints + repurposed tab +
   Telegram. Client/agent claim flow (4).
3. **P2 — Private/affiliate:** affiliate codes + `?ref=` landing + superadmin
   assignment (5).
4. **P3 — (optional) many-to-many** if multiple agencies per client is truly
   needed (the roadmap junction). — **Now confirmed required, see §10.**

---

## 10. Confirmed decisions & refinements (clarification round 2)

Authoritative — supersedes §8.

**Client↔agency is many-to-many.** A client can have several agencies; an agency
many clients. The `Multi_Vendor_Roadmap` **`client_agency_links` junction is now
adopted** — but with *claim* semantics, not the roadmap's broadcast.

**Auto-link on submit.** Every submitted order auto-links to the owning
agent/agency **and** to the customer record. Also re-ensure **every `customers`
row is tied to its `user`** (backfill existing + enforce going forward) so orders
and invoices can be recalled per user.

### A) Landing submit (proposal) routing
1. **Private** client → order is **open to all agencies** (any agency admin may claim).
2. **Company, no agency yet** → order is **open**; the agency that **claims** it
   **becomes** that client's agency (auto-link).
3. **Company with an agency** → order appears **directly on the tied agency's
   page** — no claim/registration step.

### B) Affiliate links
Arriving via an affiliate link ties that agency to the client. Multiple links →
multiple agencies (many-to-many).

### C) "Agency Code" at registration
Both private and company registration get an optional **Agency Code** field that
ties an agency to the client immediately on signup. After login, clients add more
agencies in Pengaturan (D).

### D) Pengaturan — relationship management UI (Rekap-style)
Two boxes side by side:
- **Client POV:** *User* + *Agency* tabs.
- **Agency POV:** *User* + *Client* tabs.
- **Superadmin:** all.
- Clicking a box loads its list (User shown by default); actions gated by role.
- A client **cannot add an agency not registered** on the platform.
- **Agency adds a company-type client → approval email** to the client; on
  approve, the client shows on the agency's page. **Private-type adds need no
  approval.**

### E) Claim / release (correction)
Only **role `admin` and above** can claim or release an order (not all non-demo
roles). Orders **can be reclaimed / released**.

### F) Multiple agents per agency
Deferred to **Stage 3**. For now, any **admin**-role user of the agency can claim
on the agency's behalf.

### G) Superadmin "Add Organization" tab
The existing invoicing-oriented org list becomes the **company/organization/client
management** surface from (D).

### H) Migration data procedure
Define + run **after** all Stage 2 features are built (backfills:
`customers.user_id`, agency org rows, `client_agency_links` from existing
`parent_agency_id`, affiliate/agency codes).

### Data-model deltas implied
- `client_agency_links (client_org_id, agency_org_id, status)` — many-to-many.
- `user.affiliate_code` (per agent) + an **agency code** per agency (join code).
- approval state for agency→company-client links (`pending|approved`).
- `customers.user_id` backfilled and enforced.
- order claim columns from §4 still apply (claim is for *open* orders;
  tied-agency orders appear directly per A.3).

