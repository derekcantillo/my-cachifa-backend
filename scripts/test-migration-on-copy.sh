#!/usr/bin/env bash
# Tests pending Prisma migrations on a throwaway copy of the production data.
# There is NO separate development database on this laptop: localhost:5432 and
# DATABASE_URL_LOCAL are production. This script never writes to it.
#
#   1. Read-only pg_dump of the production database (into a private temp dir).
#   2. Loads it into a throwaway Postgres container on 127.0.0.1:$COPY_DB_PORT.
#   3. Applies the pending migrations there (prisma migrate deploy).
#   4. Builds the API and starts it against the copy on 127.0.0.1:$COPY_API_PORT,
#      with a random API key (the real one is never used).
#   5. On exit (also on errors or Ctrl-C): stops the API, removes the container
#      and the dump, and checks that production did not change (a second
#      read-only dump must be identical to the first one).
#
#   scripts/test-migration-on-copy.sh               waits for Enter before cleaning up
#   scripts/test-migration-on-copy.sh -- <cmd...>   runs <cmd> against the copy, then cleans up
#   scripts/test-migration-on-copy.sh --no-api ...  skips step 4 (only the migration)
#
# <cmd> (or your own shell, while it waits) gets COPY_DATABASE_URL, COPY_API_URL,
# COPY_API_KEY and COPY_API_LOG (the API's output), e.g.
#   scripts/test-migration-on-copy.sh -- sh -c 'curl -s -H "X-API-Key: $COPY_API_KEY" "$COPY_API_URL/accounts"'
#
# Uses docker-compose.prod.yml by default; COMPOSE_FILE points it at another project.
# Compose names the project after the folder: from another checkout (a git worktree
# of an older commit, to compare before/after) set COMPOSE_PROJECT_NAME=my-cachifa-backend.
set -euo pipefail

COPY_CONTAINER=cachifa_migration_copy
COPY_DB=cachifa_copy
COPY_DB_PORT="${COPY_DB_PORT:-55432}"
COPY_API_PORT="${COPY_API_PORT:-3001}"
COPY_IMAGE=postgres:16-alpine

cd "$(dirname "$0")/.."
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

start_api=1
if [[ "${1:-}" == "--no-api" ]]; then
  start_api=0
  shift
fi
command=()
if [[ "${1:-}" == "--" ]]; then
  shift
  command=("$@")
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--no-api] [-- command...]" >&2
  exit 2
fi
if [[ ${#command[@]} -eq 0 && ! -t 0 ]]; then
  echo "no command given and stdin is not a terminal: pass one after --" >&2
  exit 2
fi
if [[ "$COPY_DB_PORT" == 5432 || "$COPY_API_PORT" == 3000 ]]; then
  echo "refusing to run: ports 5432 and 3000 belong to production" >&2
  exit 1
fi
if docker container inspect "$COPY_CONTAINER" >/dev/null 2>&1; then
  echo "refusing to run: container $COPY_CONTAINER already exists (docker rm -f $COPY_CONTAINER)" >&2
  exit 1
fi

# ─── Production: read only ──────────────────────────────────────────────────
# Every session opened here is read-only, so even a mistake cannot write.
in_prod() {
  docker compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres "$@"
}

prod_dump() {
  # Expanded inside the container, on purpose.
  # shellcheck disable=SC2016
  in_prod sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges'
}

# pg_dump adds a random \restrict key to each dump; everything else is stable
# while nobody writes.
fingerprint() {
  grep -Ev '^\\(un)?restrict ' | shasum -a 256 | cut -d ' ' -f 1
}

ROW_COUNTS_SQL="
  SELECT c.relname || ' ' ||
         (xpath('/row/c/text()',
           query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname"

prod_row_counts() {
  # shellcheck disable=SC2016
  in_prod sh -c 'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$0"' "$ROW_COUNTS_SQL"
}

# ─── Cleanup (always) ───────────────────────────────────────────────────────
umask 077
workdir=$(mktemp -d)
api_pid=
prod_hash_before=

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  echo
  if [[ -n "$api_pid" ]]; then
    echo "→ stopping the API on the copy"
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  echo "→ removing $COPY_CONTAINER and the dump"
  docker rm -f "$COPY_CONTAINER" >/dev/null 2>&1 || true
  if [[ -n "$prod_hash_before" ]]; then
    echo "→ checking that production did not change"
    local prod_hash_after
    prod_hash_after=$(set -o pipefail; prod_dump | fingerprint)
    if [[ $? -ne 0 ]]; then
      echo "✗ could not dump production again to check it; check it by hand" >&2
      status=1
    elif [[ "$prod_hash_after" == "$prod_hash_before" ]]; then
      echo "✓ production unchanged (same dump before and after)"
    else
      echo "✗ PRODUCTION CHANGED during the test. Row counts before → after:" >&2
      prod_row_counts >"$workdir/counts-after.txt" || true
      diff "$workdir/counts-before.txt" "$workdir/counts-after.txt" >&2 || true
      echo "  This script only reads production; the running app (cron, requests) may have written." >&2
      status=1
    fi
  fi
  rm -rf "$workdir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ─── 1. Read-only dump ──────────────────────────────────────────────────────
echo "→ read-only dump of production"
prod_dump >"$workdir/prod.sql"
prod_hash_before=$(fingerprint <"$workdir/prod.sql")
prod_row_counts >"$workdir/counts-before.txt"
echo "   $(wc -l <"$workdir/counts-before.txt" | tr -d ' ') tables, $(du -h "$workdir/prod.sql" | cut -f 1)"

# ─── 2. Throwaway Postgres ──────────────────────────────────────────────────
copy_password=$(openssl rand -hex 16)
echo "→ starting $COPY_CONTAINER on 127.0.0.1:$COPY_DB_PORT"
docker run --rm -d --name "$COPY_CONTAINER" \
  -e POSTGRES_PASSWORD="$copy_password" -e POSTGRES_DB="$COPY_DB" \
  -p "127.0.0.1:$COPY_DB_PORT:5432" "$COPY_IMAGE" >/dev/null
# Over TCP: during init the image runs a socket-only server that then restarts.
for _ in $(seq 1 60); do
  docker exec "$COPY_CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres -d "$COPY_DB" && break
  sleep 1
done
docker exec "$COPY_CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres -d "$COPY_DB"

echo "→ loading the dump into the copy"
docker exec -i "$COPY_CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$COPY_DB" \
  <"$workdir/prod.sql" >/dev/null
rm -f "$workdir/prod.sql"

# ─── 3. Pending migrations ──────────────────────────────────────────────────
COPY_DATABASE_URL="postgresql://postgres:$copy_password@127.0.0.1:$COPY_DB_PORT/$COPY_DB"
export COPY_DATABASE_URL
# Both names, so nothing that reads .env can fall back to production.
export DATABASE_URL="$COPY_DATABASE_URL" DATABASE_URL_LOCAL="$COPY_DATABASE_URL"

echo "→ migrations on the copy (before)"
pnpm exec prisma migrate status || true
echo "→ prisma migrate deploy (on the copy)"
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status

# ─── 4. API against the copy ────────────────────────────────────────────────
if [[ "$start_api" == 1 ]]; then
  echo "→ building and starting the API on 127.0.0.1:$COPY_API_PORT"
  pnpm exec prisma generate >/dev/null
  pnpm build >/dev/null
  COPY_API_KEY=$(openssl rand -hex 32)
  COPY_API_URL="http://127.0.0.1:$COPY_API_PORT/api/v1"
  COPY_API_LOG="$workdir/api.log"
  export COPY_API_KEY COPY_API_URL COPY_API_LOG
  # Variables already in the environment win over .env. The WhatsApp credentials get
  # placeholders so the copy can never message anyone; MY_WA_NUMBER stays, it is how
  # the API finds the user.
  PORT="$COPY_API_PORT" API_KEY="$COPY_API_KEY" NODE_ENV=development \
    WA_PHONE_NUMBER_ID=copy WA_ACCESS_TOKEN=copy WA_VERIFY_TOKEN=copy \
    WA_WEBHOOK_SECRET=copy \
    node -r tsconfig-paths/register dist/main >"$workdir/api.log" 2>&1 &
  api_pid=$!
  for _ in $(seq 1 60); do
    curl -sf "$COPY_API_URL/health" >/dev/null 2>&1 && break
    kill -0 "$api_pid" 2>/dev/null || break
    sleep 1
  done
  if ! curl -sf "$COPY_API_URL/health" >/dev/null 2>&1; then
    echo "✗ the API did not start; last lines of its log:" >&2
    tail -n 30 "$workdir/api.log" >&2
    exit 1
  fi
  echo "   API up (log: $workdir/api.log)"
fi

# ─── Tests ──────────────────────────────────────────────────────────────────
echo
if [[ ${#command[@]} -gt 0 ]]; then
  echo "→ running: ${command[*]}"
  "${command[@]}"
else
  # Throwaway values: the copy and its key disappear on cleanup.
  echo "   The copy stays up until you press Enter. From another terminal:"
  echo "   export COPY_DATABASE_URL='$COPY_DATABASE_URL'"
  if [[ "$start_api" == 1 ]]; then
    echo "   export COPY_API_URL='$COPY_API_URL' COPY_API_KEY='$COPY_API_KEY'"
    echo "   curl -s -H \"X-API-Key: \$COPY_API_KEY\" \"\$COPY_API_URL/accounts\""
  fi
  read -r -p "   Press Enter to clean up… " _
fi
