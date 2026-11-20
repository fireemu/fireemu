# Portable managed export partition selection

This model describes [managed export partitions](../../../crates/fireemu-core-export/src/managed.rs). The winning filter list keeps input order. An explicit namespace list takes precedence over a collection list, an empty namespace entry selects the default namespace, and absent filters select one all-kinds partition. A collection filter selects a document by its innermost collection. Named Datastore namespaces have no Firestore documents.

Lean proves the default, precedence, order preservation and exact membership rule. The executable reference enumerates partition metadata and data filenames, global output ordinals and the complete selected document path sequence. The Rust replay checks the writer and readers against these results on nested and Unicode documents, empty selections and combinations of filters. It also compares aggregate counts and entity byte totals.

The direct writer preserves duplicate filters, producing duplicate metadata filenames. The overall metadata reader rejects those names, as captured in the corpus. The model covers the direct codec contract independently of any request-layer validation. It does not model schema inference or production's partition checksum.

## Commands

```sh
cd verification/lean/export-partitions
lake build
lake exe corpus > ../../../crates/fireemu-core-export/tests/fixtures/lean-export-partitions.corpus
cd ../../..
cargo nextest run -p fireemu-core-export --test export_partitions_lean_corpus
```
