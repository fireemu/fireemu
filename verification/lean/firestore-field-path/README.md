# Firestore field paths

This Lean model covers the raw-segment validator and canonical rendering in `FieldPath`. A simple ASCII identifier is rendered directly. Every other valid segment is wrapped in backticks, escaping backticks and backslashes in the content. The validator measures UTF-8 bytes in the raw segments, adding one byte per separator. The 1,500-byte limit excludes the encoding overhead of quoting.

The proofs establish that quoted content decodes to the original characters and leaves the following input untouched, that a singleton path consumes exactly the byte length of its segment, and that appending a segment to a nonempty path adds exactly its own bytes and one separator. Every accepted path fits the budget. These statements are about the Lean model. The Rust replay ties the model to `FieldPath::from_segments`, `FieldPath::canonical`, and the parsing of canonical and fully quoted strings.

The corpus crosses ASCII, multibyte, and escaped text with short, boundary, and over-limit lengths in single-segment and nested paths. Extra rows cover controls, reserved names, and precedence between field and whole-path rejection. The Rust test also checks malformed-input offsets and the separate pipeline alias parser. The Lean quoted-content recognizer verifies the local encoding rule, rather than implementing the full malformed-input parser.

## Reproduce

From this directory with the pinned Lean toolchain:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-field-path.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_field_path_lean_corpus
```
