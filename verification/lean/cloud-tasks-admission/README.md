# Cloud Tasks createTask admission

The model orders unknown-field, time-syntax, payload, name, deadline, horizon and size checks. Inputs are typed field classifications so that ordering can be proved independently of JSON parsing. The Rust replayer constructs actual JSON requests and tests the returned refusal classification, ordered field violations, size-callback evaluation, and accepted deadline and schedule normalization. Dedicated collisions between faults test refusal precedence.

The model covers 15-second and 30-minute deadline endpoints, a zero deadline's default marker, the 720-hour horizon, past and future microsecond rounding, and the inclusive 1 MiB task size. The Rust replayer also checks accepted task-name form, create time and response view. Generated ID mixing, arbitrary JSON field combinations, output formatting and complete error text are outside the model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-cloud-tasks-admission.corpus
```

From the repository root, run `cargo test -p fireemu-adapter-functions --test cloud_tasks_admission_lean_corpus`.
