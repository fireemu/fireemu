---
title: 从 Local Emulator Suite 迁移
description: 将项目从 firebase emulators:exec 迁移到 Fireemu，并解决在 strict profile 下失败的测试。
---

Fireemu 读取您现有的 `firebase.json`，使用相同的默认端口并接受官方命令名称，因此大多数项目只需更改一条命令即可迁移。

## 开始之前

确认您使用的产品在 [支持列表](../../#supported-products) 中。Local Emulator Suite 还提供 App Hosting、Data Connect 和 Extensions，Fireemu 不提供，而 Realtime Database 仅部分支持。

## 切换命令

1. 安装 Fireemu 并创建引用您的 `firebase.json` 的 `fireemu.toml`：

   ```sh
   npm install --save-dev fireemu
   npx fireemu init --firebase-json firebase.json
   ```

   保留默认的 `profile = "strict"`。

2. 替换命令：

   | 之前 | 之后 |
   |---|---|
   | `firebase emulators:exec "npm test"` | `fireemu exec -- npm test` |
   | `firebase emulators:start` | `fireemu up` |

   `fireemu emulators:exec` 和 `fireemu emulators:start` 同样可用，并且 `exec` 接受官方的带引号脚本形式。

3. 运行您的测试。

## 当测试在 `strict` 下失败时

在官方模拟器上通过但在 `strict` 下失败的测试，往往揭示了您的应用在生产环境中也会遇到的行为。请修复测试或应用，或者只放宽下面的特定设置。避免将整个 profile 切换为 `emulator`。

### 未签名的模拟器 ID 令牌

`@firebase/rules-unit-testing` 的 `authenticatedContext()` 和客户端 SDK 的 `mockUserToken` 默认在 `strict` 下可用。

- 将 `auth.allowUnsignedIdTokens` 设为 `false` 可在安全规则功能面上禁用它们的回退，以测试生产环境对它们的拒绝。
- 对于拒绝测试，请使用 SDK 辅助函数默认的 `iat: 0` / `exp: 3600`，并将时钟设在过期之后。通过常规验证的 Fireemu 签发令牌仍会被接受。
- 使用 `auth.idTokenSigning = "session-rsa"` 可拒绝所有未签名的 ID 令牌。

参见 [未签名的模拟 ID 令牌](../../products/auth/#unsigned-mock-id-tokens)。

### 命名数据库

在 `firebase.json` 的 `firestore` 数组中声明每个命名数据库及其 `rules` 和 `indexes` 文件，或者像生产环境要求的那样通过 Admin API 创建它。在运行时创建的数据库在您为其加载规则之前没有安全规则（参见 [Firestore](../../products/firestore/#named-databases)）。

### 复合索引

与生产环境一样，查询会对照您声明的索引进行检查。请在 `firebase.json` 引用的 `firestore.indexes.json` 中声明查询所需的索引。

- 缺少索引的查询会以 `FAILED_PRECONDITION` 和指向该索引的链接被拒绝，与生产环境相同。
- 只有单个字段的复合索引会在文件加载时被拒绝，就像 `firebase deploy` 拒绝它一样：请使用 `fieldOverrides`。
- 若要在添加索引期间继续运行这类查询，请将 `firestore.missingIndexes` 设为 `"report"`：查询会执行，并且每个缺失的索引会按数据库在标准错误中报告一次，附带生产环境的拒绝文本和 `firestore.indexes.json` 条目。`productionExact` 不会改变此键。
- 对于 OR 查询，补充的标准错误诊断会列出所有不同的缺失分支索引，以便您一起添加它们的定义。`strict` 仍返回带有第一个索引创建链接的现有 SDK 错误，`emulator` profile 仍会执行该查询。重复的建议会去重，诊断缓存有大小上限。

### 与生产项目保持一致的设置

将以下设置与您的生产项目保持一致，而不是切换 profile：

| 设置 | 在 `strict` 下的作用 |
|---|---|
| `auth.improvedEmailPrivacy` | 电子邮件枚举保护，新的生产项目默认开启。仅当您的生产项目关闭了它时才设为 `false`；此时登录会像官方 Auth 模拟器一样返回 `EMAIL_NOT_FOUND` 和 `INVALID_PASSWORD`。 |
| `auth.mfa` | 您项目的多重身份验证配置。`strict` 开始时启用 SMS 和 TOTP；`productionExact` 开始时关闭多重身份验证，与新的生产项目相同。参见 [Authentication](../../products/auth/#multi-factor-authentication)。 |
| `firestore.enforceLimits` | 生产环境始终强制执行 Standard 版本的查询限制。`false` 会让生产环境拒绝的查询通过，因此除非有特定理由，否则请保持开启。在 `strict` 下它只切换查询限制。 |

## 与官方 CLI 的差异

- 当命令成功时，失败的 `--export-on-exit` 会使运行以 1 退出。官方 CLI 只发出警告并以 0 退出；Fireemu 的不同之处在于，依赖已保存数据的 CI 作业不会在没有这些数据的情况下通过。
- 在 Unix 上，只有当所有者可信时，才会加载发现的 `fireemu.toml` 或 `firebase.json`。参见 [配置文件](../../guides/configuration/#file-ownership-checks)。
- 在 `strict` 下，没有安全规则的项目的行为与没有规则发布的生产项目相同：客户端请求会被拒绝。参见 [安全规则](../../guides/security-rules/)。

## 相关内容

- [连接您的应用](../connect/)
- [Profile 与 productionExact](../../guides/profiles/)
- [兼容性表](../../compatibility/)
- [限制](../../compatibility/limitations/)
