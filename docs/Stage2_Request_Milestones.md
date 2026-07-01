# DSR Solution — Stage 2: Request & Milestone Log

Continues from `Stage1_Request_Milestones.md`. Same format: chronological
requests framed as milestones, with status and follow-ups.

**Stage 2 theme (so far):** post-launch enhancements and production operations.

Legend: ✅ done · 🚀 deployed to prod · 📄 documentation · ⚠️ follow-up open

---

## M1 — Surat Pengantar Tagihan + company-wide letter numbering ✅
**You asked:** repurpose the **Kwitansi** tab into a **Surat Pengantar Tagihan**
(billing transmittal letter) generator matching a supplied example, with: (1)
print sized to ~1/4 of A4, (2) a company-wide incrementing **letter number**
distinct from the invoice number, shared across all document types, (3) the same
company header as other docs, (4) freedom to adjust fonts to fit.

**Delivered:**
- **Tab renamed & repurposed** — `kwitansi` → `surat_tagihan` ("Surat Pengantar
  Tagihan") in `AdminDocuments.jsx`. New `SuratTagihanForm` + `SuratTagihanTemplate`
  replace the old kwitansi pair; order auto-fill, defaults, and the doc-type
  catalog updated. (Standalone kwitansi was redundant — the invoice already
  prints a kuitansi half.)
- **Template** matches the example: company header, letter number top-left,
  centered underlined title, Kepada/Dari/Lampiran/Berita block (berita
  auto-composed from usage date + bank/email/WA, all editable), and the
  two-column Yang Menerima / DSR signature block.
- **1/4-A4 print** — new `.doc-page-quarter` (210mm × ~74mm) + compact 8.5pt
  fonts; prints at the top portion of an A4 sheet.
- **Company-wide letter number** — new `letter_counters` table
  (`drizzle/letter_counter_migration.sql`, per org+year, seeded so the next
  number is **070**), `documentService.getNextLetterNumber()` (atomic),
  `POST /api/orgs/next-letter-number`, `api.myOrg.nextLetterNumber()`, and an
  **"Ambil Nomor"** button on the form. Per-year sequence (resets each January
  as `No.27/DSR/001`).
- **Invoice opt-in** — added the same optional **No. Surat + Ambil Nomor** to the
  invoice form; renders on the invoice only when set (most invoices don't need
  one, per your note).

**Verification:** backend service passes `node --check`; new components pass
esbuild; no leftover `kwitansi` references.

**To activate:** `cd apps/api && npm run migrate -- letter_counter` (run on dev
now; on prod at deploy). ⚠️ Follow-up: include this feature + migration in the
next prod push. 💡 Open question: with the shared header, the letter prints at
~1/4–1/3 of A4; can be made tighter if desired.

---

## M2 — Bootstrap a superadmin on production ✅ (method) / ⚠️ (run on prod)
**You asked:** production has no superadmin; promote one account, efficiently —
likely via direct DB injection.

**Delivered:** a reusable, idempotent script
`apps/api/src/scripts/promote-superadmin.js` that promotes a user to
`superadmin` by email (verifies the account exists first; no-op if already
superadmin). This is the correct bootstrap path — the create-user route
deliberately forbids minting superadmins and there's no existing one to do it
via the UI.

**Status update:** the superadmin was created **manually via the backend** — the
`promote-superadmin.js` script does **not** need to be run. The script stays in
the repo as a reusable tool for future use.

---

## M3 — Agency register form: remove duplicate fields ✅
**You asked:** the Agency signup tab (Daftar Akun → Agency → Perusahaan) showed
two identical "Nama Perusahaan" fields plus a "Tipe Pelanggan" toggle that don't
belong to an agency.

**Delivered:** in `AdminLogin.jsx`, gated the "Tipe Pelanggan" toggle and the
second company-name field to **client** signups only (`!isAgency`). The agency
tab now shows just: Nama Perusahaan, No. HP/WhatsApp, Email, Password. (Pure
conditional change; no backend impact.)

---

## M4 — Order routing redesign (claim model) — DESIGN 📄 / ⚠️ build pending
**You asked:** clarify how anonymous/landing orders get routed, how clients link
to agencies, and how multiple vendors should be handled fairly — then design a
**claim-based** order mechanism with agent affiliate links.

**Findings (verified in code):**
- Agency signup creates **no organization** (agency admin has `organization_id =
  NULL`) → can't see client orders; Pengguna list comes back empty.
- Client orgs are hardcoded to `parent_agency_id = DEFAULT_AGENCY_ID`; the invite
  code is **intra-org only** (not a client→agency link). So there's no real
  per-agency assignment, and anonymous orders (org NULL) orphan to superadmin.
- `Multi_Vendor_Roadmap.md` is only thinly/half-built (`parent_agency_id` column);
  the junction/broadcast design is not implemented.

**Delivered:** full design note — `docs/Stage2_OrderClaim_Design.md` — covering
the foundation fixes (agency-org on signup, drop the hardcoded pin, one-time
data fix for `admin@dsrappai.com`), the claim mechanism (order claim columns +
states + flow + roles + Telegram, repurposing the *Permintaan Akses* tab), agent
**affiliate links** for direct private business, the endpoints/migrations, the
divergence from the roadmap, open decisions, and a P0–P3 phased plan.

**Decisions confirmed (round 2)** — folded into the design note **§10**:
many-to-many client↔agency (adopt the `client_agency_links` junction);
landing-routing scenarios (private → open to all; company-no-agency → claimer
becomes the agency; company-with-agency → direct to tied agency); affiliate links
grant agencies; an **Agency Code** field at registration; a Rekap-style
relationship UI in Pengaturan (User+Agency / User+Client tabs) with email
approval when an agency adds a company client (none for private); **only admin+
can claim/release**; claims are reversible; multiple-agents-per-agency deferred to
Stage 3; repurpose the superadmin "Add Organization" tab into org/client
management; re-ensure `customers.user_id` linkage.

⚠️ Not yet built. Migration/backfill procedure to be defined and run **after** the
Stage 2 features are coded.

---

## M5 — Auto-deploy via GitHub Actions ✅ (needs one-time secrets)
**You asked:** true auto-deploy on push, with a step-by-step setup.

**Delivered:** `.github/workflows/deploy.yml` (SSH deploy on push to `main` +
manual trigger; code-only — migrations stay manual), a fallback `deploy.sh`
(`--migrate` flag), and `docs/CICD_GitHub_Actions_Setup.md` (deploy-key + 3
secrets + verify + rollback). ⚠️ Add the deploy key + `VPS_HOST`/`VPS_USER`/
`VPS_SSH_KEY` secrets once, then every push deploys itself.

## M6 — P0 foundation: agency gets a real org ✅
**Delivered:** agency signup now **creates its own organization** (top-level,
`parent_agency_id = NULL`) and attaches the admin (`auth-extra.routes.js`), so
the agency admin's org-scoped views (orders, users) work. Plus
`src/scripts/fix-agency-admin.js` to repair the existing `admin@dsrappai.com`
(creates the DSR agency org + attaches the admin). Verified via `node --check`.

⚠️ Deferred to the end-of-Stage-2 **migration procedure** (point H): backfill
existing client orgs' `parent_agency_id` to the DSR agency org, and the
`customers.user_id` linkage. Next phases: **P1 claim**, then **P2 affiliate**.

## M7 — P1 claim core (backend + data model) ✅
**Delivered (backend, verified `node --check`):**
- Migrations: `order_claim_migration.sql` (claim columns on `orders`:
  `claimed_by_user_id`, `claimed_by_agency_id`, `claim_status`) and
  `client_agency_links_migration.sql` (many-to-many junction + backfill from
  `parent_agency_id`). Schema models added to `schema.js`.
- `order.service`: `claimByOrderNumber` (agency claimer takes responsibility +
  becomes the client's agency per §10.2; client-admin claimer links to their
  company), `releaseByOrderNumber`, `findClaimable` (unclaimed + in-scope).
- Routes (admin+ gated, literal paths before `/:id`):
  `GET /api/orders/claimable`, `PUT /api/orders/booking/:code/claim`,
  `PUT /api/orders/booking/:code/release`.
- Telegram `notifyOrderClaimed` (+ pure `buildClaimMessage`).
- `api.js`: `orders.claimable / claimBooking / releaseBooking`.

**Known simplifications (to finish in the next slice):**
- §10 **scenario 2 visibility** (company-with-no-agency open to *all* agencies)
  isn't surfaced yet — `findClaimable` uses the existing scope (private/null +
  the agency's own clients). Needs the junction-aware "orphan client" query.
- Telegram claim goes to the configured admin chat(s), not the *claimer's*
  personal number (needs a future `user.telegram_chat_id`).
- Migrations applied later in the procedure:
  `npm run migrate -- order_claim` and `-- client_agency_links`.

## M8 — P1 frontend: Claim Order tab ✅
**Delivered (esbuild-verified):** new `AdminClaimOrders.jsx` lists open
(unclaimed) bookings grouped by code with a **Claim** button; the *Permintaan
Akses* sidebar entry + route now point to `/admin/claim-orders`; i18n keys
(`claimOrders`, `claim`, `release`) in both locales. Uses
`api.orders.claimable / claimBooking`.

P1 (claim) is now complete end-to-end (data model + backend + tab).

---

## M9 — P2 built (relationships, affiliate, agency code, scenario 2) ✅ (dev)
**Delivered (verified — node --check / esbuild; auth-extra passed via the agency
branch reconstruction, its mount copy was truncated):**
- **Schema/migrations:** `affiliate_agency_codes_migration.sql`
  (`user.affiliate_code`, `organizations.agency_code`,
  `client_agency_links.approval_token`) + schema.js columns.
- **`relationship.service.js`:** affiliate/agency code generation, list
  agencies-for-client / clients-for-agency, client adds agency by code, agency
  adds company client → **pending + email approve link**, approve-by-token,
  remove (archive) link, affiliate resolve.
- **Routes (`orgs.routes.js`):** `my-agencies`/`my-clients` (GET/POST),
  `links/:id` (DELETE), `affiliate-code`/`agency-code` (POST), public
  `approve-link` (token, HTML response). `api.js` methods added.
- **Scenario 2** (`order.service.findClaimable`): company-with-no-agency orders
  are open to ALL agencies; private/null open to all; linked clients to their
  agency; superadmin all.
- **Affiliate routing:** public order submit reads `affiliateCode` (from
  landing `?ref=`) → auto-assigns the order to the agent's agency.
- **Agency code at registration** (`auth-extra`): a client signup with an Agency
  Code links their org to that agency.
- **Frontend:** registration **Agency Code** field (`AdminLogin`); landing
  **`?ref=`** capture (`LandingBookingForm`); **Pengaturan → Mitra** relationship
  UI (`RelationshipManager.jsx`) — client manages agencies, agency manages
  clients + shares agency/affiliate codes, add/remove with status badges &
  approval flow.

**Remaining P2 (small):**
- Superadmin **"Add Organization" tab → org/client management** (repurpose of
  existing superadmin org CRUD; superadmin can already use the Mitra UI).
- New UI strings in `RelationshipManager`/agency-code field are Indonesian
  literals (not `t()` keys yet) — fine for now, i18n later.

## Remaining Stage 2 (P2 — not yet built)

Frontend-heavy + a couple of design edges; best built/validated against a live
backend. In order:
1. **Order-submit routing (§10):** scenarios 1 & 3 are already covered by the
   scope + claim model (private/null → claimable by all; company-with-agency →
   visible to the tied agency). **Scenario 2** (company-with-no-agency open to
   ALL agencies) is the remaining edge — needs a junction-aware "orphan client"
   query in `findClaimable`.
2. **Registration Agency Code** field + backend linking (needs an `agency_code`
   on agency orgs).
3. **Agent affiliate links** (`user.affiliate_code`) + public `?ref=` landing
   that stamps the order with the agent/agency.
4. **Pengaturan relationship UI** (Rekap-style User+Agency / User+Client tabs,
   add/remove links, **approval email** when an agency adds a company client).
5. **Superadmin "Add Organization" tab** → org/client management.
6. **End-of-Stage-2 migration procedure** (point H): apply all new migrations +
   backfills (`customers.user_id`, relink existing clients, affiliate/agency
   codes). Deferred until dev is settled (per your instruction — no prod yet).

---

## Open follow-ups (carried)

From Stage 1 (still open): push M5–M12 code to prod; expand www TLS;
account_type-aware user roles; dedupe hardening; confirm PM2 boot persistence.
From Stage 2: run the `letter_counter` migration on prod; push the
Surat Pengantar Tagihan feature + the `promote-superadmin` script; decide final
compactness of the surat.
