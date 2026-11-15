---
title: Conecta tu app
description: Apunta el Firebase Admin SDK, los SDK de cliente y las pruebas unitarias de Security Rules a los emuladores de Fireemu.
---

Fireemu sirve los mismos protocolos y los mismos puertos predeterminados que la Local Emulator Suite, así que te conectas a él de la misma forma.

## Conecta el código de servidor y el Admin SDK

El Firebase Admin SDK y las bibliotecas cliente de Google Cloud leen las variables de entorno del emulador. `fireemu exec` las define para el comando que ejecuta:

```sh
npx fireemu exec -- node ./scripts/seed.mjs
```

| Variable | Valor |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | `host:port` de Firestore |
| `FIREBASE_AUTH_EMULATOR_HOST` | `host:port` de Authentication |
| `FIREBASE_STORAGE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` | `host:port` de Storage y `http://host:port` |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | El ID de proyecto |
| `FIREEMU_CONTROL_URL`, `FIREEMU_CONTROL_TOKEN` | La API de control de Fireemu, usada por `fireemu/testing` |

Las variables de los demás emuladores (Realtime Database, Pub/Sub, Eventarc, Cloud Tasks, App Check, el Hub) se enumeran con sus condiciones en [Variables de entorno](../../reference/environment-variables/).

Bajo `exec`, el Admin SDK no necesita código de conexión:

```js
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Under `fireemu exec`, the Admin SDK finds the emulators from the environment.
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
await getFirestore().doc('notes/n1').set({ text: 'hello' });
```

### Variables que ya están en tu shell

Las variables de los emuladores que no se seleccionan se dejan como las tenía tu entorno. Una variable que tu shell ya contiene para un emulador que la ejecución no inicia permanece en su sitio y se informa con una advertencia.

- `fireemu exec --plan -- <command>` enumera lo que verá el comando.
- [`--deny-inherited-emulator-env`](../../reference/cli/#variables-de-emulador-heredadas) hace que una ejecución así falle antes de iniciarse.

## Conecta los SDK de cliente

Conecta los SDK de cliente en el código, como con la Local Emulator Suite. Usa el ID de proyecto con el que se ejecuta Fireemu: el valor predeterminado de `.firebaserc`; si no, `daemon.authProject` en `fireemu.toml`; si no, `demo-app`.

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

Los puertos predeterminados se enumeran en [Instalación y ejecución](../install/#puertos-predeterminados). Dos productos se conectan de otra manera:

- **Realtime Database.** El cliente necesita su propio `databaseURL`; consulta [Realtime Database](../../products/realtime-database/#conectar).
- **Hosting.** Es HTTP simple y no necesita configuración de SDK ([Firebase Hosting](../../products/hosting/)).

## Ejecuta pruebas unitarias de Security Rules

`@firebase/rules-unit-testing` funciona con Fireemu:

- Sus ID tokens simulados sin firmar (`authenticatedContext()`) se aceptan por defecto, también bajo el perfil `strict`.
- Se sirven las rutas que llama para cargar las reglas de Firestore y Storage y para vaciar Firestore (`testEnv.clearFirestore()`).
- Se sirve `withFunctionTriggersDisabled`: el Hub acepta `PUT /functions/disableBackgroundTriggers` y `enableBackgroundTriggers` sin token de un cliente que no envía metadatos de navegador (`Origin`, `Sec-Fetch-Site`).

Consulta [Security Rules](../../guides/security-rules/).

## El ID de proyecto

Fireemu toma el ID de proyecto del primero de estos que esté definido:

1. `--project` (`-P`) en la línea de comandos, como un ID o un alias de `.firebaserc`.
2. El proyecto predeterminado del `.firebaserc` situado junto al `firebase.json` cargado.
3. `daemon.authProject` en `fireemu.toml`.
4. `demo-app`.

## Relacionado

- [Variables de entorno](../../reference/environment-variables/)
- [Security Rules](../../guides/security-rules/)
- [CI y contenedores](../../guides/ci-and-containers/)
