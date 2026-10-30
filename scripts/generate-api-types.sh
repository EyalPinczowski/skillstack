#!/usr/bin/env bash
# Regenerates the web app's API types from the API's real OpenAPI document:
#   apps/api/scripts/openapi-dump.ts  ->  openapi-typescript  ->  apps/web/src/api/schema.d.ts
# Usage: bash scripts/generate-api-types.sh [output-file]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/apps/web/src/api/schema.d.ts}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$root"
pnpm --silent --filter @skillstack/api openapi:dump --out "$tmp/openapi.json"
pnpm --silent --filter @skillstack/web exec openapi-typescript "$tmp/openapi.json" -o "$out" >/dev/null
