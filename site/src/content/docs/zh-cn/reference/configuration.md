---
title: 配置架构
description: 查找 fireemu.toml 的 JSON Schema 以及每个顶层配置部分的指南。
---

`fireemu.toml` 由 JSON Schema 描述。相同的设置可以写成 TOML（`fireemu.toml`）或 JSON（`fireemu.json`）；加载哪个文件参见 [配置文件](../../guides/configuration/)。

Fireemu 在启动时验证该文件（包括架构无法表达的规则），遇到不接受的值时会报错并停止。`npx fireemu config show` 会打印每个键及其生效值和来源。

## 获取架构

- [本站上的 fireemu.schema.json](../../spec/config/fireemu.schema.json)。
- [GitHub 上的 spec/config/fireemu.schema.json](https://github.com/fireemu/fireemu/blob/main/spec/config/fireemu.schema.json)。每个发布标签下都有同一文件，`https://raw.githubusercontent.com/fireemu/fireemu/v<version>/spec/config/fireemu.schema.json`，发布版二进制文件的 `fireemu init` 会将该地址写入新文件（从源代码构建的版本写入 `main` 的位置）。
- `npx fireemu config schema --out fireemu.schema.json` 写入您所运行的二进制文件内置的架构：它接受的键就是它用来验证的键。

## 顶层部分

| 部分 | 配置内容 | 指南 |
|---|---|---|
| `schemaVersion` | 始终为 `1` | |
| `profile`, `productionExact` | 生产环境行为或官方模拟器行为 | [Profile 与 productionExact](../../guides/profiles/) |
| `firebaseJson` | 用于读取端口、规则、索引和 Functions 的 `firebase.json` | [配置文件](../../guides/configuration/) |
| `firestore` | 版本、API 模式、索引、限制、历史记录 | [Cloud Firestore](../../products/firestore/) |
| `rules` | Firestore 安全规则的来源，以及 Firestore 和 Storage 的拒绝日志 | [安全规则](../../guides/security-rules/) |
| `auth` | `requireClientApiKey`（默认 `false`）会使 emulator profile 以官方模拟器的 403 拒绝没有 API 密钥或 Authorization 标头的客户端请求；strict 不变。还配置登录方式、密码策略、MFA、租户、提供方、令牌，以及 Firestore、Storage 和 Realtime Database 的安全规则功能面是否接受未签名的模拟 ID 令牌（`allowUnsignedIdTokens`） | [Authentication](../../products/auth/) |
| `storage` | Storage 安全规则、对象大小、缓冲请求体和存储字节数限制、存储桶声明（`undeclaredBuckets`）、存储桶 CORS（`cors`）以及签名 URL 密钥（`signedUrlKeys`） | [Cloud Storage](../../products/storage/) |
| `database` | 没有规则文件的 Realtime Database 实例允许什么（`defaultAccess`）；在两种 profile 下，由 `auth.allowUnsignedIdTokens` 决定其规则是否接受 `@firebase/rules-unit-testing` 的模拟令牌 | [Realtime Database](../../products/realtime-database/) |
| `hosting` | strict profile 的两个开发默认值：`cacheControl`（默认 `"none"`，使用 `productionExact` 时为 `"production"`，会为文件添加 `Cache-Control: max-age=3600`）和 `clientCountry`（默认 `"honoured"`，使用 `productionExact` 时为 `"ignored"`） | [Firebase Hosting](../../products/hosting/#profiles) |
| `remoteConfig` | `updateUser`（`email` 必填，`name` 和 `imageUrl` 可选）：本地 Remote Config 模板管理报告为 `updateUser` 的身份。默认关闭 | [Remote Config 模板](https://github.com/fireemu/fireemu/blob/main/docs/remote-config.md) |
| `functions` | 代码库、运行器、应用时钟、未提供的触发器、提供的函数的固定列表（`manifest`）、`isolation`（默认 `"codebase"`，使用 `productionExact` 时为 `"function"`：每个函数一个运行器进程，在其首次触发时启动）、`taskNameReuse`、`taskDispatchDeadlineSeconds`、`taskRetryDefaults` 和 `taskRetryBackoff`（Cloud Tasks 队列的开发默认值，`productionExact` 会将其设为生产环境的值，参见 [Profile](../../guides/profiles/)），以及 `authBlockingToken`（默认 `"emulated"`，在 `strict` 下使用 `productionExact` 时为 `"production"`，投递一个由 Python 运行器按 SDK 规则验证的已签名令牌；Node 函数收到相同的生产环境形态令牌但不验证它，因此行为与以前相同） | [Cloud Functions](../../products/functions/) |
| `scheduler` | 定时函数的时区、补跑和重叠 | [时间和定时函数](../../guides/time/) |
| `pubsub`, `eventarc` | 身份验证和投递设置；`pubsub.restNegativeCache`（默认 `"off"`；`"production"` 是 strict 下的显式选择加入，重现生产环境在某个连接上表现出的、真实 `404` 之后约 10 秒的缓存 `404`；`productionExact` 不会选择它） | [Pub/Sub 和 Eventarc](../../products/pubsub-eventarc/) |
| `appCheck` | 应用、调试令牌和强制执行 | [App Check](../../products/app-check/) |
| `daemon` | 端口、项目、开始时间、时钟如何推进（`clock`） | [时间和定时函数](../../guides/time/) |
| `network` | 在环回地址以外监听（`allowNonLoopbackHosts`），以及模拟器额外应答的 `Host` 名称（`allowedHosts`，DNS 重绑定防御） | [CI 与容器](../../guides/ci-and-containers/#host-names-the-emulators-answer) |
| `bind` | 接受，目前不起作用：守护进程绑定环回地址，`firebase.json` 中的 `emulators.<name>.host` 为每个服务设置主机 | [CI 与容器](../../guides/ci-and-containers/) |
| `projects` | 是否只接受 `demo-` 项目 ID（`requireDemoPrefix`），以及指定其他项目的请求是被提供还是被拒绝（`unknownProjects`） | [Profile 与 productionExact](../../guides/profiles/) |
| `limits` | 保留用于限制目录、警告、配额计算和计划覆盖。目前没有任何成员会改变行为：每个成员要么被接受但不起作用，要么只接受其空值或默认值并拒绝其他任何值。Firestore 的限制由 `firestore.enforceLimits` 切换 | |
| `events` | 函数触发事件的投递：对使用 `retry` 声明的函数的 `maxAttempts`（默认 4）；`delivery` 只接受 `exactly-once-test` | [Profile 与 productionExact](../../guides/profiles/) |
| `trace` | 接受，目前不起作用 | |

被接受但不起作用的键会在运行加载它时打印一条 `note:` 行。若要在出现此类设置时使 CI 作业失败，请运行 `fireemu config lint --deny-ineffective`。它会列出这些设置，并且除非每个设置都被某个 `--allow` 条目涵盖，否则以 1 退出（参见 [`config lint`](../cli/#config-lint)）。

## Storage 大小限制

| 键 | 设置内容 | 默认值 | 最大值 |
|---|---|---|---|
| `storage.maxObjectBytes` | 单个对象的最大大小。请求体上限为该值加 4194304 字节 | 268435456 字节 | 2143289343 |
| `storage.bufferedBodyBudgetBytes` | 进程范围内缓冲 Storage 请求体的预算 | 1073741824 字节 | 2147483647 |

两个值都必须是正整数。单独的存储字节数和可续传上传限制参见 [Cloud Storage](../../products/storage/)。
