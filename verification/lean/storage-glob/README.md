# Cloud Storage globs in Lean 4

The reference in `StorageGlob/Spec.lean` splits a Unicode scalar sequence across atoms. It models literals, `?`, segment and recursive stars, optional recursive directories, classes, and a brace union of sequences. The Rust implementation in `crates/fireemu-core-storage/src/glob.rs` uses a compiled state machine. `Main.lean` renders each modeled pattern into its actual wire spelling for differential testing.

Theorems cover exact literal anchoring, slash exclusion from segment wildcards and classes, the zero-directory case, recursive-star inclusion, and union. Diagnostic rows use the admission fragment with a literal prefix and at most one unfinished construct. They cover the byte limit, rejection precedence, and scalar indices for unfinished classes and braces. The model covers full matching for the rendered fragment. Nested brace parsing, malformed-pattern fallback matching, cancellation, and resource complexity are separate contracts.

## Commands

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-storage/tests/fixtures/lean-storage-glob.corpus
```

From the repository root, run `cargo test -p fireemu-core-storage --test storage_glob_lean_corpus`.
