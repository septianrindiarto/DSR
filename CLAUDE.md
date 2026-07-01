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
8. i18n keys in **both** `id.js` and `en.js`.

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
