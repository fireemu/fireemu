# Eventarc channel lifecycle in Lean 4

The state machine models a single named channel, injected whole-millisecond time, sequential identities, and fixed creation and deletion delays. The clock retains its high-water mark. Lookup prefers the creation phase before readiness, even after a deletion has been accepted. Deletion becomes effective exactly at its deadline, and an early deletion starts its duration at readiness. Theorems cover clock monotonicity, repeat deletion, early-deletion timing, retirement and new identity allocation.

Rust replays create, declare, lookup and delete calls against an in-memory store with deterministic entropy. The fixture captures the action result, phase, view timestamps and identity, topic visibility and completion of all issued operations. The model omits cross-channel listings, stored operation response payloads, deadline overflow and concurrent callers. TLC checks the bounded lifecycle separately.

Regenerate the fixture with the pinned Lean toolchain.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-eventarc-channel-lifecycle.corpus
```

Run the Rust replay from the workspace root.

```sh
cargo nextest run -p fireemu-adapter-functions -E 'binary(eventarc_channel_lifecycle_lean_corpus)'
```
