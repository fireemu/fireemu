# Fireemu

[![npm](https://img.shields.io/npm/v/fireemu)](https://www.npmjs.com/package/fireemu)

**Test against Firebase as it behaves in production.**

Fireemu is a single-binary local Firebase emulator for automated tests and CI. It defaults to production Firebase rules, validation, and error shapes so problems show up in your test suite before deployment.

Fireemu is an independent open-source project and is not affiliated with Google or Firebase.

What you get out of the box:

- **Composite index checks**: Firestore queries missing an index in `firestore.indexes.json` fail with `FAILED_PRECONDITION`, just like production.
- **Identity Platform & Auth flows**: test TOTP and SMS MFA, multi-tenancy, blocking functions (including `beforeEmailSent`), and account policies through the standard Firebase SDKs.
- **Virtual clock**: freeze, set, or advance emulator time to test token expiry, TTL, and scheduled Node.js functions without waiting.
- **Isolated test worlds**: run integration tests in parallel with `fireemu/testing`, each with its own ports, data, Security Rules, Functions, and clock.
- **Fast native binary**: installed via npm with no Java runtime required.

**Documentation:** <https://fireemu.github.io/fireemu/>

## Quick start

Install Fireemu, generate a config file, and start the emulators:

```sh
npm install --save-dev fireemu
npx fireemu init

# Start the emulators (UI: http://127.0.0.1:4000/ui/)
npx fireemu up
```

Press `Ctrl+C` to stop. For test runs and CI, use `exec` to start Fireemu, inject the Firebase emulator environment variables, run your command, and shut down with its exit code:

```sh
npx fireemu exec -- npm test

# Start only the services you need
npx fireemu exec --only auth,firestore,storage -- npm test
```

The Firebase CLI names `emulators:start` and `emulators:exec` also work as aliases. Fireemu reads `fireemu.toml` (or `fireemu.json`) in the current directory, or falls back to the nearest `firebase.json`. Run `npx fireemu --help` for options, or `npx fireemu doctor` if startup fails.

**Requirements:**

- Node.js 20+
- macOS 13+ (Apple silicon, Intel), Linux (x86-64, arm64), or Windows 10+ (x86-64)
- Node.js Functions: `firebase-functions` v6 or v7
- Python Functions: Python 3.10–3.14 in a `venv` with `firebase-functions` (macOS or Linux)

Guides: [Install and run](https://fireemu.github.io/fireemu/getting-started/install/), [Connect your app](https://fireemu.github.io/fireemu/getting-started/connect/), [Migrate from the Local Emulator Suite](https://fireemu.github.io/fireemu/getting-started/migrate/).

### Parallel tests with isolated worlds

The `fireemu` package exports `fireemu/testing` for spinning up isolated emulator instances per test, and `fireemu/control` for calling the control API. `withTestWorld` handles startup and teardown automatically, even when a test throws:

```js
import { withTestWorld } from 'fireemu/testing';

await withTestWorld(
  { services: ['auth', 'firestore'], clockStart: '2026-01-31T23:59:00Z' },
  async (world) => {
    await world.clock.advance(60_000);
    await world.run(process.execPath, ['./test.mjs']);
  },
);
```

See [Test worlds](https://fireemu.github.io/fireemu/guides/test-worlds/), [Time and scheduled functions](https://fireemu.github.io/fireemu/guides/time/), and [docs/test-worlds.md](docs/test-worlds.md).

## Supported services

| Product | What is supported | Docs |
|---|---|---|
| Cloud Firestore | Standard and Enterprise editions, composite index validation, Security Rules, subset of Enterprise Pipeline reads, local lexical text search | [Firestore](https://fireemu.github.io/fireemu/products/firestore/) |
| Firebase Authentication | Sign-in methods, TOTP/SMS MFA, multi-tenancy, OIDC/SAML providers, blocking functions (external IdP round-trips are out of scope) | [Auth](https://fireemu.github.io/fireemu/products/auth/) |
| Cloud Storage | Firebase and JSON APIs, Security Rules (signed-URL signature verification, IAM, `compose`, and notifications are out of scope) | [Storage](https://fireemu.github.io/fireemu/products/storage/) |
| Cloud Functions | HTTP, callable, event, task-queue, blocking, and virtual-clock scheduled functions (Node.js); HTTP, callable, and trigger functions in real time (Python) | [Functions](https://fireemu.github.io/fireemu/products/functions/) |
| Cloud Pub/Sub & Eventarc | Topics, subscriptions, push/pull delivery, dead-letter topics, StreamingPull, and Eventarc custom events | [Pub/Sub & Eventarc](https://fireemu.github.io/fireemu/products/pubsub-eventarc/) |
| Firebase Realtime Database | REST, realtime protocol, Security Rules, export/import (verified against production for recorded cases; no parity claim against the official emulator) | [Realtime Database](https://fireemu.github.io/fireemu/products/realtime-database/) |
| Firebase Hosting | Static files, redirects, rewrites (including to local functions), headers, clean URLs, localization (verified against production for recorded cases; no parity claim against the official emulator) | [Hosting](https://fireemu.github.io/fireemu/products/hosting/) |
| Firebase App Check | Local debug-token exchange and enforcement (no real-device attestation or replay protection) | [App Check](https://fireemu.github.io/fireemu/products/app-check/) |

App Hosting and Data Connect are deferred, and Firebase Extensions is not planned. Fireemu also includes a local [Emulator UI](https://fireemu.github.io/fireemu/guides/ui/) for inspecting data, rules decisions, functions, and the virtual clock.

For detailed API coverage, see [Limitations](https://fireemu.github.io/fireemu/compatibility/limitations/), `npx fireemu capabilities` ([capabilities.json](crates/fireemu/src/capabilities.json)), and the [Functions export inventory](docs/functions-export-inventory.md).

## Compatibility and profiles

Fireemu ships with two compatibility profiles:

| Profile | Purpose |
|---|---|
| `strict` (default) | Follows production Firebase behavior and constraints across the supported surface. Recommended for day-to-day testing and when migrating from the official emulator. |
| `emulator` | Tracks a pinned version of Google's official Local Emulator Suite (`firebase-tools` 15.28.2). Useful as a secondary target when checking alignment with the official emulator. |

Some production setup adds friction to local tests, such as signing keys, signed mock tokens, or enabling MFA and multi-tenancy through Admin API calls. Both profiles keep sensible development defaults for these, each with its own config key, and `productionExact = true` turns production behavior back on for all of them. See [Profiles and productionExact](https://fireemu.github.io/fireemu/guides/profiles/).

### Verification scope

Fireemu's behavior is checked against recordings taken from real Firebase projects. The [compatibility tables](https://fireemu.github.io/fireemu/compatibility/) list every verified area, the conditions checked, and known differences; [docs/compatibility-contract.md](docs/compatibility-contract.md) documents how the checks run.

Local verification only covers the recorded scope. No local emulator reproduces real quota accounting, billing, IAM, organization policies, network latency, or backend rollouts, so test critical flows against a dedicated Firebase test project before relying solely on local runs in CI.

<details>
<summary>Formal compatibility statement (firebase-tools 15.28.2)</summary>

Fireemu is compatible with the listed Local Emulator Suite products as shipped by firebase-tools 15.28.2 -- Cloud Firestore, Firebase Authentication, Cloud Storage for Firebase, Cloud Functions, Cloud Pub/Sub and Eventarc, with Security Rules on the Firestore and Storage surfaces -- under the `emulator` compatibility profile and the evidence recorded in `spec/compatibility/contract.json`; it makes no complete-suite and no unqualified superset claim while the Realtime Database and Firebase Hosting are served without a parity claim against the official emulator (an open gap; both are verified against production for recorded cases), App Hosting and Data Connect are deferred and Firebase Extensions is not planned.

See [spec/compatibility/contract.json](spec/compatibility/contract.json) for the machine-checked contract.

</details>

## Configuration

`npx fireemu init` creates a minimal `fireemu.toml`:

```toml
#:schema https://raw.githubusercontent.com/fireemu/fireemu/v0.64.0/spec/config/fireemu.schema.json
schemaVersion = 1
profile = "strict"

[firestore]
edition = "standard"
apiMode = "native"
```

Keep Fireemu-specific options in `fireemu.toml` and point it at your existing `firebase.json` with `npx fireemu init --firebase-json firebase.json`. Rules, indexes, Functions codebases, and ports are read from `firebase.json` on each start.

Useful config commands:

- `npx fireemu config show`: print effective values and where each setting came from
- `npx fireemu config lint --deny-ineffective`: fail CI if a config key has no runtime effect
- `npx fireemu config schema --out fireemu.schema.json`: export the installed binary's JSON Schema for offline editor completion

More documentation:

- [Configuration files](https://fireemu.github.io/fireemu/guides/configuration/) and [Configuration schema](https://fireemu.github.io/fireemu/reference/configuration/) ([JSON Schema](spec/config/fireemu.schema.json))
- Guides: [Security Rules](https://fireemu.github.io/fireemu/guides/security-rules/), [Time and scheduled functions](https://fireemu.github.io/fireemu/guides/time/), [Export and import](https://fireemu.github.io/fireemu/guides/data/), [Emulator UI](https://fireemu.github.io/fireemu/guides/ui/), [CI and containers](https://fireemu.github.io/fireemu/guides/ci-and-containers/), [Troubleshooting](https://fireemu.github.io/fireemu/guides/troubleshooting/)
- [CLI reference](https://fireemu.github.io/fireemu/reference/cli/)

By default, all listeners bind to localhost. Read [CI and containers](https://fireemu.github.io/fireemu/guides/ci-and-containers/) before exposing emulator ports on a network interface.

## Performance

Because Fireemu runs as a single native binary, startup overhead and memory usage stay small. On a GitHub Actions Linux runner, a Firestore-only run was ready for SDK traffic in 140 ms using 11 MiB of idle memory (compared with 3,043 ms and 390 MiB for the JVM-based Firestore emulator in the same paired run). See [Performance](https://fireemu.github.io/fireemu/compatibility/performance/) for the full benchmark setup and numbers.

## Reporting issues and contributing

When filing an issue, include your Fireemu and Firebase SDK versions, the profile (`strict` or `emulator`), the product involved, and a minimal reproduction. For compatibility bugs, note whether you are comparing against production Firebase or the official emulator, and strip any credentials or personal data from logs and configs.

Build and test instructions are in [docs/development.md](docs/development.md). Release notes live in [CHANGELOG.md](CHANGELOG.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt).
