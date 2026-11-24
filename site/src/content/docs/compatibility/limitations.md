---
title: Limitations
description: Check what Fireemu does not support yet and what no local emulator can model before relying on local test results.
---

Fireemu does not reproduce every feature of production Firebase. This page summarizes the main boundaries; for individual APIs, see the [capability manifest](../#capability-manifest) or run:

```sh
npx fireemu capabilities
```

## Unsupported products

App Hosting and Data Connect are not currently supported. Firebase Extensions is not planned.

## Partially supported products

- **Realtime Database**: served and verified against production only for recorded cases ([Production verification](../#production-verification)). Broader production coverage is unverified, and there is no parity claim against the official emulator. See [Realtime Database](../../products/realtime-database/#differences-from-the-official-emulator) and the notes below.

## Unsupported features

### Cloud Firestore

- The Enterprise Pipeline API implements a limited subset of read operations ([Enterprise pipelines](../../products/firestore/#enterprise-pipelines)).
- Enterprise text search runs a local lexical engine with explicit index build controls. Tokenization and ranking are approximations, and `productionExact` refuses unobserved search semantics.

### Authentication

- Sign-in flows that communicate with external identity providers, hosted authorization-code exchange, and live key discovery/rotation are not supported.
- Local signed OIDC/SAML verification works on the strict signed-assertion path using `auth.idpSigners` public keys or the SAML provider's configured certificates.
- SAML checks cover present status, destination, issuer, audience, and validity fields, plus responses to daemon-issued requests. Missing fields, unparseable timestamps, and other unrecorded combinations remain unobserved.

### Cloud Storage

- Verifying signatures on signed URLs or POST policies (expiry and policy conditions are checked; V4 signed-URL keys can be registered separately via `storage.signedUrlKeys`).
- Object ACLs other than `allUsers` read, IAM, and bucket-level public access.
- Object composition (`compose`) and bucket notification configuration.
- **Storage CORS under `strict`**: `strict` applies the CORS behavior recorded in `conformance/storage-strictness-obs/recordings/run-2.json` (covering absent, empty, and configured bucket CORS across JSON API metadata/media/bucket/list/UBLA errors, preflights, resumable uploads, and cancellations) without requiring `productionExact`; the `emulator` profile keeps its existing behavior. Mixed-case requested-header preservation, UBLA PATCH/toggles, and applying expose headers to other responses remain unrecorded. Bucket creation accepts recorded region and disabled soft-delete hints without modeling those services; local tests cover UBLA export/import and empty created buckets. See [Bucket CORS](../../products/storage/#bucket-cors).

### Realtime Database

- Verified against production only for recorded cases ([Production verification](../#production-verification)), with no parity claim against the official emulator; official-emulator comparison is limited to recorded cases.
- Documented unsupported rules syntax and evaluation edge cases (including certain regex constructs and case mappings) are rejected at load time or produce rule errors. `query.endBefore`, `query.isOrderByChild()`, `OrderByKey`/`OrderByValue`/`OrderByPriority`, `http.encodeURL()`, method reads without a call, and ternary callees match recorded production behavior.
- The eight regex patterns rejected by the official emulator's determinization limit are also rejected when rules load (including inside unevaluated branches). This does not imply full regex or production equivalence.
- Functions trigger delivery is verified only for a limited set of recorded handlers and writes.
- Behavior adopted from the official emulator where production has not been observed may change as recordings are added.

See [Realtime Database](../../products/realtime-database/#differences-from-the-official-emulator).

### Cloud Functions

- Event triggers for products Fireemu does not deliver events for, such as Data Connect (deferred). Publishing or rolling back a Remote Config client template through local template administration delivers the event shape recorded in production on 2026-11-21 to v1 and v2 handlers. Publishing a server template delivers no event (production behavior is unrecorded), and duplicate-delivery/ordering guarantees are unrecorded.
- Dart codebases, and general protobuf CloudEvents ingress outside Firestore events (Firestore events reach Python SDK handlers as protobuf, and Node.js 2nd-gen handlers as protobuf under `strict`).
- Exact payload shape of Storage archive events remains unrecorded.
- Python codebases support HTTP, callable, Firestore, Pub/Sub, Storage, Eventarc, Realtime Database, scheduled, task-queue, and Auth blocking functions on macOS and Linux only. They run on real time (no virtual clock) and reload app source files while ignoring `venv` and bytecode caches; restart Fireemu after changing installed packages. Callable App Check tokens are verified by the Python SDK against the App Check emulator's keys (no limited-use consumption, and explicit App Check config refuses startup). See [Cloud Functions (Python)](../../products/functions-python/).

### Cloud Pub/Sub

- Schemas, BigQuery/Cloud Storage subscription delivery, exactly-once delivery, and message transforms.
- `UpdateTopic` supports only `labels` (plus `message_storage_policy` and `kms_key_name` in the `emulator` profile); `DetachSubscription` is not implemented.
- In the `emulator` profile, `messageStoragePolicy`, topic key names, and tags are stored as sent without validation against Google Cloud regions; `strict` refuses them.

### App Check

- Real-device attestation (Play Integrity, App Attest, DeviceCheck, reCAPTCHA) and limited-use token replay protection. Local debug tokens are supported.

## Local control limitations

- Sessions within one daemon share the virtual clock, Security Rules, Functions, and admission barrier.
- In-memory snapshots last only for the daemon's lifetime and do not capture in-flight Functions work.
- `awaitIdle` does not wait for Enterprise text-index builds or establish causal fences across sessions.

## Differences no local emulator removes

A passing local test does not guarantee identical behavior in production. Fireemu does not reproduce real quota accounting, billing, IAM, organization policies, regional/network differences, or service rollouts, and local performance does not predict production latency or throughput.

Security Rules and API behavior are implemented from documentation and production recordings. Upstream Firebase changes or untested edge cases can still introduce unrecorded differences.

## Local limits

Fireemu adds a few local-only bounds to keep memory predictable: [Firestore history limits](../../products/firestore/#transactions-and-history) and the optional [Storage stored-byte limit](../../products/storage/#limit-the-stored-bytes).

## Changes between versions

Configuration keys and runtime behavior may change between releases. See the [CHANGELOG](https://github.com/fireemu/fireemu/blob/main/CHANGELOG.md).

## Related

- [Compatibility tables](../)
- [Profiles and productionExact](../../guides/profiles/)
- [Performance](../performance/)
