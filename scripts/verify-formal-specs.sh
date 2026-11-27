#!/usr/bin/env bash
set -euo pipefail

# Verify checked-in formal specifications (TLA+ and Lean 4) when their toolchains are available.
# Usage:
#   scripts/verify-formal-specs.sh [--tla-only | --lean-only | --quick]
#
# By default, runs the fast bounded TLA+ specs (world-queue, clock-calendar-move, clock-settle)
# and builds Lean 4 packages under verification/lean/* if `lake` is installed.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_TLA=1
RUN_LEAN=1
TLA_EXPLICIT=0
LEAN_EXPLICIT=0
QUICK=0

for arg in "$@"; do
  case "$arg" in
    --tla-only) RUN_LEAN=0; TLA_EXPLICIT=1 ;;
    --lean-only) RUN_TLA=0; LEAN_EXPLICIT=1 ;;
    --quick) QUICK=1 ;;
    -h|--help)
      sed -n '3,10p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ "$TLA_EXPLICIT" -eq 1 && "$LEAN_EXPLICIT" -eq 1 ]]; then
  echo "Error: --tla-only and --lean-only are mutually exclusive" >&2
  exit 2
fi

if [[ "$RUN_TLA" -eq 1 ]]; then
  if command -v tla2tools >/dev/null 2>&1; then
    WORKERS="${TLA_WORKERS:-2}"
    echo "==> Verifying TLA+ specifications (workers=$WORKERS)"
    (cd "$ROOT/verification/tla/world-queue" && tla2tools -workers "$WORKERS" -config lanes.cfg WorldQueue.tla)
    (cd "$ROOT/verification/tla/clock-calendar-move" && tla2tools -workers "$WORKERS" -config CalendarMove.cfg CalendarMove.tla)
    (cd "$ROOT/verification/tla/clock-calendar-move" && tla2tools -workers "$WORKERS" -config PreviewGuard.cfg PreviewGuard.tla)
    if [[ "$QUICK" -eq 0 ]]; then
      (cd "$ROOT/verification/tla/clock-settle" && tla2tools -workers "$WORKERS" -config ClockSettle.cfg ClockSettle.tla)
      (cd "$ROOT/verification/tla/clock-mode" && tla2tools -workers "$WORKERS" -config ClockMode.cfg ClockMode.tla)
    fi
  else
    echo "tla2tools not found on PATH" >&2
    if [[ "$TLA_EXPLICIT" -eq 1 ]]; then
      exit 127
    fi
  fi
fi

if [[ "$RUN_LEAN" -eq 1 ]]; then
  if command -v lake >/dev/null 2>&1; then
    echo "==> Verifying Lean 4 specifications"
    for dir in "$ROOT"/verification/lean/*/; do
      [[ -f "$dir/lakefile.toml" || -f "$dir/lakefile.lean" ]] || continue
      echo "  -> lake build $(basename "$dir")"
      (cd "$dir" && lake build)
    done
  else
    echo "lake not found on PATH" >&2
    if [[ "$LEAN_EXPLICIT" -eq 1 ]]; then
      exit 127
    fi
  fi
fi
