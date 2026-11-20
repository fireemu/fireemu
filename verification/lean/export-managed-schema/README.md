# Managed export partition schema

This model covers scalar property summaries in Firestore managed export metadata. Selected documents affect a kind's schema in input order. A property appears in its first observed position. Its code list keeps the first occurrence of each scalar type. The repeated flag becomes true when any selected observation is an array, including an empty array. All-kinds and Datastore namespace outputs omit property summaries.

The guarded theorems prove insertion order and stability of previously observed field names and codes as new observations arrive. The corpus compares the order, repeated flags and exact scalar code bytes from metadata written by `write_managed_export`. Nested summaries and vector-specific rules are exercised by the existing Rust tests.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-export/tests/fixtures/lean-export-managed-schema.corpus
```

From the repository root run `cargo nextest run -p fireemu-core-export --test export_managed_schema_lean_corpus`.
