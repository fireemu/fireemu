# Functions event path patterns

The Lean reference parses document event path patterns and matches relative paths. Its model distinguishes a literal, a one-component wildcard or capture, and a terminal wildcard or capture of the remaining path. Parsing checks empty components, capture syntax, duplicate names, and the position of a multi-component token. Matching follows Fireemu's raw path treatment, including an empty path component after slash trimming and the refusal of unmatched extra components in a fixed-length pattern.

`FunctionsEventPattern/Theorems.lean` proves the terminal-capture result, literal consumption, and the equal-length requirement for an accepted fixed-length pattern. The Rust replayer checks parse error categories and payloads, normalized text, the full segment list, document classification, and the exact ordered capture map. This package focuses on the pure path-pattern contract. Trigger routing and service-side path validation are outside the model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-functions/tests/fixtures/lean-functions-event-pattern.corpus
```
