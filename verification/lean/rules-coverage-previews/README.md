# Security Rules coverage previews

This reference specifies the UTF-8 byte budget for recorded string values and undefined causes. Lean proves that the kept prefix fits the budget and that the first excluded scalar would exceed it. The model treats the UTF-8 width of each scalar as input, preserves a previously truncated tag, and distinguishes a clipped preview from its identical exact text.

The Rust replay calls `Coverage::record` and `ExprValue::of` with the four UTF-8 widths at the 1,024-byte boundary. It verifies exact retained content, diagnostic source extent, tags, and counts for observations that have the same prefix. The separate [coverage merge](../rules-coverage-merge/README.md) reference specifies the behavior of merging bounded entries.

## Replay

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-coverage-previews.corpus
cargo nextest run -p fireemu-core-rules --test rules_coverage_previews_lean_corpus
```
