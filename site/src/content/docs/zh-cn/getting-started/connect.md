---
title: 连接您的应用
description: 将 Firebase Admin SDK、客户端 SDK 和安全规则单元测试指向 Fireemu 模拟器。
---

Fireemu 提供与 Local Emulator Suite 相同的协议和默认端口，因此连接方式也相同。

## 连接服务器代码和 Admin SDK

Firebase Admin SDK 和 Google Cloud 客户端库会读取模拟器环境变量。`fireemu exec` 会为其运行的命令设置这些变量：

```sh
npx fireemu exec -- node ./scripts/seed.mjs
```

| 变量 | 值 |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | Firestore 的 `host:port` |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authentication 的 `host:port` |
| `FIREBASE_STORAGE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` | Storage 的 `host:port` 和 `http://host:port` |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | 项目 ID |
| `FIREEMU_CONTROL_URL`, `FIREEMU_CONTROL_TOKEN` | Fireemu 的控制 API，供 `fireemu/testing` 使用 |

其他模拟器（Realtime Database、Pub/Sub、Eventarc、Cloud Tasks、App Check、Hub）的变量及其条件列在 [环境变量](../../reference/environment-variables/) 中。

在 `exec` 下，Admin SDK 不需要连接代码：

```js
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Under `fireemu exec`, the Admin SDK finds the emulators from the environment.
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
await getFirestore().doc('notes/n1').set({ text: 'hello' });
```

### Shell 中已有的变量

未选中的模拟器的变量保持您环境中的原样。如果 Shell 中已经带有本次运行不启动的模拟器的变量，该变量会保留，并以警告形式报告。

- `fireemu exec --plan -- <command>` 列出命令将看到的内容。
- [`--deny-inherited-emulator-env`](../../reference/cli/#继承的模拟器变量) 会使这类运行在启动前失败。

## 连接客户端 SDK

与 Local Emulator Suite 一样，在代码中连接客户端 SDK。请使用 Fireemu 运行时所用的项目 ID：`.firebaserc` 的默认项目，否则为 `fireemu.toml` 中的 `daemon.authProject`，否则为 `demo-app`。

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

默认端口列在 [安装和运行](../install/#default-ports) 中。有两个产品的连接方式不同：

- **Realtime Database。** 客户端需要自己的 `databaseURL`；参见 [Realtime Database](../../products/realtime-database/#connect)。
- **Hosting。** 它是普通 HTTP，不需要 SDK 设置（[Firebase Hosting](../../products/hosting/)）。

## 运行安全规则单元测试

`@firebase/rules-unit-testing` 可与 Fireemu 配合使用：

- 默认接受它的未签名模拟 ID 令牌（`authenticatedContext()`），在 `strict` profile 下也是如此。
- 它用来加载 Firestore 和 Storage 规则以及清空 Firestore（`testEnv.clearFirestore()`）的路由均已提供。
- 支持 `withFunctionTriggersDisabled`：对于不发送浏览器元数据（`Origin`、`Sec-Fetch-Site`）的客户端，Hub 无需令牌即可接受 `PUT /functions/disableBackgroundTriggers` 和 `enableBackgroundTriggers`。

参见 [安全规则](../../guides/security-rules/)。

## 项目 ID

Fireemu 从以下来源中第一个已设置的来源获取项目 ID：

1. 命令行上的 `--project`（`-P`），可以是 ID 或 `.firebaserc` 别名。
2. 已加载的 `firebase.json` 旁边的 `.firebaserc` 中的默认项目。
3. `fireemu.toml` 中的 `daemon.authProject`。
4. `demo-app`。

## 相关内容

- [环境变量](../../reference/environment-variables/)
- [安全规则](../../guides/security-rules/)
- [CI 与容器](../../guides/ci-and-containers/)
