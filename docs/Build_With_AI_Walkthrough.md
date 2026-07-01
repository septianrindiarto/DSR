# Building DSR Solution with AI — Full Walkthrough

A complete, follow-along guide to how the DSR Solution car-rental platform is
built: the design, infrastructure, security, database, and **every feature
explained as Input → Process → Output (IPO)**. It is written so that someone can
either (a) reproduce the whole app with an AI coding assistant, or (b) lift a
single mechanism (e.g. the multi-row invoice engine, the bulk-status pattern, or
the shared-code booking model) into their own app.

> Companion docs: `Stage1_Request_Milestones.md` (how it evolved),
> `User_Guide.md` (how to operate it), `Deployment_Master_Guide.md` (how to
> ship it), and root `CLAUDE.md` (canonical context for AI sessions).

---

## 0. What the app is

DSR Solution is a **car-rental management platform** with two surfaces and two
account types.

**Surfaces**
- **Public** — landing page, car catalog, and an online booking form.
- **Admin panel** — fleet, orders (Rekap), schedule, customers, drivers,
  finance, documents/invoices, analytics, users, and settings.

**Account types (the tenancy dimension)**
- **Agency** — the rental company (e.g. "DSR Rent Car"). Agency staff manage
  everything and see the orders of all their client companies.
- **Client** — a customer company that books cars from an agency. Client users
  see only their own org's orders.

The spine of the whole system is two ideas, repeated everywhere:
1. **Multi-tenancy by organization** — every row is scoped to an org; agencies
   see their clients via `organizations.parent_agency_id`.
2. **Shared booking code (Tier 2)** — one booking can contain N cars; all N
   order rows share one `order_number` (e.g. `C073`). Most features are a
   variation of "operate on all rows that share a code."

---

## 1. Tech stack and why

**Frontend** (`apps/web/`)
- React 19 (function components + hooks), Vite 7, React Router DOM 7.
- Tailwind CSS v4, configured **CSS-first** in `src/index.css` via `@theme` (no
  `tailwind.config.js`).
- Material Symbols Outlined icon font; Outfit (display) + Inter (body) fonts.
- No state library — a small in-memory `swr` + `apiCache` in `src/lib/api.js`.
- i18n hand-rolled: `useLanguage()` + `src/i18n/{id,en}.js`, Indonesian-first.

**Backend** (`apps/api/`)
- Node 22, Express 5, Drizzle ORM over `postgres-js`, Zod for validation.
- Better Auth for cookie-based sessions (email/password).
- Helmet, CORS allowlist, express-rate-limit, morgan logging, multer uploads,
  nodemailer (Gmail OAuth) for verification email.

**Database**
- Neon (managed Postgres, off-box). Hand-written SQL migrations in
  `apps/api/drizzle/`, applied by a custom runner (`src/scripts/migrate.js`).

**Infrastructure**
- Single VPS (Ubuntu, 1 vCPU / 2 GB): nginx serves the static web build and
  proxies `/api` to the Node process managed by PM2. TLS via Let's Encrypt.
- Rationale for bare PM2 over Docker: one Node service + static files + external
  DB doesn't need orchestration on a 2 GB box. (See `Deployment_Master_Guide.md` §0.)

**Why this stack:** it is deliberately boring and cheap to run. The guiding rule
(see `AGENTS.md`) is *existing pattern over new architecture, stability over
modernization, small scoped changes over refactors.*

---

## 2. How to build this with an AI assistant (the method)

This app was built incrementally with an AI coding assistant. The method that
made it reliable:

1. **Give the AI durable context.** Keep an `AGENTS.md` / `CLAUDE.md` at the repo
   root describing the stack, conventions, file layout, and "forbidden unless
   asked" list. The assistant reads it every session so it doesn't reinvent
   patterns. (This repo's `CLAUDE.md` is the canonical example.)
2. **Contract-first.** For any feature, decide the API contract before the UI:
   HTTP method, path, request body, response shape. The frontend mirror lives in
   `src/lib/api.js`; the backend route mirrors it exactly.
3. **One feature, one vertical slice.** Route → page → API method → backend
   route → service → migration → i18n. Keep each change scoped.
4. **Verify every change.** Backend: `node --check` or the `node:test` suite.
   Frontend: a build (`npm run build`) / esbuild parse, plus a manual browser
   pass. Add a verification step to every task.
5. **Migrations are code.** Every schema change is an idempotent `.sql` file in
   `drizzle/`, applied by `npm run migrate`. They must be committed (don't
   gitignore `drizzle/`).
6. **Prompt in small, testable units** and paste real errors back. Most of the
   hard bugs in this project were config/contract issues (gitignored migrations,
   an env fallback, a Postgres error code not matched) — surfaced fastest by
   feeding the exact error to the assistant.

A good feature prompt looks like: *"Add X. Backend: PUT /api/orders/booking-items
taking {items:[{orderId,carId,driverId,totalPrice}]}, validate with Zod, register
before /:id. Service: updateBookingItemsBulk. Frontend: add api.orders.updateBookingItems
and a modal. Keep i18n in id.js+en.js."*

---

## 3. Architecture & request lifecycle

```
Browser (React SPA)
   │  fetch(`${API_BASE}/api/...`, { credentials:'include' })
   ▼
nginx :443  ──/api/*──►  Node/Express :5000  ──►  Drizzle  ──►  Neon Postgres
   │  /  (static dist)                         ──►  Better Auth (sessions)
   ▼
index.html + assets
```

- **Frontend never calls `fetch` directly** — only through `api.<resource>.<verb>`
  in `src/lib/api.js`. That file is the single source of truth for the contract
  and holds the `swr`/`apiCache` helpers and the friendly-error map.
- **Every list endpoint** returns `{ data, total, page, ... }`; pages read
  `result.data`. Detail endpoints return the entity directly.
- **Auth** is a cookie session set by Better Auth; the request helper sends
  `credentials: 'include'`. No tokens in localStorage.
- **Admin routes** are wrapped in `<ProtectedRoute>`; backend routes are gated by
  `requireAuth` / `requireAdmin` / `requireRole` middleware.

---

## 4. Security model

| Layer | Mechanism |
|------|-----------|
| Sessions | Better Auth, HTTP-only cookies. Frontend sends `credentials:'include'`; never stores tokens. |
| Route gating (frontend) | `<ProtectedRoute>` redirects to `/admin/login` when no user. |
| Route gating (backend) | `requireAuth`, `requireAdmin`, `requireRole(ROLE_GROUPS.*)` middleware. |
| Multi-tenancy | `buildScopeConditions()` / `buildScopeFragment()` add `WHERE organization_id = …` (agency sees its clients via `parent_agency_id`; clients see only their org or `customers.user_id = me`). |
| Demo isolation | demo users only ever see `is_demo = true` rows scoped to their own `created_by`. |
| Input validation | Zod schemas on every mutating route (`validate(schema)` middleware). |
| Rate limiting | `express-rate-limit` (`authLimiter` on auth routes, `apiLimiter` elsewhere). Requires `app.set('trust proxy', 1)` behind nginx. |
| CORS | Allowlist gated by `NODE_ENV`; in prod only `CORS_ORIGIN` is allowed; localhost only in dev. Better Auth `trustedOrigins` mirrors it. |
| Headers | Helmet. |
| Secrets | `.env` (chmod 600 on the VPS), never committed. `BETTER_AUTH_SECRET` rotated for prod. |
| Graceful shutdown | `SIGTERM`/`SIGINT` drain the server with a 10s hard-exit fallback (clean PM2 reloads). |

**Production env contract (`apps/api/.env`):** `NODE_ENV`, `PORT`, `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `APP_URL` (all the URLs
must be the exact `https://` origin), Gmail OAuth vars, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_ADMIN_CHAT_ID`, `REKAP_SYNC_DISABLED=true` (the Rekap watcher is
desktop-only).

---

## 5. Database

Schema lives in `apps/api/src/db/schema.js` (Drizzle). Migrations are
hand-written SQL in `apps/api/drizzle/`, applied in **alphabetical order** by
`src/scripts/migrate.js` (idempotent; reads `DATABASE_URL` from `.env`).

```bash
cd apps/api
npm run migrate                         # apply all *.sql
npm run migrate -- orders_shared_code   # apply only files matching a name
node src/scripts/add-user-role-enum.js  # post-migration enum top-up
```

**Key tables (abridged):** `user`, `account`, `session` (Better Auth);
`organizations` (with `parent_agency_id`, `admin_user_id`, invite codes,
display ids); `customers`; `cars`; `drivers`; `orders`; `maintenance`;
finance tables; `sync_logs`; `access_requests`.

**Key enums:** `car_status` (available/rented/maintenance), `driver_status`
(active/inactive/suspended), `order_status`
(pending/confirmed/active/completed/cancelled), `user_role`
(admin/superadmin/agent/demo/client/client_admin/user),
`customer_type` (private/company).

**Two dimensions on `user`:** `role` (permission level) **and** `account_type`
(`agency` vs `client`). Backend permission checks gate on both.

### The shared-code model (the Tier 2 spine)
- A booking writes **N `orders` rows**, all sharing one `order_number`.
- The old `UNIQUE(order_number)` constraint was **dropped** and replaced with a
  non-unique index — migration `drizzle/orders_shared_code_migration.sql`.
  Without it, any 2+ car booking fails with `23505 duplicate key`.
- The code is generated once per booking by `generateOrderNumber(customerId)`
  in `order.service.js` (prefix `C` for company, `P` for private; zero-padded
  sequence). Verify the constraint is gone:
  ```sql
  SELECT conname FROM pg_constraint WHERE conname='orders_order_number_unique';
  -- expect zero rows
  ```

---

## 6. Cross-cutting mechanisms (IPO)

These patterns repeat across pages; understand them once.

### 6.1 The Import button (the canonical IPO example)
Used on Orders, Fleet, Drivers, Customers.

- **Input:** user clicks Import → `<SharedImportModal>` opens → picks a file
  (XLSX/CSV/JSON/XML/TXT) and format.
- **Process:**
  1. `src/lib/dataFormats.js` `parse(file, format)` turns the file into rows.
     XLSX support is lazy-loaded from CDN (SheetJS) on first use — not an npm dep.
  2. The page maps source headers → canonical server keys (alias table, e.g.
     `tglPemakaian`/`pickupdate` → `pickupDate`) and normalizes values (dates,
     numbers, enum synonyms).
  3. Rows with no usable identity are dropped; the rest POST to
     `api.<resource>.importData(rows)`.
  4. Backend bulk-inserts in chunks, pre-loading lookup tables and creating
     missing customers/drivers in batch (see `orders.routes.js` `/data/import`).
- **Output:** `{ imported, skipped, errors }` → a toast; `apiCache.invalidate()`
  + reload refreshes the table.

### 6.2 The Export button
- **Input:** Export → `<FormatPickerModal>` → choose format.
- **Process:** `api.<resource>.exportData()` returns canonical rows →
  `exportAs(rows, format, filename)` builds the file client-side.
- **Output:** a downloaded file.

### 6.3 List loading (swr + apiCache)
- **Input:** page mounts.
- **Process:** state hydrates synchronously from `apiCache.get(key)` (instant
  paint on revisit); `swr(key, fetcher, onUpdate)` refetches in the background;
  on mutation, `apiCache.invalidate('resource:')`.
- **Output:** table renders immediately, then refreshes.
- **Key convention:** `<resource>:<view>:<filterA>:<filterB>`.

### 6.4 Pagination / sort / search
- `<TablePagination>` + `usePagination(items, {storageKey, deps})`. Search is
  client-side (haystack of every visible value); status/sort are server-side.

### 6.5 i18n
- Every user-facing string is a key in **both** `id.js` and `en.js`, read via
  `t('key')`. Indonesian is canonical.

---

## 7. Feature-by-feature (IPO)

### 7.1 Public catalog & landing
- **Input:** visitor opens `/`.
- **Process:** `LandingPage.jsx` composes Header → Hero → `CarGrid`
  (`api.cars.listPublic()`, swr-cached) → Features → Booking form → Footer.
- **Output:** browsable catalog; available cars link into the booking form.

### 7.2 Booking — multi-vehicle (the headline flow)
Two entry points share one backend: `LandingBookingForm.jsx` (anonymous) and
`DashboardBookingForm.jsx` (logged-in). Endpoint: `POST /api/orders/public`.

- **Input (trip-level):** name, WhatsApp, company, dates. **Input (per vehicle,
  repeatable via "Tambah Kendaraan"):** category, quantity, package,
  **destination, pickup** (per-car since M3).
  - On the dashboard form, agency staff pick the client company from a dropdown
    of affiliated companies; clients are locked to their own org.
- **Process (`orders.routes.js` `/public`):**
  1. Normalize to a `vehicles[]` array (legacy single-car payloads are wrapped);
     expand `quantity>1` into N identical rows (cap 10).
  2. `findOrCreate` the customer once.
  3. If the company name matches a registered org, set `organizationId` so that
     client sees the booking.
  4. `generateOrderNumber(customer.id)` → **one shared code**.
  5. Loop the vehicles → `orderService.create()` one row each, all sharing the
     code; per-car destination/pickup fall back to trip-level.
  6. Fire **one** Telegram notification listing all cars (never throws).
- **Output:** `{ orderNumber, vehicleCount, totalPrice }`; N rows in `orders`;
  admin sees one grouped booking in Rekap.

### 7.3 Auth, registration, invite codes
- **Register agency:** first agency self-registers → becomes `org_id=1` admin.
- **Register client:** uses an agency's **invite code** (Pengaturan → Kode
  Undangan) so the new org attaches via `parent_agency_id`.
- **Process:** Better Auth signup → verification email (Gmail OAuth) → click link
  → session cookie. `useAuth()` exposes `user/login/register/logout/checkSession`.
- **Output:** an authenticated, org-scoped session.
- **Admin-created users:** `POST /api/users` (M12). Duplicate email → clean
  "Email sudah terdaftar." (detects Postgres `23505` on `error.cause`).

### 7.4 Orders / Rekap (`AdminOrders.jsx`)
- **Input:** admin opens Rekap.
- **Process:** `api.orders.list()` (scoped) → rows grouped by `order_number`:
  - single-car bookings render as normal rows;
  - multi-car bookings collapse into a summary row (sum of price/bailout/inap/
    lembur, "N mobil" badge) that expands to per-car child rows.
- **Output / actions:**
  - **Action** (group row) → **ManageBookingModal**: set unit + driver + price
    per car, saved together → `PUT /api/orders/booking-items`. Unit/driver
    dropdowns show only non-maintenance/active options (plus any current
    assignment); picking a unit auto-prices an unpriced row (rate × days).
  - **Cancel** → whole booking (`PUT /api/orders/booking/:code/cancel`,
    completed rows protected); single-car cancel via the row's detail modal.
  - **Delete** → whole booking (`DELETE /api/orders/booking/:code`).
  - Columns, search, sort, export/import as in §6.

### 7.5 Fleet / Armada (`AdminFleet.jsx`)
- **Input:** CRUD a car (name, brand, type, category, plate, price, capacity,
  transmission, fuel, images, status, gallery).
- **Process:** `api.cars.*`; images upload via multer (`/uploads`); table + grid
  views; **bulk status** (M7): select rows → set Available/Maintenance/Rented
  → `PUT /api/cars/bulk-status`.
- **Output:** fleet list, stats cards, status badges; bulk updates in one call.

### 7.6 Drivers (`AdminDrivers.jsx`)
- Same shape as Fleet: CRUD + documents (SIM/KTP/photo uploads), data/dokumen
  tabs, and **bulk status** Active/Inactive/Suspended → `PUT /api/drivers/bulk-status`.
- `api.drivers.available()` returns active-only (used by the assign-driver dropdowns).

### 7.7 Customers + dedupe (`AdminCustomers.jsx`)
- CRUD customers (private/company, status, total_orders, last_order).
- **Hapus Duplikat (IPO):**
  - **Input:** click the dedupe button (badge = `customers.length − unique-by-name`).
  - **Process (`customer.service.deduplicateByName`):** group by exact `name`,
    keep the lowest id, reassign that group's orders to it, delete the rest.
  - **Output:** `{ mergedGroups, removed }` toast.
  - **Caveats:** preview keeps "most orders" survivor but backend keeps "lowest
    id"; grouping is exact-name (case/space sensitive); only orders migrate;
    `total_orders` isn't recomputed; it's global + permanent. Export first.

### 7.8 Documents / Invoices (`AdminDocuments.jsx`)
Five document types: **Invoice (+ kuitansi), Surat Jalan, Kwitansi, Surat
Penawaran, Surat Perjanjian.** All render to print-ready A4 React layouts.

- **Multi-row invoice (IPO):**
  - **Input:** pick any car of a booking (or a row from the "perlu tagihan"
    queue).
  - **Process:** `bookingSiblings()` gathers every row sharing the code (from the
    orders cache **and** the pending queue) → builds one line item per car.
    Subtotal = Σ(price + lembur×50k + inap×150k); tax folded in; auto-discount
    (5%) keys off **rental days** (date span), never car count; `terbilang()`
    renders the grand total in Indonesian words.
  - **Output:** a print-ready invoice + kuitansi; "Tandai Invoice Selesai" marks
    **every** sibling row invoiced (`bulkMarkInvoiceGenerated`).

### 7.9 Analytics (`AdminAnalytics.jsx`)
- **Input:** open Analytics.
- **Process:** pulls all orders, aggregates a fixed 5-month YoY window. After
  M2 it tracks **two dimensions explicitly**: `trips` (distinct `order_number`)
  and `cars` (rows). Backend `analytics.service.js` exposes `cars_rented`,
  `trips_booked`, `avg_trip_value`.
- **Output:** YoY table (Trip / Unit / Days / Omset / Net) + top-5 contributors.
- **Lesson baked in:** with the shared-code model, "count orders" is ambiguous —
  always say whether you mean bookings or cars, in SQL and in labels.

### 7.10 Finance, Schedule, Settings (overview)
- **Finance** (`AdminFinance.jsx` + `components/finance/`): chart of accounts,
  journal, financial reports (ledger, trial balance, income statement, cash
  flow, balance sheet) via `api.journal.*` / `api.accounts.*` / `api.finance.*`.
- **Schedule** (`AdminSchedule.jsx`): week/month timeline of bookings + maintenance
  using the Material-3 token set.
- **Settings** (`AdminSettings.jsx`): org profile, invite code (get/rotate/resend),
  vendor list (Phase 2 multi-vendor groundwork), notification (Telegram) status/test.
- **Users/Orgs** (`AdminUsers.jsx`): create/list users, roles, org assignment
  (superadmin manages orgs).

### 7.11 Sync (Rekap.xlsx → DB) & Notifications
- **Sync** (`sync.service.js`): imports the legacy Rekap 2026.xlsx into the DB
  (manual trigger or upload); writes `sync_logs`; web-origin rows are skipped on
  the order-by-code path to avoid multi-row collisions. Disabled on the VPS
  (`REKAP_SYNC_DISABLED=true`).
- **Telegram** (`telegram.service.js`): free push alerts to the agency on every
  order. Pure `buildOrderMessage()` builds the HTML; `notifyOrderCreated()`
  sends it; no token = silent no-op (booking still succeeds).

---

## 8. Infrastructure & deployment (condensed)

Full step-by-step is in `Deployment_Master_Guide.md`. The shape:

1. VPS base: Ubuntu + Node 22 + PM2 + nginx + ufw; a non-root `dsr` user.
2. Clone repo as `dsr` into `/home/dsr/dsr`; `npm ci` both apps.
3. `.env` (chmod 600); symlink `uploads` → `/var/lib/dsr/uploads`.
4. `npm run migrate` (builds the schema on empty Neon) + `add-user-role-enum.js`.
5. Build web with **`VITE_API_BASE=https://your-domain`** (NOT empty — empty
   falls back to `localhost:5000` and breaks the live app).
6. PM2 ecosystem (`fork` mode, `max_memory_restart 1024M`) + `pm2 startup`/`save`.
7. nginx: serve `dist`, proxy `/api`, then `certbot --nginx` for TLS.
8. Ensure `chmod o+x /home/dsr` so nginx (`www-data`) can read `dist`.
9. Smoke test: `/api/health`, register+verify email, a multi-unit booking,
   Telegram alert.

**Gotchas this project hit (now permanent lessons):** don't gitignore
`drizzle/`; set `VITE_API_BASE` to the real origin; the `normalize_*` cleanup
migrations error harmlessly on a fresh DB; home-dir must be traversable by
`www-data`.

---

## 9. Adopting a portion into your own app

Pieces that transplant cleanly:

- **Shared-code "one booking, N rows" model** — drop the unique constraint, add
  a non-unique index, generate the code once, group by it in the UI. Useful for
  any order/invoice system with line items that are also first-class rows.
- **Multi-row invoice engine** (`AdminDocuments.jsx`) — gather siblings by code,
  one line per row, totals + `terbilang()` words.
- **Bulk-status pattern** — checkbox column + select-all + bulk bar →
  `PUT /resource/bulk-status {ids, status}` validated against an enum, registered
  before `/:id`.
- **swr + apiCache** (`src/lib/api.js`) — a ~40-line dependency-free
  stale-while-revalidate cache.
- **Import/export** (`dataFormats.js` + `FormatPickerModal`) — multi-format,
  XLSX lazy-loaded from CDN.
- **Tenancy scope helper** (`buildScopeConditions`) — one function that turns a
  user into `WHERE` conditions across every list query.
- **The migration runner** (`scripts/migrate.js`) — plain `.sql` files, no
  drizzle-kit needed at deploy.

When adopting, keep the contract-first method (§2) and bring the relevant
`api.<resource>` block, the backend route, and the migration together.

---

## 10. Verification & quality gates

- Backend pure logic: `npm test` in `apps/api` (`node:test`, zero deps) — see
  `test/multivehicle.test.js`. Full manual matrix in `Tier2_E2E_Test_Matrix.md`.
- Frontend: `npm run lint`, `npm run build`, manual browser pass.
- DB: idempotent migrations; verify constraints/columns with `pg_tables` /
  `information_schema.columns` / `pg_constraint` queries.
- Every feature change touches: route (App.jsx) · page · `api.js` · backend
  route · service · migration (if schema) · i18n (id+en). Use that as a checklist.
