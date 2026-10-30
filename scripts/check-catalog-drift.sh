#!/usr/bin/env bash
# Fails when the generated catalog files (JSON, SQL, CSV, JSONL) differ from what
# data/catalog/build/build.py produces from its Python sources. Generated files must
# never be edited by hand: edit catalog.py / taxonomy.py / questions.py and re-run build.py.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp -R "$root/data/catalog" "$tmp/catalog"
find "$tmp/catalog" -name __pycache__ -prune -exec rm -rf {} +

(cd "$tmp/catalog/build" && PYTHONDONTWRITEBYTECODE=1 python3 build.py >/dev/null)

if diff -r -x __pycache__ "$root/data/catalog" "$tmp/catalog" >"$tmp/drift.txt"; then
  echo "Catalog is up to date with its build sources."
else
  head -n 40 "$tmp/drift.txt"
  echo
  echo "Catalog drift: generated files differ from build output." >&2
  echo "Edit data/catalog/build/*.py and run: cd data/catalog/build && python3 build.py" >&2
  exit 1
fi
