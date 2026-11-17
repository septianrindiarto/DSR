#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DSR Solution — nightly backup (database + private/public uploads)
#
# What it does
#   1. pg_dump of the Neon database (custom format, compressed)
#   2. tar.gz of apps/api/uploads and apps/api/uploads-private
#   3. optional off-site copy with rclone (Google Drive / S3 / Backblaze B2)
#   4. retention: 14 daily, 8 weekly (Sunday), 12 monthly (1st of month)
#
# Setup (once, on the VPS as user dsr):
#   sudo apt install postgresql-client-17 rclone     # pg_dump >= Neon's PG version
#   cp ops/backup/backup.env.example ~/.dsr-backup.env && chmod 600 ~/.dsr-backup.env
#   edit ~/.dsr-backup.env   (UNPOOLED Neon URL — not the -pooler host)
#   crontab -e →  15 2 * * * /home/dsr/dsr/ops/backup/backup.sh >> /home/dsr/backups/backup.log 2>&1
#   (set APP_DIR=/home/dsr/dsr/apps/api in ~/.dsr-backup.env; uploads are symlinks → tar -h follows them)
#
# Nothing here reads or prints apps/api/.env.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ENV_FILE="${DSR_BACKUP_ENV:-$HOME/.dsr-backup.env}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL (unpooled) in $ENV_FILE}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
APP_DIR="${APP_DIR:-$HOME/DSR/apps/api}"
STAMP="$(TZ=Asia/Jakarta date +%Y%m%d-%H%M)"
DOW="$(TZ=Asia/Jakarta date +%u)"   # 7 = Sunday
DOM="$(TZ=Asia/Jakarta date +%d)"

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
umask 077
DB_FILE="$BACKUP_DIR/daily/db-$STAMP.dump"
FILES_FILE="$BACKUP_DIR/daily/files-$STAMP.tar.gz"

echo "[$(date -Is)] backup start"
pg_dump --format=custom --compress=9 --no-owner --no-privileges -d "$BACKUP_DATABASE_URL" -f "$DB_FILE"
pg_restore --list "$DB_FILE" > /dev/null   # integrity check: archive is readable
tar -czhf "$FILES_FILE" -C "$APP_DIR" $( [ -d "$APP_DIR/uploads" ] && echo uploads ) $( [ -d "$APP_DIR/uploads-private" ] && echo uploads-private ) 2>/dev/null || true

# Optional encryption at rest (recommended for off-site): set BACKUP_GPG_RECIPIENT.
if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  for f in "$DB_FILE" "$FILES_FILE"; do gpg --batch --yes -r "$BACKUP_GPG_RECIPIENT" -o "$f.gpg" -e "$f" && rm -f "$f"; done
  DB_FILE="$DB_FILE.gpg"; FILES_FILE="$FILES_FILE.gpg"
fi

[ "$DOW" = "7" ] && cp "$DB_FILE" "$FILES_FILE" "$BACKUP_DIR/weekly/"
[ "$DOM" = "01" ] && cp "$DB_FILE" "$FILES_FILE" "$BACKUP_DIR/monthly/"

# Retention
ls -1t "$BACKUP_DIR"/daily/db-*   2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/daily/files-* 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/weekly/db-*  2>/dev/null | tail -n +9  | xargs -r rm -f
ls -1t "$BACKUP_DIR"/weekly/files-* 2>/dev/null | tail -n +9 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/monthly/db-* 2>/dev/null | tail -n +13 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/monthly/files-* 2>/dev/null | tail -n +13 | xargs -r rm -f

# Off-site copy (the VPS itself can be lost — keep a copy elsewhere).
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone sync "$BACKUP_DIR" "$RCLONE_REMOTE" --exclude "backup.log" --transfers 2
fi

# Optional heartbeat (e.g. Healthchecks.io / Better Stack) — alerts if a night is missed.
[ -n "${BACKUP_HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$BACKUP_HEARTBEAT_URL" > /dev/null || true
echo "[$(date -Is)] backup ok: $(du -h "$DB_FILE" | cut -f1) db, $(du -h "$FILES_FILE" | cut -f1) files"
