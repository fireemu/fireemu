---
title: 限制
description: 在依赖本地结果之前，确认 Fireemu 不支持什么，以及任何本地模拟器都无法重现什么。
---

Fireemu 尚未重现生产环境 Firebase 的所有功能和行为。以下是主要限制；该列表并不详尽。请在 [能力清单](../#能力清单) 中查看各个 API，或运行：

```sh
npx fireemu capabilities
```

## 不支持的产品

目前不支持 App Hosting 和 Data Connect。不计划支持 Firebase Extensions。

## 部分支持的产品

- **Realtime Database。** 已提供，并且仅针对其记录的用例对照生产环境验证（参见 [生产环境验证](../#生产环境验证)）。更广泛的生产环境兼容性未经验证，也没有针对官方模拟器的对等声明。详情：[Realtime Database](../../products/realtime-database/#differences-from-the-official-emulator) 以及下面的列表。

## 不支持的功能

### Cloud Firestore

- Enterprise Pipeline API 仅支持有限的读取操作子集（参见 [Enterprise 管道](../../products/firestore/#enterprise-pipelines)）。
- Enterprise 文本搜索提供有限的本地词法搜索和显式构建控制。分析和排序是近似实现；`productionExact` 会拒绝未观测的搜索语义。

### Authentication

- 不支持与外部身份提供方通信的登录流程、托管授权码交换以及实时密钥发现和轮换。
- 支持在本地配置的已签名 OIDC/SAML 验证，通过 strict 签名断言路径，使用 `auth.idpSigners` 公钥或 SAML 提供方配置的证书。
- 有限的 SAML 检查涵盖存在的 status、destination、issuer、audience 和有效期字段，以及对守护进程已知签发请求的响应。缺失字段、无法解析的时间及其他未记录的组合仍属未观测。

### Cloud Storage

- 验证签名 URL 或 POST 策略的签名（会检查其过期时间和条件）。
- `allUsers` 读取以外的对象 ACL、IAM 以及存储桶级公开访问。
- 对象合成（`compose`）和通知配置。
- **`strict` 下已记录的 Storage CORS。** `conformance/storage-strictness-obs/recordings/run-2.json` 记录了在存储桶 CORS 缺失、为空和已配置时的 JSON API 元数据、媒体、存储桶、列表和 UBLA ACL 错误响应、上传预检、可续传初始化、取消以及已取消会话的读取。Strict 使用记录的 CORS 值，无需 `productionExact`；emulator profile 保留其现有行为。保留混合大小写的请求头、UBLA PATCH/切换行为以及将 expose 列表应用到其他响应属于未记录的假设。创建时接受记录的区域和禁用软删除提示，但不对这些服务建模。本地测试涵盖 UBLA 导出/导入和空的已创建存储桶。参见 [存储桶 CORS](../../products/storage/#bucket-cors)。

### Realtime Database

- 仅针对其记录的用例对照生产环境验证（参见 [生产环境验证](../#生产环境验证)）；更广泛的生产环境兼容性未经验证，也没有针对官方模拟器的对等声明。比较仅限于记录的官方模拟器用例。
- 列出的不支持的语法和求值用例（正则表达式构造、大小写映射以及那里列出的其他差异）会在加载规则时被拒绝或产生规则错误。`query.endBefore`、`query.isOrderByChild()`、`OrderByKey`、`OrderByValue` 和 `OrderByPriority` 名称、`http.encodeURL()`、未调用的方法读取以及三元表达式被调用者，会按照记录的生产环境行为加载和求值。
- 官方模拟器的确定化资源限制所拒绝的八个已记录模式，在 Fireemu 加载规则时同样会被拒绝，包括在未求值的表达式分支中。这并不能证明正则表达式或生产环境完全等价。
- Functions 触发器投递仅针对有限的已记录处理程序和写入进行了观测；更广泛的用例仍未验证。
- 在未观测生产环境的情况下取自官方模拟器的行为可能会改变。

参见 [Realtime Database](../../products/realtime-database/#differences-from-the-official-emulator)。

### Cloud Functions

- Fireemu 不为其投递事件的产品的触发器，例如 Data Connect（已推迟）。通过 Fireemu 本地模板管理发布或回滚 Remote Config 客户端模板时，会向 v1 和 v2 处理程序投递 2026-11-21 在生产环境记录的事件形式。服务器模板的发布不投递事件，2026-11-24 的生产环境记录中也没有投递；重复投递和顺序保证尚未确定（一次有限的记录中，每个事件都按顺序只到达一次）。
- Dart 代码库，以及 Firestore 事件以外的 protobuf CloudEvents 入口。Firestore 事件以 protobuf 形式到达 Python SDK，在 `strict` 下也以 protobuf 形式到达 Node 第 2 代函数。
- Storage 归档事件的确切形态仍未记录。
- Python 代码库支持 HTTP、可调用、Firestore、Pub/Sub、Storage、Eventarc、Realtime Database、定时、任务队列和 Auth 阻塞函数。它们只看到真实时间（无虚拟时钟），会重新加载应用源代码的更改，但忽略对其 `venv` 和 Python 字节码缓存的编辑，并且仅在 macOS 和 Linux 上运行。更改已安装的依赖后请重启 Fireemu。其可调用函数的 App Check 令牌由 Python SDK 根据 App Check 模拟器的密钥进行验证（不支持限用令牌消耗，并且显式的 App Check 配置会拒绝启动）。参见 [Cloud Functions（Python）](../../products/functions-python/)。

### Cloud Pub/Sub

- 架构（schema）、BigQuery 和 Cloud Storage 订阅投递、仅一次投递以及消息转换。
- `UpdateTopic` 仅支持 `labels` 更新掩码，以及在 emulator profile 下的 `message_storage_policy` 和 `kms_key_name` 更新掩码；`DetachSubscription` 未实现。
- `messageStoragePolicy` 按发送的原样存储，从不对照 Google Cloud 的区域进行检查；`strict` profile 会拒绝它。
- 在 emulator profile 下，主题的密钥名称和标签按发送的原样存储且从不验证；strict profile 会拒绝它们。

### App Check

- 通过 Play Integrity、App Attest、DeviceCheck 或 reCAPTCHA 进行的证明，以及使用限用令牌的重放保护。支持使用调试令牌进行本地测试。

## 本地控制的限制

- 会话之间共享时钟、规则、Functions 和准入屏障。
- 快照在守护进程生命周期内保存在内存中；它们不捕获未完成的 Functions 工作。
- `awaitIdle` 不等待 Text Index 工作，也不提供跨会话的因果栅栏。

## 任何本地模拟器都无法消除的差异

本地操作成功并不保证在生产环境中得到相同的结果。Fireemu 不重现真实的配额计算、计费、IAM、组织政策、区域或网络差异以及服务的发布推出。本地性能无法预测生产环境的延迟或吞吐量。

安全规则和 API 行为是根据文档以及对 Firebase 实际行为的观测实现的。Firebase 的变化或未经测试的条件可能会引入尚未记录的差异。

## 本地限制

有些限制仅存在于 Fireemu 中，用于约束内存使用：[Firestore 历史记录限制](../../products/firestore/#transactions-and-history) 和可选的 [Storage 存储字节数限制](../../products/storage/#limit-the-stored-bytes)。

## 版本之间的变化

配置和行为可能在不同版本之间发生变化。参见 [CHANGELOG](https://github.com/fireemu/fireemu/blob/main/CHANGELOG.md)。

## 相关内容

- [兼容性表](../)
- [Profile 与 productionExact](../../guides/profiles/)
- [性能](../performance/)
