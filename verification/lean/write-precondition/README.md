# Firestore write preconditions in Lean 4

A declarative specification of Firestore's write precondition rules, a model of the corresponding decision in `crates/fireemu-core-firestore/src/store.rs`, machine-checked proofs, and an executable reference that generates the Rust test fixture. The Rust tests replay the corpus through the public store API.

## Scope

The model covers one document, the precondition check against the current staged document, and the resulting existence and update time for a create, set, update with or without a mask, delete, or transform. The declarative rule takes the outcome of the write body as an input: invalid, delete, or store with a flag for equality after storage normalization. The corpus computes that flag using one integer field, where a nonempty mask can set or clear it and an empty mask preserves it. The representative transform increments that field, saturates at both i64 bounds, and refuses a nonnumeric operand. The corpus includes an invalid delete with a transform to exercise error precedence.

Core create, set, and update all lower to `WriteOp::Set`. The core API has no separate create entry point. `CreateDocument` constructs an unmasked set with `exists: false`, so create cases cover both initial states under its one legal condition and the set matrix covers the other conditions. `UpdateDocument` forwards the supplied optional precondition. The integration test exercises the lowered writes rather than adapter request construction.

The five outcomes cover the precondition check and write body. The model assumes transaction, contention, transform-count, document, index, and history admission checks pass. The transform-count check runs before per-write preconditions and can return `ResourceExhausted`. Transaction bookkeeping and verify writes are outside the scope. Clock arithmetic uses integers for the range in which the store's i128 alignment and increment are defined.

`next_commit_time` floors the clock to a whole microsecond, including for negative times, and advances one microsecond past the previous commit if needed. Every accepted commit consumes its stamp, even when the document does not change. A batch uses one stamp and checks each write against the document left by the previous staged write. Refusal discards the staged document and results.

## Layout

- `WritePrecondition/Spec.lean` defines the declarative rules for satisfaction, refusal, and the accepted effect.
- `WritePrecondition/Model.lean` models the core precondition check, commit stamp, effect selection, staging, and publication.
- `WritePrecondition/Theorems.lean` proves the model agrees with the rules, and states the create, update, delete, timestamp, refusal, and replay laws.
- `WritePrecondition/Counterexamples.lean` proves the cases listed under Findings and Fixed.
- `WritePrecondition/Axioms.lean` checks every theorem's axiom dependencies as part of the build.
- `Main.lean` documents and generates the 311-case corpus. It includes the condition matrix, clock and saturation boundaries, and batches of two and three writes.

## Findings

1. An update on an absent document with field `n = 7` and no precondition creates it, with or without a mask. An empty mask creates an empty document. All three return `NOT_FOUND` under `exists: true`. The decisions agree when the document is present (`missing_updates_without_precondition_upsert`, `update_stage_without_precondition_iff_present`).
2. A set of the already stored `n = 7` at update time 10000 ns reports that same time, even when its commit stamp is 11000 ns. The same set at the next commit with `updateTime = 10000 ns` succeeds. Repeating a successful storing write at its reported time succeeds if the second body is valid. The proposed equivalence with an update-time change holds when the first write stamps the document and the stamp is fresh for that document (`no_op_can_retry_with_unchanged_time`, `retry_with_reported_update_time`, `retry_iff_changed_for_fresh_stamp`).
3. Deleting a present document at update time 10000 ns removes it and reports no update time. Repeating the delete with `updateTime = 10000 ns` returns `FAILED_PRECONDITION` (`delete_can_change_existence_without_a_retry_time`).
4. The store compares the supplied update time at exact nanosecond precision. A condition of 10001 ns against 10000 ns returns `FAILED_PRECONDITION`; it succeeds against an imported 10001 ns document. The adapter's `decode_precondition` rejects sub-microsecond wire times before they reach the store. The Rust fixture exercises the core path (`submicrosecond_precondition_is_not_truncated`, `update_time_exact`).

## Fixed

- 2026-11-20: Import advances the store clock to the larger of the import commit time and the largest imported update time rounded up to a whole microsecond. Imported update times are preserved. A subsequent write that changes fields receives a strictly later, microsecond-aligned update time (`changed_fields_advance_past_imported_time`, `commit_time_aligned`). In the regression case, importing a document with update time 10001 ns at clock 10000 ns makes the next changed write at clock 10001 ns produce 12000 ns. A retry using 10001 ns fails.

## Open

No outstanding proof obligations within the stated scope.

## Commands

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-write-precondition.corpus
```

The Rust side is `crates/fireemu-core-firestore/tests/write_precondition_lean_corpus.rs`. It checks the case count, replays each outcome and reported time, and uses the crate's existing proptest dependency for the general rule properties.
