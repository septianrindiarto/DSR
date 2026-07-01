#!/bin/bash
# Manual one-command deploy (fallback / for schema changes the auto-workflow skips).
#
#   ./deploy.sh             # code deploy: pull → install → build → reload
#   ./deploy.sh --migrate   # same, but also apply DB migrations (npm run migrate)
#
# Run as the dsr user on the VPS. The GitHub Actions workflow does the same
# (minus migrations) automatically on push to main.
set -e
cd /home/dsr/dsr

echo "[deploy] pulling latest…"
git pull --ff-only

echo "[deploy] installing API deps…"
cd apps/api && npm ci --omit=dev

if [ "$1" = "--migrate" ]; then
  echo "[deploy] running migrations…"
  npm run migrate
fi

echo "[deploy] building web…"
cd ../web && npm ci && npm run build

echo "[deploy] reloading API…"
pm2 reload dsr-api

echo "[deploy] done at $(date)"
