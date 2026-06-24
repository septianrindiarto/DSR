# DSR Solution — VPS Deployment Walkthrough

**Prereq:** every box in `Pre_Deployment_Checklist.md` ticked. If you
came here without doing the checklist, go back.

**Target:** Ubuntu 22.04 LTS VPS, 2 vCPU / 2 GB RAM / 40 GB disk minimum.
This walkthrough runs API and web on the same machine behind nginx.

**Time:** ~60–90 minutes end to end if no DNS surprises.

Run the steps in order. Each section assumes the previous one succeeded.

---

## Step 1 — Provision the VPS basics

SSH into the VPS as `root` (or whatever sudo-capable user your provider
created).

```bash
apt update && apt upgrade -y
apt install -y curl git nginx ufw fail2ban
```

Install Node 22 LTS from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # verify v22.x.x
```

Install PM2 globally:

```bash
npm install -g pm2
pm2 -v   # verify
```

Create the dedicated app user (don't run prod as root):

```bash
adduser --disabled-password --gecos "" dsr
usermod -aG www-data dsr
mkdir -p /var/lib/dsr/uploads
chown -R dsr:dsr /var/lib/dsr
```

Open the firewall to SSH + HTTP/HTTPS only:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status   # should list 22, 80, 443
```

---

## Step 2 — Clone repo + install dependencies

Switch to the `dsr` user:

```bash
sudo -iu dsr
```

Clone the repo to the user's home directory. Use whichever git host you
push to:

```bash
cd ~
git clone https://your-git-host/dsr.git
cd dsr
git log -1 --oneline   # confirm the SHA has the five pre-deploy fixes
```

Install api dependencies (prod-only, skip devDependencies):

```bash
cd ~/dsr/apps/api
npm ci --omit=dev
```

Install web dependencies (need dev deps for the build step):

```bash
cd ~/dsr/apps/web
npm ci
```

Don't run `npm run build` yet — we need `.env.production` set first.

---

## Step 3 — Write the production .env

Create the file with the values from your scratch file (Pre-Deployment
Checklist §5):

```bash
nano /home/dsr/dsr/apps/api/.env
```

Paste the full contents, save (Ctrl+O, Enter, Ctrl+X).

Lock it down — readable only by the `dsr` user:

```bash
chmod 600 /home/dsr/dsr/apps/api/.env
ls -l /home/dsr/dsr/apps/api/.env   # should show -rw-------
```

---

## Step 4 — Build the frontend

If you chose same-origin (recommended), tell Vite to use relative `/api`
paths:

```bash
cd ~/dsr/apps/web
echo "VITE_API_BASE=" > .env.production
npm run build
```

The build output lands in `apps/web/dist/`. Verify it's there:

```bash
ls dist/index.html
```

If you went split-subdomain, use the API URL instead:

```bash
echo "VITE_API_BASE=https://api.dsrappai.com" > .env.production
npm run build
```

---

## Step 5 — Wire the uploads volume

The deploy tree shouldn't own user-uploaded data. Symlink to the external
volume created in Step 1:

```bash
cd ~/dsr/apps/api
# If the cloned repo has an empty uploads/ (or one with .gitkeep), drop it
rm -rf uploads
ln -s /var/lib/dsr/uploads uploads
ls -la uploads   # should be a symlink to /var/lib/dsr/uploads
```

If you're migrating from another host with existing photos, `scp` them
into `/var/lib/dsr/uploads/` before this step.

---

## Step 6 — Run database migrations and audits

Before starting the API for the first time, make sure the prod DB is in
the right state:

```bash
cd ~/dsr/apps/api
node src/scripts/audit-parent-agency.js
```

You should see the BEFORE/AFTER table and a "✓" line saying everything
is already set or backfilled. Re-running is idempotent.

If you have any other pending migration scripts, run them now in order.
Check `apps/api/src/scripts/` for what's there.

---

## Step 7 — Start PM2

Create the PM2 ecosystem file:

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
        max_memory_restart: '512M',
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

Save. Prepare the log directory:

```bash
exit   # back to root user
mkdir -p /var/log/pm2
chown dsr:dsr /var/log/pm2
sudo -iu dsr
```

Start the API:

```bash
pm2 start ~/dsr/ecosystem.config.cjs
pm2 ls   # should show dsr-api online
pm2 logs dsr-api --lines 30   # confirm "🚗 DSR Solution API running on http://localhost:5000"
```

Wire PM2 to start on reboot. PM2 prints the exact command — copy and run
it as root:

```bash
pm2 startup systemd -u dsr --hp /home/dsr
# Copy the printed sudo line and run it as root, e.g.:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u dsr --hp /home/dsr
```

Save the current process list so PM2 restores it after reboot:

```bash
pm2 save
```

---

## Step 8 — nginx config

Back to root for nginx work. Create the site config:

```bash
exit   # back to root
nano /etc/nginx/sites-available/dsr
```

Paste (replace `app.dsrappai.com` with your domain):

```nginx
server {
    listen 80;
    server_name app.dsrappai.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.dsrappai.com;

    # certbot fills these in on Step 9
    ssl_certificate     /etc/letsencrypt/live/app.dsrappai.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.dsrappai.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    root /home/dsr/dsr/apps/web/dist;
    index index.html;

    location /api/ {
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
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:js|css|woff2?|ttf|png|jpg|jpeg|gif|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 12M;
}
```

Important: at this point the SSL paths don't exist yet, so nginx won't
reload cleanly. We'll fix that in Step 9.

Enable the site:

```bash
ln -s /etc/nginx/sites-available/dsr /etc/nginx/sites-enabled/dsr
rm /etc/nginx/sites-enabled/default   # remove the default site
```

---

## Step 9 — TLS via Let's Encrypt

Install certbot and the nginx plugin:

```bash
apt install -y certbot python3-certbot-nginx
```

Run certbot — it will read your nginx config, request a cert, fill in
the `ssl_certificate` lines, and reload nginx:

```bash
certbot --nginx -d app.dsrappai.com
```

Choose to redirect HTTP to HTTPS when prompted (option 2). Certbot will
edit `/etc/nginx/sites-available/dsr` automatically.

Verify auto-renewal:

```bash
systemctl status certbot.timer
# Should be active. Renewal runs twice daily; only re-issues when <30 days remain.
```

Test config and reload:

```bash
nginx -t && systemctl reload nginx
```

---

## Step 10 — Smoke test

From your laptop, not the VPS:

```bash
curl https://app.dsrappai.com/api/health
# Expected: {"status":"ok","timestamp":"2026-06-19T..."}
```

Then open `https://app.dsrappai.com` in a browser:

1. Landing page loads with car catalog (or the empty fleet message if
   the DB has no cars yet).
2. Click "Masuk" → log in as the superadmin (created in
   Pre-Deployment §4).
3. Dashboard renders. Open Pengaturan → confirm your profile loads.
4. Open Rekap Order → confirm the orders that exist appear.
5. Sign out → register a new test account (fresh email) → confirm the
   verification email arrives.
6. Click the verification link → log in → create an order from the
   Dashboard form.
7. Sign back in as the agency admin → confirm the test order appears
   in Rekap.
8. Confirm the Telegram bot sent an order-created alert.

If any step fails, check `pm2 logs dsr-api --lines 100` and
`/var/log/nginx/error.log` for clues. Most first-deploy issues are
typos in `.env` (the wrong `BETTER_AUTH_URL`, a missing comma in
`CORS_ORIGIN`, etc).

---

## Step 11 — Post-deploy hygiene (do once)

Install pm2-logrotate so the logs don't fill the disk:

```bash
sudo -iu dsr
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

Add a daily uploads backup cron (as root):

```bash
exit
nano /etc/cron.d/dsr-uploads-backup
```

Paste:

```
0 3 * * * root tar -czf /var/backups/dsr-uploads-$(date +\%F).tgz -C /var/lib/dsr uploads
0 4 * * * root find /var/backups -name 'dsr-uploads-*.tgz' -mtime +14 -delete
```

Add an uptime monitor — point UptimeRobot or Better Stack at
`https://app.dsrappai.com/api/health` with a 5-minute interval. Alert if
the check fails twice in a row.

---

## Step 12 — Subsequent deploys

Once the first deploy succeeds, future releases use this script. Create
it as the `dsr` user:

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

echo "[deploy] installing api deps..."
cd apps/api
npm ci --omit=dev

# Run any pending migration scripts here, in order.
# Example:
# node src/scripts/<next-migration>.js

echo "[deploy] building web..."
cd ../web
npm ci
npm run build

echo "[deploy] reloading PM2..."
pm2 reload dsr-api

echo "[deploy] OK at $(date)"
```

```bash
chmod +x ~/dsr-deploy.sh
```

For each release: `~/dsr-deploy.sh`. PM2's `reload` is graceful — old
process keeps serving until the new one boots.

---

## Rollback plan

If a deploy ships broken code:

```bash
sudo -iu dsr
cd /home/dsr/dsr
git log --oneline -10   # find last known-good SHA
git reset --hard <sha>
cd apps/web && npm run build
pm2 reload dsr-api
```

If a migration corrupted data, Neon supports branching to a point-in-time
snapshot via console.neon.tech — fork the prod branch to a checkpoint
before the bad migration, swap the connection string in `.env`, restart.

---

## Troubleshooting first-deploy mistakes

**`502 Bad Gateway`** — PM2 isn't running or crashed. `pm2 ls`. If down,
`pm2 logs dsr-api` and look for the actual error (usually a missing env
var or bad DATABASE_URL).

**`CORS error in browser console`** — `CORS_ORIGIN` doesn't match the
actual frontend origin including scheme. `https://app.dsrappai.com`, not
`app.dsrappai.com`.

**Verification email never arrives** — Gmail OAuth refresh token was
revoked. Re-run the OAuth Playground flow from `.env.example` step 5,
update `GMAIL_OAUTH_REFRESH_TOKEN`, `pm2 reload dsr-api`.

**`Too many requests` from your own browser** — `trust proxy` not set in
the build, so the rate limiter is bucketing every request as 127.0.0.1.
Verify §1 of the Pre-Deployment Checklist; the line should be in the
committed code.

**Cookies not sticking** — `BETTER_AUTH_URL` and the actual origin don't
match. Both must be `https://...`, exactly the same domain.

**`nginx: [emerg] cannot load certificate`** — `certbot --nginx` never
ran or failed. DNS isn't pointing at the VPS yet. `dig app.dsrappai.com`
and confirm.
