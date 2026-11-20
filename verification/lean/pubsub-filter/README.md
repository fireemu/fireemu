# Pub/Sub attribute filters

The Lean reference evaluates an expression over optional string attributes. It covers existence, equality, inequality, prefixes, and boolean composition. For an absent attribute, inequality is true, equality is false, and even an empty prefix fails. The laws cover these distinctions, the complement of equality, De Morgan's law and the always-true empty filter.

The 741 corpus rows evaluate typed expressions independently of the Rust syntax parser. The reference emits canonical strings and selected wire examples for case-insensitive boolean keywords, precedence, quoted dotted keys, quote and backslash escaping, Unicode values, malformed equality, and the 256-byte admission edge. The Rust replay invokes both parsing and matching and checks retained source text. The full lexer grammar and all syntax diagnostic offsets remain the responsibility of the parser tests. The wire input is serialized as decimal Unicode code points to preserve whitespace.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-filter.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-core-pubsub -E 'binary(pubsub_filter_lean_corpus)'`.
