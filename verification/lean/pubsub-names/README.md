# Pub/Sub resource names

This specification covers the name checks in `fireemu-core-pubsub/src/name.rs`. The reference models UTF-8 byte lengths, project slash and control-character restrictions, the ASCII resource ID alphabet, rejection order, the exact case-sensitive `goog` reservation, and qualified topic and subscription name shape. It represents qualified names as slash-separated components. The Rust replay passes complete names to the production parser and also checks project and resource validation directly. The snapshot cases exercise the shared short-ID validator.

The Lean laws cover complete character inspection, permitted alphabet membership for admitted IDs, slash exclusion for admitted projects, and kind-specific parsing of canonical topic names and the deleted-topic sentinel. The 177 corpus rows include the short length edge, 255 and 256-byte inputs, an invalid multibyte ID, a project control character after a multibyte character, and invalid qualified paths. Text is serialized as decimal Unicode code points so control characters cannot alter the fixture framing.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-names.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-core-pubsub -E 'binary(pubsub_names_lean_corpus)'`.
