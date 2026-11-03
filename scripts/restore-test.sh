#!/usr/bin/env bash
# Restore test: loads the newest dump into a throwaway database
# (cachifa_restore_test) on the same Postgres server, counts the rows of the key
# tables and drops it. It never writes to the real database.
#
#   scripts/restore-test.sh            newest local dump (cachifa_backups volume)
#   scripts/restore-test.sh --remote   newest daily/ dump on the encrypted remote
#                                      (also proves it decrypts)
#
# Uses docker-compose.prod.yml by default. COMPOSE_FILE and COMPOSE_PROJECT_NAME
# (standard Docker Compose variables) point it at another project, e.g. a test one.
set -euo pipefail

RESTORE_DB=cachifa_restore_test
KEY_TABLES=(users accounts transactions loans loan_repayments goals goal_contributions
  financial_periods period_ledgers budgets recurring_expenses alerts _prisma_migrations)

cd "$(dirname "$0")/.."
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

source_kind=local
if [[ "${1:-}" == "--remote" ]]; then
  source_kind=remote
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--remote]" >&2
  exit 2
fi

in_backup() {
  docker compose exec -T backup "$@"
}

# Expanded inside the container, on purpose.
# shellcheck disable=SC2016
real_db=$(in_backup sh -c 'printf %s "$PGDATABASE"')
if [[ -z "$real_db" || "$real_db" == "$RESTORE_DB" ]]; then
  echo "refusing to run: PGDATABASE is '$real_db'" >&2
  exit 1
fi

if [[ "$source_kind" == remote ]]; then
  echo "→ fetching the latest daily dump from the remote"
  dump=$(in_backup cachifa-backup fetch daily | tail -n 1)
else
  dump=$(in_backup sh -c \
    "ls -1 /backups/cachifa-*.sql.gz 2>/dev/null | sort | tail -n 1")
fi
if [[ -z "$dump" ]]; then
  echo "no dump found ($source_kind)" >&2
  exit 1
fi
echo "→ dump: $dump"

psql_admin() {
  # Connected to the `postgres` maintenance DB, never to the real one.
  in_backup psql -v ON_ERROR_STOP=1 -q -d postgres "$@"
}

cleanup() {
  echo "→ dropping $RESTORE_DB"
  psql_admin -c "DROP DATABASE IF EXISTS $RESTORE_DB WITH (FORCE)" || true
  if [[ "$source_kind" == remote ]]; then
    in_backup rm -f "$dump" || true
  fi
}
trap cleanup EXIT

echo "→ creating $RESTORE_DB"
psql_admin -c "DROP DATABASE IF EXISTS $RESTORE_DB WITH (FORCE)"
psql_admin -c "CREATE DATABASE $RESTORE_DB"

echo "→ restoring (this does not touch $real_db)"
in_backup sh -c "gunzip -c '$dump' | psql -v ON_ERROR_STOP=1 -q -d $RESTORE_DB >/dev/null"

echo "→ row counts in $RESTORE_DB"
table_list=$(printf "'%s'," "${KEY_TABLES[@]}")
table_list="${table_list%,}"
# A missing key table means the dump is not a full Cachifa database: report and fail.
counts=$(in_backup psql -v ON_ERROR_STOP=1 -At -F '|' -d "$RESTORE_DB" -c "
  SELECT t,
         CASE WHEN to_regclass(format('public.%I', t)) IS NULL THEN 'MISSING'
              ELSE (xpath('/row/c/text()',
                     query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text
         END
  FROM unnest(ARRAY[$table_list]) AS t")
missing=0
while IFS='|' read -r table rows; do
  printf '   %-20s %s\n' "$table" "$rows"
  [[ "$rows" == MISSING ]] && missing=1
done <<<"$counts"
if [[ "$missing" == 1 ]]; then
  echo "✗ restore test FAILED: key tables missing from the dump" >&2
  exit 1
fi

echo "✓ restore test passed"
