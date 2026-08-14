#!/usr/bin/env bash
#
# A disposable local Postgres for the integration suite (tests/db/).
#
#   ./scripts/scratch-db.sh start     # start it, print the connection URL
#   ./scripts/scratch-db.sh stop      # stop it
#   ./scripts/scratch-db.sh destroy   # stop it and delete the data directory
#   ./scripts/scratch-db.sh test      # start if needed, then run the whole suite
#
# The cluster lives in .scratch-db/ (git-ignored) and holds nothing you would
# miss. The tests truncate everything they touch, so pointing them at anything
# real would be a bad idea — this exists so you never have to.
#
# Needs initdb/pg_ctl/psql on PATH (Postgres.app, Homebrew, or a system install).
# Listens on TCP only: a Unix socket path under a long repo path can exceed the
# 103-byte limit Postgres allows.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/.scratch-db/data"
LOG="$ROOT/.scratch-db/postgres.log"
PORT="${LMS_SCRATCH_DB_PORT:-55432}"
DB=lms_test
URL="postgres://postgres@127.0.0.1:$PORT/$DB"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: $1 not found on PATH — install PostgreSQL first." >&2
    exit 1
  }
}

running() {
  pg_ctl -D "$DATA" status >/dev/null 2>&1
}

start() {
  need initdb; need pg_ctl; need psql

  if [ ! -d "$DATA" ]; then
    echo "creating a scratch cluster in $DATA ..." >&2
    mkdir -p "$(dirname "$DATA")"
    initdb -D "$DATA" -U postgres --auth=trust >/dev/null
  fi

  if ! running; then
    echo "starting Postgres on port $PORT ..." >&2
    if ! pg_ctl -D "$DATA" -l "$LOG" \
         -o "-p $PORT -h 127.0.0.1 -c unix_socket_directories=''" start >/dev/null
    then
      # Almost always a port clash with another Postgres. Say so rather than
      # carrying on and quietly running the tests against somebody else's
      # cluster — which is how a test suite ends up truncating real tables.
      echo "error: could not start Postgres on port $PORT." >&2
      echo "       something else is probably using it; set LMS_SCRATCH_DB_PORT" >&2
      echo "       to a free port, or stop the other server." >&2
      [ -f "$LOG" ] && { echo "--- $LOG ---" >&2; tail -5 "$LOG" >&2; }
      exit 1
    fi
  fi

  # The suite applies db/lms-schema.sql and db/settlement-fn.sql itself; both are
  # re-runnable, so an existing database is fine to reuse.
  #
  # -tAc and an exact comparison, rather than piping into grep: psql's default
  # output is padded and decorated, and `grep -q 1` would match a "1" anywhere
  # in it — a row count, a port number in a notice, a database whose name
  # happens to contain a 1. That reads "already exists" for a database that does
  # not, and the suite then fails to connect for no visible reason.
  local exists
  exists="$(psql -X -tAc "select 1 from pg_database where datname = '$DB'" \
              -h 127.0.0.1 -p "$PORT" -U postgres -d postgres \
            | tr -d '[:space:]')"
  if [ "$exists" != "1" ]; then
    psql -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d postgres \
      -c "create database $DB" >/dev/null
  fi

  echo "$URL"
}

case "${1:-start}" in
  start)
    start
    echo >&2
    echo "run the integration suite with:" >&2
    echo "  LMS_TEST_DATABASE_URL=$URL npm test" >&2
    ;;
  stop)
    running && pg_ctl -D "$DATA" stop >/dev/null && echo "stopped." >&2 || \
      echo "not running." >&2
    ;;
  destroy)
    running && pg_ctl -D "$DATA" stop >/dev/null || true
    rm -rf "$ROOT/.scratch-db"
    echo "destroyed." >&2
    ;;
  test)
    # Not `URL="$(start)"`: a failure inside a command substitution does not
    # reliably trip `set -e` on every bash we might be run under, and a silently
    # empty URL would make the suite skip itself and report green.
    start >/dev/null
    cd "$ROOT"
    LMS_TEST_DATABASE_URL="$URL" npm test
    ;;
  *)
    echo "usage: $0 {start|stop|destroy|test}" >&2
    exit 1
    ;;
esac
