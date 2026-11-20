# Bounded HTTP body collection in Lean 4

The reference consumes an in-memory stream of data frames, free trailers and transport failures. It reports the collected payload or first rejection and the number of frames read. The proofs check the successful length bound, trailer neutrality and immediate termination on either error. The Rust replayer uses the public asynchronous collector with a synthetic stream and checks both bytes and polling effects. Corpus payloads use ASCII bytes, one scalar per byte. Transport, deadlines and protocol-specific error mapping belong to the adapters.

~~~sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-support/tests/fixtures/lean-adapter-bounded-body.corpus
cargo test -p fireemu-adapter-support --test adapter_bounded_body_lean_corpus
~~~
