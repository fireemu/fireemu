# Shared identifier constructors in Lean 4

The model covers project, database, limit catalog, collection and document names. It specifies ordered rejection, UTF-8 byte lengths and offsets, the default database exception, the ASCII project/database/catalog alphabet and the Firestore path segment restrictions. Control rejection follows Fireemu's documented environment hardening.

Theorems prove the size bound of a successful constructor, agreement of collection and document validation, and representative rejection precedence. The corpus crosses constructor, character class and size boundary. Rust compares the exact error variant and payload or lossless text preservation. Wire parsing of names and path range sentinels belong to their respective consumers.

~~~sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-type-identifiers.corpus
cargo test -p fireemu-core-types --test type_identifiers_lean_corpus
~~~
