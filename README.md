# Fireemu

[![npm](https://img.shields.io/npm/v/fireemu)](https://www.npmjs.com/package/fireemu)

**Test against Firebase as it behaves in production.**

Fireemu is an unofficial local Firebase emulator for tests and CI, built to close the gap between local tests and production behavior. It is an independent open-source project, not an official Google or Firebase product.

It brings more of production into local tests:

- **Missing-index query rejection.** Queries that need an undeclared composite index fail with `FAILED_PRECONDITION` under the default `strict` settings, so the missing index surfaces in the test run, before deployment.
- **TOTP multi-factor authentication.** Test TOTP enrollment and sign-in through the Firebase SDK.
- **Blocking functions and account policies.** Test blocking functions for sign-up, sign-in and password-reset emails (under `strict`), and account settings such as disabling user-initiated account deletion.
- **A virtual clock.** Set and advance the emulator's clock to test token expiry and scheduled Node.js functions without waiting for real time to pass.
- **Independent test worlds.** Each world has its own data, Security Rules, Functions, ports and clock, so integration tests run in parallel without sharing state.

Fireemu's responses are compared with recordings from real Firebase projects, and the [compatibility tables](https://fireemu.github.io/fireemu/compatibility/) publish the conditions checked and the known differences. Verification applies to the recorded scope, not every Firebase feature or input. Before relying on results in CI, compare the features and critical workflows your application uses with a dedicated Firebase test project (not your live production project).

**Documentation:** <https://fireemu.github.io/fireemu/>

## Quick start

Start locally:

```sh
npm install --save-dev fireemu
npx fireemu init

# Start the emulators
# UI (default): http://127.0.0.1:4000/ui/
npx fireemu up
```

Press `Ctrl+C` to stop. To run your tests, use `exec`: it starts Fireemu, sets the Firebase SDK emulator host environment variables for your command, runs it, then stops and returns the command's exit status:

```sh
npx fireemu exec -- npm test

# Start only some services
npx fireemu exec --only auth,firestore,storage -- npm test
```

Requirements:

- Node.js 20 or newer.
- macOS 13 or newer (Apple silicon, Intel), Linux (x86-64, arm64) or Windows 10 or newer (x86-64).
- To run Node Functions: `firebase-functions` v6 or v7 in the codebase.
- To run a Python codebase: Python 3.10 to 3.14, its own `venv` with `firebase-functions`, and macOS or Linux.

The official command names `emulators:start` and `emulators:exec` work as aliases. `up` and `exec` read `fireemu.toml` (or an existing `fireemu.json`) from the current directory, or, when there is none, the nearest `firebase.json`; the first lines of the startup output name the files that were loaded. Run `npx fireemu --help` and `npx fireemu <command> --help` for every option, and `npx fireemu doctor` if the emulator does not start.

See [Install and run](https://fireemu.github.io/fireemu/getting-started/install/), [Connect your app](https://fireemu.github.io/fireemu/getting-started/connect/) and [Migrate from the Local Emulator Suite](https://fireemu.github.io/fireemu/getting-started/migrate/).

### Independent test worlds

The npm package also ships `fireemu/testing`, which starts independent emulator worlds with their own daemon, ports, clock and data for parallel integration tests, and `fireemu/control`, a client for the control API. `withTestWorld` starts the world and cleans it up when the test finishes, including when it fails:

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

See [Test worlds](https://fireemu.github.io/fireemu/guides/test-worlds/), [Time and scheduled functions](https://fireemu.github.io/fireemu/guides/time/) and the [design notes on test clocks and independent worlds](docs/test-worlds.md).

## Supported services

Find the services your app uses. Each guide describes the supported APIs and their limits.

| Product | Summary | Documentation |
|---|---|---|
| Cloud Firestore | Standard and Enterprise editions, composite index validation, Security Rules; the Enterprise Pipeline API supports a subset of read operations including bounded `union` and `sample` shapes, and text search is a local lexical engine | [Cloud Firestore](https://fireemu.github.io/fireemu/products/firestore/) |
| Firebase Authentication (Identity Platform) | Sign-in methods, TOTP and SMS multi-factor authentication, multi-tenancy, OIDC and SAML providers, blocking functions; flows that talk to external identity providers are outside the scope | [Authentication](https://fireemu.github.io/fireemu/products/auth/) |
| Cloud Storage for Firebase | Firebase and JSON APIs, Security Rules; signed-URL signatures, IAM, `compose` and notification configuration are outside the scope | [Cloud Storage](https://fireemu.github.io/fireemu/products/storage/) |
| Cloud Functions for Firebase | HTTP, callable, event, task-queue, blocking and scheduled functions on a virtual clock; Python codebases serve HTTP, callable, Firestore, Pub/Sub, Storage, Eventarc, database, scheduled, task-queue and blocking triggers in real time | [Cloud Functions](https://fireemu.github.io/fireemu/products/functions/) |
| Cloud Pub/Sub and Eventarc | Topics, subscriptions, push and pull delivery, dead-letter topics and StreamingPull; Eventarc custom events for Functions | [Pub/Sub and Eventarc](https://fireemu.github.io/fireemu/products/pubsub-eventarc/) |
| Firebase Realtime Database | REST, realtime protocol, Security Rules, export and import; supported for the recorded scope, verified against production for the recorded cases (an open gap against the official emulator) | [Realtime Database](https://fireemu.github.io/fireemu/products/realtime-database/) |
| Firebase Hosting | `firebase.json` Hosting sites served locally: static files, redirects, rewrites (including to functions of the same run), headers, clean URLs and localization; verified against production for its recorded cases, with no parity claim against the official emulator (an open gap) | [Firebase Hosting](https://fireemu.github.io/fireemu/products/hosting/) |
| Firebase App Check | Local testing with debug tokens; no real attestation providers or replay protection | [App Check](https://fireemu.github.io/fireemu/products/app-check/) |

App Hosting and Data Connect are deferred (not currently supported), and Firebase Extensions support is not planned. Fireemu also provides a UI for managing data and viewing logs.

This table is a summary, not an exhaustive list. See [Limitations](https://fireemu.github.io/fireemu/compatibility/limitations/), the [capability manifest](crates/fireemu/src/capabilities.json) (also printed by `npx fireemu capabilities`) and the [Functions support inventory](docs/functions-export-inventory.md) for individual APIs and conditions.

## Compatibility

Fireemu uses the `strict` profile by default. It has two compatibility profiles:

| Profile | Behavior |
|---|---|
| `strict` | Matches production Firebase behavior and constraints as closely as possible within the supported scope. This is the default profile. Recommended, including when migrating from the official emulator |
| `emulator` | Targets the behavior of a pinned version of the official emulator. Use it only to check alignment with the pinned official emulator (for example as an extra test target); it is not needed for a migration |

Where production needs setup that a test should not have to do (signed tokens, signing keys, enabling a feature through an Admin API call), both profiles use a documented development default with its own setting, and `productionExact = true` restores production's behavior for all of them. See [Profiles and productionExact](https://fireemu.github.io/fireemu/guides/profiles/).

Each area is compared with recordings from real Firebase projects. The [compatibility tables](https://fireemu.github.io/fireemu/compatibility/) list the areas verified against production, and the [compatibility documentation](docs/compatibility-contract.md) explains the verification process and how to read its records.

### Comparison with the official emulator

The official emulator comparison baseline is `firebase-tools 15.28.2`.

Fireemu is compatible with the listed Local Emulator Suite products as shipped by firebase-tools 15.28.2 -- Cloud Firestore, Firebase Authentication, Cloud Storage for Firebase, Cloud Functions, Cloud Pub/Sub and Eventarc, with Security Rules on the Firestore and Storage surfaces -- under the `emulator` compatibility profile and the evidence recorded in `spec/compatibility/contract.json`; it makes no complete-suite and no unqualified superset claim while the Realtime Database and Firebase Hosting are served without a parity claim against the official emulator (an open gap; both are verified against production for recorded cases), App Hosting and Data Connect are deferred and Firebase Extensions is not planned.

The [compatibility contract](spec/compatibility/contract.json) records scope and known differences. A successful local operation does not guarantee the same result in production: Fireemu does not reproduce real quota accounting, billing, IAM, organization policies, regional or network differences, or service rollouts.

## Configuration

`npx fireemu init` creates a minimal `fireemu.toml`:

```toml
#:schema https://raw.githubusercontent.com/fireemu/fireemu/v0.49.0/spec/config/fireemu.schema.json
schemaVersion = 1
profile = "strict"

[firestore]
edition = "standard"
apiMode = "native"
```

Keep Fireemu-specific settings in `fireemu.toml` and point it at your existing `firebase.json` (`npx fireemu init --firebase-json firebase.json`), whose rules, indexes, Functions codebases and ports are read on every start. `npx fireemu config show` prints every key with its effective value and source, and `npx fireemu config lint --deny-ineffective` fails when the configuration sets a key that is accepted but has no effect. In a released binary the `#:schema` line names the schema of that release (`v0.49.0` above), so the editor checks against what the installed version accepts (a build from source writes the `main` location); `npx fireemu config schema --out fireemu.schema.json` writes the exact schema of the installed binary without the network.

- [Configuration files](https://fireemu.github.io/fireemu/guides/configuration/): which files are loaded and the ownership checks on discovered files
- [Configuration schema](https://fireemu.github.io/fireemu/reference/configuration/): every section, and the [JSON Schema](spec/config/fireemu.schema.json)
- Guides: [Security Rules](https://fireemu.github.io/fireemu/guides/security-rules/), [Time and scheduled functions](https://fireemu.github.io/fireemu/guides/time/), [Export and import data](https://fireemu.github.io/fireemu/guides/data/), [Emulator UI](https://fireemu.github.io/fireemu/guides/ui/), [CI and containers](https://fireemu.github.io/fireemu/guides/ci-and-containers/), [Troubleshooting](https://fireemu.github.io/fireemu/guides/troubleshooting/)
- [CLI reference](https://fireemu.github.io/fireemu/reference/cli/)

Keep the emulator bound to localhost (the default); see [CI and containers](https://fireemu.github.io/fireemu/guides/ci-and-containers/) before exposing ports to other hosts.

## Performance

Fireemu is a single native binary. In one benchmark run on a GitHub Actions Linux runner, it was ready for the Firestore SDK in 140 ms and used 11 MiB of idle memory with an empty database (3,043 ms and 390 MiB for the official Firestore emulator in the same run). See [Performance](https://fireemu.github.io/fireemu/compatibility/performance/) for the method, the conditions and the full results.

## Changes between versions

Configuration and behavior may change between releases. See the [CHANGELOG](CHANGELOG.md).

## Reporting issues and contributing

When reporting an issue, include the Fireemu and Firebase SDK versions, the profile used, the Firebase product involved, and a minimal reproduction. For compatibility issues, also state whether you are comparing against the actual Firebase service or the official emulator, along with the expected and actual results. Remove credentials and personal information before sharing configuration files or logs.

See the [development guide](docs/development.md) for build and test instructions.

## License

Fireemu is licensed under the [Apache License 2.0](LICENSE). Third-party notices are listed in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt).
