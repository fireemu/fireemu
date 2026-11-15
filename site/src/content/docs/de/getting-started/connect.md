---
title: Ihre App verbinden
description: Richten Sie das Firebase Admin SDK, die Client-SDKs und Unit-Tests für Security Rules auf die Fireemu-Emulatoren aus.
---

Fireemu spricht dieselben Protokolle und verwendet dieselben Standardports wie die Local Emulator Suite, daher verbinden Sie sich auf dieselbe Weise.

## Servercode und das Admin SDK verbinden

Das Firebase Admin SDK und die Google-Cloud-Clientbibliotheken lesen die Umgebungsvariablen der Emulatoren. `fireemu exec` setzt sie für den Befehl, den es ausführt:

```sh
npx fireemu exec -- node ./scripts/seed.mjs
```

| Variable | Wert |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | `host:port` von Firestore |
| `FIREBASE_AUTH_EMULATOR_HOST` | `host:port` von Authentication |
| `FIREBASE_STORAGE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` | `host:port` und `http://host:port` von Storage |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | Die Projekt-ID |
| `FIREEMU_CONTROL_URL`, `FIREEMU_CONTROL_TOKEN` | Die Steuer-API von Fireemu, die `fireemu/testing` verwendet |

Die Variablen der anderen Emulatoren (Realtime Database, Pub/Sub, Eventarc, Cloud Tasks, App Check, der Hub) sind mit ihren Bedingungen unter [Umgebungsvariablen](../../reference/environment-variables/) aufgeführt.

Unter `exec` braucht das Admin SDK keinen Verbindungscode:

```js
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Under `fireemu exec`, the Admin SDK finds the emulators from the environment.
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
await getFirestore().doc('notes/n1').set({ text: 'hello' });
```

### Variablen, die bereits in Ihrer Shell gesetzt sind

Variablen für Emulatoren, die nicht ausgewählt sind, bleiben so, wie Ihre Umgebung sie hatte. Eine Variable, die Ihre Shell bereits für einen Emulator trägt, den der Lauf nicht startet, bleibt bestehen und wird mit einer Warnung gemeldet.

- `fireemu exec --plan -- <command>` listet auf, was der Befehl sehen wird.
- [`--deny-inherited-emulator-env`](../../reference/cli/#inherited-emulator-variables) lässt einen solchen Lauf scheitern, bevor er startet.

## Client-SDKs verbinden

Verbinden Sie Client-SDKs im Code, wie bei der Local Emulator Suite. Verwenden Sie die Projekt-ID, mit der Fireemu läuft: den Standard aus `.firebaserc`, sonst `daemon.authProject` in `fireemu.toml`, sonst `demo-app`.

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

Die Standardports sind unter [Installieren und starten](../install/#default-ports) aufgeführt. Zwei Produkte verbinden sich anders:

- **Realtime Database.** Der Client braucht eine eigene `databaseURL`; siehe [Realtime Database](../../products/realtime-database/#connect).
- **Hosting.** Es ist schlichtes HTTP und braucht keine SDK-Einrichtung ([Firebase Hosting](../../products/hosting/)).

## Unit-Tests für Security Rules ausführen

`@firebase/rules-unit-testing` funktioniert mit Fireemu:

- Die unsignierten Mock-ID-Tokens (`authenticatedContext()`) werden standardmäßig akzeptiert, auch unter dem Profil `strict`.
- Die Routen, die es zum Laden von Firestore- und Storage-Rules und zum Leeren von Firestore (`testEnv.clearFirestore()`) aufruft, werden bereitgestellt.
- `withFunctionTriggersDisabled` wird bereitgestellt: Der Hub akzeptiert `PUT /functions/disableBackgroundTriggers` und `enableBackgroundTriggers` ohne Token von einem Client, der keine Browser-Metadaten (`Origin`, `Sec-Fetch-Site`) sendet.

Siehe [Security Rules](../../guides/security-rules/).

## Die Projekt-ID

Fireemu übernimmt die Projekt-ID aus der ersten dieser Quellen, die gesetzt ist:

1. `--project` (`-P`) auf der Kommandozeile, als ID oder als Alias aus `.firebaserc`.
2. Das Standardprojekt der `.firebaserc` neben der geladenen `firebase.json`.
3. `daemon.authProject` in `fireemu.toml`.
4. `demo-app`.

## Siehe auch

- [Umgebungsvariablen](../../reference/environment-variables/)
- [Security Rules](../../guides/security-rules/)
- [CI und Container](../../guides/ci-and-containers/)
