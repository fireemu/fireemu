# App Check registry histories in Lean 4

This package projects the public App Check registry in `crates/fireemu-core-app-check/src/registry.rs` onto two synthetic applications in separate projects, their static digest counts, dynamic record metadata, and a separate issuance gate with epochs and counters. Additions respect the combined static and dynamic cap. Removal and clearing affect only the selected application or project. Explicit restore scope determines which live lists a snapshot replaces. A selected application with no captured record list is restored to an empty list. Static registration remains configuration.

Theorems establish record preservation outside the selected restore scope, exact replacement by captured records, empty replacement for an uncaptured project, idempotent restoration, and unchanged records on a capacity refusal. The epoch projection proves the first successful issue after rotation has counter one, and an issuance refusal for the disabled application leaves its counter unchanged. Corpus rows compare exact public results and record order under scoped restore, static capacity limits, and epoch rotation. Digest bytes are synthetic and never observed in the replay.

Concurrency, epoch generation, counter width and wrap, registration conflicts, observation rings, cryptographic work, and actual network-issued tokens are outside this finite projection.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-app-check/tests/fixtures/lean-app-check-registry.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-app-check --test app_check_registry_lean_corpus`. Each history row provides capture and restore scopes, a mutation, initial static count, exact additions and mutations, and final dynamic record sequences. Epoch rows provide complete generation and claim-issuance observations.
