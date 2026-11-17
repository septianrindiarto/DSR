#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DSR Solution — restore a database backup INTO A TARGET YOU CHOOSE.
#
#   ops/backup/restore.sh <db-dump-file> <TARGET_DATABASE_URL>
#
# Always restore into a NEW, EMPTY database first (e.g. a new Neon branch
# "restore-test"), check it, then point DATABASE_URL at it. Never restore over
# the live database. Monthly restore drill: run this against a scratch branch
# and open the app against it for 10 minutes.
# Encrypted dumps (*.gpg) are decrypted on the fly.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
DUMP="${1:?usage: restore.sh <dump> <TARGET_DATABASE_URL>}"
TARGET="${2:?usage: restore.sh <dump> <TARGET_DATABASE_URL>}"
read -r -p "Restore $DUMP into the target database? Existing objects there will be replaced. Type YES: " ok
[ "$ok" = "YES" ] || { echo "aborted"; exit 1; }
if [[ "$DUMP" == *.gpg ]]; then
  gpg --batch -d "$DUMP" | pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET"
else
  pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET" "$DUMP"
fi
psql "$TARGET" -c "SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM invoices) AS invoices, (SELECT COUNT(*) FROM book_transactions) AS journals;"
echo "restore finished — verify the counts above against production before switching."
