---
title: Performance
description: Measured startup time, memory footprint, and Firestore throughput alongside the official Firestore emulator, plus how to benchmark changes.
---

We benchmark Fireemu and Google's official Firestore emulator on the same SDK workloads, running back-to-back on the same GitHub Actions Linux runner with Fireemu in the `emulator` profile. Every operation's output is verified during the run.

## Results

Measured from a single `standard` tier run at commit `f3b942c` against the Firestore emulator bundled with `firebase-tools` 15.28.2 on JDK 21.0.8. Ratios come from five paired trials; absolute numbers vary by hardware and runner load.

| Metric | Official emulator | Fireemu | Ratio |
|---|---:|---:|---:|
| Startup until SDK-ready (Firestore) | 3,043 ms | 140 ms | 21.6× faster |
| Idle memory with empty database (PSS) | 390 MiB | 11 MiB | ~1/34 memory |
| Peak memory during trial (cgroup) | 849 MiB | 79 MiB | ~1/10.7 memory |
| Firestore throughput across 22 workloads | — | — | 1.1× to 5.2× higher |

The 95% confidence interval is [21.4, 21.8] for the startup ratio and [10.2, 11.1] for peak memory (official emulator divided by Fireemu).

See [benchmark.yml](https://github.com/fireemu/fireemu/blob/main/.github/workflows/benchmark.yml) and [`tools/bench/`](https://github.com/fireemu/fireemu/tree/main/tools/bench) for the harness and raw scripts.

## Applying results to a test suite

Use these numbers only to estimate the emulator startup and memory portion of your workflow. Fill in the template below from a validated run and your own process counts:

| Quantity | Baseline | Candidate |
|---|---:|---:|
| SDK-usable startup (seconds) | measured ms / 1000 | measured ms / 1000 |
| Loaded idle PSS (MiB per engine) | measured bytes / 1048576 | measured bytes / 1048576 |
| Fresh engine starts per job | observed count | observed count |
| Concurrent engines at steady state | observed count | observed count |

- **Sequential starts**: multiply measured seconds per start by the number of fresh starts.
- **Concurrent engines**: multiply idle PSS (MiB) by the peak concurrent engine count.

Report emulator time separately from dependency installation, builds, SDK setup, and test code. Engine benchmarks alone do not prove end-to-end CI savings; measure the full job if you need total wall-time numbers.

## For contributors: comparing a change

Contributors modifying Fireemu can compare two Fireemu binaries directly on Linux using the same profile, fixture shape, services, and SDK install. Each paired trial launches fresh processes, and the manifest records binary paths, SHA-256 digests, versions, and harness hashes. Any binary change mid-run, invalid result, or failed cleanup invalidates the run.

```sh
python3 tools/bench/bench.py --fireemu /path/to/candidate/fireemu --baseline-fireemu /path/to/baseline/fireemu --sdk-root conformance --tier standard --profile emulator --out .bench-candidate
python3 tools/bench/report.py .bench-candidate
```

Official-vs-Fireemu runs default to report schema v2; Fireemu-vs-Fireemu runs use schema v3 with `baseline-fireemu`/`candidate-fireemu` labels and `baseline_*`/`candidate_*` fields. Use at least five paired fresh-process runs before claiming a speedup. Running an identical binary against itself is a useful sanity check; a confidence interval containing 1 does not show an improvement.

### Fixture shapes

`--fixture-shape tiny` uses scalar documents and `--fixture-shape wide-map` uses 32 nested map fields, while the default fixture keeps its standard payload. Query oracle fields and full SDK readback checks run for every shape. Always compare matching shapes separately.

### Mixed services

`--mixed-services` loads Auth, Storage, and Firestore across isolated and overlapping phases. It runs 8 validated operations per class at concurrency 2 with a fixed seed, a 64 KiB Storage upload/readback/delete cycle, and live Auth config, Hub registry, and Firestore read probes, keeping per-class latency and throughput distributions separate.

- Mixed trials require observed overlap between Storage and another service at the client boundary (this does not prove simultaneous server-side execution).
- Storage latency covers upload, readback, and delete together; it does not split out queue time, execution time, or lock wait.
- The 16-handler / 2-Glob-slot limits remain the measurement baseline.
- Cancellation permit recovery is covered by runtime tests, and RSS/PSS reflect the complete loaded engine.
- For official comparisons, pre-download the pinned Storage emulator via `pnpm -C conformance exec firebase setup:emulators:storage`.
- Startup readiness probes every loaded service; the Functions runner does not participate.
