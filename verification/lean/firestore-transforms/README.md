# Firestore field transforms

The reference models signed integer increments, numeric extrema, and direct array union and removal. An integer increment clamps the mathematical sum to the signed 64-bit range. Numeric extrema compare finite witness values exactly as integer half-units, preserve the stored representation on a tie, and propagate NaN. The witness domain includes infinities, signed zero, numerically equivalent integers and doubles, and values around the binary64 exact-integer boundary.

Array transforms compare canonical keys, including equal cross-type numbers and timestamps in the same storage microsecond. Union appends missing operands in order and retains existing duplicates. Removal filters every matching occurrence without reordering survivors. A missing or non-array current field supplies an empty array. Array transform results report null while the stored field contains the resulting array.

The proofs give signed range and clipping laws, preservation of the current value on numeric ties, invariance of canonical equality under timestamp precision truncation, preservation of the union prefix, and exact membership of removal survivors. The Rust test compares stored and reported values from real commits and exercises staged rollback after a rejected transform. The model excludes server timestamps, floating increments, recursive array values, and commit version allocation.

## Reproduce

From this directory with the pinned toolchain:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-transforms.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_transforms_lean_corpus
```
