#!/usr/bin/env bash
# Restore test: loads a dump into a throwaway database (cachifa_restore_test) on
# the same Postgres server, counts the rows of the key tables and drops it. It
# never writes to the real database: the real one is only read, in read-only
# sessions, by --compare.
#
#   scripts/restore-test.sh                newest local dump (cachifa_backups volume)
#   scripts/restore-test.sh --remote       newest daily/ dump on the encrypted remote
#                                          (also proves it decrypts)
#   scripts/restore-test.sh --file <path>  a .sql.gz on this machine (scripts/backup-now.sh)
#   ... --compare                          also compares the counts with the real
#                                          database and fails if they differ
#
# Uses docker-compose.prod.yml by default. COMPOSE_FILE and COMPOSE_PROJECT_NAME
# (standard Docker Compose variables) point it at another project, e.g. a test one.
set -euo pipefail

RESTORE_DB=cachifa_restore_test
KEY_TABLES=(users accounts transactions loans loan_repayments goals goal_contributions
  financial_periods period_ledgers budgets recurring_expenses alerts _prisma_migrations)

cd "$(dirname "$0")/.."
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

usage() {
  echo "usage: $0 [--remote | --file <path.sql.gz>] [--compare]" >&2
  exit 2
}

source_kind=local
file=
compare=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote) source_kind=remote ;;
    --file)
      [[ $# -ge 2 ]] || usage
      source_kind=file
      file="$2"
      shift
      ;;
    --compare) compare=1 ;;
    *) usage ;;
  esac
  shift
done
if [[ "$source_kind" == file && ! -r "$file" ]]; then
  echo "cannot read $file" >&2
  exit 1
fi

in_backup() {
  docker compose exec -T backup "$@"
}

# psql runs in the postgres container, as POSTGRES_USER over the local socket.
# Expanded inside the container, on purpose.
# shellcheck disable=SC2016
in_psql() { # <db> [psql args...]
  docker compose exec -T -e PGOPTIONS="${PGOPTIONS:-}" postgres \
    sh -c 'db="$1"; shift; exec psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$db" "$@"' sh "$@"
}

# Connected to the `postgres` maintenance DB, never to the real one.
psql_admin() {
  PGOPTIONS='-c client_min_messages=warning' in_psql postgres "$@"
}

# Read-only session: even a mistake cannot write.
psql_read_only() { # <db> [psql args...]
  PGOPTIONS='-c default_transaction_read_only=on' in_psql "$@"
}

# shellcheck disable=SC2016
real_db=$(docker compose exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')
if [[ -z "$real_db" || "$real_db" == "$RESTORE_DB" ]]; then
  echo "refusing to run: POSTGRES_DB is '$real_db'" >&2
  exit 1
fi

dump=
case "$source_kind" in
  remote)
    echo "→ fetching the latest daily dump from the remote"
    dump=$(in_backup cachifa-backup fetch daily | tail -n 1)
    ;;
  local)
    dump=$(in_backup sh -c "ls -1 /backups/cachifa-*.sql.gz 2>/dev/null | sort | tail -n 1")
    ;;
  file) dump="$file" ;;
esac
if [[ -z "$dump" ]]; then
  echo "no dump found ($source_kind)" >&2
  exit 1
fi
echo "→ dump: $dump"

# The uncompressed dump on stdout. Local and remote dumps live in the backup
# container; --file reads from this machine.
stream_dump() {
  if [[ "$source_kind" == file ]]; then
    gunzip -c "$dump"
  else
    in_backup gunzip -c "$dump"
  fi
}

cleanup() {
  echo "→ dropping $RESTORE_DB"
  psql_admin -c "DROP DATABASE IF EXISTS $RESTORE_DB WITH (FORCE)" || true
  if [[ "$source_kind" == remote ]]; then
    in_backup rm -f "$dump" || true
  fi
}
trap cleanup EXIT

# A dump that switches database (\connect, or CREATE DATABASE from pg_dump -C)
# would restore into the real one. grep -c reads the whole stream, so the
# pipeline status is not hidden by an early exit.
switches=$(stream_dump | grep -cE '^(\\connect|\\c |CREATE DATABASE)' || true)
if [[ "$switches" != 0 ]]; then
  echo "refusing to restore: the dump switches database ($switches line(s) with \\connect or CREATE DATABASE)" >&2
  exit 1
fi

echo "→ creating $RESTORE_DB"
psql_admin -c "DROP DATABASE IF EXISTS $RESTORE_DB WITH (FORCE)"
psql_admin -c "CREATE DATABASE $RESTORE_DB"

echo "→ restoring (this does not touch $real_db)"
stream_dump | in_psql "$RESTORE_DB" >/dev/null

table_list=$(printf "'%s'," "${KEY_TABLES[@]}")
table_list="${table_list%,}"
# A missing key table shows as MISSING.
COUNT_SQL="
  SELECT t,
         CASE WHEN to_regclass(format('public.%I', t)) IS NULL THEN 'MISSING'
              ELSE (xpath('/row/c/text()',
                     query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text
         END
  FROM unnest(ARRAY[$table_list]) AS t"

count_rows() { # <db>
  psql_read_only "$1" -At -F '|' -c "$COUNT_SQL"
}

restored=$(count_rows "$RESTORE_DB")
if [[ "$compare" == 1 ]]; then
  real=$(count_rows "$real_db")
fi

echo "→ row counts in $RESTORE_DB"
missing=0
mismatch=0
while IFS='|' read -r table rows; do
  if [[ "$compare" == 1 ]]; then
    real_rows=$(awk -F '|' -v t="$table" '$1 == t { print $2 }' <<<"$real")
    mark=
    if [[ "$rows" != "$real_rows" ]]; then
      mark="  ← $real_db has $real_rows"
      mismatch=1
    fi
    printf '   %-20s %8s%s\n' "$table" "$rows" "$mark"
  else
    printf '   %-20s %s\n' "$table" "$rows"
  fi
  [[ "$rows" == MISSING ]] && missing=1
done <<<"$restored"

if [[ "$missing" == 1 ]]; then
  echo "✗ restore test FAILED: key tables missing from the dump" >&2
  exit 1
fi
if [[ "$mismatch" == 1 ]]; then
  echo "✗ restore test FAILED: the counts differ from $real_db (if the app wrote since the dump, run it again)" >&2
  exit 1
fi
if [[ "$compare" == 1 ]]; then
  echo "✓ restore test passed: same row counts as $real_db"
else
  echo "✓ restore test passed"
fi
