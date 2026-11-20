---
title: テストワールド
description: fireemu/testingヘルパーを使い、それぞれが独自のクロック、ポート、データを持つ独立したワールドで、並列の統合テストを実行します。
---

`fireemu/testing`ヘルパーは、並列テスト用の独立したワールドを起動します。各ワールドは、同じプロジェクトIDでも、独自のデーモン、ポート、クロック、データを持ちます。テストがクロック、Rules、Functionsを変更する場合に使ってください。1つのデーモン内のセッションは、この3つをデーモンと共有します。

ワールドはクロックの開始時刻を固定するため、クロックは止まったままで、テストが手動で動かします([時刻とスケジュール関数](../time/)を参照)。

## クロックの範囲とリセット

テストを書く前にこの2つのセクションを読んでください。クロックの移動が及ばない範囲と、`reset()`が古くするものが書かれています。

### クロックの移動が及ぶ範囲

`world.clock`はデーモンのクロックを動かします。テストプロセスのクロックや、起動したものすべてのクロックは動かしません。

| 対象 | `world.clock`で動くか |
| --- | --- |
| Functionsの`Date`、`Date.now()`、`new Date()` | はい。ワールドではデフォルトで動きます(`functions.clock.date`は`virtual`)。 |
| Security Rulesの`request.time`、Auth、Storage、App Checkのタイムスタンプ | はい。 |
| Cloud Tasksのスケジュール時刻、リトライのバックオフ、レートの補充 | はい。ワールドではデフォルトで動きます(`functions.clock.tasks`は`virtual`)。 |
| スケジュール関数 | はい。 |
| FunctionsのJavaScriptタイマー(`setTimeout`、`setInterval`) | デフォルトでは動きません(`functions.clock.timers`は`real`)。`timers: 'virtual'`では、クロックの移動でタイマーが期限になり、`world.clock.runDue()`が実行します。 |
| テストプロセス: `Date.now()`、`performance.now()`、そのタイマー | いいえ。自分のヘルパーには、明示的な時刻を渡してください。 |
| `world.run()`で起動したコマンドの`Date.now()`と`performance.now()` | いいえ。ワールドへのルーティングが渡されるだけです。 |
| 外部サービスと、デーモンの外にあるそれ以外のもの | いいえ。 |

### `reset()`が無効にするもの

`world.reset()`はデーモンを停止し、ワールド作成時に取ったスナップショットから、新しいデーモン(新しい*世代*)を起動します。

- 古い世代から読み取ったものはすべて古くなります。`world.endpoints`、`world.environment`、`world.uiUrl`、それらから作ったSDKインスタンスとクライアント、古いcontrol URLとトークンから作ったcontrolクライアントです。`reset()`が解決した後で、ゲッターを再度読み取り、再接続してください。
- `world.control()`、`world.clock.*`、`world.run()`は常に現在の世代を使います。`createControlClient({ env: world.environment })`や、明示的なオリジンとトークンで作ったクライアントは、古い世代のエンドポイントと認証情報を保持します。`reset()`の後で作り直してください。
- 古い世代で`world.run()`により起動したコマンドは終了されます。
- `reset()`が戻るのは*作成時のスナップショット*であり、現在のソースではありません。ワールドの作成後に行ったFunctionsのコード、Rules、インデックス、設定への変更は反映されません。それらを使うには新しいワールドを作成してください。

## ワールドを起動する

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

- `world.run`は、ワールドのプロジェクトとエミュレーターのホストを指定してコマンドを起動します。
- `world.reset()`は、作成時のスナップショットからワールドを起動し直します。
- `world.dispose()`はワールドを停止し、そのファイルを削除します。`withTestWorld`は、コールバックが例外を投げた場合も含め、自動的に破棄します。

別々のワールドは、クロック、Rules、Functions、サービスの状態を分離します。

`fireemu/control`クライアントは`fireemu exec`のコマンド内でも動作し、`world.control()`とURL解決および認証を共有するため、呼び出し側がcontrol URLを連結する必要はありません([テストワールドのガイド](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md)を参照)。

### 1つのテストで複数のワールドを使う

- `Promise.all`を使う場合は、各ワールドに専用の`withTestWorld()`を使い、他のワールドが失敗してもすべてのワールドが破棄されるようにします。
- 1つのテスト内で共存させる必要があるワールドは、`Promise.allSettled`で作成し、`finally`で破棄します。
- `Promise.all([createTestWorld(), ...])`の後に`try/finally`を置くと、1つの作成が失敗したとき、すでに起動していたワールドがリークします([テストワールドのガイド](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds)を参照)。

## 暦の単位でクロックを動かす

`world.clock.advance`にはISO 8601形式の期間や暦の単位も指定できます。`world.clock.to`は日、月、年の先頭や末尾にクロックを合わせます。暦の単位や区切りの計算には`timeZone`を使います。省略するとワールドの`scheduler.defaultTimeZone`を使い、それも未設定ならUTCを使います。詳しい規則は[時刻とスケジュール関数](../time/#期間を指定してクロックを動かすか暦の区切りに合わせる)を参照してください。

```js
await world.clock.advance({ months: 1 });                      // 1月31日は2月28日または29日になる
await world.clock.advance('PT36H');                            // 正確な経過時間
await world.clock.advance({ days: -3 }, { allowBackwards: true });
await world.clock.to('endOfMonth');                            // 現地時刻の23:59:59.999999
await world.clock.to('startOfMonth', { duration: { months: 1 }, timeZone: 'Asia/Tokyo' });
```

数値は従来どおりミリ秒を表し、`{ seconds }`や`{ millis }`のオブジェクトは指定した経過時間だけクロックを動かします。暦の単位は`millis`と併用できず、すべて同じ符号にそろえる必要があります。`world.clock.to`は`clock:set`を使うため、現在より前の時刻に合わせるには`allowBackwards: true`が必要です。`advanceAndSettle`にも同じ期間を指定でき、オプションには`timeZone`と`allowBackwards`があります。 `advance`と`advanceAndSettle`の`timeZone`と`allowBackwards`は、ISO 8601文字列または暦の単位を指定したオブジェクトで使えます。数値や`{ seconds }`、`{ millis }`に付けると拒否されます。

## クロックを進めて処理を待つ

`world.clock.advanceAndSettle(duration, { scope, timeoutSeconds, runTimers })`は、クロックを進め、期限になった仮想タイマーを実行し、デーモンがアイドルになるのを待ちます。この順序で行います。デフォルトのscopeは`runnable`で、移動した先より後にスケジュールされた処理は待ちません。移動が失敗した場合や待機がタイムアウトした場合はrejectされます。

```js
const { clock, timers, idle } = await world.clock.advanceAndSettle({ seconds: 60 });
```

保留中の`awaitIdle`は同じワールドの後続のクロック呼び出しを止めないため、`awaitIdle`とクロックの移動を並行して行うこともできます。

```js
await Promise.all([
  world.control('POST', 'sessions/default:awaitIdle', { timeoutSeconds: 20 }),
  world.clock.advance({ seconds: 60 }),
]);
```

`reset()`と`dispose()`は、予算が尽きるのを待たずに、保留中の待機をキャンセルします。順序のルールは[テストワールドのガイド](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#advance-the-clock-and-wait-for-work)にあります。

## 実行可能な処理を待つ

`POST /v1/sessions/default:awaitIdle`は`{ "scope": "runnable" }`を受け付けます(v0.26.0以降)。ワールドでは次のようにします。

```js
await world.control('POST', 'sessions/default:awaitIdle', { scope: 'runnable' });
```

- `runnable` scopeは、将来のタスクのスケジュールと将来のリトライのバックオフを待機から除外します。デフォルトのscopeは、引き続きすべての処理を待ちます。
- レートや同時実行数の制限でブロックされている期限到来済みのタスクと、アクティブなHTTPリクエストは、保留のままです。該当するクロックを進めるか、アクティブな処理を待ってください。診断は、待機中のフェーズと期限を示します。
- ユーザーが作成した任意のJavaScriptタイマーは待ちません。

[アイドルscopeとタスククロック](https://github.com/fireemu/fireemu/blob/main/docs/tasks-idle.md)を参照してください。

## VitestとPlaywright用のフィクスチャ

ワールドをフィクスチャで作成し、テストごとに名前付きの独自のAdmin SDKアプリを与え、後片付けでアプリを削除します。`reset()`の後は、アプリを削除し、`world.endpoints`を再度読み取り、新しいアプリを作成します。デフォルトのAdminアプリはプロセス全体でキャッシュされるため、ワールドに向け直すことはできません。

### 継承されたFirestoreホストをクリアする

Firebase AdminのFirestore SDKは、`db.settings({ host })`より`FIRESTORE_EMULATOR_HOST`を優先します。VitestとPlaywrightは、ランナーを外側の`fireemu exec`で包まずに直接実行し、ワーカーを起動する前に、専用のランナープロセスで継承されたホストを一度クリアしてください。たとえばPOSIXシェルでは次のようにします。

```sh
env -u FIRESTORE_EMULATOR_HOST npx vitest run
env -u FIRESTORE_EMULATOR_HOST npx playwright test
```

以下のフィクスチャのガードは、ワーカーにまだその変数が残っている場合、接続の前に失敗します。各テストから共有の`process.env`を変更しないでください。テストが意図的にエミュレーターのホストを環境に残す場合は、そのテストを`world.run()`経由で実行し、子プロセスがワールドのエンドポイントを受け取るようにします。

### フィクスチャの例

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

Admin Authのように、エミュレーターのホストを環境から読み取るクライアントは、名前付きアプリ経由ではワールドに向けられません。そのコードは`world.run()`で実行してください。`world.run()`は`world.environment`を子プロセスに渡します。

## TypeScript

`fireemu/testing`と`fireemu/control`は、strictの`NodeNext`とバンドラーのモジュール解決向けの型宣言を同梱しています。サブパスを直接インポートしてください。別の型パッケージは不要です。

```ts
import { withTestWorld, type TestWorldOptions } from 'fireemu/testing';
import { createControlClient } from 'fireemu/control';

const options = { services: ['auth', 'firestore'] as const } satisfies TestWorldOptions;
const projectId: string = await withTestWorld(options, (world) => world.projectId);

const client = createControlClient({ origin: 'http://127.0.0.1:9000', token: 'your-control-token' });
const response: unknown = await client.request('GET', 'sessions/default');
```

- サービス名のスペルミス、非対応のクロックモード、未知のオプションはコンパイルエラーになります。
- ワールドとクライアントのプロパティは読み取り専用で、`uiUrl`は`string | undefined`であり、各サービスのエンドポイントは、選択したサービスだけが起動するためオプションです。
- 汎用のcontrolリクエストは`unknown`に解決されます。フィールドを読む前にレスポンスを絞り込んでください。
- 型は実行時の制限(たとえば`runDue`には1から10000までの整数の予算が必要)を保証しません。ヘルパーが実行時にそれらを検査します。

詳細は[テストワールドのガイド](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#typescript-consumers)を参照してください。

## UIでワールドを確認する

UIはデフォルトでは無効です。デバッグUIでワールドを確認するには、`createTestWorld()`に`ui: true`を渡し、`world.uiUrl`を開きます。

- 有効にした各ワールドは、独自のループバックポートを受け取り、稼働中のFirestore、Auth、Storage、Functionsの状態を共有します。
- 確認している間はワールドを維持してください。`dispose()`はUIも停止します。
- `reset()`の後は、`world.uiUrl`を再度読み取り、ページを開き直してください。

対話的な例は[テストワールド](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#inspect-a-world-in-the-ui)を参照してください。

## エクスポートとインポート

`hub: true`を有効にすると、テストワールドをエクスポートし、そのデータを新しいワールドにインポートできます。[独立したテストワールドをエクスポートする](../data/#独立したテストワールドをエクスポートする)を参照してください。

## スナップショットのコスト

ワールドがFunctionsのソース、依存関係のリンク、`NODE_PATH`のルートをコピーするのは、Functionsを読み込む場合のみです。つまり、`services`を省略した場合(デフォルトの選択は、設定にソースまたはマニフェストが指定されていればFunctionsを含みます)、または`functions`か`functions:<codebase>`を列挙した場合です。

`['auth', 'firestore']`のような選択では、それらはすべてスキップされ、スナップショットされる設定からFunctionsセクションが取り除かれます。Auth blocking functionsとイベントトリガーの関数はFunctionsサービスで実行されるため、それらを使うには`functions`を選択してください。

`world.snapshotStats`は、各コピーのコストを報告します。

- `initial`は、入力の1回限りのコピーです。
- `generations`の各エントリは、世代を開始したコピー(作成と各`reset()`)です。
- それぞれに`files`、`directories`、`symlinks`、`bytes`、`method`(`copy`、`clone`、`mixed`)、`elapsedMs`があります。

コピーごとにstderrへ1行出力するには、`FIREEMU_TEST_WORLD_STATS=1`を設定します。

```js
const { initial, generations } = world.snapshotStats;
console.log(initial.functions, initial.files, initial.elapsedMs, generations.at(-1).method);
```

世代のコピーは、プラットフォームが対応していればcopy-on-writeを使い(APFS上のmacOSの`cp -c`、対応するLinuxファイルシステムのreflink)、そうでなければ通常のコピーを使います。どちらの場合も、各世代は自分のバイト列を所有します。[スナップショットがコピーするものとそのコスト](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#what-a-snapshot-copies-and-what-it-costs)を参照してください。

## スナップショットとタイムアウト

| オプション | 制限対象 | デフォルト |
| --- | --- | --- |
| `snapshotTimeoutMs` | 最初の入力スナップショットと最初の世代の準備の合計、およびリセットごとの準備(個別)。1から2,147,483,647までの整数を受け付けます。 | 60,000 ms |
| `startupTimeoutMs` | 準備後のデーモンの起動完了まで。 | 60,000 ms |

- タイムアウトまたはキャンセルすると、ファイルのコピーを停止し、アクティブなコピーが完了するのを待ち、読み取り専用のコピー済みディレクトリを含め、不完全なスナップショットをクリーンアップします。
- 設定ファイルは通常ファイルに解決される必要があります。コピーされるツリーにはディレクトリ、通常ファイル、対応する依存関係のリンクを含められますが、それ以外のファイルシステムタイプは拒否されます。
- 準備がタイムアウトした場合は、使っていない依存関係を絞り込むか、`snapshotTimeoutMs`を引き上げてください。起動完了のタイムアウトを引き上げても効果はありません。
- リセットは先に前の世代を終了させるため、準備が失敗しても古いデーモンが動き続けることはありません。

### 依存関係のスナップショットとグローバルなNODE_PATH

Functionsのワールドは、呼び出し側の編集がリセットに影響しないように、ローカルのソースと依存関係をスナップショットします。環境の`NODE_PATH`はデフォルトでクリアされます(v0.27.0以降)。通常の親環境変数は継承されたままです。ローカルのソースと祖先の`node_modules`は、引き続きスナップショットされます。

- グローバルを保持するには、`env: { ...process.env }`を渡すか、必要なディレクトリだけを含む絞り込んだ`env.NODE_PATH`を指定します。`NODE_PATH`を含む環境オブジェクトは、スプレッドで構築しても明示的な有効化として扱われます。
- `nodePathExcludes`は、使っていないパッケージの正確な名前(スコープ付きの名前を含む)を、リンクをたどる前に除外します。必須の依存関係の失敗は、引き続きエラーです。
- v0.27.0より前は、ワールドは継承された`NODE_PATH`のディレクトリ(リンクされたグローバルの開発用リポジトリを含む)もコピーしていたため、使っていないリンク済みリポジトリのせいで、起動が遅くなったり、テスト開始前にコピーが失敗したりすることがありました。それらのバージョンでは、ローカルのみの依存関係には`env: { ...process.env, NODE_PATH: '' }`を渡してください。

[依存関係スナップショットの制限](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds)を参照してください。

## 関連

- [時刻とスケジュール関数](../time/)
- [データのエクスポートとインポート](../data/#独立したテストワールドをエクスポートする)
- [Emulator UI](../ui/)
- [Cloud Functions](../../products/functions/)
