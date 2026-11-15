#!/usr/bin/env python3
"""Generate required checksum cases and verify every required seed row."""

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
model = ROOT / "PICT.pict"
seeds = ROOT / "PICT.seed.tsv"
table = ROOT / "PICT.generated.tsv"
result = subprocess.run(
    ["pict", str(model), f"/e:{seeds}"], check=True, capture_output=True, text=True
)
table.write_text(result.stdout, encoding="utf-8")
check = subprocess.run(
    ["docs.local/tools/pict-check", "--seeds", str(seeds), "--table", str(table)],
    check=True,
    capture_output=True,
    text=True,
)
print(f"generated_rows={max(0, len(result.stdout.splitlines()) - 1)}")
print(check.stdout.strip())
