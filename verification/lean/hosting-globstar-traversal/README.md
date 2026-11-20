# Hosting globstar suffix traversal

A whole pattern component `**` tries the possible lengths of the path prefix it consumes. The remaining pattern may match the original path or a suffix. When dot matching is disabled, a hidden component may begin the suffix seen by the next pattern component. The globstar itself cannot consume it.

This model separates the suffix matcher from the split enumeration. Lean proves that the single-pass traversal agrees with enumerating all allowed splits for any hidden-component predicate and suffix matcher. It proves that a hidden leading component can still be considered by the rest of the pattern and that consuming zero components suffices when the original path is accepted. These theorems describe the modeled traversal. Grammar, rule order, path parsing, and transport remain covered by the Hosting matcher corpus and request tests.

The 340 vectors cover both dot policies, every hidden/visible layout up to three components, and every possible set of accepted suffix lengths. Rust replays them against `globstar_suffixes` in `crates/fireemu/src/hosting/matcher.rs`.

```sh
lake build
lake exe corpus > ../../../crates/fireemu/tests/fixtures/lean-hosting-globstar-traversal.corpus
cd ../../..
cargo nextest run -p fireemu --test hosting_globstar_traversal_lean_corpus
```
