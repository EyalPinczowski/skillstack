#!/usr/bin/env bash
# Throwaway PostgreSQL cluster for the @skillstack/db tests.
#
#   scripts/test-postgres.sh start   create and start the cluster
#   scripts/test-postgres.sh env     print the `export` lines the tests need
#   scripts/test-postgres.sh stop    stop the cluster and delete its directory
#
# Local only. CI uses a `postgres:16` service container instead (see .github/workflows/ci.yml).
set -euo pipefail

PORT="${TEST_PG_PORT:-55432}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DIR="${TEST_PG_DIR:-${TMPDIR:-/tmp}/skillstack-test-pg}"
SETUP_SQL="$(cd "$(dirname "$0")/.." && pwd)/test/setup.sql"
DB_NAME=skillstack_test

# initdb and postgres refuse to run as root: use the OS user `postgres` in that case.
as_pg() {
  if [ "$(id -u)" -eq 0 ]; then
    (cd / && su postgres -s /bin/bash -c "$1")
  else
    (cd / && bash -c "$1")
  fi
}

start() {
  if [ -d "$DIR" ]; then
    echo "$DIR already exists; run '$0 stop' first" >&2
    exit 1
  fi
  mkdir -p "$DIR"
  if [ "$(id -u)" -eq 0 ]; then chown postgres "$DIR"; fi
  # The superuser and the admin role `migrator` use trust auth (loopback only, throwaway data).
  # Every other role must present a password, so the tests prove that set-passwords works.
  as_pg "'$PG_BIN/initdb' -D '$DIR/data' -U postgres --auth-local=trust --auth-host=scram-sha-256 >/dev/null"
  as_pg "printf 'host all postgres 127.0.0.1/32 trust\nhost all migrator 127.0.0.1/32 trust\nhost all all 127.0.0.1/32 scram-sha-256\n' > '$DIR/data/pg_hba.conf'"
  as_pg "'$PG_BIN/pg_ctl' -D '$DIR/data' -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1' -l '$DIR/log' -w start >/dev/null"
  # setup.sql is read by this process, so the postgres OS user needs no access to the repo.
  "$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -f "$SETUP_SQL"
  echo "test cluster running on 127.0.0.1:$PORT (database $DB_NAME)" >&2
}

stop() {
  if [ -d "$DIR/data" ]; then
    as_pg "'$PG_BIN/pg_ctl' -D '$DIR/data' -m fast -w stop >/dev/null" || true
  fi
  rm -rf "$DIR"
  echo "test cluster stopped and $DIR deleted" >&2
}

env_lines() {
  echo "export TEST_DATABASE_URL=postgres://migrator@127.0.0.1:$PORT/$DB_NAME"
  echo "export TEST_SUPERUSER_URL=postgres://postgres@127.0.0.1:$PORT/$DB_NAME"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  env) env_lines ;;
  *)
    echo "usage: $0 start|stop|env" >&2
    exit 2
    ;;
esac
