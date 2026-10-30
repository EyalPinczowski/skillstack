#!/usr/bin/env bash
# Restore an encrypted backup into a SCRATCH database (a drill, never a live database).
#
#   AGE_IDENTITY_FILE=/path/to/key.txt RESTORE_DATABASE_URL=... \
#     restore.sh --schema prod|rnd --file FILE.dump.age --i-know-this-is-a-scratch-database
#
# AGE_IDENTITY_FILE    path to the age private key file (never inside this repo).
# RESTORE_DATABASE_URL connection string of an empty scratch database, with rights to create schemas.
#
# Creates the empty schema first (fails if it already exists). The decrypted dump is piped
# straight into pg_restore and never written to disk.
# Objects are owned by the restoring user. Policies that name roles that do not exist in the
# scratch database (backup_<schema>, app_<schema>_user) make pg_restore report errors for
# those statements; create the roles first (or expect those errors) in a drill.
set -euo pipefail

usage() {
  echo "usage: AGE_IDENTITY_FILE=... RESTORE_DATABASE_URL=... $0 --schema prod|rnd --file FILE.dump.age --i-know-this-is-a-scratch-database" >&2
  exit 2
}

schema=""
file=""
confirmed=0
while [ $# -gt 0 ]; do
  case "$1" in
    --schema)
      [ $# -ge 2 ] || usage
      schema="$2"
      shift 2
      ;;
    --file)
      [ $# -ge 2 ] || usage
      file="$2"
      shift 2
      ;;
    --i-know-this-is-a-scratch-database)
      confirmed=1
      shift
      ;;
    *) usage ;;
  esac
done

case "$schema" in
  prod | rnd) ;;
  *)
    echo "error: --schema is required and must be 'prod' or 'rnd'" >&2
    exit 2
    ;;
esac
[ -n "$file" ] || usage
if [ "$confirmed" -ne 1 ]; then
  echo "error: refusing to restore without --i-know-this-is-a-scratch-database" >&2
  exit 2
fi
if [ ! -f "$file" ]; then
  echo "error: backup file not found: $file" >&2
  exit 2
fi
if [ -z "${AGE_IDENTITY_FILE:-}" ] || [ ! -f "$AGE_IDENTITY_FILE" ]; then
  echo "error: AGE_IDENTITY_FILE must point to an existing age identity file" >&2
  exit 2
fi
if [ -z "${RESTORE_DATABASE_URL:-}" ]; then
  echo "error: RESTORE_DATABASE_URL is not set" >&2
  exit 2
fi
if [ -n "${BACKUP_DATABASE_URL:-}" ] && [ "$RESTORE_DATABASE_URL" = "$BACKUP_DATABASE_URL" ]; then
  echo "error: RESTORE_DATABASE_URL is the same as BACKUP_DATABASE_URL" >&2
  exit 2
fi

for tool in pg_restore psql age; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "error: $tool is not installed" >&2
    exit 1
  }
done

# pg_dump --schema does not include CREATE SCHEMA, so create it. It fails if the schema already
# exists, which keeps a drill from landing on top of existing data.
psql "$RESTORE_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "create schema $schema"

age -d -i "$AGE_IDENTITY_FILE" "$file" |
  pg_restore --dbname="$RESTORE_DATABASE_URL" --schema="$schema" --no-owner --no-privileges
echo "restore finished (schema $schema)" >&2
