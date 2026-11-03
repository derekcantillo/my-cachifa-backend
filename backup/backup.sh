#!/bin/sh
# shellcheck shell=busybox
# Runs only inside the image (Alpine's busybox ash), which has `pipefail` and `\<`.
# Our dump names are fixed ASCII, so `ls | grep` is safe here.
# shellcheck disable=SC2010
#
# Daily backup of the Cachifa database: pg_dump → gzip → checks → rclone.
#
#   cachifa-backup schedule      Container loop (default CMD): one backup a day from
#                                BACKUP_TIME on, with retries.
#   cachifa-backup run           One backup now (same retries).
#   cachifa-backup status        Prints /status/last_backup.json.
#   cachifa-backup list          Lists the local dumps and each remote tier.
#   cachifa-backup fetch [tier]  Downloads the newest remote dump of a tier (daily by
#                                default) to /backups/restore/ and prints its path.
#
# BACKUP_RCLONE_REMOTE must be a `crypt` remote: rclone encrypts names and contents
# before uploading, so the provider never sees the data. The rclone config is mounted
# read-only from the host; it is never part of the image.
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"
BACKUP_TIME="${BACKUP_TIME:-03:00}"
BACKUP_LOCAL_KEEP="${BACKUP_LOCAL_KEEP:-7}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
BACKUP_KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-6}"
BACKUP_MAX_RETRIES="${BACKUP_MAX_RETRIES:-3}"
BACKUP_RETRY_DELAY="${BACKUP_RETRY_DELAY:-3600}"
# Tests only: also upload to weekly/ or monthly/ even if it isn't Sunday or the 1st.
BACKUP_FORCE_WEEKLY="${BACKUP_FORCE_WEEKLY:-0}"
BACKUP_FORCE_MONTHLY="${BACKUP_FORCE_MONTHLY:-0}"

BACKUP_DIR=/backups
STATUS_DIR=/status
STATUS_FILE="$STATUS_DIR/last_backup.json"
LAST_RUN_FILE="$STATUS_DIR/last_run_day"
MOUNTED_RCLONE_CONFIG="${RCLONE_CONFIG:-/config/rclone/rclone.conf}"
RCLONE_ERR=/tmp/rclone.err

LAST_ERROR=""
LAST_FILE=""
LAST_SIZE=0
LAST_TIERS=""

log() {
  printf '%s [backup] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

fail() {
  LAST_ERROR="$*"
  log "ERROR: $*"
  return 1
}

# The mounted config is read-only. rclone rewrites it when an OAuth token (Google
# Drive) is refreshed, so it works on a private copy; the refresh token in the
# original keeps working, so nothing is lost when the copy goes away.
prepare_rclone_config() {
  if [ ! -r "$MOUNTED_RCLONE_CONFIG" ]; then
    return 1
  fi
  mkdir -p /tmp/rclone
  cp "$MOUNTED_RCLONE_CONFIG" /tmp/rclone/rclone.conf
  chmod 600 /tmp/rclone/rclone.conf
  export RCLONE_CONFIG=/tmp/rclone/rclone.conf
}

# `name:` or `name:sub/dir` + a relative path.
remote_path() {
  case "$BACKUP_RCLONE_REMOTE" in
    *:) printf '%s%s' "$BACKUP_RCLONE_REMOTE" "$1" ;;
    *) printf '%s/%s' "$BACKUP_RCLONE_REMOTE" "$1" ;;
  esac
}

log_rclone_error() {
  if [ -s "$RCLONE_ERR" ]; then
    sed 's/^/    rclone: /' "$RCLONE_ERR"
  fi
}

check_config() {
  if [ -z "$BACKUP_RCLONE_REMOTE" ]; then
    fail "BACKUP_RCLONE_REMOTE is not set (e.g. cachifa-crypt:)"
    return 1
  fi
  if ! prepare_rclone_config; then
    fail "rclone config not found at $MOUNTED_RCLONE_CONFIG (mount ~/.config/cachifa-backup from the host, see DEPLOY.md §5)"
    return 1
  fi
  remote_name="${BACKUP_RCLONE_REMOTE%%:*}"
  if ! rclone listremotes 2>"$RCLONE_ERR" | grep -qx "$remote_name:"; then
    log_rclone_error
    fail "rclone remote '$remote_name:' is not defined in the mounted rclone.conf"
    return 1
  fi
  remote_type=$(rclone config show "$remote_name" 2>/dev/null | sed -n 's/^type *= *//p')
  if [ "$remote_type" != "crypt" ]; then
    log "WARNING: remote '$remote_name:' is of type '$remote_type', not 'crypt': the provider can read the dumps"
  fi
}

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r\t' '   ')"
}

# One key per line, so the previous lastSuccessAt can be read back with sed.
write_status() {
  result="$1"
  attempt="$2"
  now=$(date '+%Y-%m-%dT%H:%M:%S%z')
  if [ "$result" = ok ]; then
    last_success="$now"
  else
    last_success=$(sed -n 's/^ *"lastSuccessAt": *"\([^"]*\)".*/\1/p' "$STATUS_FILE" 2>/dev/null || true)
  fi
  {
    printf '{\n'
    printf '  "timestamp": %s,\n' "$(json_string "$now")"
    printf '  "result": %s,\n' "$(json_string "$result")"
    printf '  "file": %s,\n' "$(json_string "$LAST_FILE")"
    printf '  "sizeBytes": %s,\n' "$LAST_SIZE"
    printf '  "uploadedTo": %s,\n' "$(json_string "$LAST_TIERS")"
    printf '  "attempt": %s,\n' "$attempt"
    printf '  "maxAttempts": %s,\n' "$((BACKUP_MAX_RETRIES + 1))"
    if [ "$result" = ok ]; then
      printf '  "error": null,\n'
    else
      printf '  "error": %s,\n' "$(json_string "$LAST_ERROR")"
    fi
    if [ -n "$last_success" ]; then
      printf '  "lastSuccessAt": %s\n' "$(json_string "$last_success")"
    else
      printf '  "lastSuccessAt": null\n'
    fi
    printf '}\n'
  } >"$STATUS_FILE.tmp"
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

# Upload `file` to `tier/` and confirm the remote copy has the same size (for a
# crypt remote rclone reports the decrypted size, i.e. the local one).
upload() {
  file="$1"
  tier="$2"
  name=$(basename "$file")
  target=$(remote_path "$tier/$name")
  if ! rclone copyto "$file" "$target" 2>"$RCLONE_ERR"; then
    log_rclone_error
    fail "upload to $target failed"
    return 1
  fi
  remote_size=$(rclone lsjson "$target" 2>"$RCLONE_ERR" | grep -o '"Size":[0-9]*' | head -n 1 | cut -d: -f2)
  if [ "$remote_size" != "$LAST_SIZE" ]; then
    log_rclone_error
    fail "upload to $target not confirmed (remote size '${remote_size:-none}', local $LAST_SIZE)"
    return 1
  fi
  log "uploaded $tier/$name ($remote_size bytes, confirmed)"
}

# Keep the newest `keep` dumps of a remote tier. Names sort by date.
prune_remote() {
  tier="$1"
  keep="$2"
  if ! listing=$(rclone lsf --files-only "$(remote_path "$tier/")" 2>"$RCLONE_ERR"); then
    log_rclone_error
    log "WARNING: could not list $tier/ to apply retention; will retry next run"
    return 0
  fi
  dumps=$(printf '%s\n' "$listing" | grep -E '^cachifa-[0-9]{8}-[0-9]{6}\.sql\.gz$' | sort || true)
  total=$(printf '%s' "$dumps" | grep -c . || true)
  excess=$((total - keep))
  if [ "$excess" -le 0 ]; then
    return 0
  fi
  printf '%s\n' "$dumps" | head -n "$excess" | while read -r old; do
    if rclone deletefile "$(remote_path "$tier/$old")" 2>"$RCLONE_ERR"; then
      log "retention: deleted $tier/$old (keeping $keep)"
    else
      log_rclone_error
      log "WARNING: could not delete $tier/$old"
    fi
  done
}

prune_local() {
  dumps=$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^cachifa-[0-9]{8}-[0-9]{6}\.sql\.gz$' | sort || true)
  total=$(printf '%s' "$dumps" | grep -c . || true)
  excess=$((total - BACKUP_LOCAL_KEEP))
  if [ "$excess" -le 0 ]; then
    return 0
  fi
  printf '%s\n' "$dumps" | head -n "$excess" | while read -r old; do
    rm -f "$BACKUP_DIR/$old"
    log "retention: deleted local $old (keeping $BACKUP_LOCAL_KEEP)"
  done
}

tiers_for_today() {
  tiers="daily"
  if [ "$(date +%u)" = 7 ] || [ "$BACKUP_FORCE_WEEKLY" = 1 ]; then
    tiers="$tiers weekly"
  fi
  if [ "$(date +%d)" = 01 ] || [ "$BACKUP_FORCE_MONTHLY" = 1 ]; then
    tiers="$tiers monthly"
  fi
  printf '%s' "$tiers"
}

keep_for() {
  case "$1" in
    daily) printf '%s' "$BACKUP_KEEP_DAILY" ;;
    weekly) printf '%s' "$BACKUP_KEEP_WEEKLY" ;;
    monthly) printf '%s' "$BACKUP_KEEP_MONTHLY" ;;
  esac
}

backup_once() {
  attempt="$1"
  LAST_ERROR=""
  LAST_FILE=""
  LAST_SIZE=0
  LAST_TIERS=""
  check_config || return 1

  name="cachifa-$(date +%Y%m%d-%H%M%S).sql.gz"
  file="$BACKUP_DIR/$name"
  partial="$BACKUP_DIR/.$name.partial"
  mkdir -p "$BACKUP_DIR"

  log "attempt $attempt/$((BACKUP_MAX_RETRIES + 1)): dumping $PGDATABASE on $PGHOST"
  # Same flags as the manual dump in DEPLOY.md: restorable over an existing database.
  if ! (set -o pipefail; pg_dump --clean --if-exists --no-password 2>/tmp/pg_dump.err | gzip -c >"$partial"); then
    sed 's/^/    /' /tmp/pg_dump.err
    rm -f "$partial"
    fail "pg_dump failed"
    return 1
  fi

  if ! gzip -t "$partial" 2>/tmp/gzip.err; then
    sed 's/^/    gzip: /' /tmp/gzip.err
    rm -f "$partial"
    fail "gzip -t failed: the dump is corrupt"
    return 1
  fi
  if ! gunzip -c "$partial" | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
    rm -f "$partial"
    fail "the dump is incomplete (no 'dump complete' marker)"
    return 1
  fi
  LAST_SIZE=$(wc -c <"$partial" | tr -d ' ')
  if [ "$LAST_SIZE" -le 0 ]; then
    rm -f "$partial"
    fail "the dump is empty"
    return 1
  fi
  mv "$partial" "$file"
  LAST_FILE="$name"
  log "dump ok: $name ($LAST_SIZE bytes, gzip -t passed)"

  for tier in $(tiers_for_today); do
    upload "$file" "$tier" || return 1
    LAST_TIERS="${LAST_TIERS:+$LAST_TIERS }$tier"
  done
  # Retention only where something was added: a tier that got no new dump can't
  # have gone over its limit.
  for tier in $LAST_TIERS; do
    prune_remote "$tier" "$(keep_for "$tier")"
  done
  prune_local
}

run_with_retries() {
  attempt=1
  max=$((BACKUP_MAX_RETRIES + 1))
  while :; do
    if backup_once "$attempt"; then
      write_status ok "$attempt"
      log "backup OK: $LAST_FILE → $LAST_TIERS"
      return 0
    fi
    write_status error "$attempt"
    if [ "$attempt" -ge "$max" ]; then
      log "ERROR: backup FAILED after $max attempts: $LAST_ERROR (next try at the next scheduled run)"
      return 1
    fi
    log "retrying in ${BACKUP_RETRY_DELAY}s (retry $attempt of $BACKUP_MAX_RETRIES)"
    sleep "$BACKUP_RETRY_DELAY"
    attempt=$((attempt + 1))
  done
}

# Once a day, at BACKUP_TIME or the first moment after it the container is up: a
# laptop asleep at 03:00 catches up when it wakes instead of skipping the day.
schedule() {
  mkdir -p "$BACKUP_DIR" "$STATUS_DIR"
  log "scheduler started: daily at $BACKUP_TIME ($TZ), remote '$BACKUP_RCLONE_REMOTE'," \
    "keep local $BACKUP_LOCAL_KEEP, remote $BACKUP_KEEP_DAILY daily / $BACKUP_KEEP_WEEKLY weekly / $BACKUP_KEEP_MONTHLY monthly"
  check_config || log "fix the configuration above; the scheduled run will fail until then"
  while :; do
    today=$(date +%F)
    now=$(date +%H:%M)
    last_run=$(cat "$LAST_RUN_FILE" 2>/dev/null || true)
    # HH:MM strings compare in time order.
    if [ "$today" != "$last_run" ] && ! [ "$now" \< "$BACKUP_TIME" ]; then
      printf '%s\n' "$today" >"$LAST_RUN_FILE"
      run_with_retries || true
    fi
    sleep 30
  done
}

latest_remote() {
  tier="${1:-daily}"
  rclone lsf --files-only "$(remote_path "$tier/")" 2>"$RCLONE_ERR" |
    grep -E '^cachifa-[0-9]{8}-[0-9]{6}\.sql\.gz$' | sort | tail -n 1
}

case "${1:-schedule}" in
  schedule) schedule ;;
  run) run_with_retries ;;
  status) cat "$STATUS_FILE" 2>/dev/null || echo '{"result": null, "note": "no backup has run yet"}' ;;
  list)
    check_config
    echo "local ($BACKUP_DIR):"
    ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^cachifa-.*\.sql\.gz$' | sort | sed 's/^/  /' || true
    for tier in daily weekly monthly; do
      echo "remote $tier/:"
      rclone lsf --files-only "$(remote_path "$tier/")" 2>/dev/null | sort | sed 's/^/  /' || true
    done
    ;;
  fetch)
    check_config
    tier="${2:-daily}"
    name=$(latest_remote "$tier")
    if [ -z "$name" ]; then
      log_rclone_error
      fail "no dump found in $tier/"
    fi
    mkdir -p "$BACKUP_DIR/restore"
    rclone copyto "$(remote_path "$tier/$name")" "$BACKUP_DIR/restore/$name" >&2
    gzip -t "$BACKUP_DIR/restore/$name"
    printf '%s\n' "$BACKUP_DIR/restore/$name"
    ;;
  *)
    echo "usage: cachifa-backup [schedule|run|status|list|fetch [daily|weekly|monthly]]" >&2
    exit 2
    ;;
esac
