# Pub/Sub subscription configuration

The reference models the ordered decisions exposed by `SubscriptionConfig::validate` and `SubscriptionConfig::validate_production_configuration`. It separates the core and production acknowledgement ranges, treats retention and backoff durations as signed nanoseconds, and distinguishes a default expiration, disabled expiration and an explicitly supplied TTL. The production oracle treats label validation as an input decision. The Rust replay uses an empty label map and an uppercase key as representatives of the two outcomes.

The Lean laws cover acknowledgement and label error priority, the bounded ordered retry interval, the default retention duration, and the effect of a disabled or explicit expiry on retention. The 2,478 corpus rows include values one nanosecond outside duration boundaries, mixed invalid settings to exercise refusal priority, and every selected optional policy shape. The replay checks the selected diagnostic category, invalid-argument status and resolved retention. Delivery, redelivery timing, expiration enforcement and request-level policy defaults are separate state and adapter concerns.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-pubsub/tests/fixtures/lean-pubsub-subscription.corpus
```

From the workspace root, run `cargo nextest run -p fireemu-core-pubsub -E 'binary(pubsub_subscription_lean_corpus)'`.
