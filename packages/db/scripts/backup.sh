#!/usr/bin/env bash
# Encrypted backup of one environment schema.
#
#   BACKUP_DATABASE_URL=... AGE_RECIPIENT=age1... backup.sh --schema prod|rnd [--out-dir DIR]
#
# BACKUP_DATABASE_URL  connection string of the read-only login backup_<schema> (a secret).
# AGE_RECIPIENT        the age PUBLIC key (age1...). A private key is refused.
#
# Writes <schema>-<UTC timestamp>.dump.age to the output dir (default: ./backups).
# The dump never touches the disk unencrypted. The connection string is never printed.
set -euo pipefail

usage() {
  echo "usage: BACKUP_DATABASE_URL=... AGE_RECIPIENT=age1... $0 --schema prod|rnd [--out-dir DIR]" >&2
  exit 2
}

schema=""
out_dir="backups"
while [ $# -gt 0 ]; do
  case "$1" in
    --schema)
      [ $# -ge 2 ] || usage
      schema="$2"
      shift 2
      ;;
    --out-dir)
      [ $# -ge 2 ] || usage
      out_dir="$2"
      shift 2
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

if [ -z "${BACKUP_DATABASE_URL:-}" ]; then
  echo "error: BACKUP_DATABASE_URL is not set" >&2
  exit 2
fi
if [ -z "${AGE_RECIPIENT:-}" ]; then
  echo "error: AGE_RECIPIENT is not set" >&2
  exit 2
fi
case "$AGE_RECIPIENT" in
  AGE-SECRET-KEY*)
    echo "error: AGE_RECIPIENT looks like a private key. Use the public key (age1...) and rotate this key pair." >&2
    exit 2
    ;;
  age1*) ;;
  *)
    echo "error: AGE_RECIPIENT must be an age public key starting with 'age1'" >&2
    exit 2
    ;;
esac

for tool in pg_dump age; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "error: $tool is not installed" >&2
    exit 1
  }
done

mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$out_dir/$schema-$stamp.dump.age"
partial="$final.part"
trap 'rm -f "$partial"' EXIT

# --enable-row-security: pg_dump defaults to row_security=off, which makes a role without
# BYPASSRLS fail on any table with RLS. backup_<schema> sees every row through its SELECT policy.
pg_dump --dbname="$BACKUP_DATABASE_URL" \
  --schema="$schema" --no-owner --no-privileges --format=custom --enable-row-security |
  age -r "$AGE_RECIPIENT" -o "$partial"

if [ ! -s "$partial" ]; then
  echo "error: backup file is empty" >&2
  exit 1
fi
mv "$partial" "$final"
trap - EXIT
echo "backup written: $final ($(wc -c <"$final") bytes)" >&2
