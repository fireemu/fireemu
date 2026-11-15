---
title: 安全规则
description: 加载 Firestore、Storage 和 Realtime Database 的安全规则，并找出请求被拒绝的原因。
---

加载 Firestore、Storage 和 Realtime Database 的安全规则，查看是哪个条件拒绝了请求，并使用模拟令牌进行测试。

## 加载规则

与 Firebase CLI 一样，在 `firebase.json` 中指定规则文件：

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" }
}
```

或在 `fireemu.toml` 中指定（Firestore 用 `rules.source`，Storage 用 `storage.rules`）。启动输出中有 `firestore rules:` 和 `storage rules:` 行，说明是否已加载规则。

Realtime Database 规则从 `firebase.json` 的 `database` 部分加载：默认实例使用单个文件，或者每个实例或部署目标各一个文件。启动输出的 `database rules:` 行会列出每个文件及其实例。各 profile 接受的凭据、没有规则的实例允许什么以及与官方模拟器的差异，参见 [Realtime Database](../../products/realtime-database/#security-rules)。

`@firebase/rules-unit-testing` 也可以在运行时加载规则：`initializeTestEnvironment` 会将您传入的 `firestore.rules` 和 `storage.rules` 发送给模拟器，并且支持 `testEnv.clearFirestore()`。

加载时的检查：

- 与官方模拟器的比较仅限于记录的用例。
- 列出的不支持的语法和求值用例会在加载规则时被拒绝，或产生规则错误。
- 官方模拟器的确定化资源限制所拒绝的八个已记录模式，在 Fireemu 加载规则时同样会被拒绝，包括在未求值的表达式分支中。这并不能证明正则表达式或生产环境完全等价。

## 没有规则的项目

在 `strict` 下，没有安全规则的项目的行为与没有规则发布的生产项目相同：

- 对 Firestore 的每个客户端请求都会以 `PERMISSION_DENIED` 被拒绝；
- 对 Storage 的每个最终用户请求都会以生产环境的 400 “bucket has not been set up” 应答被拒绝。

Admin SDK 和其他所有者凭据不受影响。

这些应答保留生产环境的措辞。因此，每个数据库和存储桶第一次被拒绝的请求还会在标准错误中打印一条警告，说明未加载规则以及如何加载。

`emulator` profile 会像官方模拟器一样，允许所有 Firestore 请求，以及 `demo-*` 项目的所有 Storage 请求。

## 请求为何被拒绝

生产环境以简短的消息应答拒绝（Firestore 的 `PERMISSION_DENIED` “Missing or insufficient permissions.”，Storage 的 403），不会说明是哪条规则拒绝的。Fireemu 还会将每次最终用户请求的拒绝打印到标准错误，并列出请求所求值的每个 `allow` 条件及其求值结果：

```text
note: firestore: Security Rules denied get on "notes/n1" in "database (default)" (request.auth.uid "bob"): no allow statement evaluated to true; line 5:22 `request.auth.uid == resource.data.owner` was false
```

- 在 `fireemu.toml` 中将 `rules.denialLog` 设为 `"off"` 可关闭这些行，例如在断言大量拒绝的测试套件中。无论哪种方式，返回给客户端的应答都相同。
- Rules 页面和 `GET /v1/sessions/default/rules/requests` 显示最新的 100 条已跟踪的 Firestore 决策。跟踪在打开 UI 或首次读取控制 API 时开始；加载新的规则集会清除历史记录。这是调试视图，而不是完整的请求日志。

### 诊断限制

这些上限只影响诊断，不影响允许/拒绝决策。

- Firestore 和 Storage 规则诊断每个表达式最多保留 64 个不同的值。
- 字符串值和错误消息会在 1,024 个 UTF-8 字节以内的字符边界处截断。
- Firestore 覆盖率 JSON/HTML 和控制请求跟踪会用 `truncated: true` 标记被截断的值；省略的观测会添加 `valuesOmitted` 和 `valuesCountMayBeLower: true`。因此，显示的计数可能低于某个值的实际计数。

## 使用模拟令牌进行单元测试

`@firebase/rules-unit-testing` 的 `authenticatedContext()` 和客户端 SDK 的 `mockUserToken` 选项会发送未签名的模拟 ID 令牌。Fireemu 默认接受它（在 `strict` 下也是如此），并像官方模拟器一样根据其声明构建 `request.auth`。在 `strict` 下只接受这种确切的令牌形态；其他所有令牌都会经过验证，包括过期时间。

若要测试生产环境对未签名令牌的拒绝，请将 `auth.allowUnsignedIdTokens` 设为 `false`，或设置 [`productionExact`](../profiles/)。

## 规则语言细节

Fireemu 求值规则时的边界情况。

### 对不是文档的路径调用 `get()` 和 `exists()`

`get()` 和 `exists()` 接受一个指向请求所在数据库中某个文档的路径。以下路径不指向任何文档，因此调用属于求值错误：

- 指向集合的路径（`/databases/$(database)/documents/users`，`documents` 之后的段数为奇数）；
- 指向另一个数据库的路径（`/databases/other/documents/users/u1`）；
- 不含 `documents` 的路径（`/databases/$(database)/users/u1`）。

与任何规则错误一样，它会使条件失败：除非 `||` 或 `&&` 的另一侧决定了结果，否则请求会被拒绝（`exists(<such a path>) || true` 会允许；生产环境对这种组合的应答未被记录）。`!exists(...)` 和 `get(...) == null` 不会将该路径视为“不存在”而允许；生产环境会拒绝它们，官方模拟器也是如此。

指向不存在的文档的路径仍视为不存在的文档：`exists()` 为 `false`，`get()` 为 `null`。

路径拼写错误导致缺少文档 ID 是常见原因，因此拒绝日志中 `was an error` 的行会指向该调用。

### 查询与存储的文档

与生产环境一样，Firestore 查询根据其筛选条件授权，而不是根据它将返回的文档授权。

一个例外：只有单个 `documentId() ==` 筛选条件的查询分支，无论它有哪些其他筛选条件、limit、offset 或游标，都按该文档的存储状态来决定，与生产环境和官方模拟器的决定方式相同。在证明中，`resource.data` 恰好包含查询筛选或排序所用的字段，因此 `keys()`、`size()`、`in` 和 `get(key, default)` 仅根据这些字段作答。

将指定一个文档的分支与不指定文档的分支混合在一起的 `OR` 查询，其行为因 profile 而异：

- `emulator` profile 会像官方模拟器一样逐个分支授权。
- `strict` profile 会根据筛选条件证明每个分支，因为生产环境对该查询的应答是缺失索引错误，其规则应答未被记录。

### 规则中的字符串

与生产环境一样，Firestore 和 Storage 规则按 UTF-16 码元对字符串进行索引和计量：`"é🔥x".size()` 为 4，且 `"é🔥x"[3] == "x"`。`lower()` 和 `upper()` 只改变 ASCII 字母，并且字符串从不进行规范化。正则表达式仍将补充字符视为一个字符。

代理对的一半因 profile 而异：

- 在 `strict` 下，它是只等于自身的片段，并且包含孤立代理项的 `split()`、`replace()` 或 `matches()` 模式会使规则失败，与生产环境的应答相同。
- `emulator` profile 会像官方模拟器一样保留孤立的码元。

## 相关内容

- [Cloud Firestore](../../products/firestore/)
- [Cloud Storage](../../products/storage/)
- [Realtime Database](../../products/realtime-database/#security-rules)
- [Profile 与 productionExact](../profiles/)
