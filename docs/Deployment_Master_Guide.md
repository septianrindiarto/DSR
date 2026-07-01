# DSR Solution — Deployment Master Guide

**Audience:** operator deploying DSR to a Rumahweb VPS for the first time
**Scope:** every step from pre-deploy code state through routine post-deploy maintenance
**Skipped:** VPS purchase + provisioning on Rumahweb's panel (handle separately)
**Stack decision:** bare Node + nginx + PM2. Docker considered and rejected — see §0.
**Database:** Neon (managed, off-VPS, already configured)

This guide is meant to be checked off top-to-bottom. Each section assumes
the previous one succeeded. Don't skip ahead.

---

## Table of contents

0. Stack decision and why
1. Pre-deployment code state
2. Credentials and external services
3. Data state on the production DB
4. Drafting the production .env
5. Frontend build decision
6. Dev-side smoke test
7. VPS initial setup (post-purchase)
8. Clone, install, configure
9. PM2 process configuration
10. nginx + TLS
11. Maintenance-mode mechanism (deferred — install after first deploy)
12. First-deploy smoke test
13. Post-deploy hygiene (logs, backups, monitoring)
14. Subsequent deploys
15. Rollback procedure
16. Troubleshooting cheatsheet
17. Verification gate checklist

---

## 0. Stack decision — bare PM2 vs Docker

**Verdict:** bare PM2.

**Why not Docker:**

Your stack has a single application service (the Node API), a static
frontend (just files served by nginx), and an external managed database
(Neon). Docker pays off when you have multiple coupled services that
need orchestration. You don't. Containerizing one process adds the
Docker daemon overhead (~200–300 MB RAM on a 2 GB box), 2–3× slower
builds on 1 vCPU, and a new layer to learn — for no offsetting gain.

**When to revisit:** if you add Redis, BullMQ, a worker process, or move
to a managed container host like Fly.io. Until then, the application
code is fully portable — a 40-line Dockerfile can be added later
without changing the app.

---

## 1. Pre-deployment code state — verify five fixes are committed

These five changes must be in the SHA the VPS will pull. They were
applied in the current working tree but they only protect production
if they're committed and pushed.

### 1.1 What to verify

`apps/api/src/index.js` should contain:

- `app.set('trust proxy', 1)` near the top — without this the rate
  limiter buckets every nginx-proxied request as 127.0.0.1.
- A `const IS_PROD = process.env.NODE_ENV === 'production';` constant.
- A CORS allowlist that only appends localhost origins when
  `!IS_PROD`. In production, `CORS_ORIGIN` is the only allowed origin.
- The server boot captured into a `const server = app.listen(...)`.
- `SIGTERM` and `SIGINT` handlers that call `server.close()` with a
  10-second hard-exit fallback.

`apps/api/src/auth.js` should contain the same NODE_ENV-gated shape for
`trustedOrigins` (mirrors the CORS allowlist).

`apps/api/package.json` and `apps/web/package.json` should both contain
`"engines": { "node": ">=22" }`.

### 1.2 Verification commands

From `D:\Project\DSR` in PowerShell:

```powershell
Select-String -Path apps\api\src\index.js -Pattern "trust proxy"
Select-String -Path apps\api\src\index.js -Pattern "IS_PROD"
Select-String -Path apps\api\src\index.js -Pattern "SIGTERM"
Select-String -Path apps\api\src\auth.js   -Pattern "NODE_ENV === 'production'"
Select-String -Path apps\api\package.json,apps\web\package.json -Pattern '"engines"'
```

Or in Git Bash / on the VPS:

```bash
grep -n "trust proxy" apps/api/src/index.js
grep -n "IS_PROD" apps/api/src/index.js
grep -n "SIGTERM" apps/api/src/index.js
grep -n "NODE_ENV === 'production'" apps/api/src/auth.js
grep -n '"engines"' apps/api/package.json apps/web/package.json
```

Five non-empty outputs (the last produces 2 matches across the two
files) = all fixes present. If any returns nothing, fix before
committing.

### 1.3 Tier 2 multi-vehicle release — additional must-haves

This deploy also ships the Tier 2 multi-vehicle feature set. Two things
must be true for it to work in production:

**A. The shared-code DB migration must be applied.** A booking can now
span N vehicle rows that all share one `order_number` (e.g. C073 across
3 cars). That requires dropping the old `UNIQUE` constraint on
`orders.order_number`. The migration that does this is:

```
apps/api/drizzle/orders_shared_code_migration.sql
```

It drops `orders_order_number_unique` and replaces it with a non-unique
index. It is idempotent. **If it hasn't run, any multi-unit booking
fails** with `duplicate key value violates unique constraint
"orders_order_number_unique"` (the first car inserts, the second
collides). This is applied automatically on Path A (§8.6 runs every
`.sql`), but on Path B (reusing an existing DB) you must run it
explicitly — see §8.6.

**B. The full Tier 2 working tree must be committed and pushed**, not
just the five §1.1 fixes. Quick check from `D:\Project\DSR`:

```bash
git status            # should be clean after commit
git log -1 --oneline  # the SHA the VPS will pull
```

Confirm the SHA includes the booking forms, `AdminOrders.jsx`,
`AdminDocuments.jsx`, fleet/driver bulk-status, analytics dimension
changes, and the new `apps/api/test/` directory.

No new environment variables are introduced by this release — §4 is
unchanged. The per-vehicle `destination` / `pickup_location` columns
already exist in the base schema, so no separate migration is needed for
them.

---

## 2. Credentials and external services

### 2.1 Neon Postgres connection string

console.neon.tech → your project → copy the **pooled** connection
string. Looks like
`postgres://owner:pwd@ep-foo.region.aws.neon.tech/dsr?sslmode=require`.

Reuse the dev DB for first prod, or fork to a separate Neon project if
you want hard isolation.

### 2.2 Fresh BETTER_AUTH_SECRET

Don't reuse the dev one:

```bash
openssl rand -hex 32
```

This signs session cookies. Rotating it invalidates everyone's
session — fine for first deploy, painful later.

### 2.3 Domain name with A record pointed at the VPS IP

A subdomain like `app.dsrappai.com` is recommended. Verify after DNS
propagation:

```bash
dig +short A app.dsrappai.com
# Should return the VPS public IP exactly. No CNAME chains.
```

certbot will fail if DNS isn't correct, so this is a hard gate.

### 2.4 Gmail SMTP credentials

Reuse from dev: `GMAIL_USER`, `GMAIL_OAUTH_CLIENT_ID`,
`GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` (or
`GMAIL_APP_PASSWORD` if you used that mode). Confirm the refresh token
still works by sending a test verification email from dev.

### 2.5 Telegram bot credentials

`TELEGRAM_BOT_TOKEN` (from `@BotFather`) and `TELEGRAM_ADMIN_CHAT_ID`
(from `@userinfobot`). Bot-level, identical between dev and prod.

### 2.6 SSH key for the VPS

Generate locally if you don't have one:

```bash
ssh-keygen -t ed25519 -C "you@email.com"
```

Add the public key to Rumahweb's panel during or after VPS provisioning.

---

## 3. Data state on the production DB

There are two paths here. Pick the one that matches your situation.

### Path A — fresh prod Neon project (most likely)

You created a separate Neon project for production with zero tables.
`git clone` brought code only; the schema doesn't exist yet on this DB.

**You do nothing in §3.** The full schema initialization happens on the
VPS in §8.6 (after `npm ci`) because the migration runner needs the
`postgres` driver from `node_modules`. Skip to §4 now. Don't try to run
migrations from your dev box against the prod URL — the dev `.env` is
not configured for it and the risk of pointing at the wrong DB is too
high.

The bootstrap sequence after migrations run in §8.6:

1. Visit `https://app.dsrappai.com/admin/login` after deploy
2. Click "Daftar" → "Agensi"
3. Fill in your real company name, e.g. "DSR Rent Car"
4. Email + password → verification email arrives → click link
5. You're now the agency admin of `org_id=1` (auto-assigned because
   Postgres `serial` starts at 1 on the first INSERT into a fresh table)
6. Real clients register against you via the invite code you'll see in
   Pengaturan → Kode Undangan

### Path B — existing dev DB you're reusing as prod

If you're (intentionally) reusing the same Neon project for both dev
and prod, the schema is already present. Run these three commands to
clean the state before going live:

#### B.1 Backfill parent_agency_id

```bash
cd apps/api
node src/scripts/audit-parent-agency.js
```

Prints BEFORE/AFTER tables and fills any NULL rows with `parent_agency_id=1`.
Idempotent — safe to re-run.

#### B.2 Normalize legacy roles

If any rows still have `role IN ('client', 'client_admin')`:

```bash
node src/scripts/normalize-client-roles.js
```

After: `role` only ever contains `admin`, `user`, `superadmin`,
`agent`, `demo`.

#### B.3 Confirm at least one superadmin exists

The recovery account if the agency admin gets locked out:

```sql
SELECT id, email, role FROM "user" WHERE role = 'superadmin';
```

If empty, promote one:

```sql
UPDATE "user" SET role = 'superadmin' WHERE email = 'you@yourcompany.com';
```

---

## 4. Drafting the production .env

Write this in a local scratch file (do NOT commit). You'll paste it
into the VPS in §8.

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

The Rekap watcher is desktop-only — disable on the VPS.

---

## 5. Frontend build decision

Choose **same-origin** unless you have a specific reason not to.

**Same-origin (recommended):** nginx serves `/` (web bundle) and
`/api/*` (proxy to backend) on one domain. Set
`VITE_API_BASE=https://your-domain` (the full HTTPS origin, e.g.
`https://dsrappai.com`) in `apps/web/.env.production`. The frontend then
calls the API on the same host nginx proxies — no CORS, cookies Just
Work.

> ⚠️ Do NOT set `VITE_API_BASE=` (empty). `apps/web/src/lib/api.js`
> resolves the base as `import.meta.env.VITE_API_BASE || 'http://localhost:5000'`
> — an empty value is falsy and falls back to **localhost:5000**, so the
> deployed app calls each visitor's own machine and every request fails
> with "failed to fetch". Always set the real `https://` origin.
> (If you'd rather make empty mean "same-origin/relative", change that
> `||` to `??` in api.js — then empty resolves to a relative `/api`.)

**Split subdomains:** `app.dsrappai.com` for web, `api.dsrappai.com`
for API. Set `VITE_API_BASE=https://api.dsrappai.com`. Two nginx
server blocks, two TLS certs, two CORS entries. Only worth it if you
want to scale them independently later.

---

## 6. Dev-side smoke test

Before touching the VPS, prove the working tree is green on your dev
machine.

0. Run the unit smoke tests: `cd apps/api && npm test`. All Tier 2
   multi-vehicle invariant tests (`test/multivehicle.test.js`) should
   pass before you ship.
1. `npm run dev` in `apps/api`, then in `apps/web` in another shell.
2. Open `http://localhost:5173`, hard refresh (Ctrl+F5).
3. Register a fresh test user → verification email arrives → click link → log in.
4. Create an order from the Dashboard form. The WhatsApp field should be
   editable. Submit succeeds.
5. **Create a multi-unit booking** — one vehicle row with Jumlah = 2 (or
   two vehicle rows). Submit must succeed and produce ONE order code
   shared across the rows. If this errors with a duplicate-key message,
   your dev DB is missing the shared-code migration — run
   `cd apps/api && npm run migrate -- orders_shared_code` and retry.
   This is the same migration prod needs (§1.3 / §8.6).
6. Sign out → sign in as agency admin → verify the order appears in Rekap,
   grouped under one collapsible row. This exercises the scope.js
   multi-org visibility fix and the Tier 2 grouping.
7. Ctrl+C the API. Console should print
   `[shutdown] SIGINT received, draining…` then
   `[shutdown] all connections closed, bye.`

If any step fails, fix on dev first.

---

## 7. VPS initial setup (post-purchase)

You've already provisioned the Rumahweb VPS and have SSH root access.
Confirm: 1 vCPU, 2 GB RAM, 40 GB disk, Ubuntu 22.04 LTS, root SSH key
installed.

```bash
ssh root@<vps-ip>
apt update && apt upgrade -y
apt install -y curl git nginx ufw fail2ban
```

Install Node 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # confirm v22.x.x
```

Install PM2 globally:

```bash
npm install -g pm2
pm2 -v
```

Create the dedicated app user (do not run prod as root):

```bash
adduser --disabled-password --gecos "" dsr
usermod -aG www-data dsr
mkdir -p /var/lib/dsr/uploads
chown -R dsr:dsr /var/lib/dsr
```

Configure the firewall:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status   # confirm 22, 80, 443
```

---

## 7.5 Optional: VS Code Remote SSH (recommended)

Strongly recommended for everything that follows. Lets you browse, edit,
and search VPS files in a graphical editor on Windows, with an integrated
terminal — no desktop environment installed on the VPS, no RAM cost.

### 7.5.1 Install on Windows

If you don't already have VS Code:

1. Download from `https://code.visualstudio.com/` and install with the
   defaults.
2. Open VS Code. Click the Extensions icon in the left sidebar (or press
   `Ctrl+Shift+X`).
3. Search for **Remote - SSH** by Microsoft. Click Install.

### 7.5.2 Connect to the VPS

1. Press `F1` (or `Ctrl+Shift+P`) to open the command palette.
2. Type `Remote-SSH: Connect to Host` and press Enter.
3. Choose `+ Add New SSH Host...`.
4. Paste `ssh root@<your-vps-ip>` (replace with your real IP). Press Enter.
5. Pick the SSH config file to save it to — the first option
   (`C:\Users\<you>\.ssh\config`) is fine.
6. Press `F1` → `Remote-SSH: Connect to Host` again → select the entry
   you just added.
7. A new VS Code window opens. The first connect installs the Remote
   server on the VPS (~30 seconds, automatic). Then the bottom-left
   corner shows `SSH: <vps-ip>` — you're connected.

### 7.5.3 What you can now do

Open the file tree with the Explorer icon (top-left). Navigate to
`/home/dsr/dsr/` once you've completed §8.2 — files appear visually
just like a local folder.

Open the integrated terminal with `` Ctrl+` `` — it's an SSH session
already logged in. Every command in §8 onwards can be typed here
instead of in PowerShell. The advantage: you can see the file you
edited and the terminal output in the same window.

Edit any config file (`.env`, `ecosystem.config.cjs`, nginx configs)
by clicking it in the tree — VS Code's syntax highlighting catches
typos that nano misses.

Search across all VPS files with `Ctrl+Shift+F` — useful for
"where does this env var get read?".

Drag a file from Windows Explorer into the VS Code file tree to
upload it to the VPS; drag a file from the tree to your desktop to
download it.

### 7.5.4 Note on root vs dsr user

Initial steps (§7) run as `root`. From §8 onwards you switch to the
`dsr` user via `sudo -iu dsr`. To VS Code as the `dsr` user instead
of root, add a separate host:

1. `F1` → `Remote-SSH: Connect to Host` → `+ Add New SSH Host...`
2. Paste `ssh dsr@<your-vps-ip>`
3. Save and switch between `root@...` and `dsr@...` from the host
   list.

The dsr user needs its own SSH public key in `/home/dsr/.ssh/authorized_keys`.
Add it once after creating the user in §7 (run as root):

```bash
mkdir -p /home/dsr/.ssh
cp /root/.ssh/authorized_keys /home/dsr/.ssh/authorized_keys
chown -R dsr:dsr /home/dsr/.ssh
chmod 700 /home/dsr/.ssh
chmod 600 /home/dsr/.ssh/authorized_keys
```

After this, VS Code can connect as `dsr` with the same Windows-side
key that worked for `root`.

---

## 8. Clone, install, configure

### 8.1 Add the dsr user's SSH key for GitHub (if private repo)

As `dsr`:

```bash
sudo -iu dsr
ssh-keygen -t ed25519 -C "dsr@vps" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Paste the public key into GitHub → Settings → SSH keys. Or, if the repo
is public, skip this and use HTTPS.

### 8.2 Clone the repo

```bash
cd ~
git clone git@github.com:your-org/dsr.git
# Or HTTPS: git clone https://github.com/your-org/dsr.git
cd dsr
git log -1 --oneline   # confirm SHA has the five pre-deploy fixes
```

### 8.3 Install dependencies

```bash
cd ~/dsr/apps/api
npm ci --omit=dev

cd ~/dsr/apps/web
npm ci
# Don't build yet — need .env.production set first
```

### 8.4 Write the production .env

```bash
nano /home/dsr/dsr/apps/api/.env
# Paste your draft from §4
chmod 600 /home/dsr/dsr/apps/api/.env
ls -l /home/dsr/dsr/apps/api/.env   # confirm -rw-------
```

### 8.5 Wire the uploads volume

```bash
cd ~/dsr/apps/api
rm -rf uploads
ln -s /var/lib/dsr/uploads uploads
ls -la uploads   # should be a symlink to /var/lib/dsr/uploads
```

If migrating existing photos from another host, `scp` them into
`/var/lib/dsr/uploads/` before this step.

### 8.6 Initialize the production schema

**For Path A (fresh prod Neon project — no tables yet):**

Apply every SQL migration in `apps/api/drizzle/` to the empty prod DB.
The runner is idempotent and reads `DATABASE_URL` from the `.env` you
just wrote.

```bash
cd ~/dsr/apps/api
npm run migrate
```

You should see ~15 SQL files applied, with most statements showing `✓`
and a final summary like `Total: N ok, 0 errors`. The migrations
include the full table schema (`0000_short_sumo.sql`), tenancy
columns, invite codes, display IDs, access requests, finance tables,
the normalize/scope migrations, and the Tier 2
`orders_shared_code_migration.sql` (drops the UNIQUE on
`order_number`). Because `npm run migrate` applies every `.sql` file,
the shared-code migration is included automatically on this path — no
extra step needed.

Append the `'user'` value to the `user_role` enum (added after the
drizzle-kit snapshot was generated):

```bash
node src/scripts/add-user-role-enum.js
```

Verify the schema is in place:

```bash
node -e "import('./src/db/index.js').then(async m => {
  const r = await m.db.execute(\"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\");
  console.log((r.rows || r).map(x => x.tablename || x).join('\n'));
})"
```

You should see ~20 tables including `organizations`, `user`,
`customers`, `orders`, `cars`, `account`, `session`, etc.

Don't seed anything yet. The first agency org gets created when you
register through the UI after deploy (Path A bootstrap, §3).

**For Path B (reusing an existing dev DB — schema already present):**

Run the cleanup audits from §3 (`audit-parent-agency.js`,
`normalize-client-roles.js`). Don't run a blanket `npm run migrate` on a
populated DB — while idempotent, it's noisy and slow when not needed.

**But you MUST apply any migrations added since the DB was last set up.**
For this release that means the Tier 2 shared-code migration — without
it, multi-unit bookings fail (see §1.3). The runner accepts a filename
filter so you can apply just that one:

```bash
cd ~/dsr/apps/api
npm run migrate -- orders_shared_code
```

Expected output: `orders_order_number_unique` dropped (or "does not
exist" if already gone — both fine, it's idempotent) and
`idx_orders_order_number` created. Re-running is safe.

Confirm the constraint is gone:

```bash
node -e "import('./src/db/index.js').then(async m => {
  const r = await m.db.execute(\"SELECT conname FROM pg_constraint WHERE conname = 'orders_order_number_unique'\");
  console.log((r.rows || r).length ? 'STILL PRESENT — multi-unit bookings will fail' : 'OK: unique constraint removed');
})"
```

### 8.7 Build the frontend

Same-origin (recommended) — use the full HTTPS origin, NOT empty (see
§5's warning; empty falls back to localhost and breaks the live app):

```bash
cd ~/dsr/apps/web
echo "VITE_API_BASE=https://dsrappai.com" > .env.production
npm run build
ls dist/index.html   # confirm the build landed
```

Split subdomain (if chosen):

```bash
echo "VITE_API_BASE=https://api.dsrappai.com" > .env.production
npm run build
```

---

## 9. PM2 process configuration

### 9.1 Create the ecosystem file

```bash
nano /home/dsr/dsr/ecosystem.config.cjs
```

Paste:

```js
module.exports = {
    apps: [{
        name: 'dsr-api',
        cwd: '/home/dsr/dsr/apps/api',
        script: 'src/index.js',
        instances: 1,
        exec_mode: 'fork',
        // 1 vCPU + 2 GB RAM: allow 1 GB before forced restart.
        // Single-process; do NOT enable cluster mode on 1 vCPU.
        max_memory_restart: '1024M',
        env: {
            NODE_ENV: 'production',
        },
        out_file: '/var/log/pm2/dsr-api-out.log',
        error_file: '/var/log/pm2/dsr-api-err.log',
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }],
};
```

### 9.2 Prepare log directory

Back to root briefly:

```bash
exit   # back to root
mkdir -p /var/log/pm2
chown dsr:dsr /var/log/pm2
sudo -iu dsr
```

### 9.3 Start the API

```bash
pm2 start ~/dsr/ecosystem.config.cjs
pm2 ls   # should show dsr-api online
pm2 logs dsr-api --lines 50   # confirm the startup banner appears
```

### 9.4 Persist PM2 across reboots

```bash
pm2 startup systemd -u dsr --hp /home/dsr
# Copy the printed sudo line and run it AS ROOT, then come back
exit   # to root
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u dsr --hp /home/dsr
sudo -iu dsr
pm2 save   # save current process list
```

---

## 10. nginx + TLS

### 10.1 Site config (HTTP only — certbot adds HTTPS)

As root:

```bash
nano /etc/nginx/sites-available/dsr
```

Paste (replace `app.dsrappai.com` with your domain):

```nginx
server {
    listen 80;
    server_name app.dsrappai.com;

    # certbot will rewrite this server block to add HTTPS in §10.2

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    root /home/dsr/dsr/apps/web/dist;
    index index.html;

    # Maintenance mode hook — see §11. Until you add the maintenance.flag
    # mechanism after first deploy, this block is a no-op (file doesn't exist).
    set $maintenance 0;
    if (-f /var/lib/dsr/maintenance.flag) { set $maintenance 1; }

    location /api/health {
        # Health endpoint MUST stay reachable during maintenance so monitors
        # don't false-alarm. Bypass the maintenance check.
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
    }

    location /api/ {
        if ($maintenance = 1) { return 503; }
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    location /uploads/ {
        alias /var/lib/dsr/uploads/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        if ($maintenance = 1) { return 503; }
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:js|css|woff2?|ttf|png|jpg|jpeg|gif|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    error_page 503 @maintenance;
    location @maintenance {
        root /var/www;
        try_files /maintenance.html =503;
        internal;
    }

    client_max_body_size 12M;
}
```

```bash
ln -s /etc/nginx/sites-available/dsr /etc/nginx/sites-enabled/dsr
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### 10.2 TLS via Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d app.dsrappai.com
# Choose option 2 (redirect HTTP → HTTPS) when prompted.
# certbot edits /etc/nginx/sites-available/dsr automatically.

systemctl status certbot.timer   # confirm auto-renewal is active
```

---

## 11. Maintenance-mode mechanism

**Status:** to be installed after the first successful deploy in §12.
Once installed, this gives you a clean "the site is briefly down for
maintenance" page during any deploy that touches the DB or breaks
backward compatibility.

### 11.1 How it works

A flag file at `/var/lib/dsr/maintenance.flag`. When present, nginx
returns HTTP 503 for all `/` and `/api/` traffic, redirecting to a
static maintenance page. `/api/health` stays reachable so uptime
monitors don't alert.

The nginx config in §10.1 already includes the check (`if -f
/var/lib/dsr/maintenance.flag`) — it's a no-op until the flag file
actually exists.

### 11.2 Create the maintenance page

After first deploy succeeds:

```bash
sudo mkdir -p /var/www
sudo nano /var/www/maintenance.html
```

Paste:

```html
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="60">
<title>Sedang Pemeliharaan — DSR Solution</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; background: #fcf8f8;
       color: #1d0c0d; display: flex; align-items: center; justify-content: center;
       min-height: 100vh; margin: 0; }
.card { max-width: 480px; background: #fff; border: 1px solid #eacdce;
        border-radius: 12px; padding: 40px; text-align: center; }
h1 { color: #ff0008; font-size: 22px; margin: 0 0 12px; }
p { color: #555; line-height: 1.6; margin: 12px 0; }
.icon { font-size: 48px; margin-bottom: 8px; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">🔧</div>
  <h1>Sedang Pemeliharaan</h1>
  <p>DSR Solution sedang menjalani pemeliharaan singkat.<br>
     Halaman ini akan otomatis dimuat ulang setiap 60 detik.</p>
  <p style="font-size: 12px; color: #999;">Estimasi: kurang dari 5 menit</p>
</div>
</body>
</html>
```

```bash
sudo chmod 644 /var/www/maintenance.html
```

### 11.3 Create the on/off scripts

```bash
sudo nano /usr/local/bin/dsr-maint-on
```

```bash
#!/bin/bash
sudo touch /var/lib/dsr/maintenance.flag
echo "[maint] ON — site shows maintenance page, /api/health still up"
```

```bash
sudo nano /usr/local/bin/dsr-maint-off
```

```bash
#!/bin/bash
sudo rm -f /var/lib/dsr/maintenance.flag
echo "[maint] OFF — site live"
```

```bash
sudo chmod +x /usr/local/bin/dsr-maint-on /usr/local/bin/dsr-maint-off
# Allow dsr user to use sudo for these two commands without password
sudo visudo
# Add the line:
# dsr ALL=(ALL) NOPASSWD: /usr/bin/touch /var/lib/dsr/maintenance.flag, /bin/rm -f /var/lib/dsr/maintenance.flag
```

### 11.4 Wire into the deploy script

Update `~/dsr-deploy.sh` (see §14) to wrap risky steps in maintenance
mode:

```bash
# Inside dsr-deploy.sh, wrap migration steps:
dsr-maint-on
# ...run migration...
dsr-maint-off
```

For code-only deploys (no DB changes), don't toggle — PM2's graceful
reload handles zero-downtime already.

### 11.5 Manual toggle (when fixing a live bug)

```bash
# Before debugging
dsr-maint-on
# Fix the issue
dsr-maint-off
```

---

## 12. First-deploy smoke test

From your laptop, not the VPS:

```bash
curl https://app.dsrappai.com/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

Open `https://app.dsrappai.com` in a browser and run through:

**For Path A (fresh DB — the first run is also a bootstrap):**

1. Landing page loads with the empty-fleet message (no cars yet).
2. Click "Masuk" → "Daftar" → "Agensi".
3. Fill in company name "DSR Rent Car" (or your real name), email,
   password → submit.
4. Verification email arrives in your inbox → click link → log in.
5. You should land on the Dashboard as the first agency admin. Open
   Pengaturan to confirm the profile loaded and the invite code is
   visible.
6. SQL-promote yourself to superadmin if you want platform-level access:
   ```sql
   UPDATE "user" SET role = 'superadmin' WHERE email = 'you@yourcompany.com';
   ```
7. Sign out → register a fresh test account as "Klien" → use the invite
   code from step 5 → verification email → log in → create an order
   from the Dashboard form.
8. Sign back in as the agency admin → confirm the test order appears
   in Rekap (exercises the scope fix).
9. Confirm the Telegram alert fired for the new order.

**For Path B (existing DB — data already there):**

1. Landing page loads (cars catalog or empty fleet message).
2. Click "Masuk" → log in as the superadmin you set up in §3.B.3.
3. Dashboard renders. Open Pengaturan → profile loads.
4. Open Rekap Order → existing orders appear.
5. Sign out → register a fresh account → verification email arrives.
6. Click verification link → log in → create an order from the Dashboard
   form (free-text WhatsApp field works).
7. Sign back in as the agency admin → confirm the test order appears in
   Rekap (exercises the scope fix).
8. Confirm the Telegram alert fired for the new order.

If any step fails, check:

```bash
pm2 logs dsr-api --lines 100
sudo tail -50 /var/log/nginx/error.log
```

Most first-deploy failures are typos in `.env` (mismatched
`BETTER_AUTH_URL` scheme, wrong `CORS_ORIGIN` host).

---

## 13. Post-deploy hygiene (run once)

### 13.1 PM2 log rotation

```bash
sudo -iu dsr
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 13.2 Install maintenance mode (now that everything works)

Follow §11.2–11.3 to add the maintenance.html and toggle scripts.

### 13.3 Daily uploads backup cron

```bash
sudo nano /etc/cron.d/dsr-uploads-backup
```

```
0 3 * * * root tar -czf /var/backups/dsr-uploads-$(date +\%F).tgz -C /var/lib/dsr uploads
0 4 * * * root find /var/backups -name 'dsr-uploads-*.tgz' -mtime +14 -delete
```

Neon handles DB backups automatically — nothing to do there.

### 13.4 Uptime monitoring

Free options: UptimeRobot, Better Stack, Hetrix Tools. Point at
`https://app.dsrappai.com/api/health` with a 5-minute interval. Alert
if check fails twice in a row. Configure in their UI; no VPS-side
config needed.

### 13.5 System updates monthly

Add a calendar reminder. On the first of each month:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y
# If a kernel update lands, schedule a reboot during low-traffic hours.
```

PM2 auto-restarts the API after reboot because §9.4 was completed.

### 13.6 TLS expiry sanity check (quarterly)

```bash
sudo certbot certificates
# Confirm "Expiry Date" is more than 30 days out.
# Auto-renewal is reliable but worth a glance.
```

---

## 14. Subsequent deploys

Create the deploy script as the `dsr` user (once, then reuse forever):

```bash
sudo -iu dsr
nano ~/dsr-deploy.sh
```

Paste:

```bash
#!/bin/bash
set -e
cd /home/dsr/dsr

echo "[deploy] pulling..."
git pull --ff-only

# OPTIONAL: enable maintenance mode for risky deploys. Skip for
# code-only changes — PM2 reload is graceful.
NEEDS_MAINT=false
# Detect schema changes by looking at the diff. Crude but effective.
if git diff HEAD~1 HEAD --name-only | grep -qE '(drizzle/|src/scripts/.*migrat|schema\.js)'; then
    NEEDS_MAINT=true
fi

if [ "$NEEDS_MAINT" = "true" ]; then
    echo "[deploy] schema change detected → maintenance ON"
    dsr-maint-on
fi

echo "[deploy] installing api deps..."
cd apps/api
npm ci --omit=dev

# Run any pending migration scripts here, in order. Example:
# node src/scripts/<next-migration>.js

echo "[deploy] building web..."
cd ../web
npm ci
npm run build

echo "[deploy] reloading PM2..."
pm2 reload dsr-api

if [ "$NEEDS_MAINT" = "true" ]; then
    echo "[deploy] verifying API came up cleanly..."
    sleep 5
    if curl -sf http://localhost:5000/api/health > /dev/null; then
        dsr-maint-off
        echo "[deploy] maintenance OFF — site live"
    else
        echo "[deploy] WARNING: health check failed — leaving maintenance ON for you to debug"
        exit 1
    fi
fi

echo "[deploy] OK at $(date)"
```

```bash
chmod +x ~/dsr-deploy.sh
```

For each release: `~/dsr-deploy.sh`. PM2's `reload` is graceful — old
process keeps serving until the new one boots.

---

## 15. Rollback procedure

### 15.1 Code rollback (last known-good commit)

```bash
sudo -iu dsr
cd /home/dsr/dsr
git log --oneline -10           # find the last known-good SHA
git reset --hard <sha>
cd apps/web && npm run build
pm2 reload dsr-api
```

### 15.2 Bad migration rollback (data state)

Neon supports point-in-time branching:

1. Open console.neon.tech → your project → Branches
2. Click "Create branch" → "from point in time" → pick a timestamp
   before the bad migration
3. Copy the new branch's connection string
4. SSH to VPS, edit `.env` to use the new connection string
5. `pm2 reload dsr-api`

The bad branch (`main`) is still there — you can compare or merge
specific tables manually.

### 15.3 Emergency maintenance mode

If everything is broken and you need a clean error page while you
debug:

```bash
dsr-maint-on
# Now investigate calmly; users see the maintenance page
# When fixed:
dsr-maint-off
```

---

## 16. Troubleshooting cheatsheet

**`502 Bad Gateway`** — PM2 isn't running. `pm2 ls` to check. If down,
`pm2 logs dsr-api` and read the error. Usually a missing env var or
bad DATABASE_URL.

**`CORS error` in browser console** — `CORS_ORIGIN` doesn't match the
actual frontend origin including scheme. Must be `https://app.dsrappai.com`,
not `app.dsrappai.com`.

**Verification email never arrives** — Gmail OAuth refresh token was
revoked. Regenerate via the OAuth Playground steps in
`apps/api/.env.example`. Update `.env`, `pm2 reload dsr-api`.

**"Too many requests" from your own browser** — `trust proxy` not set
or commit not pushed. Re-run §1.2 verification.

**Cookies not sticking after login** — `BETTER_AUTH_URL` and the
actual origin don't match. Both must be `https://...`, identical
domain.

**`nginx: cannot load certificate`** — certbot never ran successfully.
DNS not pointing at VPS. `dig +short A app.dsrappai.com` and confirm.

**Build OOMs on 1 vCPU** — rare but possible if frontend grows. Add a
swap file:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Maintenance flag stuck on** — `dsr-maint-off` should remove it. If
the file persists, manually: `sudo rm -f /var/lib/dsr/maintenance.flag`.

**API stuck after PM2 reload** — graceful shutdown timeout expired.
`pm2 restart dsr-api` (hard restart). Look at `pm2 logs` for what kept
a connection open past 10 seconds.

---

## 17. Verification gate checklist

Tick each before opening §12 smoke test. If anything is unchecked, the
deploy is incomplete.

### Pre-deploy (do on your machine)

- [ ] Five §1.2 verification commands all return matches
- [ ] Neon connection string in scratch file
- [ ] Fresh `BETTER_AUTH_SECRET` generated
- [ ] `dig` confirms domain points at VPS IP
- [ ] Gmail refresh token verified by sending dev test email
- [ ] Telegram alerts confirmed from dev order creation
- [ ] Path identified — A (fresh prod project) or B (reusing dev DB)
- [ ] Path B only: `audit-parent-agency.js` run cleanly on prod DB
- [ ] Path B only: at least one `role = 'superadmin'` row exists
- [ ] `.env` draft complete, NO localhost values
- [ ] Same-origin vs subdomain decision made
- [ ] `npm test` (apps/api) passes — Tier 2 invariants green (§6.0)
- [ ] Multi-unit booking (Jumlah ≥ 2) succeeds on dev (§6.5)
- [ ] Dev-side smoke test passes (§6)
- [ ] All current work committed AND pushed to GitHub (not just the five
      §1.1 fixes — the whole Tier 2 release, §1.3)

### VPS setup (run on the VPS)

- [ ] Ubuntu updated, Node 22, PM2, nginx, ufw installed (§7)
- [ ] `dsr` user created, uploads dir at `/var/lib/dsr/uploads` (§7)
- [ ] UFW allows OpenSSH + Nginx Full only (§7)
- [ ] Repo cloned, SHA matches dev (§8.2)
- [ ] `npm ci` succeeded for both apps (§8.3)
- [ ] `.env` written with `chmod 600` (§8.4)
- [ ] Uploads symlink in place (§8.5)
- [ ] Schema initialized on prod DB (§8.6) — Path A: `npm run migrate` + `add-user-role-enum.js` ran cleanly; Path B: cleanup audits ran cleanly
- [ ] Tier 2 shared-code migration applied — Path A: included in `npm run migrate`; Path B: `npm run migrate -- orders_shared_code` run, and the "unique constraint removed" check passed (§8.6 / §1.3)
- [ ] Verified ~20 tables exist via the `pg_tables` query in §8.6
- [ ] Frontend built, `dist/index.html` exists (§8.7)
- [ ] PM2 started, `dsr-api` shows `online` (§9.3)
- [ ] PM2 boot persistence active (§9.4)
- [ ] nginx site enabled, default removed (§10.1)
- [ ] certbot issued cert, HTTPS redirect works (§10.2)

### Post-deploy smoke test (§12)

- [ ] `/api/health` returns 200 with JSON
- [ ] Landing page loads over HTTPS
- [ ] Path A only: agency "DSR Rent Car" registered → became `org_id=1` → verification link clicked
- [ ] Path B only: login as superadmin works
- [ ] Rekap Order lists orders (Path B) or is empty (Path A)
- [ ] New client registration flow works end-to-end (invite code → verification email)
- [ ] Order created via Dashboard form lands in agency Rekap
- [ ] Multi-unit booking (Jumlah ≥ 2) succeeds and appears as ONE grouped row in Rekap (proves the shared-code migration is live)
- [ ] Telegram alert fires on new order (one consolidated message for multi-vehicle)

### Post-deploy hygiene (§13)

- [ ] PM2 log rotation installed and configured
- [ ] Maintenance mode page + scripts installed (§11)
- [ ] Daily uploads backup cron in place
- [ ] Uptime monitor pointing at `/api/health`
- [ ] Calendar reminder for monthly `apt upgrade`
- [ ] Calendar reminder for quarterly `certbot certificates`

When every box is checked, the deploy is complete and durable.
