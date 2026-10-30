#!/usr/bin/env bash
# Local end-to-end test of backup.sh and restore.sh against the throwaway Postgres.
#
#   packages/db/scripts/test-backup.sh
#
# Starts the throwaway cluster, bootstraps `rnd`, backs it up as backup_rnd with a freshly
# generated age key, restores into a scratch database and compares schema_migrations.
# The age key lives in a temp dir that is deleted on exit, together with the cluster.
# Needs: age, age-keygen, pg_dump, pg_restore, psql (PG 16 binaries, see test-postgres.sh), pnpm.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DB_PKG="$(cd "$HERE/.." && pwd)"
PORT="${TEST_PG_PORT:-55432}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
export PG_BIN

for tool in age age-keygen pnpm; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "error: $tool is not installed" >&2
    exit 1
  }
done

work="$(mktemp -d)"
cleanup() {
  rm -rf "$work"
  "$HERE/test-postgres.sh" stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT")

"$HERE/test-postgres.sh" start

admin_url="postgres://migrator@127.0.0.1:$PORT/skillstack_test"
backup_password="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
app_password="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

echo "== bootstrap rnd" >&2
(
  cd "$DB_PKG"
  DATABASE_URL="$admin_url" pnpm --silent migrate migrate --schema rnd
  DATABASE_URL="$admin_url" APP_PASSWORD="$app_password" BACKUP_PASSWORD="$backup_password" \
    pnpm --silent migrate set-passwords --schema rnd
)

echo "== generate a throwaway age key" >&2
age-keygen -o "$work/key.txt" 2>"$work/keygen.log"
recipient="$(age-keygen -y "$work/key.txt")"

echo "== refusal checks" >&2
expect_fail() {
  if "$@" >/dev/null 2>&1; then
    echo "FAIL: expected failure: $*" >&2
    exit 1
  fi
}
backup_url="postgres://backup_rnd:$backup_password@127.0.0.1:$PORT/skillstack_test"
expect_fail env BACKUP_DATABASE_URL="$backup_url" AGE_RECIPIENT="$recipient" "$HERE/backup.sh"
expect_fail env BACKUP_DATABASE_URL="$backup_url" AGE_RECIPIENT="$recipient" "$HERE/backup.sh" --schema public
expect_fail env BACKUP_DATABASE_URL="$backup_url" AGE_RECIPIENT="AGE-SECRET-KEY-1ABC" "$HERE/backup.sh" --schema rnd
expect_fail env AGE_RECIPIENT="$recipient" "$HERE/backup.sh" --schema rnd

echo "== backup" >&2
BACKUP_DATABASE_URL="$backup_url" AGE_RECIPIENT="$recipient" \
  "$HERE/backup.sh" --schema rnd --out-dir "$work/out" 2>"$work/backup.log"
cat "$work/backup.log" >&2
if grep -q "$backup_password" "$work/backup.log"; then
  echo "FAIL: backup output contains the password" >&2
  exit 1
fi
file="$(ls "$work"/out/rnd-*.dump.age)"
if head -c 64 "$file" | grep -q PGDMP; then
  echo "FAIL: backup file is not encrypted" >&2
  exit 1
fi

echo "== restore into scratch database" >&2
"${PSQL[@]}" -U postgres -d postgres -c "create database scratch"
scratch_url="postgres://postgres@127.0.0.1:$PORT/scratch"
expect_fail env AGE_IDENTITY_FILE="$work/key.txt" RESTORE_DATABASE_URL="$scratch_url" \
  "$HERE/restore.sh" --schema rnd --file "$file"
AGE_IDENTITY_FILE="$work/key.txt" RESTORE_DATABASE_URL="$scratch_url" \
  "$HERE/restore.sh" --schema rnd --file "$file" --i-know-this-is-a-scratch-database

echo "== compare schema_migrations row counts" >&2
orig="$("${PSQL[@]}" -U postgres -d skillstack_test -At -c "select count(*) from rnd.schema_migrations")"
copy="$("${PSQL[@]}" -U postgres -d scratch -At -c "select count(*) from rnd.schema_migrations")"
echo "original=$orig restored=$copy" >&2
if [ "$orig" != "$copy" ] || [ "$orig" -lt 1 ]; then
  echo "FAIL: row counts differ or are empty" >&2
  exit 1
fi
echo "PASS: backup and restore round trip" >&2
