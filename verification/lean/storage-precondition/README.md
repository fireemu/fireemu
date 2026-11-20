# Cloud Storage object preconditions in Lean 4

A declarative specification of Cloud Storage object guards, a Lean model of fireemu's guard checks and identity transitions, machine-checked proofs relating them, and an executable reference that writes the golden corpus. The Rust replay uses the public Storage API and builds without Lean.

## Scope

In `crates/fireemu-core-storage/src/store.rs`, `Precondition::check` and `StorageState::check` evaluate the four guard fields. `plan_put` uses them for `put` and `finalize_upload_with_admission_inner`. `update_metadata_with_admission` and `delete_with_admission` require a live object before checking guards. Reads follow the GET arm of `gcs_object` in `crates/fireemu-adapter-http/src/storage.rs`, which does the lookup first and calls `Precondition::check` for a present object.

The model takes one live object or an absent name, one value per guard field, valid payloads, and admitted writes in an unversioned store. The four guard results use the GCS names and codes for the core results `Ok`, `PreconditionFailed` (412), `NotModified` (304), and `NotFound` (404). For strict GCS writes `gcs_core_err` maps `NotModified` to 304. The separate `core_err` envelope mapping uses 412 for the same variant. An allowed write can still return `IdentityExhausted`. The model includes the checked identity arithmetic in `next_generation_preview` and `patched`, the production microsecond floor and its zero fallback for values outside `u64`, and the session phase when a receiving upload with valid bytes reaches `plan_put`.

Request parsing and profile selection, explicit generation selectors, archived objects, payload validation, quotas, spill, event admission, and the rest of the resumable-upload lifecycle are outside this scope. In particular, strict GCS parsing rejects simultaneous match and not-match fields on the same identity. The core accepts these combinations, so the corpus exercises them. The strict HTTP `PATCH`, `PUT`, and `DELETE` paths look up their target before entering the live mutation logic.

## Layout

- `StoragePrecondition/Spec.lean` defines which individual guards refuse, which operations require a target, and the declarative `Verdict` for a set of guards.
- `StoragePrecondition/Model.lean` computes the check, the operation's guard decision, the identity transition, and the finalization phase.
- `StoragePrecondition/Theorems.lean` proves that `check_iff_all_pass`, `decide_iff_spec`, and `verdict_exists_unique` characterize the model. `decision_depends_only_on_object` and `order_independent` establish independence from the allocator and written guard order. `generation_match_not_match_exclusive` and `metageneration_match_not_match_exclusive` cover equal-value pairs. `zero_match_iff_absent`, `absent_guard`, `absent_read`, and `absent_write_rules` cover absence. `refused_preserves_object_state` and `finalize_refusal_aborts` cover refusals. `successful_upload_generation` and `successful_metadata_preserves_generation` cover successful writes.
- `StoragePrecondition/Axioms.lean` guards the axiom dependencies of every exported theorem at build time.
- `Main.lean` generates 815 cases. Its header documents the trace format. Cases include every operation and presence state, each single guard at equality, inequality and zero, every pair and the full set in both orders, and multi-step traces through writes and conditional writes.
- `crates/fireemu-core-storage/tests/storage_precondition_lean_corpus.rs` replays the generated fixture and checks the proved properties with proptest, which is already a dev-dependency of the crate.

## Findings

1. For object `7:3`, `ifGenerationNotMatch=7` plus `ifMetagenerationMatch=4` yields 412 in either written order. The core's match failures take priority over not-match refusals. See `failed_match_takes_priority`.
2. `ifGenerationMatch=0` also passes on raw metadata with identity `0:1`. The public check compares the field as given. The import boundary refuses generation zero, so `zero_match_iff_absent` requires positive stored generations. See `raw_zero_generation_passes_zero_match` and the named Rust test.
3. Finalizing a receiving upload with buffered bytes, an absent object, and `ifGenerationMatch=7` returns 412, aborts the session, and discards its buffered bytes. The refusal preserves the object and the generation counter. See `refused_finalize_changes_session` and `finalize_refusal_aborts`.
4. An upload at the persisted generation ceiling, or a metadata update at the persisted metageneration ceiling, can pass every guard and still return `IdentityExhausted`. An absent object with `ifGenerationMatch=0` can be created with counter zero and refused with counter `i64::MAX`. The four-way guarantee applies to the guard decision. See `exhausted_identity_can_refuse_after_guards_pass` and `execution_can_depend_on_counter`.
5. A metadata update on `7:3` returns `7:4`, so `ifGenerationMatch=7` still passes. The fresh-generation theorem applies to body replacement and assumes the counter covers the current generation, as it does after writes and imports. With a fabricated current identity `1:3` and counter zero, a matching upload could reuse generation 1. See `metadata_write_keeps_generation` and `stale_counter_can_repeat_generation`.

## Fixed

- 2026-11-20. Reads, live metadata updates, and live deletes all return 404 for an absent object regardless of guards. An upload can still create an absent object with `ifGenerationMatch=0`. See `absent_reads_and_live_mutations_return_not_found` and `absent_write_rules`.

## Open

The core crate exposes lookup and guard checking as separate public methods. The read replay composes `get` and `Precondition::check` in the order used by the adapter. Direct replay of the HTTP endpoint, including its status mapping, requires the adapter.

## Commands

Run from this directory with the toolchain pinned in `lean-toolchain`.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-storage/tests/fixtures/lean-storage-precondition.corpus
```

The Rust integration test target is `storage_precondition_lean_corpus` in `fireemu-core-storage`.
