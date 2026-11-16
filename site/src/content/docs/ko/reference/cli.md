---
title: CLI
description: fireemu 명령줄의 명령과 옵션을 찾아봅니다.
---

자주 쓰는 `fireemu` 명령과 그 옵션입니다. 아래 블록은 현재 릴리스의 도움말 텍스트입니다. 설치된 버전의 도움말은 `npx fireemu --help` 또는 `npx fireemu help <command>`로 확인하십시오. `exec`와 `capabilities`는 `up`의 모든 옵션을 받으며, 옵션은 [up](#up)에 한 번만 나열되어 있습니다.

| 명령 | 기능 |
|---|---|
| [`init`](#init) | 현재 디렉터리에 `fireemu.toml`을 생성합니다 |
| [`up`](#up) | 에뮬레이터를 시작하고 `Ctrl+C`까지 계속 실행합니다(별칭: `emulators:start`) |
| [`exec`](#exec) | 에뮬레이터를 시작하고, 명령을 실행한 뒤, 에뮬레이터를 중지합니다(별칭: `emulators:exec`) |
| [`emulators:export`](#emulatorsexport) | 실행 중인 스위트의 상태를 디렉터리로 내보냅니다 |
| [`doctor`](#doctor) | 설치를 점검합니다: 바이너리, UI, Functions 러너, Node.js |
| [`capabilities`](#capabilities) | 확정된 프로필의 기능 매니페스트를 JSON으로 출력합니다 |
| [`config show`](#config-show) | 모든 구성 키를 유효 값과 출처와 함께 출력합니다 |
| [`config lint`](#config-lint) | 구성이 설정했지만 수락될 뿐 효과가 없는 설정을 나열하며, CI에서는 그 경우 실패시킵니다 |
| [`config schema`](#config-schema) | 이 바이너리에 포함된 구성 스키마를 출력하거나 파일로 기록합니다 |
| `--version` (`-V`, `version`도 가능) | 버전을 출력하고 종료합니다 |
| `help [command]` (`--help`, `-h`도 가능) | 명령 목록 또는 한 명령의 도움말을 출력합니다 |

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

### 실행 계획 확인

`up` 또는 `exec`의 `--plan`은 시작할 때와 정확히 같은 방식으로 실행을 확정하고, 수행할 작업을 출력하며, 아무것도 시작하지 않습니다. `--json`은 같은 계획을 JSON으로 출력합니다(`planVersion` 1). CI 작업 전에 실행하면 명령줄과 구성이 합쳐져 어떤 결과가 되는지 확인할 수 있습니다.

```sh
npx fireemu exec --plan -- npm test
npx fireemu up --plan --json --only firestore,auth --project demo-ci
```

계획에는 다음이 나열됩니다.

- 프로젝트 ID와 이를 선택한 규칙(`--project`, `.firebaserc`의 별칭, `.firebaserc`의 기본값, `daemon.authProject`, 또는 내장 기본값), 로드된 구성 파일, 적용된 명령줄 재정의. [`config show`](#config-show)는 파일만 읽으므로 재정의를 포함하지 않습니다.
- 주소가 있는 모든 서비스, 또는 서비스가 시작되지 않는 이유(`--only`, Functions 코드베이스 없음, Pub/Sub 미구성). 포트를 조사하지는 않으며, 실행이 시작될 때 포트를 바인딩합니다.
- 환경: 실행이 서비스를 위해 설정하는 변수와, 부모 환경이 갖고 있어 그대로 남는 에뮬레이터 변수([상속된 에뮬레이터 변수](#상속된-에뮬레이터-변수) 참조). 상속된 엔드포인트의 자격 증명은 `***`로 대체됩니다.
- 실행이 여는 각 규칙, 인덱스, 텍스트 인덱스, 소스 파일: 절대 경로, 작성된 그대로의 경로, 상대 경로를 해석하는 기준 디렉터리. 정규 구성의 경로는 작업 디렉터리를 기준으로, `firebase.json`의 경로는 해당 파일의 디렉터리를 기준으로 해석됩니다([상대 경로](../../guides/configuration/#상대-경로)). 정규 구성이 작업 디렉터리가 아닌 다른 디렉터리에 있으면 계획이 경고합니다. 같은 파일을 자기 디렉터리에서 실행하면 다른 파일을 읽게 되기 때문입니다.
- Functions 코드베이스마다, 실행이 사용할 Node 또는 Python 실행 파일과 버전(시작 시 사용하는 것과 같은 코드로 선택되므로 `FIREEMU_NODE`, `PATH`, `VOLTA_HOME`, `engines.node`, 코드베이스의 `venv`가 모두 반영됨), 그리고 설치된 `firebase-functions`와 `firebase-admin` 버전. 이를 알아내기 위해 계획은 `node --version`과 Python 코드베이스의 인터프리터를 실행합니다.
- 적용 중인 개발 기본값. [`productionExact`](../../guides/profiles/)가 전환할 항목은 `relaxed`로 표시되며, 구성이 설정했지만 [효과가 없는](#config-lint) 설정도 나열됩니다.

계획이 확인할 수 있는 이유로 실행이 실패할 때, 즉 시작할 수 없는 Functions 코드베이스(사용할 수 있는 Node 없음, `venv` 누락)나 `--deny-inherited-emulator-env`가 거부하는 상속된 변수가 있을 때 명령은 계획을 계속 출력한 채 종료 코드 1로 끝납니다. 데몬이 거부하는 구성은 `up`과 같은 메시지와 종료 코드로 실패합니다.

### 상속된 에뮬레이터 변수

`exec`는 `firebase emulators:exec`와 마찬가지로, 시작하는 서비스의 변수를 교체한 사용자의 환경을 명령에 전달합니다. 이번 실행이 시작하지 않는 서비스의 변수는 값을 유지하므로, 에뮬레이터가 없다고 해서 SDK가 프로덕션으로 향하는 일은 없습니다. 그러나 다른 스위트(두 번째 체크아웃이나 병렬 작업)가 셸에 남겨 둔 변수가 테스트를 그 스위트로 향하게 할 수 있으므로 Fireemu가 이를 보고합니다.

- 기본적으로 그러한 변수마다 `warning:`을 출력하고, 변수를 유지한 채 실행합니다.
- `--deny-inherited-emulator-env`는 환경이 이번 실행이 시작하지 않는 서비스의 에뮬레이터 변수를 갖고 있으면, 아무것도 시작하기 전에 실행을 거부합니다(종료 코드 1). 실행이 시작하는 서비스의 변수는 실행 자체의 값으로 교체되므로 거부되지 않습니다. 변수가 해당 명령을 시작하는 셸에 속하는 `up`에도, `emulator` 프로필의 Functions 러너에도 적용됩니다.
- `--allow-inherited-emulator-env <NAME>`은 의도적으로 하나를 유지합니다. 예를 들어 한 스위트가 다른 스위트의 Pub/Sub를 일부러 사용할 때의 `PUBSUB_EMULATOR_HOST`가 그렇습니다. 해당 변수에 대한 경고와 거부를 없애며, 반복해서 지정할 수 있고, 에뮬레이터 변수가 아닌 이름은 거부합니다. [`--plan`](#실행-계획-확인)은 상속된 각 변수와 그 처리 방식을 나열합니다.

이 검사는 Firebase와 Google Cloud SDK가 읽는 모든 에뮬레이터 호스트 변수를 인식하며, Fireemu가 제공하지 않아 시작되지 않는 서비스를 위한 `DATA_CONNECT_EMULATOR_HOST`와 `FIREBASE_DATA_CONNECT_EMULATOR_HOST`도 포함합니다. Hub와 Logging 에뮬레이터는 최선 노력(best effort)으로 동작합니다(기본 포트가 사용 중이면 해당 에뮬레이터만 비활성화됩니다). 시작 전 검사는 이들을 시작된 것으로 취급하고, 리스너가 바인딩된 뒤 Functions 러너나 명령이 시작되기 전에 실제로 바인딩된 것들을 대상으로 검사를 다시 실행합니다. `functions.runner` 재정의는 인수에 자격 증명이 들어 있을 수 있으므로 인수를 `[redacted]`로 대체해서 표시합니다.

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

`capabilities`는 데몬을 시작하지 않고 구성된 프로필과 재정의를 확정합니다. 가상 시계 시작 시각이 없으면 표준 오류에 보고되고 표준 출력은 계속 기능 JSON으로 유지됩니다. 단, 시작에는 여전히 그 시계 값이 필요합니다.

## config show

`fireemu config show`는 모든 구성 키를 스키마 순서대로 유효 값과 출처와 함께 출력합니다. `fireemu up`과 같은 구성 탐색을 사용하지만, `up`의 명령줄 재정의(`--project`, `--only`, 포트 플래그)는 적용하지 않고 에뮬레이터도 시작하지 않습니다. 파일과 재정의를 함께 적용한 결과를 보려면 [`fireemu up --plan`](#실행-계획-확인)을 사용하십시오.

파일을 선택하려면 `--config <path>` 또는 `--firebase-json <path>`를, `key`, `value`, `source`, 스키마 설명을 담은 레코드를 얻으려면 `--json`을 사용하십시오.

- 출처는 명시적 값, 기본값, `productionExact`, 파생 값, 설정되지 않은 키를 구분합니다.
- 런타임이 값을 노출하지 않을 때 명령은 명시된 파일 값, 스키마 기본값(`default (schema)`로 표시), 또는 `(unset)`(JSON에서는 출처 `unset`의 `null`)을 사용합니다.
- 구성이 수락하지만 데몬이 읽지 않는 키(예: `bind`, `limits.catalog`, `firestore.textSearch.*`, `rules.staticLimitChecks`, `auth.enabled`, `trace.*`)의 출처는 `accepted, no effect`입니다. 값은 작성된 그대로 또는 `(unset)`으로 표시되며 적용 중인 것처럼 표시되지 않고, 이러한 키를 설정한 구성은 시작 시 `note:` 줄을 출력합니다.
- 비밀을 담은 값은 텍스트와 JSON에서 `[redacted]`로 가려집니다: `pubsub.authentication.localBearerToken`, 각 `auth.apiKeys` 값, `auth.customTokenSigners`, OIDC 공급자의 `clientSecret`, App Check 앱의 `debugTokenSha256` 항목. 다른 필드는 그대로 표시되고 null은 null로 유지됩니다.
- `firebaseJson`은 `--firebase-json`으로 선택한 것을 포함해, 실제로 선택된 Firebase 구성 파일을 표시합니다.
- `appCheck.enabled` 아래의 `in effect` 줄은 App Check가 표면별(교환, callable, Auth, Firestore, Storage)로 무엇을 제공하는지 시작 배너와 같은 용어로 보여 줍니다. 엄격 프로파일은 `appCheck` 블록 없이도 교환을 제공하므로 키만으로는 알 수 없습니다. JSON에서는 해당 행의 `effective` 객체로 담습니다. 모든 제품 또는 `fireemu up --only`가 선택하는 방식대로 `--only <services>`가 지정한 제품을 대상으로 하며, `--only`는 출력의 다른 부분을 바꾸지 않습니다.

## config lint

```text
fireemu config lint [--config <path>] [--firebase-json <path>] [--json] [--deny-ineffective] [--allow <key>]... [--allow-file <path>]
```

`fireemu config lint`는 구성이 설정했고 Fireemu가 수락하지만 읽지 않는 설정을 나열합니다. `fireemu config show`와 정확히 같은 방식으로 구성을 로드하며, 데몬이 거부하는 구성은 같은 메시지와 종료 코드 1로 실패합니다. 각 줄은 `fireemu up`이 시작 시 출력하는 `note:` 줄과 같은 텍스트를 담고 있으며 둘 다 하나의 키 목록에서 나오므로, 효과를 갖게 된 키는 lint와 note에서 함께 사라집니다. 이러한 설정이 하나도 없는 구성은 `no ineffective settings`를 출력합니다.

기본적으로 보고서는 정보 제공용이며 종료 코드는 0입니다. CI 작업에서 `--deny-ineffective`를 추가하면 검사가 됩니다. 허용 목록 항목이 포함하지 않는 설정을 구성이 갖고 있으면 명령은 각 설정을 지목하며 종료 코드 1로 끝납니다.

```sh
fireemu config lint --deny-ineffective --allow bind --allow 'firestore.textSearch.*'
```

- `--allow <key>`는 효과가 없더라도 존재해도 되는 설정을 지정합니다. 예를 들어 이후 릴리스를 위해 유지하는 키입니다. `prefix.*`는 `prefix` 아래의 모든 키를 포함합니다. 이 옵션은 반복해서 지정할 수 있습니다. 허용된 설정도 `allowed`로 표시되어 여전히 나열되며 검사를 실패시키지 않습니다.
- `--allow-file <path>`는 파일에서 허용 목록 항목을 한 줄에 하나씩 읽습니다. 파일은 UTF-8이어야 합니다. 바이트 순서 표시(BOM)와 CRLF 줄 끝은 허용되며, 그 외 인코딩은 사용법 오류(종료 코드 2)입니다. 빈 줄과 `#` 주석(줄 전체 또는 줄 끝)은 무시됩니다. 목록이 길거나 버전 관리에서 검토해야 할 때 사용하십시오.
- 구성 키가 아닌 항목(오타, 또는 `trace.*` 대신 `trace` 같은 테이블)은 종료 코드 2의 사용법 오류이므로, 철자가 틀린 항목이 조용히 아무것도 허용하지 않는 일이 없습니다.
- `--json`은 `config`(검사한 파일 또는 `null`), `ineffective`(`key`, `note`, `allowed`를 가진 각 설정), `denied`(`--deny-ineffective`에서 실패하는 키)를 출력합니다. 구성 값이 아니라 키와 note를 보고합니다.
- 정규 구성(`fireemu.toml` 또는 `fireemu.json`)만 검사합니다. 아무것도 찾지 못하면 명령은 그 사실을 알리고 0으로 종료합니다.

## config schema

`fireemu config schema`는 이 바이너리가 구성을 검증하는 데 사용하는 JSON Schema를 네트워크 없이 바이트 단위로 그대로 출력합니다.

`--out <path>`는 대신 파일에 기록하고 아무것도 출력하지 않습니다. 기존 일반 파일은 원자적으로 교체되므로 업그레이드 후 사본이 갱신되며, `init --force`와 마찬가지로 심볼릭 링크는 거부됩니다.

릴리스된 바이너리의 `fireemu init`은 생성하는 파일에 해당 릴리스의 스키마 URL을 기록합니다. 편집기나 도구에 설치된 버전의 스키마가 필요한데 그 URL을 가져올 수 없을 때는 `config schema`를 사용하십시오.
