---
title: Connect your app
description: Point the Firebase Admin SDK, client SDKs, and Security Rules unit tests at Fireemu.
---

Fireemu speaks the same protocols and uses the same default ports as the Firebase Local Emulator Suite, so SDK connection code works without changes.

## Connect server code and the Admin SDK

The Firebase Admin SDK and Google Cloud client libraries discover emulators from environment variables. `fireemu exec` sets them automatically for the command it runs:

```sh
npx fireemu exec -- node ./scripts/seed.mjs
```

| Variable | Value |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | Firestore `host:port` |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authentication `host:port` |
| `FIREBASE_STORAGE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` | Storage `host:port` and `http://host:port` |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | The project ID |
| `FIREEMU_CONTROL_URL`, `FIREEMU_CONTROL_TOKEN` | Fireemu control API (used by `fireemu/testing`) |

Variables for Realtime Database, Pub/Sub, Eventarc, Cloud Tasks, App Check, and the Hub are listed in [Environment variables](../../reference/environment-variables/).

Under `exec`, the Admin SDK connects without extra code:

```js
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Under `fireemu exec`, the Admin SDK reads the emulator host variables automatically.
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
await getFirestore().doc('notes/n1').set({ text: 'hello' });
```

### Variables already in your shell

Variables for emulators that were not started are left untouched. If your shell already defines a host variable for an unselected emulator, Fireemu keeps it and prints a warning.

- Run `fireemu exec --plan -- <command>` to see the exact environment variables your command will receive.
- Pass [`--deny-inherited-emulator-env`](../../reference/cli/#inherited-emulator-variables) to fail fast instead of inheriting leftover variables.

## Connect client SDKs

Connect client SDKs in code the same way as with the Local Emulator Suite. Match the project ID Fireemu uses (the `.firebaserc` default, `daemon.authProject` in `fireemu.toml`, or `demo-app`).

```js
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const app = initializeApp({
  projectId: 'demo-app',
  apiKey: 'fake-api-key',
  storageBucket: 'demo-app.appspot.com',
});

connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099');
connectFirestoreEmulator(getFirestore(app), '127.0.0.1', 8080);
connectStorageEmulator(getStorage(app), '127.0.0.1', 9199);
connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);
```

See [Default ports](../install/#default-ports) for the full port table. Two services connect differently:

- **Realtime Database**: client SDKs need a `databaseURL`; see [Realtime Database](../../products/realtime-database/#connect).
- **Hosting**: plain HTTP, no SDK setup required ([Firebase Hosting](../../products/hosting/)).

## Run Security Rules unit tests

`@firebase/rules-unit-testing` works directly with Fireemu:

- Unsigned mock ID tokens from `authenticatedContext()` are accepted by default, including under `strict`.
- The routes for loading Firestore/Storage rules and clearing Firestore (`testEnv.clearFirestore()`) are supported.
- `withFunctionTriggersDisabled` works through the Hub's `PUT /functions/disableBackgroundTriggers` and `enableBackgroundTriggers` endpoints (accepted without a control token from non-browser clients that omit `Origin` and `Sec-Fetch-Site`).

See [Security Rules](../../guides/security-rules/) for denial logs and mock-token settings.

## The project ID

Fireemu resolves the project ID in this order:

1. `--project` (`-P`) on the command line (project ID or `.firebaserc` alias).
2. The default project in the `.firebaserc` next to the loaded `firebase.json`.
3. `daemon.authProject` in `fireemu.toml`.
4. `demo-app`.

## Related

- [Environment variables](../../reference/environment-variables/)
- [Security Rules](../../guides/security-rules/)
- [CI and containers](../../guides/ci-and-containers/)
