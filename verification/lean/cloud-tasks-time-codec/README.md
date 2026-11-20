# Cloud Tasks time codec

The timestamp parser reference uses explicit ASCII tokens and counts elapsed days by complete years and preceding months. It accepts second 60 as the next second and applies the parsed offset after checking the local year. An offset can therefore move the result outside the local-year input range. Duration parsing uses a signed magnitude within the observed accepted grammar. Formatting uses the Rust codec's Euclidean quotient and remainder, with 0, 3, 6 or 9 fractional digits.

The proof and corpus preserve the asymmetry for negative fractional durations. For example, formatting −0.5 seconds produces `-1.500s`, which parses as −1.5 seconds. This is the current codec behavior. CreateTask accepts a positive dispatch deadline or a zero default marker, so the negative case is checked at the codec boundary.

The corpus checks the public timestamp and duration parsers, duration formatting across the i128 range and timestamp formatting near the epoch or when the seconds conversion falls back to the epoch. The timestamp formatting model omits other civil dates.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-cloud-tasks-time-codec.corpus
```

From the repository root, run `cargo test -p fireemu-adapter-functions --test cloud_tasks_time_codec_lean_corpus`.
