---
title: CLI
description: 查阅 fireemu 命令行的命令和选项。
---

常用的 `fireemu` 命令及其选项。下面的代码块是当前版本的帮助文本；要查看您已安装版本的帮助，请运行 `npx fireemu --help` 或 `npx fireemu help <command>`。`exec` 和 `capabilities` 接受 `up` 的所有选项，这些选项只在 [up](#up) 下列出一次。

| 命令 | 作用 |
|---|---|
| [`init`](#init) | 在当前目录中创建 `fireemu.toml` |
| [`up`](#up) | 启动模拟器并保持运行，直到按下 `Ctrl+C`（别名：`emulators:start`） |
| [`exec`](#exec) | 启动模拟器，运行命令，然后停止它们（别名：`emulators:exec`） |
| [`emulators:export`](#emulatorsexport) | 将正在运行的套件的状态导出到目录 |
| [`doctor`](#doctor) | 检查安装：二进制文件、UI、Functions 运行器、Node.js |
| [`capabilities`](#capabilities) | 以 JSON 格式打印所解析 profile 的能力清单 |
| [`config show`](#config-show) | 打印每个配置键及其生效值和来源 |
| [`config lint`](#config-lint) | 列出配置中已设置、被接受但不起作用的设置；在 CI 中可使其失败 |
| [`config schema`](#config-schema) | 打印此二进制文件内置的配置架构，或将其写入文件 |
| `--version` （也可用 `-V`、`version`） | 打印版本并退出 |
| `help [command]` （也可用 `--help`、`-h`） | 打印命令列表或某个命令的帮助 |

## init

```text
fireemu init - create fireemu.toml in the current directory

usage:
  fireemu init [options]

Creates fireemu.toml in the current directory and prints the command to start with it. It never overwrites an existing file unless --force is given. An existing fireemu.json must be removed before creating fireemu.toml.

options:
  --reference
        Also write fireemu.reference.toml, which fireemu does not load. With an existing fireemu.toml or fireemu.json and no --profile or --firebase-json, write only the reference. Copying a key into fireemu.toml makes it explicit and stops productionExact from switching it.
  --profile strict|emulator
        Compatibility profile. strict follows production Firebase and is recommended, including when migrating from the official emulator; emulator is only for checking alignment with the pinned official emulator and is not needed when migrating. Default: strict (asked interactively).
  --firebase-json <file>
        Reference this firebase.json from fireemu.toml, so rules, indexes, Functions and ports are read from it on every start. Default: ./firebase.json when it exists (asked interactively).
  --interactive
        Ask for the missing choices. Default: only when stdin and stdout are terminals.
  --yes, --no-interactive
        Never ask; use the defaults for what is not given.
  --force
        Replace existing output files. Default: an existing file is an error.
  -h, --help
        Print this help and exit.
```

## up

```text
fireemu up - start the emulators and keep them running until Ctrl-C (alias: emulators:start)

usage:
  fireemu up [options]
  fireemu up --plan [--json] [options]
  fireemu emulators:start [options]

Serves the selected emulators (Firestore, Auth, Storage and App Check; Functions when a codebase is configured, and with it Eventarc and Cloud Tasks; Pub/Sub when configured; the Realtime Database when configured) plus the control API, the Emulator Hub and the UI on loopback until Ctrl-C.

options:
  --config <file>
        Configuration file: TOML (.toml) or JSON (any other extension), with schemaVersion 1, or a firebase.json. Default: ./fireemu.toml or ./fireemu.json when neither --config nor --firebase-json is given (both present is an error; remove one), else the nearest firebase.json (see --no-config-discovery), else the built-in defaults.
  --firebase-json <file>
        Read ports, rules, indexes and Functions codebases from this firebase.json. Takes precedence over one referenced by --config. Default: the one ./fireemu.toml or ./fireemu.json names, else, without either, the nearest firebase.json in the current directory or a parent.
  --no-config-discovery
        Do not search for ./fireemu.toml, ./fireemu.json or the nearest firebase.json when neither --config nor --firebase-json is given; use the built-in defaults. Also silences the warning for a discovered file that was skipped because of its owner or permissions. Default: the search is on.
  -P, --project <id|alias>
        Project ID, or an alias from the .firebaserc next to the firebase.json (else the current directory). Default: the .firebaserc default, else daemon.authProject from --config, else demo-app.
  --only <list>
        Comma-separated services to start: auth, firestore, storage, functions (or functions:<codebase>), eventarc, tasks, pubsub, database, appcheck, hosting. Default: Firestore, Auth, Storage and App Check; Functions when a codebase is configured (firebase.json or --functions), and with it Eventarc and Cloud Tasks; Pub/Sub when configured (emulators.pubsub, daemon.pubsubPort or --pubsub-port); the Realtime Database when configured (emulators.database, daemon.databasePort or --database-port); Hosting when firebase.json has hosting.public.
  --firestore-port <n>
        Firestore port. Default: 8080 (0 picks a free port).
  --http-port <n>
        Auth (Identity Toolkit) port. Default: 9099 (0 picks a free port).
  --storage-port <n>
        Storage port. Default: 9199 (0 picks a free port).
  --functions-port <n>
        Functions port, used when a codebase is loaded. Default: 5001 (0 picks a free port).
  --hosting-port <n>
        Hosting port, used when firebase.json has hosting.public. Default: 5000 (0 picks a free port).
  --eventarc-port <n>
        Eventarc port. Eventarc starts exactly when a Functions backend is loaded; this option only sets the port. Default: 9299.
  --tasks-port <n>
        Cloud Tasks port. Cloud Tasks starts exactly when a Functions backend is loaded; this option only sets the port. Default: 9499.
  --pubsub-port <n>
        Pub/Sub port. Without --only, giving it also starts Pub/Sub; with --only, Pub/Sub starts only when the list names pubsub. Default: 8085.
  --database-port <n>
        Realtime Database port. Without --only, giving it also starts the Realtime Database; with --only, it starts only when the list names database. Default: 9000.
  --functions <dir>
        Load exactly one Functions codebase from this directory, whatever firebase.json declares. Default: the codebases firebase.json declares.
  --ui-port <n|auto>
        UI port; auto assigns an available port, 0 disables the UI. Default: 4000 for up (the UI is skipped if that port is busy), off for exec.
  --hub-port <n|auto>
        Emulator Hub port; auto assigns an available port, 0 disables it. Default: 4400.
  --logging-port <n>
        Logging emulator port; 0 disables it. Default: 4500.
  --inspect-functions [port]
        Run the Functions runner under the Node inspector on this port (1024-65535); without a port, or with `true`, a free port. Refused when functions.runner is not node. Default: off.
  --log-verbosity quiet|silent|info|debug
        quiet and silent print errors only; info adds the banner and notices; debug also prints the resolved configuration. Case-insensitive. Default: info.
  --import <dir>
        Import an export directory (from --export-on-exit or emulators:export) at start; it must exist. Default: start empty.
  --export-on-exit [dir]
        Export all state to this directory when the emulators stop; without a directory, the --import directory. Refused for the working directory or a parent of it, and unavailable on Windows. Default: no export.
  --plan
        Resolve the run exactly as start-up does, print what it would do and start nothing: the project ID and where it came from, the command-line overrides, each service with its address (or why it is off), the environment variables the run sets and the inherited ones that remain, the absolute path of every rules, index and source file with the directory a relative path is resolved against, the Node or Python each Functions codebase would run on with its SDK versions, the active development defaults and the settings that have no effect. It runs `node --version` and a Python codebase's own interpreter, probes no port, and exits 1 when the run would fail for a reason it can see (a codebase that cannot start, a variable --deny-inherited-emulator-env refuses). For up and exec; capabilities accepts and ignores it. Default: off.
  --json
        With --plan: print the plan as JSON (planVersion 1) instead of text. Requires --plan. Default: text.
  --deny-inherited-emulator-env
        Refuse to start (exit 1, before anything starts) when the environment carries an emulator variable (FIRESTORE_EMULATOR_HOST, PUBSUB_EMULATOR_HOST, ...) for a service this run does not start: the command, or a Functions runner that inherits the environment, would reach whatever listens there, for example another worktree's suite. Variables of services this run starts are replaced by its own values and never refused. For up and exec; capabilities accepts and ignores it. Default: warn and keep the variable, as the official emulators:exec does.
  --allow-inherited-emulator-env <NAME>
        Keep this inherited emulator variable on purpose (for example PUBSUB_EMULATOR_HOST when one suite deliberately uses another's Pub/Sub): no warning and no refusal for it. May be repeated. A name that is no emulator variable is a usage error. Default: none.
  --ready-file <file>
        Publish endpoint discovery, including a control capability, to this private file once every listener is bound, and remove it on graceful shutdown. For tooling such as fireemu/testing. Default: none.
  --owner-stdin
        Shut down when standard input is closed. For tooling such as fireemu/testing. Default: off.
  -h, --help
        Print this help and exit.
```

## exec

```text
fireemu exec - start the emulators, run a command, stop them (alias: emulators:exec)

usage:
  fireemu exec [options] "shell script"
  fireemu exec [options] -- <command...>
  fireemu exec --plan [--json] [options] -- <command...>
  fireemu emulators:exec [options] "shell script"
  fireemu emulators:exec [options] -- <command...>

Starts the same emulators as `up`, runs the command with the emulator host environment variables (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, and so on) once every listener is bound, stops everything when the command exits, and exits with the command's status. On Unix, a command ended by signal n gives 128 + n, and SIGINT and SIGTERM are forwarded to it.

Like the official emulators:exec, the command inherits the parent environment, and this run's values replace the variables of the services it starts. An emulator variable for a service it does not start stays as it is (and is warned about); --deny-inherited-emulator-env refuses such a run instead, and --allow-inherited-emulator-env keeps a variable on purpose. --plan shows the environment without starting anything.

With "shell script" (the official form) the script is run by the system shell. With `--` the command is run as exactly that program and argv, without a shell. Everything after `--` belongs to the command, including --help; a `--help` inside the script text is script text.

options: every option of `up` (listed under up above), and:
  --ui
        Start the UI while the command runs (exec does not start it otherwise, as in `firebase emulators:exec`). --ui-port overrides.
  -h, --help
        Print this help and exit.
```

### 规划一次运行

在 `up` 或 `exec` 上使用 `--plan` 会完全按照启动时的方式解析本次运行，打印它将执行的操作，但不启动任何内容。`--json` 以 JSON 格式（`planVersion` 1）打印相同的计划。在 CI 作业之前运行它，可以查看命令行与配置组合后的结果：

```sh
npx fireemu exec --plan -- npm test
npx fireemu up --plan --json --only firestore,auth --project demo-ci
```

计划列出：

- 项目 ID 及选定它的规则（`--project`、`.firebaserc` 中的别名、`.firebaserc` 的默认项目、`daemon.authProject` 或内置默认值）、已加载的配置文件，以及已应用的命令行覆盖。[`config show`](#config-show) 只读取文件，因此不包含这些覆盖。
- 每个服务及其地址，或其不启动的原因（`--only`、没有 Functions 代码库、未配置 Pub/Sub）。它不探测端口；运行会在启动时绑定其端口。
- 环境：本次运行为其服务设置的变量，以及父环境中携带且保留下来的模拟器变量（参见 [继承的模拟器变量](#继承的模拟器变量)）。继承的端点中的凭据会被替换为 `***`。
- 运行时打开的每个规则、索引、文本索引和源文件：绝对路径、所写的路径，以及解析相对路径所依据的目录。规范配置中的路径相对于工作目录解析，`firebase.json` 中的路径相对于其所在目录解析（[相对路径](../../guides/configuration/#relative-paths)）；当规范配置位于工作目录以外的目录时，计划会发出警告，因为从其所在目录运行同一文件会读取其他文件。
- 对于每个 Functions 代码库，本次运行将使用的 Node 或 Python 可执行文件及版本（由启动时使用的同一代码选定，因此 `FIREEMU_NODE`、`PATH`、`VOLTA_HOME`、`engines.node` 和代码库的 `venv` 都会被考虑），以及已安装的 `firebase-functions` 和 `firebase-admin` 版本。计划会运行 `node --version` 和 Python 代码库的解释器来确定这些信息。
- 生效的开发默认值，其中 [`productionExact`](../../guides/profiles/) 会切换的项标记为 `relaxed`，以及配置中设置但 [不起作用](#config-lint) 的设置。

当本次运行会因计划能发现的原因而失败时，命令仍会打印计划并以 1 退出：无法启动的 Functions 代码库（没有可用的 Node、缺少 `venv`），或被 `--deny-inherited-emulator-env` 拒绝的继承变量。守护进程拒绝的配置会以与 `up` 相同的消息和退出码失败。

### 继承的模拟器变量

与 `firebase emulators:exec` 一样，`exec` 将您的环境传给其命令，并替换它所启动的服务的变量。本次运行不启动的服务的变量保持原值，因此缺失的模拟器永远不会让 SDK 连到生产环境。这也意味着，另一个套件（第二个检出或并行作业）留在您 Shell 中的变量会让您的测试指向那个套件，因此 Fireemu 会报告它：

- 默认情况下，它会为每个这样的变量打印一条 `warning:`，保留该变量，然后运行。
- 当环境中带有本次运行不启动的服务的模拟器变量时，`--deny-inherited-emulator-env` 会在任何内容启动之前拒绝运行（退出码 1）。本次运行启动的服务的变量会被替换为它自己的值，永远不会被拒绝。它也适用于 `up`，此时这些变量属于启动它的 Shell，以及 `emulator` profile 下的 Functions 运行器。
- `--allow-inherited-emulator-env <NAME>` 有意保留某个变量，例如当一个套件有意使用另一个套件的 Pub/Sub 时的 `PUBSUB_EMULATOR_HOST`。它会消除该变量的警告和拒绝，可以重复使用，并且会拒绝不是模拟器变量的名称。[`--plan`](#规划一次运行) 会列出每个继承的变量及其处理方式。

该检查识别 Firebase 和 Google Cloud SDK 读取的每个模拟器主机变量，包括用于 Fireemu 不提供（因而永远不会启动）的服务的 `DATA_CONNECT_EMULATOR_HOST` 和 `FIREBASE_DATA_CONNECT_EMULATOR_HOST`。Hub 和 Logging 模拟器是尽力而为的（默认端口被占用只会禁用它们）：启动前检查将它们视为已启动，并在监听器绑定后、任何 Functions 运行器或命令启动之前，针对实际绑定成功的监听器再次运行检查。`functions.runner` 覆盖会显示为参数被替换为 `[redacted]` 的形式，因为参数可能包含凭据。

## emulators:export

```text
fireemu emulators:export - export the state of a running suite to a directory

usage:
  fireemu emulators:export <dir> [options]

Asks the suite that is already running for the project (found through its Emulator Hub locator file) to write its state to <dir>, in the format --import reads. Not available on Windows.

options:
  -P, --project <id>
        Project of the running suite. Default: the .firebaserc default in the current directory, else demo-app.
  -f, --force
        Overwrite a non-empty destination. Default: refused.
  -h, --help
        Print this help and exit.
```

## doctor

```text
fireemu doctor - check the installation: binary, UI, Functions runner, Node.js

usage:
  fireemu doctor [--connect <control url> | --export-dir <path>]

Reports the Fireemu binary, UI, Functions runner and the Node.js that Functions would run on (FIREEMU_NODE, else the first node on PATH or in VOLTA_HOME, chosen by the code Functions start-up uses, not the node a shell finds), and suggests a remedy for each problem. A codebase's runtime or engines.node can select another installed Node; `fireemu up --plan` shows the one each codebase gets.

options:
  --export-dir path
        Inspect an export destination and its ancestors without starting a daemon or changing files. Export checks again when it writes. Cannot be combined with --connect.
  --connect http://127.0.0.1:<port>
        Also report what a running suite says, through its control URL (the control port is printed at startup). Default: only the offline report.
  -h, --help
        Print this help and exit.
```

## capabilities

```text
fireemu capabilities - print the capability manifest of the resolved profile as JSON

usage:
  fireemu capabilities [options]

Prints the capability manifest for the profile the options resolve to. It accepts the same options as `up` and validates them the same way, but only --config (the profile it names) changes the result.

options: every option of `up` (listed under up above); only --config and --firebase-json change the result.
  -h, --help
        Print this help and exit.
```

`capabilities` 在不启动守护进程的情况下解析配置的 profile 和覆盖。缺少虚拟时钟起始时间会在标准错误中报告，而标准输出仍是能力 JSON；启动时仍需要该时钟值。

## config show

`fireemu config show` 按架构顺序打印每个配置键及其生效值和来源。它使用与 `fireemu up` 相同的配置发现，但不包含 `up` 的命令行覆盖（`--project`、`--only` 和端口标志），也不启动模拟器。要同时查看文件和覆盖的结果，请使用 [`fireemu up --plan`](#规划一次运行)。

使用 `--config <path>` 或 `--firebase-json <path>` 选择文件，使用 `--json` 输出包含 `key`、`value`、`source` 和架构描述的记录。

- 来源区分显式值、默认值、`productionExact`、派生值和未设置的键。
- 当运行时不公开某个值时，命令会使用其在文件中的显式值、其架构默认值（标记为 `default (schema)`）或 `(unset)`（在 JSON 中为 `null`，来源为 `unset`）。
- 配置接受但守护进程不读取的键（例如 `bind`、`limits.catalog`、`firestore.textSearch.*`、`rules.staticLimitChecks`、`auth.enabled` 和 `trace.*`）的来源为 `accepted, no effect`：其值按所写的原样或 `(unset)` 显示，绝不会显示为已生效，并且设置了这类键的配置会在启动时打印一条 `note:` 行。
- 包含机密的值在文本和 JSON 中都会被屏蔽为 `[redacted]`：`pubsub.authentication.localBearerToken`、每个 `auth.apiKeys` 值、`auth.customTokenSigners`、OIDC 提供方的 `clientSecret` 以及 App Check 应用的 `debugTokenSha256` 条目。其他字段保持可见，null 仍为 null。
- `firebaseJson` 显示实际选定的 Firebase 配置文件，包括通过 `--firebase-json` 选定的文件。
- 在 `appCheck.enabled` 下方，`in effect` 行按表面（兑换、callable、Auth、Firestore、Storage）显示 App Check 实际提供的内容，用语与启动横幅一致；仅看该键无法得知，因为严格配置文件在没有 `appCheck` 块时也会提供兑换。JSON 将其作为该行的 `effective` 对象携带。它涵盖所有产品，或 `--only <services>` 指定的产品，选取方式与 `fireemu up --only` 相同；`--only` 不会改变输出中的其他任何内容。

## config lint

```text
fireemu config lint [--config <path>] [--firebase-json <path>] [--json] [--deny-ineffective] [--allow <key>]... [--allow-file <path>]
```

`fireemu config lint` 列出配置中已设置、Fireemu 接受但不读取的设置。它完全按照 `fireemu config show` 的方式加载配置；守护进程拒绝的配置会以相同的消息和退出码 1 失败。每一行的文本与 `fireemu up` 在启动时打印的 `note:` 行相同，两者来自同一份键列表，因此开始生效的键会同时从 lint 和 note 中消失。未设置任何此类键的配置会打印 `no ineffective settings`。

默认情况下，报告仅供参考，退出码为 0。在 CI 作业中添加 `--deny-ineffective` 可将其变为检查：当配置设置了任何允许列表条目都未涵盖的此类设置时，命令会列出每个设置并以 1 退出。

```sh
fireemu config lint --deny-ineffective --allow bind --allow 'firestore.textSearch.*'
```

- `--allow <key>` 指定一个虽然不起作用但可以存在的设置，例如为以后的版本保留的键。`prefix.*` 涵盖 `prefix` 下的所有键。该选项可以重复使用。允许的设置仍会列出并标记为 `allowed`，不会使检查失败。
- `--allow-file <path>` 从文件中读取允许列表条目，每行一个。文件必须为 UTF-8；接受字节顺序标记和 CRLF 行尾，任何其他编码都属于用法错误（退出码 2）。空行和 `#` 注释（整行或行尾）会被忽略。当列表较长或应在版本控制中审查时使用它。
- 不对应任何配置键的条目（拼写错误，或写成 `trace` 这样的表而不是 `trace.*`）属于用法错误，退出码为 2，因此拼错的条目不会悄无声息地什么也不允许。
- `--json` 打印 `config`（所检查的文件或 `null`）、`ineffective`（每个设置及其 `key`、`note` 和 `allowed`）和 `denied`（在 `--deny-ineffective` 下失败的键）。它报告键和说明，不报告配置值。
- 只检查规范配置（`fireemu.toml` 或 `fireemu.json`）。如果找不到，命令会说明这一点并以 0 退出。

## config schema

`fireemu config schema` 逐字节打印此二进制文件用于验证配置的 JSON Schema，无需网络。

`--out <path>` 改为将其写入文件，不打印任何内容。现有的普通文件会被原子地替换，因此副本会随升级更新；与 `init --force` 一样，符号链接会被拒绝。

发布版二进制文件的 `fireemu init` 会将其版本的架构 URL 写入生成的文件。当编辑器或工具需要已安装版本的架构且无法获取该 URL 时，请使用 `config schema`。
