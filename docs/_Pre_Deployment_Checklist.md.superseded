# DSR Solution — Pre-Deployment Checklist

**Purpose:** what must be true about the codebase, credentials, and
external services BEFORE you start the VPS walkthrough. Treat this as
the gate; once every item is checked, move to `VPS_Deployment_Walkthrough.md`.

---

## 1. Code state (already done — verify the commits are pushed)

These five changes were applied to the repo and need to be in the SHA
the VPS pulls. If a fresh clone of the repo does not contain them,
re-run the fix step before deploying.

**`apps/api/src/index.js`**

The file should contain `app.set('trust proxy', 1)` near the top of the
Express setup (without this, the rate limiter buckets every nginx-proxied
request as 127.0.0.1 and one user can lock everyone out).

The CORS allowlist should read `process.env.CORS_ORIGIN` (comma-separated
supported) and only append the localhost entries when
`NODE_ENV !== 'production'`. The `IS_PROD` constant gates the dev origins.

The server boot should capture the return of `app.listen()` in a `server`
variable and register `SIGTERM` + `SIGINT` handlers that call
`server.close()` with a 10-second hard-exit fallback. Without this PM2
reloads will kill in-flight requests.

**`apps/api/src/auth.js`**

The `trustedOrigins` array should mirror the same NODE_ENV-gated shape
as `index.js`. Better Auth bookkeeping must match CORS to avoid cookie
mismatches.

**`apps/api/package.json` and `apps/web/package.json`**

Both files must contain `"engines": { "node": ">=22 <23" }`. Pins Node
22 LTS on the VPS and stops `npm ci` from quietly using a newer major.

**Quick verification:**

```bash
grep -n "trust proxy" apps/api/src/index.js
grep -n "IS_PROD" apps/api/src/index.js
grep -n "SIGTERM" apps/api/src/index.js
grep -n "NODE_ENV === 'production'" apps/api/src/auth.js
grep -n '"engines"' apps/api/package.json apps/web/package.json
```

Each line should return a hit. If anything is missing, the deploy will
expose the corresponding bug. Don't ship without all five.

---

## 2. Credentials and secrets to gather

You'll need each of these before writing the production `.env` on the VPS.
Get them now so the deploy doesn't stall at step 4.3 of the walkthrough.

**Neon Postgres connection string.** Log into console.neon.tech, pick the
project, copy the pooled connection string. It will look like
`postgres://owner:password@ep-foo.region.aws.neon.tech/dsr?sslmode=require`.
The same DB that runs in dev is fine for first prod — Neon offers branching
later if you want a separated environment.

**Better Auth secret.** Generate fresh, don't reuse the dev one:

```bash
openssl rand -hex 32
```

Paste the output into `BETTER_AUTH_SECRET`. This is what signs session
cookies; rotating it invalidates everyone's session.

**Domain name.** A name pointed at the VPS IP via an A record. Both
`app.dsrappai.com` (or whatever you choose) and the apex `dsrappai.com`
ideally; the apex can 301-redirect to the subdomain.

**Gmail credentials.** The dev `.env` already has `GMAIL_USER`,
`GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`,
`GMAIL_OAUTH_REFRESH_TOKEN` (or the App Password fallback). Use the same
production values — they're tied to the Gmail account, not the
environment. Verify the refresh token still works by sending a test
email from dev.

**Telegram credentials.** `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_ADMIN_CHAT_ID` from `@BotFather` and `@userinfobot` respectively.
Same as dev — these are bot-level, not env-level.

**SSH key for the VPS.** Generate locally if you don't have one:

```bash
ssh-keygen -t ed25519 -C "you@email.com"
```

Add the public key (`~/.ssh/id_ed25519.pub`) to the VPS provider's panel
during creation. Password-auth-only VPSes are a security hole and most
providers refuse to enable them now anyway.

---

## 3. External services that must be live

**Neon database** — the same DB you've been developing against. Make
sure the IP allowlist (if you set one) includes the VPS IP. By default
Neon accepts any IP if you only have a pooled connection string. Verify
by running `node src/scripts/audit-parent-agency.js` from your dev box
right before deploy; if that works, the production deploy will too.

**Gmail / Google Workspace** — confirm the OAuth refresh token has not
been revoked. Refresh tokens go stale if the Workspace admin changes
2FA policy or removes the OAuth client. Send a test verification email
from dev; if the email arrives, you're good.

**Telegram bot** — the bot must have received `/start` from the chat
ID listed in `TELEGRAM_ADMIN_CHAT_ID`. If not, Telegram refuses to send
the bot's first message. Test from dev by triggering any order creation
and confirming the alert lands.

**Domain DNS** — A record for `app.dsrappai.com` pointing at the VPS
public IP, propagated. Verify:

```bash
dig +short A app.dsrappai.com
# Should return the VPS IP, no CNAME chains
```

`certbot` will fail if DNS isn't pointing at the VPS yet, so this is a
hard gate.

---

## 4. Data state

**Run the parent_agency_id audit on the production DB.** Even though the
schema is correct, any client org rows created before Phase 4C-1 may have
`parent_agency_id = NULL`, which means agency admins can't see orders
tagged to them (the bug we just fixed).

```bash
cd apps/api
node src/scripts/audit-parent-agency.js
```

It's idempotent — running on a clean DB is a no-op. Print the BEFORE/AFTER
table and screenshot it before deploying.

**Normalize legacy roles if not already.** Run once if your DB still has
`role = 'client'` or `role = 'client_admin'` rows:

```bash
node src/scripts/normalize-client-roles.js
```

After normalization, `role` should only contain `admin`, `user`,
`superadmin`, `agent`, `demo`.

**Verify there's at least one superadmin.** A superadmin row in `user`
table is the recovery account if the agency admin gets locked out:

```bash
node -e "import('./src/db/index.js').then(async m => {
  const r = await m.db.execute(\"SELECT id, email, role FROM \\\"user\\\" WHERE role = 'superadmin'\");
  console.log(r.rows || r);
})"
```

If zero rows, promote one:

```sql
UPDATE "user" SET role = 'superadmin' WHERE email = 'you@yourcompany.com';
```

---

## 5. Environment variables to draft

Before SSHing into the VPS, write the full `.env` locally in a scratch
file so you can paste it directly. Don't commit it.

```dotenv
NODE_ENV=production
PORT=5000

DATABASE_URL=postgres://...neon connection string...

BETTER_AUTH_SECRET=...openssl rand -hex 32 output...
BETTER_AUTH_URL=https://app.dsrappai.com
CORS_ORIGIN=https://app.dsrappai.com
APP_URL=https://app.dsrappai.com

GMAIL_USER=admin@dsrappai.com
GMAIL_FROM_NAME=DSR Solution
GMAIL_OAUTH_CLIENT_ID=...
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_REFRESH_TOKEN=...

TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_CHAT_ID=...

DEBUG=false
REKAP_SYNC_DISABLED=true
```

The Rekap watcher is desktop-only so disable it on the VPS. Re-enable
later if you upload the xlsx file to a Linux path and point
`REKAP_XLSX_PATH` at it.

---

## 6. Frontend build decision

Choose ONE before building:

**Same-origin (recommended).** nginx serves both `/` (web bundle) and
`/api/*` (proxy to backend). Build the web with an empty `VITE_API_BASE`:

```bash
# apps/web/.env.production
VITE_API_BASE=
```

The frontend then fetches `/api/...` as a same-origin call. Zero CORS
config needed beyond the basic allowlist for cookie credentials.

**Split subdomains.** `app.dsrappai.com` for web, `api.dsrappai.com` for
API. Build with:

```bash
VITE_API_BASE=https://api.dsrappai.com
```

This requires two nginx server blocks and two TLS certs. More moving
parts; only worth it if you want to scale them independently later.

Pick same-origin unless you have a specific reason not to.

---

## 7. Pre-deploy smoke test on dev

Before touching the VPS, run the same flow you'll run after deploy, on
the dev machine, with the just-applied code:

1. `npm run dev` in both `apps/api` and `apps/web`
2. Open `http://localhost:5173`, hard refresh (Ctrl+F5) to load the new bundle
3. Register a fresh test user → verify email lands → click link → log in
4. Create an order from the Dashboard form (verify the WhatsApp field is
   editable and the order lands in Rekap)
5. Sign out, sign in as the agency admin, verify the order appears
   (this exercises the scope.js fix)
6. Ctrl+C the API and confirm you see `[shutdown] SIGINT received, draining…`
   followed by `[shutdown] all connections closed, bye.` — this proves the
   graceful shutdown handler works

If any step fails, fix on dev first. The VPS is not the place to debug
working-tree code.

---

## 8. Gate summary — DO NOT DEPLOY UNTIL ALL ✓

- [ ] Five code fixes confirmed via `grep` (§1)
- [ ] Neon connection string + new `BETTER_AUTH_SECRET` in scratch file
- [ ] Domain A record resolves to the VPS IP via `dig`
- [ ] Gmail OAuth refresh token verified by sending a dev test email
- [ ] Telegram bot reachable from dev order creation
- [ ] `audit-parent-agency.js` run cleanly on the prod DB
- [ ] At least one `role = 'superadmin'` row exists
- [ ] Full `.env` drafted with NO trailing localhost values
- [ ] Same-origin vs subdomain decision made
- [ ] Local smoke test passes end-to-end with the new code

When every box is ticked, open `VPS_Deployment_Walkthrough.md` and start
at step 1.
