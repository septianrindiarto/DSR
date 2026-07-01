# Stage 2 — Deploy & Data-Migration Runbook

Everything built this stage (customer-name snapshot, customer identity by
name+phone+type+company, order-claim ownership, Rekap/Klaim scoping, login
account-type check, client column hiding, Telegram rework, footer/WhatsApp,
LCV category, mandatory fields, dashboard/demo cleanup).

> ⚠️ Commit from YOUR machine (VS Code terminal), not from any AI sandbox —
> the sandbox mirror can serve truncated files. Your local working tree is the
> source of truth.

---

## 0. Pre-commit review (local)

Confirm no stray/debug files get committed. These should be removed or ignored:

- `apps/api/check.mjs`  — temp syntax-check scratch, delete it.
- `apps/api/src/test-db.js` — only commit if it's a real change you intended.

`clean-users.js` is a **dev reset tool** — safe to commit (it's guarded and
dry-run by default) but NEVER run it against production.

Quick local sanity check before committing:

```bash
cd apps/api && npm test          # node:test — Telegram + invoice unit tests
cd ../web  && npm run build       # Vite production build must succeed
```

---

## 1. Commit & push (triggers auto-deploy if GitHub Actions is armed)

```bash
git add -A
git status                        # eyeball the list; unstage anything unwanted
git commit -m "Stage 2: customer identity + order claim/scoping, login guard, client Rekap columns, Telegram/footer fixes"
git push origin main
```

- **If GitHub Actions secrets are set** (deploy key + host vars from
  `docs/CICD_GitHub_Actions_Setup.md`): the push auto-builds and deploys.
  Watch the run under the repo's **Actions** tab.
- **If NOT set yet**: do the manual deploy in §2, or finish the Actions setup
  first (that's the one deferred item from earlier).

---

## 2. Manual deploy (fallback / if Actions not armed)

SSH to the VPS as the app user, then:

```bash
cd /home/dsr/dsr
git pull origin main
cd apps/api && npm ci
cd ../web  && npm ci && VITE_API_BASE=https://dsrappai.com npm run build
# nginx serves apps/web/dist; ensure o+x on /home/dsr so www-data can read it
```

Do NOT restart PM2 until AFTER migrations (§3) so the app never runs against a
schema it expects but the DB lacks.

---

## 3. Data migration (PROD) — run AFTER code is deployed, BEFORE restart

All migrations are **idempotent** and additive (ADD COLUMN/TABLE IF NOT EXISTS).
A single command applies them in the correct order:

```bash
cd /home/dsr/dsr/apps/api
npm run migrate
```

Migrations applied this stage (alphabetical = safe dependency order):

| File | Effect |
|------|--------|
| `affiliate_agency_codes_migration.sql` | `user.affiliate_code`, `organizations.agency_code` |
| `client_agency_links_migration.sql`    | creates `client_agency_links` (+ approval_token) |
| `letter_counter_migration.sql`         | `letter_counters` table (surat number) |
| `order_claim_migration.sql`            | `orders.claim_status / claimed_by_user_id / claimed_by_agency_id` |
| `order_customer_name_migration.sql`    | `orders.customer_name` (+ backfill from customers) |
| `orders_shared_code_migration.sql`     | Tier 2 shared order code (drop UNIQUE) — if not already applied |
| `zz_backfill_claim_status_migration.sql` | stamps legacy unclaimed orders as owned (runs last) |

Harmless noise: older non-idempotent files (e.g. `normalize_client_roles`) may
print errors on re-run — safe to ignore.

Then restart:

```bash
pm2 restart dsr-api && pm2 save
```

### Verify the schema landed

```sql
-- columns
SELECT column_name FROM information_schema.columns
WHERE table_name='orders' AND column_name IN
  ('customer_name','claim_status','claimed_by_agency_id');
-- table
SELECT to_regclass('public.client_agency_links');
```

---

## 4. One-time PROD data hygiene (only if applicable)

- **Account types**: make sure each real account has the right `account_type`
  (`agency` vs `client`). The login guard now blocks cross-type logins, so a
  mislabeled account can't sign in via the wrong menu.
  ```sql
  SELECT id, email, role, account_type, organization_id FROM "user";
  -- fix any wrong ones, e.g.:
  -- UPDATE "user" SET account_type='client', role='admin' WHERE email='...';
  ```
- **Agency org**: each agency account should have an `organization_id` (so
  `claimed_by_agency_id` is populated on the orders it owns). Attach with
  `node src/scripts/fix-agency-admin.js <agency-email> "<Agency Name>"`.
- Do **not** run `clean-users.js` on prod.

---

## 5. Post-deploy smoke test

1. Log in as an **agency** via the Agency menu, and a **client** via the Client
   menu — cross-menu login should be rejected.
2. Client submits an order for a named PIC → shows the typed name in Rekap,
   appears in the client's Rekap only (not their Klaim), and in the serving
   agency's Klaim.
3. Agency claims it → moves into the agency's Rekap, leaves Klaim.
4. Client Rekap shows no Action column and no lembur / inap / kontrak harga /
   dibuat oleh / bailout columns.
5. Telegram alert lists "N unit CATEGORY / jemput di … tujuan …", no prices.

---

## Rollback

Migrations are additive (no drops of existing data), so rolling back CODE
(`git revert` + redeploy) is safe without touching the DB. The new columns
simply go unused by the reverted code.
