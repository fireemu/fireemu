# Pub/Sub publish admission

The model describes the admission decision in `PubsubMessage::validate`. The data input is a byte count, attributes are unique strings presented to the validator in lexical key order, and the ordering key is a separate UTF-8 string. The decision chooses the first diagnostic category across empty messages, data size, attribute count, individual attributes, combined data-and-attribute size, and the ordering key.

The Lean laws cover the empty-message rule, size error priority, the bound on admitted payloads, and the reservation for lowercase `goog`. The 570 corpus rows cross five data sizes, 19 attribute presets and six ordering-key presets. The Rust replay exercises concrete UTF-8 values, NUL, mixed failures, and the exact 10,000,000-byte combined boundary. A mixed-case `Goog` attribute is admitted by the current core despite the diagnostic describing a case-insensitive reservation. The corpus pins the current behavior.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-publish.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-core-pubsub -E 'binary(pubsub_publish_lean_corpus)'`.
