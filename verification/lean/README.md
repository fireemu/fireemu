# Fireemu specifications in Lean 4

Each package defines a reference contract, checks its theorems, and generates the golden corpus replayed by Rust. The package README records its scope, case format and Rust entry point. Rust tests consume the checked-in fixtures, so the ordinary build has no Lean toolchain dependency.

## Package index

| Area | Reference packages |
| --- | --- |
| Shared types and wire codecs | [crc32c](crc32c/README.md), [firestore-edition](firestore-edition/README.md), [type-identifiers](type-identifiers/README.md), [wire-codecs](wire-codecs/README.md), [deterministic-id-source](deterministic-id-source/README.md), [pubsub-message-ids](pubsub-message-ids/README.md), [rfc3339-time](rfc3339-time/README.md) |
| Firestore values and paths | [firestore-value-order](firestore-value-order/README.md), [document-size](document-size/README.md), [firestore-field-path](firestore-field-path/README.md), [firestore-query-scope](firestore-query-scope/README.md), [firestore-ttl](firestore-ttl/README.md) |
| Firestore queries and writes | [cursor-order](cursor-order/README.md), [index-merge](index-merge/README.md), [single-index](single-index/README.md), [firestore-query-dnf](firestore-query-dnf/README.md), [write-precondition](write-precondition/README.md) |
| Realtime Database | [rtdb-key-order](rtdb-key-order/README.md), [rtdb-query-window](rtdb-query-window/README.md), [rtdb-push-id](rtdb-push-id/README.md), [rtdb-server-value](rtdb-server-value/README.md) |
| Cloud Storage | [storage-names](storage-names/README.md), [storage-glob](storage-glob/README.md), [storage-etag](storage-etag/README.md), [storage-precondition](storage-precondition/README.md) |
| Pub/Sub | [pubsub-names](pubsub-names/README.md), [pubsub-pagination](pubsub-pagination/README.md), [pubsub-filter](pubsub-filter/README.md), [pubsub-subscription](pubsub-subscription/README.md) |
| Functions and Scheduler | [functions-cron](functions-cron/README.md), [functions-event-pattern](functions-event-pattern/README.md), [functions-env](functions-env/README.md), [scheduler-retry-policy](scheduler-retry-policy/README.md) |
| Cloud Tasks | [cloud-tasks-clock-rebase](cloud-tasks-clock-rebase/README.md), [cloud-tasks-time-codec](cloud-tasks-time-codec/README.md), [cloud-tasks-admission](cloud-tasks-admission/README.md), [cloud-tasks-retry](cloud-tasks-retry/README.md) |
| Events and Eventarc | [event-retry](event-retry/README.md), [event-transition](event-transition/README.md), [eventarc-wire-size](eventarc-wire-size/README.md) |
| Auth and App Check | [totp-window](totp-window/README.md), [auth-base32](auth-base32/README.md), [auth-password-policy](auth-password-policy/README.md), [auth-signup-quota](auth-signup-quota/README.md), [app-check-admission](app-check-admission/README.md), [app-check-claims](app-check-claims/README.md) |
| Security Rules | [rules-regex](rules-regex/README.md), [rules-failure-algebra](rules-failure-algebra/README.md), [rules-set-values](rules-set-values/README.md), [rules-path-pattern](rules-path-pattern/README.md) |
| Export and logging wire formats | [export-wire](export-wire/README.md), [export-partitions](export-partitions/README.md), [export-leveldb](export-leveldb/README.md), [log-websocket-frame](log-websocket-frame/README.md) |
| Limits and sessions | [limit-evaluation](limit-evaluation/README.md), [clock-calendar](clock-calendar/README.md), [virtual-clock](virtual-clock/README.md), [session-fault](session-fault/README.md) |

## Reproduce a package

Run the commands in the package README from that package directory. Use its pinned Lean toolchain. A clean check builds the guarded theorems, compares fresh corpus output byte-for-byte with the tracked fixture, and runs the corresponding Rust integration test.

Theorems describe the reference model and its stated assumptions. The Rust replayers compare public API observations, including error order and exact byte representations where the model specifies them. Use the package scope when drawing conclusions about Rust behavior.
