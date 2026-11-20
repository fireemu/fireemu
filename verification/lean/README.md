# Fireemu specifications in Lean 4

Each package defines a reference contract, checks its theorems, and generates the golden corpus replayed against Fireemu. The package README records its scope, case format, and test entry point. Rust, Node.js, and Python tests consume the checked-in fixtures, so the ordinary build has no Lean toolchain dependency.

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

## Additional contracts

| Area | Reference packages |
| --- | --- |
| Shared JSON and export metadata | [core-json](core-json/README.md), [export-metadata](export-metadata/README.md) |
| Firestore writes and aggregates | [firestore-transforms](firestore-transforms/README.md), [firestore-aggregates](firestore-aggregates/README.md), [firestore-partition-query](firestore-partition-query/README.md) |
| Firestore query inputs | [firestore-pipeline-values](firestore-pipeline-values/README.md), [firestore-text-query](firestore-text-query/README.md), [firestore-proto-values](firestore-proto-values/README.md), [firestore-index-config](firestore-index-config/README.md) |
| Security Rules | [rules-utf16-slices](rules-utf16-slices/README.md), [rules-coverage-merge](rules-coverage-merge/README.md) |
| Realtime Database and UI | [rtdb-path-merge](rtdb-path-merge/README.md), [rtdb-node-hash](rtdb-node-hash/README.md), [rtdb-long-poll](rtdb-long-poll/README.md), [ui-rtdb-forwarding](ui-rtdb-forwarding/README.md) |
| Cloud Storage | [storage-list-pages](storage-list-pages/README.md), [storage-http-range](storage-http-range/README.md) |
| Pub/Sub | [pubsub-publish](pubsub-publish/README.md), [pubsub-rest-negative-cache](pubsub-rest-negative-cache/README.md), [pubsub-ack-lease](pubsub-ack-lease/README.md) |
| Auth and App Check | [auth-user-pagination](auth-user-pagination/README.md), [auth-custom-claims](auth-custom-claims/README.md), [app-check-registry](app-check-registry/README.md) |
| Functions and Eventarc | [functions-trigger-selection](functions-trigger-selection/README.md), [functions-ordered-json](functions-ordered-json/README.md), [eventarc-channel-lifecycle](eventarc-channel-lifecycle/README.md) |
| Sessions and Cloud Tasks | [session-tenancy](session-tenancy/README.md), [cloud-tasks-queue](cloud-tasks-queue/README.md) |
| Outbox and Functions transport | [event-outbox](event-outbox/README.md), [functions-protocol-frame](functions-protocol-frame/README.md) |
| Adapter limits and retry | [adapter-bounded-body](adapter-bounded-body/README.md), [adapter-terminal-policy](adapter-terminal-policy/README.md), [adapter-notice-limit](adapter-notice-limit/README.md), [adapter-accept-backoff](adapter-accept-backoff/README.md) |
| Hosting and CLI | [hosting-match](hosting-match/README.md), [config-discovery](config-discovery/README.md), [service-start-plan](service-start-plan/README.md) |
| Node.js runner and npm | [runner-log-bounds](runner-log-bounds/README.md), [runner-invocation-budget](runner-invocation-budget/README.md), [runner-parameter-defaults](runner-parameter-defaults/README.md), [npm-clock-duration](npm-clock-duration/README.md), [runner-wait-deadlines](runner-wait-deadlines/README.md) |
| Python runner | [python-runner-wire-layout](python-runner-wire-layout/README.md), [python-runner-event-data](python-runner-event-data/README.md) |

## Reproduce a package

Run the commands in the package README from that package directory. Use its pinned Lean toolchain. A clean check builds the guarded theorems, compares fresh corpus output byte-for-byte with the tracked fixture, and runs the corresponding integration test.

Theorems describe the reference model and its stated assumptions. The replayers compare selected implementation behavior, including error order and exact byte representations where the model specifies them. Use the package scope when drawing conclusions about Rust behavior.
