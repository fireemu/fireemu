# Adapter accept classification and backoff in Lean 4

The numerical reference describes the effective millisecond schedule. It proves monotonicity, the basic delay bounds and stability beyond the fifth resource error. The replayer checks failure counts around all transitions and at the full Rust counter bound. Separate cases classify portable Rust error kinds. OS-specific raw codes, listener scheduling and cancellation remain in the adapter runtime domain.

~~~sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-support/tests/fixtures/lean-adapter-accept-backoff.corpus
cargo test -p fireemu-adapter-support --test adapter_accept_backoff_lean_corpus
~~~
