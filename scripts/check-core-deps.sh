#!/usr/bin/env bash
# CI 31.1 #5: enforce ADR-001's small, explicit normal dependency allowlist.
# Path dependencies on other fireemu-core-* crates are allowed. crc32c is allowed only for
# fireemu-core-types so CRC32C can use its safe runtime-dispatched backend.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
status=0
for manifest in crates/fireemu-core-*/Cargo.toml; do
  crate="$(basename "$(dirname "$manifest")")"
  # List normal (non-dev, non-build) dependencies via cargo metadata.
  deps="$(cargo metadata --no-deps --format-version 1 --manifest-path "$manifest" \
    | python3 -c '
import json, sys
meta = json.load(sys.stdin)
pkg = next(p for p in meta["packages"] if p["name"] == sys.argv[1])
for d in pkg["dependencies"]:
    if d["kind"] is None and not d["name"].startswith("fireemu-core-"):
        print(d["name"])
' "$crate")"
  allowed=""
  if [[ "$crate" == "fireemu-core-types" ]]; then
    allowed="crc32c"
  fi
  unexpected="$(python3 -c 'import sys; allowed=set(sys.argv[1].split()); print("\n".join(sorted(set(sys.stdin.read().split()) - allowed)))' "$allowed" <<<"$deps")"
  if [[ -n "$unexpected" ]]; then
    echo "error: $crate has external normal dependencies outside its allowlist: $unexpected" >&2
    status=1
  else
    echo "ok: $crate external normal dependencies match its allowlist"
  fi
done
exit $status
