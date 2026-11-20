# Eventarc protobuf wire sizing

The reference uses the bit width of an unsigned integer to compute its base-128 prefix length. It then composes one-byte tags and length-delimited frames for a CloudEvent, the enclosing Any, and the publish request. The publish model fixes valid metadata, gives each event a unique ID of the same byte width, and varies the payload representation, the Any size boundary, and the number of small peer events.

The proofs establish monotonicity of the wire, field, and Any sizes, exact size growth from adding one peer, and the kind and order of the supported publish refusals. The Rust replayer checks the two wire helpers directly and sends in-memory requests through the public Eventarc evaluator. Oversized events check the exact request byte count and error field index. ASCII and Unicode JSON text are valid data. Base64 data is charged by its decoded size and hits the text-data validation error when the size checks succeed.

The model covers the adapter's fixed valid metadata shape and bounded publish cases. Mapped Pub/Sub request thresholds, arbitrary attribute sets, credentials, and channel lifecycle are outside its scope.

From this directory, regenerate the checked-in fixture with the pinned Lean toolchain.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-eventarc-wire-size.corpus
```

From the workspace root, replay the fixture without Lean.

```sh
cargo nextest run -p fireemu-adapter-functions -E 'binary(eventarc_wire_size_lean_corpus)'
```
