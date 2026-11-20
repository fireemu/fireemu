# Cloud Tasks queue name lifecycle

The model projects one name in one queue onto free, pending, active and finished states. Virtual time determines schedule eligibility and the two-second tombstone boundary. It also specifies run-now release, immediate and retained reuse, delete-before-due, and refusal of completion handles from an older generation. A trace sends one such handle with the current task ID to isolate the generation check.

The Rust replayer imports the scheduler and its direct dependency modules within the test crate. This exercises the same scheduler source without a runner, network, or public API extension. The corpus fixes the production rate at one start per second, with its ten-token initial capacity, and tests fewer than ten starts in one trace. The scope excludes rate exhaustion, competition among queues, completion history eviction and dispatch retries.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-cloud-tasks-queue.corpus
```

From the repository root, run `cargo test -p fireemu-adapter-functions --test cloud_tasks_queue_lean_corpus cloud_tasks_queue_matches_lean`. The trailing test filter selects the corpus replay while leaving out the imported unit tests.
