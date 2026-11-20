# Cloud Storage names in Lean 4

This package specifies three validators from `crates/fireemu-core-storage/src/name.rs`. The object constructor receives the already decoded name and treats its text as opaque. The core bucket constructor accepts names used by import and internal fixtures. The strict bucket validator adds the service's length, endpoint, component, reserved-word, and IPv4-shape rules.

`StorageNames/Spec.lean` defines ordered rejection predicates. `StorageNames/Theorems.lean` proves that successful validation means every predicate passed, that the object length limit precedes content validation, and that strict bucket acceptance implies core bucket acceptance. In the strict grammar, an address has four decimal components that each fit in a byte. The reference follows Fireemu's current reserved-word checks. Its scope ends before endpoint routing, percent decoding, and the external service's additional spelling rules.

`Main.lean` generates 126 cases spanning Unicode byte width, length boundaries, competing violations, and preservation of slash, escaped-looking text, and distinct Unicode spellings. The replayer asserts exact rejection reasons and the original bytes of accepted names.

## Commands

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-storage/tests/fixtures/lean-storage-names.corpus
```

From the repository root, run `cargo test -p fireemu-core-storage --test storage_names_lean_corpus`.
