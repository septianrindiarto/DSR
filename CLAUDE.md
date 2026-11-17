# CLAUDE.md — DSR Solution project context

Canonical context for any AI assistant working on this repo. Read this first
every session. It complements (does not replace) `AGENTS.md`, which holds the
detailed **frontend** conventions. Where they overlap, both apply; this file
adds the **full-stack + backend + ops** picture that AGENTS.md predates.

> Deep dives live in `docs/` — see `docs/README.md` for the index. The most
> useful are `Build_With_AI_Walkthrough.md` (architecture + every feature as
> input→process→output) and `Deployment_Master_Guide.md` (ops).

---

## What this is

**DSR Solution** — a car-rental management platform. Two surfaces (public
landing/catalog/booking + admin panel) and two account types (**agency** =
the rental company; **client** = a customer company that books from an agency).
Indonesian-first UI, English secondary.

## Monorepo layout

```
D:\Project\DSR\
  apps/web/    React 19 + Vite 7 SPA (frontend)   ← AGENTS.md governs this in detail
  apps/api/    Node 22 + Express 5 + Drizzle ORM backend (Postgres/Neon)
  docs/        Project documentation (see docs/README.md)
  CLAUDE.md    this file        AGENTS.md  frontend conventions
```

> Note: `AGENTS.md` says the backend is "external." That's outdated — the backend
> **is** in this repo at `apps/api/`. Treat both apps as in-scope.

## Stack

- **Frontend:** React 19 (hooks only), Vite 7, React Router 7, Tailwind v4
  (CSS-first `@theme` in `src/index.css`, no `tailwind.config.js`), Material
  Symbols icons, hand-rolled i18n (`src/i18n/{id,en}.js` + `useLanguage()`),
  in-memory `swr`+`apiCache` (no Redux/RQ/Axios). API calls go **only** through
  `src/lib/api.js`.
- **Backend:** Express 5, Drizzle ORM over `postgres-js`, Zod validation, Better
  Auth (cookie sessions), Helmet, CORS allowlist, express-rate-limit, multer
  uploads, nodemailer (Gmail OAuth). Routes in `apps/api/src/routes/*.routes.js`,
  logic in `apps/api/src/services/*.service.js`, schema in `src/db/schema.js`.
- **DB:** Neon Postgres. Hand-written SQL migrations in `apps/api/drizzle/`,
  applied by `src/scripts/migrate.js` (`npm run migrate`). **Do not gitignore
  `drizzle/`** — migrations must ship.
- **Infra:** one VPS, nginx (static `dist` + `/api` proxy) → PM2-managed Node.
  TLS via Let's Encrypt. Bare PM2, not Docker.

## The two invariants (read before touching orders/invoices/analytics)

1. **Multi-tenancy by org.** Every scoped query runs through
   `buildScopeConditions()` / `buildScopeFragment()`. Agencies see their clients
   via `organizations.parent_agency_id`; clients see only their org or
   `customers.user_id = me`; demo users see only their own `is_demo` rows. `user`
   has **two** dimensions: `role` (permission level) and `account_type`
   (agency/client) — gate on both.
2. **Shared booking code (Tier 2).** One booking = N `orders` rows sharing one
   `order_number`. The `UNIQUE(order_number)` constraint was **dropped**
   (`drizzle/orders_shared_code_migration.sql`); a non-unique index replaces it.
   `generateOrderNumber()` makes the code once per booking. Anything that reads/
   acts on a "booking" operates on **all rows sharing the code** (grouping,
   invoices, cancel, delete, the Action modal). Per-vehicle fields:
   `car_id`, `driver_id`, `total_price`, `package`, `destination`,
   `pickup_location`, add-ons.

## How to add a feature (vertical slice, in order)

1. **Contract first** — decide method/path/body/response.
2. `apps/web/src/App.jsx` — route (wrap admin in `<ProtectedRoute>`).
3. `apps/web/src/pages/AdminX.jsx` — page in `<AdminLayout>`; load via `swr`.
4. `apps/web/src/lib/api.js` — add `api.<resource>.<verb>` (the FE source of truth).
5. `apps/api/src/routes/x.routes.js` — route gated by `requireAuth`/`requireAdmin`,
   body validated with Zod. **Literal paths before `/:id`** (e.g. `/bulk-status`,
   `/booking-items` must be registered before `/:id` or they're captured as ids).
6. `apps/api/src/services/x.service.js` — DB logic via Drizzle; scope reads.
7. Migration in `apps/api/drizzle/*.sql` if the schema changes (idempotent).
8. i18n keys in `id.js` (Indonesian is the only enabled language for now —
   `VITE_LANGUAGES`, default `id`). Add `en.js` too when convenient; missing
   keys fall back to Indonesian. Big features keep their own dictionary
   (e.g. `i18n/finance.id.js`, prefix `fin_`), merged in `src/i18n/index.js`.
   Non-component code uses `translate()` / `labelMap()` from there.

## Verification (always end with this)

- Backend pure logic: `cd apps/api && npm test` (`node:test`, zero deps;
  `test/multivehicle.test.js`). Syntax: `node --check <file>`.
- Frontend: `npm run lint` / `npm run build` (or esbuild parse for a quick check).
- DB: idempotent migrations; verify with `pg_tables` / `information_schema.columns`
  / `pg_constraint` queries.
- For anything non-trivial, add an explicit verification step to the task list.

## Conventions that bite if ignored

- **Frontend never calls `fetch`** — only `api.*`. List endpoints return
  `{ data, total, page }`; pages read `result.data`. Detail endpoints return the
  entity.
- After a mutation, `apiCache.invalidate('resource:')`.
- Cache keys: `<resource>:<view>:<filterA>:<filterB>`.
- `VITE_API_BASE` must be the **full https origin** in production. Empty falls
  back to `http://localhost:5000` (`api.js` uses `|| 'http://localhost:5000'`) →
  "failed to fetch" on the live site.
- Postgres unique violation is code **23505** on `error.cause` (not in
  `error.message`, which is just "Failed query…"). Match the code when mapping to
  friendly errors.
- nginx (`www-data`) needs `o+x` on `/home/dsr` to read the build → otherwise 500
  on `/`.
- Don't introduce TypeScript, Next, Redux/RQ/Axios, a component/icon library, a
  `tailwind.config.js`, or test frameworks beyond `node:test` — unless asked.
- Don't edit `node_modules/`, `dist/`, `*_backup_*`, or `.env*`. Don't commit
  `.env`.
- Personal/confidential files (driver SIM/KTP/photo, finance docs, agency legal
  docs) live in `apps/api/uploads-private/` and are referenced as `private:…`;
  serve them only through authenticated, scope-checked endpoints
  (`services/private-files.js`). Public `/uploads` is for car images only.
- Books auto-posting: invoices (sent) and invoice payments create/adjust journal
  entries automatically (`services/books-autopost.service.js`, source='auto').
  Never post those by hand; correct the invoice/payment instead.
- Prices come from the pricing engine (`services/pricing-core.js`, pure +
  `test/pricing.test.js`): rate card category × package × zone (city list) →
  corporate rate override → car.price fallback. Client-company orders may wait
  for internal approval (`client_approval_status='waiting'`, claim_status
  `'awaiting_approval'`) — agencies must never see them until approved.
- Online payment: Xendit payment links (`services/payment.service.js`); the
  webhook `/api/payments/xendit/webhook` is public but token-checked and
  idempotent, and books money via `invoiceService.addPayment()` (never write
  invoice_payments directly). Driver accounts (template `sys:agency_driver`,
  perm `driverapp.use`) only see `/driver`. Claim reminders run in-process
  every 5 min (`marketplace.service.js`; single PM2 instance assumed).
- Encryption: AES-256-GCM via `services/crypto.service.js` (`DATA_ENCRYPTION_KEY`,
  mandatory in production). Private files are written through
  `encryptedDiskStorage` and served with `sendFileDecrypted`/`sendPrivate`;
  sensitive columns (SIM number, NIB, NPWP) use `encryptField`/`decryptField`.
  Never return ciphertext or raw files directly. Add new sensitive fields the
  same way.
- Long-term contracts (`services/contracts.service.js`, rules in
  `contracts-core.js`): a billed month = one booking (order row per unit) + one
  invoice via `invoiceService.issueForOrders`; `lease_billings` (unique per
  contract × period) prevents double billing. Fleet care: `fleetcare-core.js`
  / `fleetcare.service.js`; always move odometers with `recordOdometer()`.
  Scheduled jobs: `services/jobs.service.js` (job_runs, daily/monthly, WIB).
- Rekap Operasional & Lembur (`services/ops.service.js`, rules in `ops-core.js`,
  `test/ops.test.js`): contract overtime/costs → agency verify → recap R### →
  client approve. Codes: P/C daily, **M** monthly contract booking, **R** recap.
  **Every invoice/document is generated only in Dokumen**; other tabs are sources.
- Contracts workflow (2026-11-05): agency OR client drafts → required documents
  (`contract_documents`, defined by one side, uploaded by the other, encrypted
  area `contracts`) → both sides approve → `active` (rules in `contracts-core.js`
  `approvalBlockers`). Active terms are locked. Ops forms each get a code
  (**L###** lembur, **R###** operasional) on submit, need agency + client
  approval, and are invoiced in Dokumen via `ops-billing.service.js` (form →
  order row with the code as booking number → `issueForOrders`). Monthly R
  recaps are legacy.
- Lembur / perjalanan dinas policy (`ops-core.js` policyOf v2) is a per-contract
  MATRIX (rate or salary÷divisor, tiers per day type, rounding bands, waiting,
  break) with NO business defaults; `policyBlockers` + `termBlockers` gate
  approval. Use generic names (Form Lembur, Perjalanan Dinas), never one
  client's terms. Help text goes behind ⓘ (`InfoTip`, `i18n/help.id.js`).
- Scope: agency rows with no organisation belong to the HOME agency only
  (`DEFAULT_AGENCY_ID` / first agency); customers are also visible through
  orders the agency owns. Order reads by id go through `requireOrderAccess`.
- Tax & Faktur Pajak (2026-11-09): invoice tax is a PROFILE (`tax-core.js`, web copy
  `lib/tax.js`, `test/tax.test.js`): per client → agency default (`organizations.tax_profile`)
  → none; PPN on DPP nilai lain 11/12; PPh withheld (info, paid via payment kind `pph23`) or
  added. `recomputeTotal` stores subtotal/discount/DPP/PPN/PPh; invoice total = faktur value.
  Faktur gabungan (`faktur.service.js`, `/api/faktur`): same buyer + masa, PPN allocated back
  (`allocatePpn`); a TERBIT faktur locks its invoices (`assertFakturOpen`) → pengganti.
  Daily lembur/inap rates + contracts without own terms use the agency default
  (`organizations.ops_policy_default`, `ops-policy.service.js`, `effectivePolicy`/`dailyRatesOf`).
  `orders.contract_id` maps M/L/R rows to their contract.
- Vehicle types (2026-11-11): `cars.type` is VARCHAR checked against the agency's list
  (`organizations.fleet_options.types`, rules `fleet-core.js`, service `fleet-types.service.js`,
  `GET/PUT /api/cars/types`). Never hard-code MPV/SUV/… in admin UI; rate-card categories =
  `categoriesWith(agency types)`.
- Contract codes (2026-11-13): C daily · **M one per unit per contract per month** (auto,
  `contract-billing.service.js`, table `lease_unit_billings`, job `contract-monthly-codes`) ·
  L lembur · **T** perjalanan dinas · **O** operasional (older R kept). Amendments = new contract
  with `amends_contract_id`; after approval the old one must be stopped (`supersede`).
  Hub tabs: Kontrak · Form · List Data (`/api/contracts/codes`); Laporan & Audit page
  (`/admin/reports`, `/api/contracts/audit`). Ops forms have a comment thread; client approvers
  may edit (editor's side counts as approved).
- Form bulanan M (2026-11-13, `contract-billing.service.js`): Form → Kontrak = M detail form
  (km awal/akhir, nama user, tujuan, bukti, comments) on `lease_unit_billings` (status open →
  submitted → approved | rejected; billed = order has invoice). Month 1 on activation, month n on
  H+1 after month n-1's tanggal tagih (`openCycles`). Both sides approve. KM is optional but, when
  filled, must EQUAL the O-form km per row (`kmCheck`, mismatch blocks approval); rows = `kmSegments`
  (unit / replacement car; maintenance days not counted), stored in `km_segments`, total → kelebihan.
  **No pro-rata**: every contract month = full monthly fee + full km quota (`cycleLine`), even 1 day;
  the M period is always the contract month (unit dates only → `activeFrom/activeTo` for KM rows). **Only approved M rows are invoiceable** and
  contract invoices are never overwritten (`assertContractRowsInvoiceable` in invoice.service) —
  cancel via `POST /api/invoices/:id/cancel` (agency admin, not realised = no payment) then re-issue. Roles: Staff
  Operasional fills, `sys:agency_approver` (Staff Persetujuan) / admin approve.
- Notifications (2026-11-13): `notifications.service.js` `notify({targets:[{orgId,perm|userId}]…})`
  (feed + optional e-mail/Telegram), `/api/inbox` (feed, read, `actions` = live "Perlu tindakan"
  from `action-items.service.js`). Bell in AdminLayout, panel on Dashboard; poll uses `silent`.
- Fleet events (2026-11-13, `fleet-alerts.service.js`, rules `fleet-events-core.js`): maintenance
  start→end (`maintenance.end_date`) set in Armada 🔧 and read by Jadwal/contracts/dashboard/
  reminders; `lease_unit_replacements` (forms in range use the replacement car via
  `carForUnitOn`); `unit_incidents` (admin or driver, notifies agency + contract client).
- Login sessions (2026-11-13, rules `session-core.js` + `test/session.test.js`, I/O `session.service.js`):
  15-min idle timeout (`session.last_seen_at`, memory + DB every 30 s; requests with `X-Background: 1`
  — `api.js` `silent` — are not activity), one live login per user (Better Auth
  `databaseHooks.session.create.before` → 403 `USER_ONLINE` / `USER_ONLINE_KICKABLE`; take-over with
  header `X-Force-Login: 1` after 5 min idle), reasons in `session_ends` → 401 `SESSION_EXPIRED` /
  `SESSION_KICKED`. Superadmin exempt; driver on phone/tablet 12 h. Web: `SessionGuard` (warning +
  quiet `/api/session/ping`). Latency: `perf.service.js` (Server-Timing, `[slow]` log, `/api/health/perf`).
- Review register: every unconfirmed business rule goes into
  `docs/Review_Register.md`; update it when the owner gives feedback.

## Public repo hygiene (owner 2026-11-18) — what never goes to GitHub

The GitHub repo is treated as public. These stay **local only** (git-ignored in the
root `.gitignore`, section "PRIVATE / LOCAL-ONLY"); keep writing/updating them on
disk, but never commit them, never link them from public docs:
1. Business documents & spreadsheets — `docs/*.xlsx|xlsm|xls|docx|pdf`, root `*.pdf`
   (proposal), Office lock files `~$*`.
2. Test scenarios, test feedback, manual checklists — `docs/testing/`,
   `docs/Test_Checklist*.md`, `docs/*Test_Matrix*.md`. (Automated `apps/api/test/*.test.js` ARE public.)
3. Things awaiting confirmation — `docs/Review_Register.md`; private doc index
   `docs/PRIVATE_INDEX.md`.
4. Unused / redundant / expired — `.backup/`, `*_backup_*`, `*.superseded`, `*.deleted`,
   `*_copy.jsx`, early design mockup folders (`Admin …/`, `Car Detail…/`, `Public Catalog…/`),
   finished-stage logs and old runbooks (`docs/Stage*_Request_Milestones.md`, …).
5. Internal strategy — competitor gap, feature benchmark, roadmap docs.
6. Tool output — `purge-backups/`; plus the usual `.env`, `uploads-private/`.

**Every time you create a document or file, flag it to the owner as either 🌐 git (public)
or 🔒 local-only, and place it accordingly** (owner 2026-11-18). When creating a NEW file
of one of the private kinds, put it under a pattern that is already ignored (or add the
pattern to that section first). When preparing a git push for the
owner: work on a branch (never `main` — it auto-deploys), and include a check that
`git ls-files` shows none of the above. To drop newly-ignored files that are still
tracked: `git rm -r -q --cached .` then `git add -A` (files stay on disk).

## Environment / runtime

- Dev: `apps/api` → `npm run dev` (nodemon, :5000); `apps/web` → `npm run dev`
  (Vite, :5173). Prod: see `docs/Deployment_Master_Guide.md`.
- Prod env (`apps/api/.env`): `NODE_ENV=production`, `PORT`, `DATABASE_URL`
  (Neon), `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`/`CORS_ORIGIN`/`APP_URL`
  all set to the exact `https://` origin; Gmail OAuth vars; Telegram vars;
  `REKAP_SYNC_DISABLED=true`.

## Status (as of Stage 1)

Live at `https://dsrappai.com` (apex). Tier 2 multi-vehicle shipped. Open
follow-ups (see `docs/Stage1_Request_Milestones.md`): push M5–M12 to prod, www
TLS expansion, account_type-aware user roles, dedupe hardening, confirm PM2 boot
persistence.

## When unsure

Inspect the surrounding files before changing code. Prefer the existing pattern.
Keep changes scoped to the request. If a backend contract must change, say which
endpoint, the new shape, and the `api.js` mirror.
