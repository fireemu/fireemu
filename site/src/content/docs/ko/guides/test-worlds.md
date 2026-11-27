---
title: 테스트 월드
description: fireemu/testing 헬퍼를 사용해, 각각 자체 시계, 포트, 데이터를 가진 독립된 월드에서 병렬 통합 테스트를 실행합니다.
---

`fireemu/testing` 헬퍼는 병렬 테스트를 위한 독립된 월드를 시작합니다. 각 월드는 프로젝트 ID가 같더라도 자체 데몬, 포트, 시계, 데이터를 가집니다. 테스트가 시계, Rules, Functions를 변경한다면 월드를 사용하십시오. 하나의 데몬 안의 세션은 이 세 가지를 데몬과 공유합니다.

월드는 시계의 시작 시점을 고정하므로 시계가 멈춰 있고, 테스트가 직접 시계를 움직입니다([시간과 예약 함수](../time/) 참조).

## 시계 범위와 리셋

테스트를 작성하기 전에 이 두 절을 읽어 보십시오. 시계 이동이 영향을 주지 않는 대상과 `reset()`이 무효화하는 대상을 설명합니다.

### 시계 이동이 영향을 주는 대상

`world.clock`은 데몬의 시계를 움직입니다. 테스트 프로세스의 시계나 사용자가 시작한 다른 어떤 것의 시계도 움직이지 않습니다.

| 대상 | `world.clock`으로 이동하는가? |
| --- | --- |
| Functions의 `Date`, `Date.now()`, `new Date()` | 예. 월드에서는 기본값입니다(`functions.clock.date`가 `virtual`). |
| Security Rules `request.time`, Auth, Storage, App Check 타임스탬프 | 예. |
| Cloud Tasks 스케줄 시각, 재시도 백오프, 속도 충전 | 예. 월드에서는 기본값입니다(`functions.clock.tasks`가 `virtual`). |
| 예약된 Functions | 예. |
| Functions JavaScript 타이머(`setTimeout`, `setInterval`) | 기본적으로 아니요(`functions.clock.timers`가 `real`). `timers: 'virtual'`을 사용하면 시계 이동으로 타이머가 실행 시점에 도달하고 `world.clock.runDue()`가 이를 실행합니다. |
| 테스트 프로세스: `Date.now()`, `performance.now()`, 해당 타이머 | 아니요. 직접 만든 헬퍼에는 명시적인 시각을 전달하십시오. |
| `world.run()`으로 시작한 명령의 `Date.now()`와 `performance.now()` | 아니요. 월드로의 라우팅만 받습니다. |
| 외부 서비스와 데몬 밖의 모든 것 | 아니요. |

### `reset()`이 무효화하는 대상

`world.reset()`은 데몬을 중지하고, 월드를 만들 때 찍은 스냅샷에서 새 데몬, 즉 새로운 *세대(generation)*를 시작합니다.

- 이전 세대에서 읽은 모든 것은 오래된 값이 됩니다. `world.endpoints`, `world.environment`, `world.uiUrl`, 이들로 만든 SDK 인스턴스와 클라이언트, 이전 제어 URL과 토큰으로 만든 제어 클라이언트가 해당합니다. `reset()`이 완료된 뒤에는 getter를 다시 읽고 다시 연결하십시오.
- `world.control()`, `world.clock.*`, `world.run()`은 항상 현재 세대를 사용합니다. `createControlClient({ env: world.environment })`나 명시적 출처와 토큰으로 만든 클라이언트는 이전 세대의 엔드포인트와 자격 증명을 유지하므로, `reset()` 뒤에 다시 만드십시오.
- 이전 세대에서 `world.run()`으로 시작한 명령은 종료됩니다.
- `reset()`은 현재 소스가 아니라 *생성 시점 스냅샷*으로 돌아갑니다. 월드를 만든 뒤 Functions 코드, Rules, 인덱스, 구성에 가한 수정은 반영되지 않습니다. 이를 사용하려면 새 월드를 만드십시오.

### 재시작 없이 상태 복원

v0.69.0부터 `world.resetState()`는 엔드포인트를 유지하면서 초기 상태를 복원합니다. `world.checkpoint()`, `world.restore()`, `world.deleteCheckpoint()`를 사용해 복원 지점을 관리합니다.

## 월드 시작

```js
import { withTestWorld } from 'fireemu/testing';

await withTestWorld(
  {
    projectId: 'demo-parallel',
    clockStart: '2026-01-31T23:59:00Z',
    functionsSource: './functions',
    services: ['auth', 'firestore', 'storage', 'functions'],
  },
  async (world) => {
    await world.clock.advance(59999); // milliseconds: one millisecond before midnight
    await world.run(process.execPath, ['./trial-before-expiry.mjs']);
    await world.clock.advance(1);
    await world.run(process.execPath, ['./trial-expired.mjs']);
  },
);
```

- `world.run`은 월드의 프로젝트와 에뮬레이터 호스트를 설정해 명령을 실행합니다.
- `world.reset()`은 생성 시점 스냅샷에서 월드를 다시 시작합니다.
- `world.dispose()`는 월드를 중지하고 파일을 제거합니다. `withTestWorld`는 콜백이 예외를 던질 때도 자동으로 dispose합니다.

서로 다른 월드는 시계, Rules, Functions, 서비스 상태를 격리합니다.

`fireemu/control` 클라이언트는 `fireemu exec` 명령에서도 동작하며 URL 해석과 인증을 `world.control()`과 공유하므로, 호출하는 쪽에서 제어 URL을 직접 이어 붙일 필요가 없습니다([테스트 월드 가이드](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md) 참조).

### 하나의 테스트에서 여러 월드 사용

- `Promise.all`을 사용할 때는 각 월드에 자체 `withTestWorld()`를 사용하여, 다른 월드가 실패하더라도 모든 월드가 dispose되도록 하십시오.
- 하나의 테스트 안에서 함께 존재해야 하는 월드는 `Promise.allSettled`로 만들고 `finally`에서 dispose합니다.
- `Promise.all([createTestWorld(), ...])` 뒤에 `try/finally`를 두면, 하나의 생성이 실패할 때 이미 시작된 월드가 누수됩니다([테스트 월드 가이드](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds) 참조).

## Hosting 사이트 테스트

`hosting`을 선택하면 `firebase.json`에 지정된 사이트를 월드에 할당된 포트로 제공할 수 있습니다. Functions로 요청을 재작성하는 경우 `functions`와 해당 함수에서 사용하는 서비스도 선택하세요.

```js
import { withTestWorld } from 'fireemu/testing';

await withTestWorld(
  { firebaseJson: 'firebase.json', services: ['hosting', 'functions', 'firestore'] },
  async (world) => {
    const url = world.hostingUrl;
    if (!url) throw new Error('The world has no Hosting site');
    await page.goto(url);
  },
);
```

`world.hostingUrl`은 첫 번째 사이트의 URL입니다. `world.endpoints.hosting`은 해당 사이트의 엔드포인트를 나타내며, `world.hostingSites`는 구성 순서대로 각 사이트의 `site`와 `url`을 제공합니다. 이름이나 배포 대상이 없는 사이트에는 월드의 프로젝트 ID가 사용됩니다. Hosting을 끄면 기본 URL과 엔드포인트는 `undefined`이고 사이트 목록은 비어 있습니다.

병렬 브라우저 워커는 같은 프로젝트 ID와 상대 API 경로를 사용할 수 있습니다. 각 워커는 자기 월드의 URL을 엽니다. 월드를 리셋하면 생성 시 저장한 공개 파일과 Firestore 및 Realtime Database 규칙이 복원됩니다. 리셋한 뒤에는 Hosting URL을 다시 읽으세요.

## 달력 단위로 시계 이동

`world.clock.advance`에는 ISO 8601 형식의 기간이나 달력 단위도 지정할 수 있습니다. `world.clock.to`는 시계를 일, 월, 연도의 시작 또는 끝으로 옮깁니다. 달력 단위와 경계 시각을 계산할 때는 `timeZone`을 사용합니다. 생략하면 월드의 `scheduler.defaultTimeZone`을 사용하고, 이 값도 없으면 UTC를 사용합니다. 자세한 규칙은 [시간과 예약 함수](../time/#지정한-기간만큼-또는-달력의-경계로-시계-이동)를 참조하십시오.

```js
await world.clock.advance({ months: 1 });                      // 1월 31일이 2월 28일 또는 29일이 됨
await world.clock.advance('PT36H');                            // 정확한 경과 시간
await world.clock.advance({ days: -3 }, { allowBackwards: true });
await world.clock.to('endOfMonth');                            // 현지 시각 23:59:59.999999
await world.clock.to('startOfMonth', { duration: { months: 1 }, timeZone: 'Asia/Tokyo' });
```

숫자는 여전히 밀리초를 뜻하며 `{ seconds }` 또는 `{ millis }` 객체는 이전처럼 지정한 경과 시간만큼 시계를 옮깁니다. 달력 단위는 `millis`와 함께 사용할 수 없으며 모두 같은 부호여야 합니다. `world.clock.to`는 `clock:set`을 사용하므로 현재보다 이른 시각으로 이동하려면 `allowBackwards: true`가 필요합니다. `advanceAndSettle`에도 같은 기간을 지정할 수 있으며 옵션에는 `timeZone`과 `allowBackwards`가 있습니다. `advance`와 `advanceAndSettle`의 `timeZone` 및 `allowBackwards` 옵션은 ISO 8601 문자열과 달력 단위 객체에 적용됩니다. 숫자와 `{ seconds }`, `{ millis }` 형식에서는 이 옵션을 사용할 수 없습니다.

## 시계를 진행하고 작업 대기

`world.clock.advanceAndSettle(duration, { scope, timeoutSeconds, runTimers })`는 시계를 진행하고, 실행 시점이 된 가상 타이머를 실행하고, 데몬이 유휴 상태가 될 때까지 기다립니다. 이 순서로 수행합니다. 기본 범위는 `runnable`이며, 이동 이후로 예약된 작업은 기다리지 않습니다. 이동이 실패하거나 대기가 시간 초과되면 reject됩니다.

```js
const { clock, timers, idle } = await world.clock.advanceAndSettle({ seconds: 60 });
```

`awaitIdle`과 시계 이동을 동시에 수행해도 동작합니다. 대기 중인 `awaitIdle`이 같은 월드에서 이후의 시계 호출을 막지 않기 때문입니다.

```js
await Promise.all([
  world.control('POST', 'sessions/default:awaitIdle', { timeoutSeconds: 20 }),
  world.clock.advance({ seconds: 60 }),
]);
```

`reset()`과 `dispose()`는 대기 중인 대기를 시간 예산이 끝나기를 기다리지 않고 취소합니다. 순서 규칙은 [테스트 월드 가이드](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#advance-the-clock-and-wait-for-work)에 있습니다.

## 실행 가능한 작업 대기

`POST /v1/sessions/default:awaitIdle`은 `{ "scope": "runnable" }`을 받습니다(v0.26.0부터). 월드에서는 다음과 같이 사용합니다.

```js
await world.control('POST', 'sessions/default:awaitIdle', { scope: 'runnable' });
```

- `runnable` 범위는 미래의 작업 스케줄과 미래의 재시도 백오프를 대기에서 제외합니다. 기본 범위는 여전히 모든 작업을 기다립니다.
- 속도 제한이나 동시성 제한에 막힌 실행 시점이 된 작업과 활성 HTTP 요청은 계속 대기 상태로 남습니다. 해당하는 시계를 진행하거나 활성 작업을 기다리십시오. 진단 정보가 대기 중인 단계와 기한을 알려 줍니다.
- 사용자가 임의로 만든 JavaScript 타이머는 기다리지 않습니다.

[유휴 범위와 작업 시계](https://github.com/fireemu/fireemu/blob/main/docs/tasks-idle.md)를 참조하십시오.

## Vitest와 Playwright용 픽스처

픽스처에서 월드를 만들고, 각 테스트에 이름이 붙은 고유한 Admin SDK 앱을 주고, 정리 단계에서 앱을 삭제하십시오. `reset()` 뒤에는 앱을 삭제하고, `world.endpoints`를 다시 읽고, 새 앱을 만드십시오. 기본 Admin 앱은 프로세스 전체에서 캐시되며 월드로 리다이렉트할 수 없습니다.

### 상속된 Firestore 호스트 지우기

Firebase Admin의 Firestore SDK는 `db.settings({ host })`보다 `FIRESTORE_EMULATOR_HOST`를 우선합니다. Vitest와 Playwright는 러너를 바깥쪽 `fireemu exec`로 감싸지 않고 직접 실행하고, 워커를 시작하기 전에 전용 러너 프로세스에서 상속된 호스트를 한 번 지우십시오. 예를 들어 POSIX 셸에서는 다음과 같습니다.

```sh
env -u FIRESTORE_EMULATOR_HOST npx vitest run
env -u FIRESTORE_EMULATOR_HOST npx playwright test
```

아래의 픽스처 가드는 워커에 그 변수가 남아 있으면 연결하기 전에 실패합니다. 각 테스트에서 공유 `process.env`를 변경하지 마십시오. 테스트가 의도적으로 환경에 에뮬레이터 호스트를 유지한다면, 그 테스트를 `world.run()`으로 실행하여 자식 프로세스가 월드의 엔드포인트를 받게 하십시오.

### 픽스처 예제

```ts
// Vitest: test/world.ts
import { test as base } from 'vitest';
import { createTestWorld, type TestWorld } from 'fireemu/testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function assertFirestoreHostIsNotInherited() {
  if ('FIRESTORE_EMULATOR_HOST' in process.env) {
    throw new Error('Start Vitest with FIRESTORE_EMULATOR_HOST cleared before workers start');
  }
}

export const test = base.extend<{ world: TestWorld; admin: { db: () => Firestore; reset: () => Promise<Firestore> } }>({
  world: async ({}, use) => {
    assertFirestoreHostIsNotInherited();
    const world = await createTestWorld({ services: ['auth', 'firestore'] });
    try {
      await use(world);
    } finally {
      await world.dispose();
    }
  },
  admin: async ({ world }, use) => {
    assertFirestoreHostIsNotInherited();
    let app: App | undefined;
    let db: Firestore;
    const connect = () => {
      const { host, port } = world.endpoints.firestore!;
      app = initializeApp({ projectId: world.projectId }, `world-${world.id}-${world.generation}`);
      db = getFirestore(app);
      db.settings({ host: `${host}:${port}`, ssl: false });
      return db;
    };
    connect();
    try {
      await use({
        db: () => db,
        reset: async () => {
          await deleteApp(app!);
          app = undefined;
          await world.reset();
          return connect();
        },
      });
    } finally {
      if (app) await deleteApp(app);
    }
  },
});
```

```ts
// Playwright: one world per worker, a clean generation and a new Admin app per test
import { test as base } from '@playwright/test';
import { createTestWorld, type TestWorld } from 'fireemu/testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function assertFirestoreHostIsNotInherited() {
  if ('FIRESTORE_EMULATOR_HOST' in process.env) {
    throw new Error('Start Playwright with FIRESTORE_EMULATOR_HOST cleared before workers start');
  }
}

export const test = base.extend<{ db: Firestore }, { world: TestWorld }>({
  world: [
    async ({}, use) => {
      assertFirestoreHostIsNotInherited();
      const world = await createTestWorld({ services: ['auth', 'firestore'] });
      try {
        await use(world);
      } finally {
        await world.dispose();
      }
    },
    { scope: 'worker' },
  ],
  db: async ({ world }, use, testInfo) => {
    assertFirestoreHostIsNotInherited();
    await world.reset(); // endpoints below are read after the reset
    const { host, port } = world.endpoints.firestore!;
    const app = initializeApp({ projectId: world.projectId }, `test-${testInfo.testId}-${world.generation}`);
    const db = getFirestore(app);
    db.settings({ host: `${host}:${port}`, ssl: false });
    try {
      await use(db);
    } finally {
      await deleteApp(app);
    }
  },
});
```

Admin Auth처럼 환경에서 에뮬레이터 호스트를 읽는 클라이언트는 이름이 붙은 앱으로는 월드를 가리키게 할 수 없습니다. 해당 코드는 `world.run()`으로 실행하십시오. `world.run()`은 `world.environment`를 자식 프로세스에 전달합니다.

## Python / Go

참고 [Python and Go](https://fireemu.github.io/fireemu/guides/test-worlds/#python-and-go).

## TypeScript

`fireemu/testing`과 `fireemu/control`은 strict `NodeNext` 및 번들러 모듈 해석을 위한 타입 선언을 함께 제공합니다. 별도의 타입 패키지 없이 하위 경로를 직접 import하십시오.

```ts
import { withTestWorld, type TestWorldOptions } from 'fireemu/testing';
import { createControlClient } from 'fireemu/control';

const options = { services: ['auth', 'firestore'] as const } satisfies TestWorldOptions;
const projectId: string = await withTestWorld(options, (world) => world.projectId);

const client = createControlClient({ origin: 'http://127.0.0.1:9000', token: 'your-control-token' });
const response: unknown = await client.request('GET', 'sessions/default');
```

- 잘못 쓴 서비스 이름, 지원하지 않는 시계 모드, 알 수 없는 옵션은 컴파일 오류가 됩니다.
- 월드와 클라이언트의 프로퍼티는 읽기 전용이고, `uiUrl`은 `string | undefined`이며, 선택한 서비스만 시작되므로 각 서비스 엔드포인트는 선택적입니다.
- 일반 제어 요청은 `unknown`으로 해석됩니다. 필드를 읽기 전에 응답의 타입을 좁히십시오.
- 타입은 런타임 한도를 보장하지 않습니다(예: `runDue`에는 1부터 10000까지의 정수 예산이 필요합니다). 이런 값은 헬퍼가 실행될 때 검사합니다.

자세한 내용은 [테스트 월드 가이드](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#typescript-consumers)를 참조하십시오.

## UI에서 월드 살펴보기

UI는 기본적으로 비활성화되어 있습니다. 디버그 UI에서 월드를 살펴보려면 `createTestWorld()`에 `ui: true`를 전달하고 `world.uiUrl`을 여십시오.

- 활성화된 각 월드는 자체 루프백 포트를 받고, 라이브 Firestore, Auth, Storage, Functions 상태를 공유합니다.
- 살펴보는 동안에는 월드를 살려 두십시오. `dispose()`는 UI도 중지합니다.
- `reset()` 뒤에는 `world.uiUrl`을 다시 읽고 페이지를 다시 여십시오.

대화형 예제는 [테스트 월드](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#inspect-a-world-in-the-ui)를 참조하십시오.

## 내보내기와 가져오기

테스트 월드를 내보내고 그 데이터를 새 월드로 가져오려면 `hub: true`를 활성화하십시오. [독립된 테스트 월드 내보내기](../data/#독립-테스트-월드-내보내기)를 참조하십시오.

## 스냅샷 비용

월드는 Functions를 로드할 때만 Functions 소스, 의존성 링크, `NODE_PATH` 루트를 복사합니다. `services`를 생략한 경우(구성에 소스나 매니페스트가 지정되어 있으면 기본 선택에 Functions가 포함됩니다), 또는 `functions`나 `functions:<codebase>`를 나열한 경우입니다.

`['auth', 'firestore']` 같은 선택은 이 모두를 건너뛰고 스냅샷된 구성에서 Functions 섹션을 제거합니다. Auth 차단 함수와 이벤트 트리거 함수는 Functions 서비스에서 실행되므로, 이를 사용하려면 `functions`를 선택하십시오.

`world.snapshotStats`는 각 복사에 든 비용을 보고합니다.

- `initial`은 입력을 한 번 복사한 것입니다.
- 각 `generations` 항목은 한 세대(생성 및 매번의 `reset()`)를 시작한 복사입니다.
- 각 항목에는 `files`, `directories`, `symlinks`, `bytes`, `method`(`copy`, `clone`, `mixed`), `elapsedMs`가 있습니다.

`FIREEMU_TEST_WORLD_STATS=1`을 설정하면 복사마다 한 줄씩 stderr에 출력합니다.

```js
const { initial, generations } = world.snapshotStats;
console.log(initial.functions, initial.files, initial.elapsedMs, generations.at(-1).method);
```

세대 복사는 플랫폼이 지원하는 곳에서는 copy-on-write(APFS의 macOS `cp -c`, 이를 허용하는 Linux 파일 시스템의 reflink)를 사용하고, 그렇지 않으면 일반 복사를 사용합니다. 어느 쪽이든 각 세대는 자신의 바이트를 소유합니다. [스냅샷이 복사하는 대상과 그 비용](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#what-a-snapshot-copies-and-what-it-costs)을 참조하십시오.

## 스냅샷과 타임아웃

| 옵션 | 제한 대상 | 기본값 |
| --- | --- | --- |
| `snapshotTimeoutMs` | 초기 입력 스냅샷과 첫 세대 준비를 합산한 시간, 그리고 각 리셋 준비를 개별적으로 제한합니다. 1부터 2,147,483,647까지의 정수를 받습니다. | 60,000 ms |
| `startupTimeoutMs` | 준비 이후 데몬이 준비 상태가 될 때까지의 시간. | 60,000 ms |

- 타임아웃이나 취소가 발생하면 파일 복사를 중지하고, 활성 복사가 정리되기를 기다린 뒤, 읽기 전용으로 복사된 디렉터리를 포함한 불완전한 스냅샷을 정리합니다.
- 구성 파일은 일반 파일로 해석되어야 합니다. 복사되는 트리에는 디렉터리, 일반 파일, 지원되는 의존성 링크를 포함할 수 있지만, 다른 파일 시스템 유형은 거부됩니다.
- 준비가 시간 초과되면 사용하지 않는 의존성을 줄이거나 `snapshotTimeoutMs`를 늘리십시오. 준비 상태 타임아웃을 늘리는 것은 도움이 되지 않습니다.
- 리셋은 이전 세대를 먼저 종료하므로, 준비가 실패해도 이전 데몬이 계속 실행되지는 않습니다.

### 의존성 스냅샷과 전역 NODE_PATH

Functions 월드는 호출자의 수정이 리셋에 영향을 주지 않도록 로컬 소스와 의존성을 스냅샷합니다. 주변 `NODE_PATH`는 기본적으로 비워지며(v0.27.0부터), 일반적인 부모 환경 변수는 계속 상속됩니다. 로컬 소스와 상위 `node_modules`는 여전히 스냅샷됩니다.

- 전역 경로를 유지하려면 `env: { ...process.env }`를 전달하거나, 필요한 디렉터리만 담은 좁은 `env.NODE_PATH`를 제공하십시오. `NODE_PATH`를 포함한 환경 객체는 스프레드로 만들었더라도 옵트인으로 취급됩니다.
- `nodePathExcludes`는 링크를 따라가기 전에, 범위 이름(scoped name)을 포함해 사용하지 않는 패키지 이름을 정확히 일치시켜 제외합니다. 필요한 의존성의 실패는 여전히 오류입니다.
- v0.27.0 이전에는 월드가 상속된 `NODE_PATH` 디렉터리도 복사했으며, 여기에는 링크된 전역 개발 저장소도 포함되었습니다. 그래서 사용하지 않는 링크된 저장소가 시작을 느리게 하거나 테스트가 시작되기 전에 복사를 실패시킬 수 있었습니다. 해당 버전에서 로컬 의존성만 사용하려면 `env: { ...process.env, NODE_PATH: '' }`를 전달하십시오.

[의존성 스냅샷 제한](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds)을 참조하십시오.

## 관련 문서

- [시간과 예약 함수](../time/)
- [데이터 내보내기와 가져오기](../data/#독립-테스트-월드-내보내기)
- [에뮬레이터 UI](../ui/)
- [Cloud Functions](../../products/functions/)
