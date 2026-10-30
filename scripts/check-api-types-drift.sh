#!/usr/bin/env bash
# Fails when apps/web/src/api/schema.d.ts differs from what the API's current OpenAPI document
# produces. The file is generated: never edit it by hand. After changing an API route or schema run:
#   pnpm api:types
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bash "$root/scripts/generate-api-types.sh" "$tmp/schema.d.ts"

if diff -u "$root/apps/web/src/api/schema.d.ts" "$tmp/schema.d.ts" >"$tmp/drift.txt"; then
  echo "API types are up to date with the OpenAPI document."
else
  head -n 40 "$tmp/drift.txt"
  echo
  echo "API type drift: apps/web/src/api/schema.d.ts differs from the generated output." >&2
  echo "Run: pnpm api:types   and commit the result." >&2
  exit 1
fi
