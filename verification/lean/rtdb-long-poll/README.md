# Realtime Database long-poll reassembly in Lean 4

The model describes the pure `Reassembler` behind the browser long-poll transport. It stores each new segment by its serial number and checks byte and segment bounds before draining. A packet becomes available only once the full consecutive range, using the first segment header, has arrived. Successful packet assembly advances the cursor by at least one and decodes either form of the Base64 alphabet into UTF-8. Stale and duplicate serials leave the pending state alone. A refused reply ends the modeled trace.

Lean proves that accepting a piece in a bounded queue preserves the two bounds, duplicates keep state, every completed packet advances the cursor, and draining never rewinds. The corpus crosses four arrival patterns, three small cap settings and seven packet forms. It checks output batches, empty packets, contiguous ordering with gaps, duplicate payloads, count and byte limits, UTF-8 failures, and the segment counter beyond its u64 range. The model excludes HTTP rendering, connection authentication, and the state of a discarded reassembler after refusal.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-database/tests/fixtures/lean-rtdb-long-poll.corpus
```

From the repository root, run `cargo nextest run -p fireemu-adapter-database --test rtdb_long_poll_lean_corpus`.
