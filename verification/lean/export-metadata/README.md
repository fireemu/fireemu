# Export metadata in Lean 4

This reference models the typed decisions of [ExportMetadata](../../../crates/fireemu-core-export/src/metadata.rs) and [ObjectMetadata](../../../crates/fireemu-core-export/src/storage.rs). Its input is a typed JSON member tree. Separate JSON parser tests cover lexical recognition.

The manifest reference resolves product sections in official order and then handles the named-database extension. It distinguishes the required top-level string version, the defaulting section version, and the optional sidecar. Lean characterizes the lexical path rule and proves a required manifest version takes precedence over all section decisions. Path checks describe the parser's slash-delimited convention. Filesystem resolution and import admission are outside the reference.

Storage rows cover signed and unsigned numeric conversions, optional metadata defaults, joined and array token spellings, string-only custom values, precedence between failures, and preservation of an unknown field. Storage object size is represented as an unsigned integer in the parser. A decimal string above `i64::MAX` can parse successfully and serialize back as zero under the current writer. The boundary is proved and replayed explicitly.

The corpus contains product, path, version, and sidecar combinations plus size, token, and custom-metadata combinations. Additional rows exercise named-database ordering and explicit invalid input. Valid fixture projections are checked against the public parser and written form. Manifest extensions with no named databases are omitted by the writer.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-export/tests/fixtures/lean-export-metadata.corpus
```

Run `cargo nextest run -p fireemu-core-export -E 'binary(export_metadata_lean_corpus)'` from the repository root.
