# Firestore structured aggregates

The reference covers Count, Sum, and Average sharing one input selection. All numeric target fields and explicit sort fields must be present, and a nonnumeric value satisfies presence while contributing nothing to sum or average. The offset and limit apply to the common selected input. Count's optional cap does not cap the other aggregates. Empty sums report integer zero and empty averages report null.

The Rust fixture uses a fixed root collection and one equality filter. Key order and explicit rank order coincide. An unbounded fold uses key order. A bounded query without rank uses the appended aggregate target fields before the document key. Mixed integer/double ordering witnesses use exactly representable conversions. Typed integer folds remain exact while they fit and promote irrevocably to binary64 on overflow or a double input. The reference executes binary64 addition and division using Lean's standard Float primitives. The replay checks finite bits and infinity signs and checks NaN classification without assuming a NaN payload.

The proofs cover required-field membership after windowing, the count cap, contributor count bounds, elementary integer fit and promotion laws, and empty outputs. They do not prove native floating operations or general query ordering, nearest-neighbor aggregation, transactional selection, arbitrary cursor composition, or aggregates whose operand order is outside the witness domain.

## Reproduce

From this directory with the pinned toolchain:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-aggregates.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_aggregates_lean_corpus
```
