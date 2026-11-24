---
title: Migrate from the Local Emulator Suite
description: Move a project from firebase emulators:exec to Fireemu and handle tests that fail under strict mode.
---

Fireemu reads your existing `firebase.json`, listens on the same default ports, and accepts the Firebase CLI command aliases, so moving an existing suite usually comes down to changing one command.

## Before you start

Make sure every service your tests need is on the [supported services list](../../#supported-products). Google's Local Emulator Suite also covers App Hosting, Data Connect, and Extensions, which Fireemu does not serve, and Realtime Database support is partial.

## Switch the commands

1. Install Fireemu and generate a `fireemu.toml` that points to your `firebase.json`:

   ```sh
   npm install --save-dev fireemu
   npx fireemu init --firebase-json firebase.json
   ```

   Leave `profile = "strict"` (the default) as is.

2. Swap the invocation in your scripts or CI workflow:

   | Before | After |
   |---|---|
   | `firebase emulators:exec "npm test"` | `fireemu exec -- npm test` |
   | `firebase emulators:start` | `fireemu up` |

   The aliases `fireemu emulators:exec` and `fireemu emulators:start` also work, and `exec` accepts the quoted single-string script form too.

3. Run your test suite.

## When a test fails under `strict`

Tests that pass on the official emulator and fail under `strict` usually point to constraints your app will also hit in production. Rather than switching the whole profile to `emulator` (which turns off production checks across all services), fix the app or test, or adjust only the specific setting below.

### Unsigned emulator ID tokens

`@firebase/rules-unit-testing`'s `authenticatedContext()` and the client SDK's `mockUserToken` work under `strict` by default.

- Set `auth.allowUnsignedIdTokens = false` to turn off the mock-token fallback on Security Rules surfaces and test production's refusal of unsigned tokens.
- When testing refusal with the SDK helper's default `iat: 0` / `exp: 3600`, move the clock past expiry; tokens minted by Fireemu that pass normal verification remain accepted.
- Set `auth.idTokenSigning = "session-rsa"` to reject all unsigned ID tokens.

See [Unsigned mock ID tokens](../../products/auth/#unsigned-mock-id-tokens).

### Named databases

Just as in production, declare each named Firestore database in the `firestore` array of `firebase.json` (with its `rules` and `indexes` files), or create it via the Admin API. A database created at runtime starts without Security Rules until you load rules for it ([Firestore named databases](../../products/firestore/#named-databases)).

### Composite indexes

Firestore checks queries against the indexes declared in `firestore.indexes.json` (referenced from `firebase.json`), matching production:

- Queries missing an index fail with `FAILED_PRECONDITION` and a console link to create it.
- Single-field entries in `compositeIndexes` fail at load time, just as `firebase deploy` rejects them; use `fieldOverrides` instead.
- If you want tests to keep running while you backfill missing indexes, set `firestore.missingIndexes = "report"`. Queries execute normally and each missing index is printed once per database to stderr along with the `firestore.indexes.json` snippet. `productionExact` does not override this setting.
- For `OR` queries that need multiple branch indexes, supplementary diagnostics on stderr list every missing branch index together so you can add them in one pass (deduplicated with a bounded cache). Under `strict`, the SDK error still includes the first creation link; under `emulator`, the query runs.

### Settings that mirror your production project

If your production Firebase project uses non-default settings, configure those directly instead of changing the profile:

| Setting | Behavior under `strict` |
|---|---|
| `auth.improvedEmailPrivacy` | Email enumeration protection is enabled by default, matching new production projects. Set it to `false` only if your production project disables it; sign-ins then return `EMAIL_NOT_FOUND` and `INVALID_PASSWORD`. |
| `auth.mfa` | Multi-factor configuration. `strict` enables SMS and TOTP by default for convenience; `productionExact` starts with MFA off, matching a fresh production project ([Authentication MFA](../../products/auth/#multi-factor-authentication)). |
| `firestore.enforceLimits` | Enforces Standard edition query limits, as production always does. Keep it enabled unless you intentionally want to bypass those limits; under `strict`, this key toggles only query limits. |

## Differences from the official CLI

- **Failed `--export-on-exit`**: if export fails after the test command succeeds, Fireemu exits 1 instead of warning and exiting 0, so CI jobs that depend on exported data do not silently pass.
- **File ownership checks on Unix**: auto-discovered `fireemu.toml` and `firebase.json` files are loaded only when owned by a trusted user ([file ownership checks](../../guides/configuration/#file-ownership-checks)).
- **Projects without Security Rules**: under `strict`, a project with no rules loaded refuses client requests, matching a production project without a rules release ([Security Rules](../../guides/security-rules/)).

## Related

- [Connect your app](../connect/)
- [Profiles and productionExact](../../guides/profiles/)
- [Compatibility tables](../../compatibility/)
- [Limitations](../../compatibility/limitations/)
