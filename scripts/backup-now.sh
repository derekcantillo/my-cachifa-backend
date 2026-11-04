#!/usr/bin/env bash
# One-off verified backup, without rclone: for when the backup service
# (DEPLOY.md §5) is not ready yet and a migration or data fix needs a backup
# from today (docs/design-liabilities.md G.1).
#
#   1. pg_dump of production in a read-only session (as DEPLOY.md §5.7) into
#      ~/cachifa-backups/cachifa-YYYYMMDD-HHMM.sql.gz, mode 600.
#   2. Checks it: gzip -t, size > 0 and the pg_dump end marker.
#   3. scripts/restore-test.sh --file <dump> --compare: restores it into the
#      throwaway cachifa_restore_test, compares the key table counts with
#      production and drops the throwaway database.
#
# It never writes to the real database. The file stays on this laptop: copy it
# somewhere else, or it is not a backup.
#
#   scripts/backup-now.sh
#
# BACKUP_NOW_DIR changes the folder; COMPOSE_FILE points it at another project.
set -euo pipefail

cd "$(dirname "$0")/.."
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
dir="${BACKUP_NOW_DIR:-$HOME/cachifa-backups}"

umask 077
mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/cachifa-$(date +%Y%m%d-%H%M).sql.gz"
if [[ -e "$file" ]]; then
  echo "refusing to overwrite $file (wait a minute or move it)" >&2
  exit 1
fi

partial="$file.partial"
trap 'rm -f "$partial"' EXIT

echo "→ read-only dump of production → $file"
# Expanded inside the container, on purpose. Same flags as the backup service.
# shellcheck disable=SC2016
docker compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  | gzip -c >"$partial"
chmod 600 "$partial"

echo "→ checking the file"
if ! gzip -t "$partial"; then
  echo "✗ gzip -t failed: the dump is corrupt" >&2
  exit 1
fi
if [[ ! -s "$partial" ]]; then
  echo "✗ the dump is empty" >&2
  exit 1
fi
if ! gunzip -c "$partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  echo "✗ the dump is incomplete (no end marker from pg_dump)" >&2
  exit 1
fi
mv "$partial" "$file"
trap - EXIT

echo "→ restore test"
if ! scripts/restore-test.sh --file "$file" --compare; then
  echo "✗ the dump was saved but did NOT pass the restore test: $file" >&2
  exit 1
fi

size=$(wc -c <"$file" | tr -d ' ')
sha=$(shasum -a 256 "$file" | cut -d ' ' -f 1)
cat <<SUMMARY

✓ backup verified
   file    $file
   size    $size bytes
   sha256  $sha

⚠  It is still on the same disk as the database: copy it off this laptop
   (Drive, a USB drive…) before migrating or fixing data. A dump that lives
   next to the database is not a backup.
SUMMARY
