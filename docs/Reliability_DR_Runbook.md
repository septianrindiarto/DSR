# Reliability & Disaster Recovery Runbook

This runbook covers why logins sometimes failed (Neon), what is now in the code, and how to recover from data loss or a dead VPS. It is written for DSR's single-VPS + Neon setup.

## 1. Why the "Internal Server Error / CONNECT_TIMEOUT" happened

| Cause | What happens | Status |
|---|---|---|
| **Neon scale-to-zero** | After a few idle minutes the compute sleeps. The first query wakes it (a cold start, usually 1–3 s, slower on bad networks). | Mitigated: keep-warm + retries. |
| **Branch archived (free plan)** | A branch that has been idle a long time is archived. Waking it takes longer and can time out. | Mitigated: keep-warm during working hours, or a paid plan. |
| **Network path** | IPv6 or office LAN/proxy issues to `*.neon.tech:5432`. | Fixed: `ipv4first` + `connect_timeout: 15`. |
| **Pooler + prepared statements** | PgBouncer rejects prepared statements. | Fixed: `prepare: false`. |

Already in the code:

- `db/index.js` has connection timeouts, recycling and `prepare:false`.
- Connection errors map to a clear **503 "Database sedang tidak dapat dijangkau"** instead of a 500.
- The frontend retries session checks on 429/503.

### New in this batch

- **`GET /api/health`** now checks the database. It returns 200 when the DB answers, 503 otherwise, plus the latency, and caches the result for 10 s.
  - Point an uptime monitor at it, for example UptimeRobot or Better Stack (both have free tiers), with alerts to email or Telegram.
  - Monitor URL: `https://dsrappai.com/api/health`.
- **Keep-warm (optional).** Set these in `apps/api/.env`:

  ```
  DB_KEEP_WARM=true
  DB_KEEP_WARM_MINUTES=4
  DB_KEEP_WARM_HOURS=8-16     # WIB, both ends inclusive (08:00–16:59). Free plan: keep ≤ ~9 h/day (100 CU-h/month)
  ```

  - It pings the DB every 4 minutes during working hours, so staff don't hit cold starts.
  - It uses Neon compute hours, so check your plan's monthly allowance before turning it on.

### Long-term options

| Option | Effect | Cost |
|---|---|---|
| Keep-warm 06:00–23:00 | Almost no cold starts during the day | Uses compute hours |
| Neon paid plan (Launch) | Longer PITR window, no archiving of the main branch, configurable autosuspend | Monthly fee |
| Self-hosted Postgres on the VPS | No cold starts. You then own backups, upgrades, and disk failures. | Your time; not recommended without the DR steps below |

**Recommendation:** keep Neon. Turn on keep-warm and the uptime monitor now, and move to a paid Neon plan when real customers depend on it daily.

## 2. Backups (there was no DR mechanism before)

Targets:

- **RPO** (max data you can lose): ≤ 24 h from nightly backups. Neon's point-in-time restore (PITR) covers the last few hours (free plan ≈ 6 h; paid plans up to 7–30 days).
- **RTO** (time to be back online): ≤ 4 h for a full VPS loss.

### What is backed up

| Data | Where it lives | Backup |
|---|---|---|
| Database (orders, invoices, Books, users…) | Neon | Nightly `pg_dump`, plus Neon PITR |
| Car images | `apps/api/uploads/` | Nightly tar |
| SIM/KTP/photo, legal docs, finance files | `apps/api/uploads-private/` | Nightly tar (optionally GPG-encrypted) |
| Code | GitHub | Already off-site |
| Secrets (`apps/api/.env`) | VPS | **Manually**: keep an encrypted copy in a password manager. Never in git or the backup bucket in plain text. |
| **`DATA_ENCRYPTION_KEY`** (AES-256) | `.env` | **Critical**: without it, encrypted files and fields (SIM/KTP, legal docs, NIB/NPWP) **cannot be restored**. Store it in a password manager, separate from the backups. After a key rotation, keep the old keys in `DATA_ENCRYPTION_OLD_KEYS`. |

### Setup (one time, on the VPS as `dsr`)

```bash
sudo apt install postgresql-client-17 rclone gnupg
cp ~/DSR/ops/backup/backup.env.example ~/.dsr-backup.env && chmod 600 ~/.dsr-backup.env
nano ~/.dsr-backup.env          # Neon UNPOOLED URL, RCLONE_REMOTE, optional GPG key
rclone config                   # e.g. Google Drive or Backblaze B2 → remote "b2:dsr-backups"
~/DSR/ops/backup/backup.sh      # first run by hand, check ~/backups/
crontab -e
# 15 2 * * * /home/dsr/DSR/ops/backup/backup.sh >> /home/dsr/backups/backup.log 2>&1
```

- **Retention:** 14 daily, 8 weekly (Sunday) and 12 monthly copies.
- **Off-site:** without `RCLONE_REMOTE`, backups live on the same VPS and die with it. Set it.
- **Heartbeat:** set `BACKUP_HEARTBEAT_URL` (Healthchecks.io) to get an alert when a night is missed.

## 3. Recovery playbooks

### A. Bad data change (wrong import, mass delete) within the last hours

1. Neon console → Branches → **Restore**, or create a branch from a point in time just before the mistake.
2. Check the data on that branch with a local API pointed at it.
3. Either switch `DATABASE_URL` to the restored branch, or copy just the affected rows back. Ask before running any DML.

### B. Data loss older than the PITR window

1. Create an empty Neon branch or database, `restore-YYYYMMDD`.
2. Run `ops/backup/restore.sh ~/backups/daily/db-YYYYMMDD-0215.dump "<unpooled URL of the new branch>"`.
3. Compare the counts it prints; then switch `DATABASE_URL` and run `pm2 restart dsr-api`.

### C. VPS is gone (provider failure, disk, compromise)

1. Create a new VPS. Follow `Deployment_Master_Guide.md`: Node 22, nginx, PM2, certbot.
2. `git clone`, then `npm ci` in `apps/api` and `apps/web`, then `npm run build` in `apps/web`.
3. Restore `apps/api/.env` from the password manager.
4. `rclone copy` the latest `files-*.tar.gz` and extract it into `apps/api/` (decrypt with GPG first if used).
5. Point DNS at the new IP and run certbot. The database is on Neon, so it is unaffected.
6. Check `/api/health`, sign in, and open a SIM document.

### D. Neon region outage

Wait for Neon status, or restore the latest dump into a temporary Postgres (another Neon region or a local Docker) and point `DATABASE_URL` there. Accept up to 24 h data loss.

## 4. Drills (put these in a calendar)

| When | Drill |
|---|---|
| Monthly | Restore last night's dump into a scratch Neon branch. Run the API locally against it and open Rekap Order + Keuangan. |
| Quarterly | Rebuild the app on a throwaway VPS from git + backups (playbook C). Note the time it took. |
| After every major migration | Take a manual backup *before* `npm run migrate` on production. |

## 5. Data retention (UU PDP)

- **Customers can download their own data:** Pengaturan → Keamanan Akun → "Unduh data saya".
- **Erasure requests:** an agency admin uses Pelanggan → 👤 "Anonimkan data pribadi".
  - This removes name, contact, address and notes, and keeps orders/invoices for accounting.
- **Backups age out on their own:** 14 days / 8 weeks / 12 months. An erased customer can remain in older backups until they rotate out. Mention this in the privacy policy.
- **Sensitive reads are logged** in `activity_logs` with action `view`/`export`: opening SIM/KTP/legal/finance files and every bulk export. Review them occasionally.
- **Telegram alerts:** `TELEGRAM_MASK_CONTACT=true` sends masked phone numbers only.
