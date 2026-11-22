#!/usr/bin/env bash
# Enforce ADR-001's normal dependency allowlist for every core manifest.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec python3 - <<'PY'
import json
from pathlib import Path
import subprocess
import sys

def packages_by_manifest(*extra):
    command = ["cargo", "metadata", "--no-deps", "--format-version", "1", *extra]
    metadata = json.loads(subprocess.check_output(command))
    return {Path(package["manifest_path"]).resolve(): package for package in metadata["packages"]}


packages = packages_by_manifest()
failed = False
manifests = sorted(Path("crates").glob("fireemu-core-*/Cargo.toml"))
if not manifests:
    sys.exit("error: no core manifests found")
for manifest in manifests:
    crate = manifest.parent.name
    path = manifest.resolve()
    if path not in packages:
        # A core crate explicitly excluded from the workspace has its own metadata.
        packages.update(packages_by_manifest("--manifest-path", manifest))
    package = packages.get(path)
    if package is None or package["name"] != crate:
        sys.exit(f"error: {manifest} does not identify package {crate}")
    allowed = {"crc32c"} if crate == "fireemu-core-types" else set()
    unexpected = sorted({
        dep["name"] for dep in package["dependencies"]
        if dep["kind"] is None and not dep["name"].startswith("fireemu-core-")
    } - allowed)
    if unexpected:
        names = "\n".join(unexpected)
        print(f"error: {crate} has external normal dependencies outside its allowlist: {names}", file=sys.stderr)
        failed = True
    else:
        print(f"ok: {crate} external normal dependencies match its allowlist")
sys.exit(int(failed))
PY
