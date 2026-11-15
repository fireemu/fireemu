---
title: 环境变量
description: 查阅 Fireemu 为您的命令和 Functions 代码设置的环境变量，以及它读取的环境变量。
---

此列表取自 `fireemu` 二进制文件和 npm 包的源代码。未在此列出的内容属于实现细节，可能会改变。

## 由 `fireemu exec` 设置

`exec` 为其命令提供正在运行的模拟器的变量，除此之外不设置自己的任何变量。名称和格式遵循 `firebase emulators:exec` 写入的内容。

未选中的模拟器的变量保持您环境中的原样，因此缺失的模拟器绝不会意外地让 SDK 连到生产环境。`exec` 会为每个这样的变量打印一条警告，而 `--deny-inherited-emulator-env` 则会拒绝运行（参见 [继承的模拟器变量](../cli/#继承的模拟器变量)）。

| 变量 | 值 | 条件 |
|---|---|---|
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_FIRESTORE_EMULATOR_ADDRESS` | Firestore 的 `host:port` | Firestore 运行时 |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authentication 的 `host:port` | Authentication 运行时 |
| `FIREBASE_STORAGE_EMULATOR_HOST` | Storage 的 `host:port` | Storage 运行时 |
| `STORAGE_EMULATOR_HOST` | 供 Cloud Storage 客户端库使用的 Storage URL（`http://host:port`）。当 Storage 的 App Check 为 `enforced` 且 `appCheck.storageServerRequests` 设为 `"capability"` 时，它还携带每次运行的 Admin 能力（参见 [App Check](../../products/app-check/)） | Storage 运行时 |
| `FIREBASE_DATABASE_EMULATOR_HOST` | Realtime Database 的 `host:port` | Realtime Database 运行时 |
| `PUBSUB_EMULATOR_HOST` | Pub/Sub 的 `host:port` | Pub/Sub 运行时 |
| `CLOUD_EVENTARC_EMULATOR_HOST` | Eventarc URL（`http://host:port`） | Functions 运行时 |
| `CLOUD_TASKS_EMULATOR_HOST` | Cloud Tasks 的 `host:port` | Functions 运行时 |
| `FIREEMU_FUNCTIONS_HOST` | Functions 的 `host:port` | Functions 运行时 |
| `FIREEMU_APP_CHECK_EMULATOR_HOST`, `FIREEMU_APP_CHECK_JWKS_URL` | App Check 交换主机和 JWKS URL | App Check 可用时（参见 [App Check](../../products/app-check/)） |
| `FIREBASE_EMULATOR_HUB` | Emulator Hub 的 `host:port` | Hub 运行时 |
| `FIREBASE_LOGGING_EMULATOR_HOST` | Logging 模拟器的 `host:port` | Logging 模拟器运行时 |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | 项目 ID | 始终 |
| `FIREBASE_CONFIG` | 根据项目 ID 设置 | 除非您的环境中已有该变量 |
| `FIREEMU_CONTROL_URL` | 控制 API 的基础 URL，以 `/v1/` 结尾 | 始终 |
| `FIREEMU_CONTROL_TOKEN` | 控制 API 的 Bearer 令牌；供 `fireemu/testing` 以及 [Cloud Firestore](../../products/firestore/#fail-a-ci-job-on-a-missing-index) 中的脚本使用 | 始终 |

`fireemu up` 不会在您的 Shell 中设置变量。其启动输出会打印每个 `host:port`（例如 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`），Emulator UI 也会在 Overview 页面的“Environment for SDKs”下显示它们。

## 为 Functions 代码设置

Functions 代码库运行时带有正在运行的服务的相同模拟器主机变量，外加 `FUNCTIONS_EMULATOR=true`、项目 ID 变量和 `FIREBASE_CONFIG`。

只有一小部分变量从守护进程继承。凭据被有意排除：`GOOGLE_APPLICATION_CREDENTIALS`、`FIREBASE_TOKEN` 和 `CLOUDSDK_*` 不会传到函数代码。`FIREEMU_RUNNER*` 变量属于内部变量。

## 由 Fireemu 读取

| 变量 | 作用 |
|---|---|
| `FIREEMU_BINARY_PATH` | `fireemu` 启动器运行此二进制文件，而不是平台包中的二进制文件。用于没有发布二进制文件的平台，或您自己构建的二进制文件。 |
| `FIREEMU_NODE` | 运行 Functions 代码库的 Node.js 可执行文件的绝对路径。如果不是指向可执行文件的绝对路径，则会被拒绝。未设置时，Fireemu 会在 `PATH` 目录（以及 Volta 的目录，参见 `VOLTA_HOME`）中查找 `node`。 |
| `FIREEMU_RUNNER_NODE`, `FIREEMU_RUNNER_PYTHON` | 用于替代内置脚本的 Functions 运行器脚本（`index.mjs`、`runner.py`）的路径。文件不存在时报错。 |
| `FIREEMU_WORKER_THREADS` | 异步工作线程数，1 至 64。默认：可用核心数，最多 4。 |
| `FIREEMU_MAX_BLOCKING_THREADS` | 阻塞线程数的上限，1 至 512。默认：64。 |
| `FIREEMU_CONTROL_TOKEN` | `fireemu doctor --connect` 将其作为 Bearer 令牌发送给控制 API。在 `fireemu exec` 内部它已被设置。 |
| `FIREBASE_CONFIG` | 当 `exec` 发现它已设置时，会保留您的值，而不是根据项目 ID 写入一个值。 |
| `PATH`, `VOLTA_HOME` | 未设置 `FIREEMU_NODE` 时查找 Node.js 的位置。 |
| `HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA` | Authentication 会话签名密钥缓存的保存位置（仅所有者可访问的目录）；如果没有可用的缓存，每次启动时会在内存中生成密钥。 |
| `SUDO_UID` | 当 Fireemu 以 root 身份运行时，此处指定的用户也是所发现配置文件的可信所有者。参见 [文件所有权检查](../../guides/configuration/#file-ownership-checks)。 |
| `ComSpec` | 在 Windows 上，运行 `fireemu exec "script"` 脚本形式的 Shell。默认：`cmd.exe`。 |
| `FIREEMU_TRACE_WEBCHANNEL`, `FIREEMU_TRACE_STORAGE` | 设为任意值都会在标准错误中打印请求跟踪（`[webchannel] ...`、`[storage] ...`），用于诊断客户端问题。不适用于常规运行。 |
