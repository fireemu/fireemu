# Security Rules concrete path patterns

The model covers concrete Firestore document get paths with a literal and single-segment binding, a nested match inheriting a parent binding, or one recursive wildcard. A match must consume the whole path. Version 1 permits a recursive wildcard only at the end of its header and it must consume at least one segment. Version 2 also permits a recursive wildcard before a suffix and can bind an empty path.

`RulesPathPattern/Spec.lean` characterizes a leading wildcard by splitting off the exact trailing pattern. It proves that a fixed match rejects descendants, a nested match keeps both bindings, and trailing and leading recursive captures preserve the entire remainder. The Rust replayer loads Rules text, verifies whether the header is accepted, checks the match result independently of captures, and checks the actual bound values on successful matches. The model describes these four concrete layouts. Abstract query markers, Storage, patterns with more than one recursive wildcard, resource limits and lexically shadowed bindings are outside its scope.

## Replay

The three case axes are Rules version, layout, and path. Each row includes the raw path suffix, the load or match outcome, and up to three expected bindings. Empty slash-separated segments are ignored in the public matcher, including the repeated-separator fixture.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-path-pattern.corpus
cargo test -p fireemu-core-rules --test rules_path_pattern_lean_corpus
```
