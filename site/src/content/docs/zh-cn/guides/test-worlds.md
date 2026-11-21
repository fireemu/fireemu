---
title: 测试世界
description: 使用 fireemu/testing 辅助工具，在各自拥有独立时钟、端口和数据的世界中运行并行集成测试。
---

`fireemu/testing` 辅助工具为并行测试启动相互独立的世界（world）。即使项目 ID 相同，每个世界也拥有自己的守护进程、端口、时钟和数据。当测试会改变时钟、Rules 或 Functions 时，请使用世界：一个守护进程内的会话会与该守护进程共享这三者。

世界会固定其时钟的起点，因此它的时钟是静止的，由测试手动推进（见[时间与定时函数](../time/)）。

## 时钟范围与重置

在编写测试之前请阅读以下两节：它们说明时钟推进不会影响什么，以及 `reset()` 会使什么失效。

### 时钟推进会影响什么

`world.clock` 推进守护进程的时钟。它不会推进测试进程或你启动的任何东西的时钟。

| 对象 | 是否由 `world.clock` 推进？ |
| --- | --- |
| Functions 的 `Date`、`Date.now()`、`new Date()` | 是，在世界中默认如此（`functions.clock.date` 为 `virtual`）。 |
| 安全规则的 `request.time`，Auth、Storage 和 App Check 的时间戳 | 是。 |
| Cloud Tasks 的调度时间、重试退避和速率补充 | 是，在世界中默认如此（`functions.clock.tasks` 为 `virtual`）。 |
| 定时函数（Scheduled Functions） | 是。 |
| Functions 的 JavaScript 计时器（`setTimeout`、`setInterval`） | 默认否（`functions.clock.timers` 为 `real`）。使用 `timers: 'virtual'` 时，推进会使它们到期，并由 `world.clock.runDue()` 运行它们。 |
| 测试进程：`Date.now()`、`performance.now()` 及其计时器 | 否。请向你自己的辅助函数传入明确的时间点。 |
| 用 `world.run()` 启动的命令：其 `Date.now()` 和 `performance.now()` | 否。它们只接收指向该世界的路由。 |
| 外部服务以及守护进程之外的任何东西 | 否。 |

### `reset()` 会使什么失效

`world.reset()` 停止守护进程，并从创建世界时拍摄的快照启动一个新的守护进程，即新的*代*（generation）。

- 从旧代读取的一切都已过时：`world.endpoints`、`world.environment`、`world.uiUrl`、由它们构建的 SDK 实例和客户端，以及从旧控制 URL 和令牌创建的控制客户端。在 `reset()` 完成后，请重新读取这些 getter 并重新连接。
- `world.control()`、`world.clock.*` 和 `world.run()` 始终使用当前代。用 `createControlClient({ env: world.environment })` 或显式的 origin 和令牌创建的客户端会保留旧代的端点和凭据：请在 `reset()` 之后重新创建它。
- 在旧代中用 `world.run()` 启动的命令会被终止。
- `reset()` 回到的是*创建时的快照*，而不是你当前的源码。世界创建之后对 Functions 代码、Rules、索引或配置所做的修改不会被采用。要使用它们，请创建一个新世界。

## 启动世界

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
    await world.clock.advance(59999); // 毫秒：午夜前一毫秒
    await world.run(process.execPath, ['./trial-before-expiry.mjs']);
    await world.clock.advance(1);
    await world.run(process.execPath, ['./trial-expired.mjs']);
  },
);
```

- `world.run` 使用该世界的项目和模拟器主机启动一条命令。
- `world.reset()` 从创建时的快照重新启动该世界。
- `world.dispose()` 停止该世界并删除其文件。`withTestWorld` 会替你释放它，回调抛出异常时也是如此。

不同的世界相互隔离其时钟、Rules、Functions 和服务状态。

`fireemu/control` 客户端也可以在 `fireemu exec` 命令中使用，并与 `world.control()` 共享 URL 解析和身份验证，因此调用方无需拼接控制 URL（见[测试世界指南](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md)）。

### 一个测试中的多个世界

- 使用 `Promise.all` 时，为每个世界单独使用一个 `withTestWorld()`，这样即使某个兄弟世界失败，每个世界也都会被释放。
- 必须在一个测试中共存的世界，用 `Promise.allSettled` 创建，并在 `finally` 中释放。
- `Promise.all([createTestWorld(), ...])` 后接 `try/finally`，会在某次创建失败时泄漏已启动的世界（见[测试世界指南](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds)）。

## 测试 Hosting 网站

选择 `hosting` 后，`firebase.json` 中的网站会通过分配给测试世界的端口提供服务。如果网站将请求重写到 Cloud Functions，请同时选择 `functions` 以及这些函数使用的服务。

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

`world.hostingUrl` 是第一个网站的 URL。`world.endpoints.hosting` 描述该网站的端点。`world.hostingSites` 按配置顺序列出各网站的 `site` 和 `url`。没有显式名称或部署目标的网站使用测试世界的项目 ID。关闭 Hosting 时，主 URL 和端点都是 `undefined`，网站列表为空。

并行的浏览器 worker 可以使用相同的项目 ID 和相对 API 路径。每个 worker 都应打开自己的测试世界 URL。重置时会恢复创建测试世界时保存的公开文件以及 Firestore 和 Realtime Database 规则。每次重置后请重新读取 Hosting URL。

## 按日历单位移动时钟

`world.clock.advance` 也接受 ISO 8601 时长或日历单位，`world.clock.to` 可将时钟移至某一天、某个月或某一年的起点或终点。计算日历单位和这些边界时使用 `timeZone`，省略时使用世界的 `scheduler.defaultTimeZone`，若也未设置则使用 UTC。具体规则见[时间与定时函数](../time/#按时长移动时钟或将时钟移至日历边界)。

```js
await world.clock.advance({ months: 1 });                      // 1 月 31 日变为 2 月 28 日或 29 日
await world.clock.advance('PT36H');                            // 实际经过的时间
await world.clock.advance({ days: -3 }, { allowBackwards: true });
await world.clock.to('endOfMonth');                            // 当地时间 23:59:59.999999
await world.clock.to('startOfMonth', { duration: { months: 1 }, timeZone: 'Asia/Tokyo' });
```

数值仍表示毫秒，`{ seconds }` 或 `{ millis }` 对象仍按指定的实际时长移动时钟。日历单位不能与 `millis` 混用，各分量的正负号必须一致。`world.clock.to` 使用 `clock:set`，因此移至早于当前时间的时刻需要 `allowBackwards: true`。`advanceAndSettle` 接受相同的时长，其选项包括 `timeZone` 和 `allowBackwards`。 `advance` 和 `advanceAndSettle` 的 `timeZone` 与 `allowBackwards` 选项适用于 ISO 8601 字符串与日历单位对象。数字、`{ seconds }` 和 `{ millis }` 形式会拒绝这些选项。

## 推进时钟并等待工作完成

`world.clock.advanceAndSettle(duration, { scope, timeoutSeconds, runTimers })` 依次推进时钟、运行到期的虚拟计时器，并等待守护进程空闲。默认 scope 为 `runnable`，它不会等待调度在本次推进之后的工作。推进失败或等待超时时，它会 reject。

```js
const { clock, timers, idle } = await world.clock.advanceAndSettle({ seconds: 60 });
```

并发执行 `awaitIdle` 和时钟推进也可以，因为挂起中的 `awaitIdle` 不会阻塞同一世界上后续的时钟调用：

```js
await Promise.all([
  world.control('POST', 'sessions/default:awaitIdle', { timeoutSeconds: 20 }),
  world.clock.advance({ seconds: 60 }),
]);
```

`reset()` 和 `dispose()` 会取消挂起中的等待，而不是等到其时间预算耗尽。顺序规则见[测试世界指南](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#advance-the-clock-and-wait-for-work)。

## 等待可运行的工作

`POST /v1/sessions/default:awaitIdle` 接受 `{ "scope": "runnable" }`（自 v0.26.0 起）。在世界中：

```js
await world.control('POST', 'sessions/default:awaitIdle', { scope: 'runnable' });
```

- `runnable` scope 从等待中排除未来的任务调度和未来的重试退避。默认 scope 仍等待所有工作。
- 因速率或并发限制而受阻的到期任务以及活跃的 HTTP 请求仍处于挂起状态。请推进相应的时钟或等待活跃的工作完成；诊断信息会指出正在等待的阶段和截止时间。
- 它不会等待用户任意创建的 JavaScript 计时器。

见 [idle scopes and task clocks](https://github.com/fireemu/fireemu/blob/main/docs/tasks-idle.md)。

## Vitest 和 Playwright 的 fixture

在 fixture 中创建世界，为每个测试提供一个自己的具名 Admin SDK 应用，并在 teardown 时删除该应用。在 `reset()` 之后，删除应用、重新读取 `world.endpoints` 并创建一个新应用。默认的 Admin 应用在进程范围内缓存，无法重定向到某个世界。

### 清除继承的 Firestore 主机

Firebase Admin 的 Firestore SDK 让 `FIRESTORE_EMULATOR_HOST` 优先于 `db.settings({ host })`。请直接运行 Vitest 和 Playwright，不要用外层的 `fireemu exec` 包裹 runner，并在专用的 runner 进程启动 worker 之前清除一次继承的主机。例如，在 POSIX shell 中：

```sh
env -u FIRESTORE_EMULATOR_HOST npx vitest run
env -u FIRESTORE_EMULATOR_HOST npx playwright test
```

下面的 fixture 守卫会在 worker 仍带有该变量时，在连接之前失败。不要在每个测试中修改共享的 `process.env`。当某个测试有意在其环境中保留模拟器主机时，请通过 `world.run()` 运行该测试，使其子进程收到该世界的端点。

### fixture 示例

```ts
// Vitest：test/world.ts
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
// Playwright：每个 worker 一个世界，每个测试一个干净的代和一个新的 Admin 应用
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
    await world.reset(); // 下面的端点在重置之后读取
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

从环境中读取模拟器主机的客户端（例如 Admin Auth）无法通过具名应用指向某个世界：请用 `world.run()` 运行这类代码，它会把 `world.environment` 传给子进程。

## TypeScript

`fireemu/testing` 和 `fireemu/control` 自带适用于 strict `NodeNext` 和 bundler 模块解析的类型声明；直接导入这些子路径即可，无需单独的类型包。

```ts
import { withTestWorld, type TestWorldOptions } from 'fireemu/testing';
import { createControlClient } from 'fireemu/control';

const options = { services: ['auth', 'firestore'] as const } satisfies TestWorldOptions;
const projectId: string = await withTestWorld(options, (world) => world.projectId);

const client = createControlClient({ origin: 'http://127.0.0.1:9000', token: 'your-control-token' });
const response: unknown = await client.request('GET', 'sessions/default');
```

- 拼错的服务名、不支持的时钟模式或未知选项都是编译错误。
- 世界和客户端的属性是只读的，`uiUrl` 为 `string | undefined`，每个服务端点都是可选的，因为只有被选中的服务会启动。
- 通用控制请求解析为 `unknown`：读取字段前请先收窄响应类型。
- 类型无法证明运行时限制（例如，`runDue` 需要 1 到 10000 之间的整数预算）；辅助工具在运行时检查这些限制。

详情见[测试世界指南](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#typescript-consumers)。

## 在 UI 中检查世界

UI 默认禁用。要在调试 UI 中检查某个世界，向 `createTestWorld()` 传入 `ui: true` 并打开 `world.uiUrl`。

- 每个启用了 UI 的世界获得自己的 loopback 端口，并共享其实时的 Firestore、Auth、Storage 和 Functions 状态。
- 检查期间请保持世界存活；`dispose()` 也会停止其 UI。
- 在 `reset()` 之后，重新读取 `world.uiUrl` 并重新打开页面。

交互式示例见[测试世界](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#inspect-a-world-in-the-ui)。

## 导出与导入

启用 `hub: true` 即可导出一个测试世界，并将其数据导入一个新的世界；见[导出相互独立的测试世界](../data/#export-independent-test-worlds)。

## 快照开销

世界只有在加载 Functions 时才会复制 Functions 源码、依赖链接和 `NODE_PATH` 根目录：省略 `services`（当配置指定了源码或清单时，默认选择包含 Functions），或列出 `functions` 或 `functions:<codebase>`。

像 `['auth', 'firestore']` 这样的选择会跳过所有这些复制，并从快照的配置中移除 Functions 部分。Auth 阻塞函数和事件触发函数在 Functions 服务中运行，因此要使用它们请选择 `functions`。

`world.snapshotStats` 报告每次复制的开销：

- `initial` 是对你的输入进行的一次性复制。
- 每个 `generations` 条目是启动一代的复制（创建时以及每次 `reset()`）。
- 每一项都有 `files`、`directories`、`symlinks`、`bytes`、`method`（`copy`、`clone` 或 `mixed`）和 `elapsedMs`。

设置 `FIREEMU_TEST_WORLD_STATS=1` 可以对每次复制向 stderr 打印一行。

```js
const { initial, generations } = world.snapshotStats;
console.log(initial.functions, initial.files, initial.elapsedMs, generations.at(-1).method);
```

在平台支持的情况下，代的复制使用写时复制（APFS 上的 macOS `cp -c`；允许 reflink 的 Linux 文件系统上的 reflink），否则使用普通复制；无论哪种方式，每一代都拥有自己的字节。见 [what a snapshot copies](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#what-a-snapshot-copies-and-what-it-costs)。

## 快照与超时

| 选项 | 限制范围 | 默认值 |
| --- | --- | --- |
| `snapshotTimeoutMs` | 初始输入快照与第一代准备合计，以及每次重置准备单独计算。接受 1 到 2,147,483,647 之间的整数。 | 60,000 ms |
| `startupTimeoutMs` | 准备完成后守护进程就绪的时间。 | 60,000 ms |

- 超时或取消会停止文件复制，等待进行中的复制结束，并清理部分快照，包括复制过来的只读目录。
- 配置文件必须解析为普通文件。复制的目录树可以包含目录、普通文件和受支持的依赖链接，其他文件系统类型会被拒绝。
- 如果准备超时，请精简未使用的依赖或调高 `snapshotTimeoutMs`；调高就绪超时没有帮助。
- 重置会先让上一代退役，因此准备失败不会让旧的守护进程继续运行。

### 依赖快照与全局 NODE_PATH

Functions 世界会对本地源码和依赖做快照，使调用方的修改不影响重置。环境中的 `NODE_PATH` 默认会被清除（自 v0.27.0 起），而普通的父进程环境变量仍会继承。本地源码和祖先目录中的 `node_modules` 仍会被快照。

- 要保留全局依赖，请传入 `env: { ...process.env }`，或提供只包含所需目录的精简 `env.NODE_PATH`。包含 `NODE_PATH` 的环境对象即视为显式启用，即使它是用展开语法构造的。
- `nodePathExcludes` 在跟随链接之前排除精确匹配的未使用包名，包括带 scope 的名称。必需依赖的失败仍然是错误。
- 在 v0.27.0 之前，世界还会复制继承的 `NODE_PATH` 目录，包括链接的全局开发仓库，因此一个未使用的链接仓库可能在测试开始前拖慢启动或导致复制失败。在这些版本上，若只使用本地依赖，请传入 `env: { ...process.env, NODE_PATH: '' }`。

见 [dependency snapshot limits](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds)。

## 相关内容

- [时间与定时函数](../time/)
- [导出和导入数据](../data/#export-independent-test-worlds)
- [模拟器 UI](../ui/)
- [Cloud Functions](../../products/functions/)
