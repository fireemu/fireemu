# Firestore Pipeline group order

This model follows the blocking Pipeline stages `distinct` and `aggregate` with a count accumulator. It separates the equality class of a finite tuple from the stored representation of the first row in that class. Missing group cells become null, numeric equality includes integer/double ties, signed zero and the single canonical NaN class, and the finite nested values have recursive equality. Groups and distinct keys keep the order in which the keys first appeared. An aggregate with zero grouping fields has one group even on empty input.

Theorems establish that materialization preserves keys, insertion retains the earliest leader and adds exactly one to the group cardinalities, and total counts equal input cardinality. The Rust replay calls `pipeline_exec::execute_in` and checks nested numeric representation and NaN and zero bits in both profiles. The model assumes keys were successfully evaluated. Other accumulators, expression errors and cursor behavior remain covered by the Pipeline stage tests.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-pipeline-group-order.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-firestore --test firestore_pipeline_group_order_lean_corpus
```
