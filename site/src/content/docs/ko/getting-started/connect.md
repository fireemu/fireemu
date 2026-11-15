---
title: 앱 연결하기
description: Firebase Admin SDK, 클라이언트 SDK, Security Rules 단위 테스트를 Fireemu 에뮬레이터에 연결합니다.
---

Fireemu는 Local Emulator Suite와 같은 프로토콜과 기본 포트를 제공하므로 같은 방식으로 연결합니다.

## 서버 코드와 Admin SDK 연결

Firebase Admin SDK와 Google Cloud 클라이언트 라이브러리는 에뮬레이터 환경 변수를 읽습니다. `fireemu exec`는 실행하는 명령에 이 변수들을 설정합니다.

```sh
npx fireemu exec -- node ./scripts/seed.mjs
```

| 변수 | 값 |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | Firestore의 `host:port` |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authentication의 `host:port` |
| `FIREBASE_STORAGE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` | Storage의 `host:port`와 `http://host:port` |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | 프로젝트 ID |
| `FIREEMU_CONTROL_URL`, `FIREEMU_CONTROL_TOKEN` | Fireemu의 제어 API. `fireemu/testing`이 사용 |

다른 에뮬레이터(Realtime Database, Pub/Sub, Eventarc, Cloud Tasks, App Check, Hub)의 변수는 조건과 함께 [환경 변수](../../reference/environment-variables/)에 나열되어 있습니다.

`exec` 아래에서는 Admin SDK에 연결 코드가 필요하지 않습니다.

```js
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Under `fireemu exec`, the Admin SDK finds the emulators from the environment.
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
await getFirestore().doc('notes/n1').set({ text: 'hello' });
```

### 셸에 이미 있는 변수

선택되지 않은 에뮬레이터의 변수는 환경에 있던 그대로 둡니다. 실행이 시작하지 않는 에뮬레이터에 대해 셸에 이미 있는 변수는 그대로 남고 경고와 함께 보고됩니다.

- `fireemu exec --plan -- <command>`는 명령이 보게 될 변수를 나열합니다.
- [`--deny-inherited-emulator-env`](../../reference/cli/#inherited-emulator-variables)를 지정하면 이런 실행은 시작하기 전에 실패합니다.

## 클라이언트 SDK 연결

Local Emulator Suite와 마찬가지로 클라이언트 SDK는 코드에서 연결합니다. Fireemu가 실행되는 프로젝트 ID를 사용하십시오. `.firebaserc`의 기본값, 없으면 `fireemu.toml`의 `daemon.authProject`, 그것도 없으면 `demo-app`입니다.

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

기본 포트는 [설치와 실행](../install/#default-ports)에 나열되어 있습니다. 두 제품은 연결 방식이 다릅니다.

- **Realtime Database.** 클라이언트에 별도의 `databaseURL`이 필요합니다. [Realtime Database](../../products/realtime-database/#connect)를 참고하십시오.
- **Hosting.** 일반 HTTP이며 SDK 설정이 필요하지 않습니다([Firebase Hosting](../../products/hosting/)).

## Security Rules 단위 테스트 실행

`@firebase/rules-unit-testing`은 Fireemu와 함께 동작합니다.

- 서명되지 않은 모의 ID 토큰(`authenticatedContext()`)은 `strict` 프로필에서도 기본적으로 수락됩니다.
- Firestore와 Storage 규칙을 로드하고 Firestore를 비우기 위해(`testEnv.clearFirestore()`) 호출하는 경로를 제공합니다.
- `withFunctionTriggersDisabled`를 제공합니다. 브라우저 메타데이터(`Origin`, `Sec-Fetch-Site`)를 보내지 않는 클라이언트에서 오는 `PUT /functions/disableBackgroundTriggers`와 `enableBackgroundTriggers`를 Hub가 토큰 없이 수락합니다.

[Security Rules](../../guides/security-rules/)를 참고하십시오.

## 프로젝트 ID

Fireemu는 다음 중 처음으로 설정된 값에서 프로젝트 ID를 가져옵니다.

1. 명령줄의 `--project`(`-P`). ID 또는 `.firebaserc` 별칭.
2. 로드된 `firebase.json` 옆에 있는 `.firebaserc`의 기본 프로젝트.
3. `fireemu.toml`의 `daemon.authProject`.
4. `demo-app`.

## 관련 문서

- [환경 변수](../../reference/environment-variables/)
- [Security Rules](../../guides/security-rules/)
- [CI와 컨테이너](../../guides/ci-and-containers/)
