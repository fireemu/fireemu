---
title: CLI
description: fireemuコマンドラインのコマンドとオプションを調べます。
---

`fireemu`の主なコマンドとそのオプションです。以下のブロックは現行リリースのヘルプテキストです。インストールされているバージョンのヘルプは、`npx fireemu --help`または`npx fireemu help <command>`で確認してください。`exec`と`capabilities`は`up`のすべてのオプションを受け付けます。それらは[up](#up)にまとめて載せています。

| コマンド | 内容 |
|---|---|
| [`init`](#init) | カレントディレクトリに`fireemu.toml`を作成します |
| [`up`](#up) | エミュレータを起動し、`Ctrl+C`まで実行し続けます(エイリアス: `emulators:start`) |
| [`exec`](#exec) | エミュレータを起動し、コマンドを実行して、停止します(エイリアス: `emulators:exec`) |
| [`emulators:export`](#emulatorsexport) | 実行中のスイートの状態をディレクトリにエクスポートします |
| [`doctor`](#doctor) | インストールを検査します: バイナリ、UI、Functionsランナー、Node.js |
| [`capabilities`](#capabilities) | 解決されたプロファイルの機能マニフェストをJSONで出力します |
| [`config show`](#config-show) | すべての設定キーを、有効な値とその由来とともに出力します |
| [`config lint`](#config-lint) | 設定が指定している、受け付けられるが効果のない設定を一覧表示します。CIではそれらで失敗させます |
| [`config schema`](#config-schema) | このバイナリに同梱された設定スキーマを出力するか、ファイルに書き出します |
| `--version`(`-V`、`version`も可) | バージョンを出力して終了します |
| `help [command]`(`--help`、`-h`も可) | コマンドの一覧、または1つのコマンドのヘルプを出力します |

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

### 実行を計画する

`up`または`exec`に`--plan`を付けると、起動時とまったく同じように実行を解決し、何を行うかを出力して、何も起動しません。`--json`は同じプランをJSON(`planVersion` 1)で出力します。CIジョブの前に実行すると、コマンドラインと設定がどのような結果になるかを確認できます。

```sh
npx fireemu exec --plan -- npm test
npx fireemu up --plan --json --only firestore,auth --project demo-ci
```

プランには次が一覧されます。

- プロジェクトIDと、それを選んだルール(`--project`、`.firebaserc`のエイリアス、`.firebaserc`のデフォルト、`daemon.authProject`、または組み込みのデフォルト)、読み込まれた設定ファイル、適用されたコマンドラインのオーバーライド。[`config show`](#config-show)はファイルだけを読むため、オーバーライドは含まれません。
- 各サービスのアドレス、または起動しない理由(`--only`、Functionsのコードベースがない、Pub/Subが未設定)。ポートの確認は行いません。実行時に起動したとき、ポートがバインドされます。
- 環境: 実行がサービスのために設定する変数と、親の環境が持っていて残るエミュレータ変数([継承されたエミュレータ変数](#継承されたエミュレータ変数)を参照)。継承されたエンドポイントに含まれる認証情報は、`***`に置き換えられます。
- 各ルール、インデックス、テキストインデックス、ソースのファイルについて、実行が開くとおりの絶対パス、記述されたとおりのパス、相対パスの解決基準となるディレクトリ。正規の設定のパスは作業ディレクトリを基準に、`firebase.json`のパスはそのディレクトリを基準に解決されます([相対パス](../../guides/configuration/#相対パス))。正規の設定が作業ディレクトリとは別のディレクトリにある場合、プランは警告を出します。同じファイルをそのファイル自身のディレクトリから実行すると、別のファイルを読むことになるためです。
- 各Functionsのコードベースについて、実行が使うNodeまたはPythonの実行ファイルとバージョン。起動時と同じコードで選ばれるため、`FIREEMU_NODE`、`PATH`、`VOLTA_HOME`、`engines.node`、コードベースの`venv`がすべて影響します。あわせて、インストールされている`firebase-functions`と`firebase-admin`のバージョン。プランは、これを調べるために`node --version`とPythonコードベースのインタープリターを実行します。
- 有効な開発用デフォルト。そのうち[`productionExact`](../../guides/profiles/)が切り替えるものには`relaxed`と表示されます。また、設定が指定している[効果のない](#config-lint)設定。

プランが把握できる理由で実行が失敗する場合、つまり、起動できないFunctionsのコードベース(使えるNodeがない、`venv`がない)や、`--deny-inherited-emulator-env`が拒否する継承された変数がある場合、コマンドはプランを出力したまま終了コード1で終了します。デーモンが拒否する設定は、`up`と同じメッセージと終了コードで失敗します。

### 継承されたエミュレータ変数

`exec`は、`firebase emulators:exec`と同様に、起動するサービスの変数を置き換えた環境をコマンドに渡します。この実行が起動しないサービスの変数は値が保持されるため、エミュレータが欠けていても、SDKが本番に接続することはありません。同時に、別のスイート(2つ目のチェックアウトや並列ジョブ)がシェルに残した変数があると、テストがそのスイートに向いてしまうため、Fireemuはそれを報告します。

- デフォルトでは、そのような変数ごとに`warning:`を出し、変数を保持したまま実行します。
- `--deny-inherited-emulator-env`は、環境に、この実行が起動しないサービスのエミュレータ変数がある場合、何かを起動する前に実行を拒否します(終了コード1)。実行が起動するサービスの変数は、その実行自身の値に置き換えられ、拒否されることはありません。`up`にも適用されます。その場合、変数は起動するシェルのものと、`emulator`プロファイルのFunctionsランナーのものです。
- `--allow-inherited-emulator-env <NAME>`は、1つを意図的に保持します。たとえば、あるスイートが意図的に別のスイートのPub/Subを使う場合の`PUBSUB_EMULATOR_HOST`です。その変数についての警告と拒否を止め、繰り返し指定でき、エミュレータ変数でない名前は拒否します。[`--plan`](#実行を計画する)は、継承された各変数とその扱いを一覧表示します。

この検査は、FirebaseとGoogle CloudのSDKが読むすべてのエミュレータのホスト変数を認識します。Fireemuが提供しないサービスの`DATA_CONNECT_EMULATOR_HOST`と`FIREBASE_DATA_CONNECT_EMULATOR_HOST`も含まれ、それらのサービスは起動されません。HubとLoggingエミュレータはベストエフォートです(デフォルトのポートが使用中の場合は無効になるだけです)。起動前の検査はそれらを起動したものとして扱い、リスナーがバインドされた後に、実際にバインドされたものに対して、Functionsランナーやコマンドを起動する前に、検査が再度実行されます。`functions.runner`のオーバーライドは、認証情報を含みうるため、引数が`[redacted]`に置き換えられて表示されます。

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

`capabilities`は、デーモンを起動せずに、設定されたプロファイルとオーバーライドを解決します。仮想クロックの開始時刻がない場合は標準エラー出力に報告され、標準出力はケイパビリティのJSONのままです。起動時には、そのクロックの値が引き続き必要です。

## config show

`fireemu config show`は、すべての設定キーを、スキーマの順に、有効な値とその由来とともに出力します。`fireemu up`と同じ設定の探索を使いますが、`up`のコマンドラインのオーバーライド(`--project`、`--only`、ポートのフラグ)は含まず、エミュレータも起動しません。ファイルとオーバーライドを合わせた結果を見るには、[`fireemu up --plan`](#実行を計画する)を使います。

ファイルを選ぶには`--config <path>`または`--firebase-json <path>`を、`key`、`value`、`source`、スキーマの説明を含むレコードを得るには`--json`を使います。

- 由来は、明示的な値、デフォルト、`productionExact`、導出された値、未設定のキーを区別します。
- ランタイムが値を公開していない場合、コマンドは、ファイルの明示的な値、スキーマのデフォルト(`default (schema)`と表示されます)、または`(unset)`(JSONでは由来が`unset`の`null`)を使います。
- 設定が受け付けるが、デーモンが読まないキー(たとえば`bind`、`limits.catalog`、`firestore.textSearch.*`、`rules.staticLimitChecks`、`auth.enabled`、`trace.*`)の由来は`accepted, no effect`になります。値は記述されたとおりか`(unset)`として表示され、有効であるかのようには決して表示されません。そのようなキーを設定している構成は、起動時に`note:`行を出力します。
- 秘密を含む値は、テキストでもJSONでも`[redacted]`としてマスクされます: `pubsub.authentication.localBearerToken`、`auth.apiKeys`の各値、`auth.customTokenSigners`、OIDCプロバイダーの`clientSecret`、App Checkアプリの`debugTokenSha256`の各エントリ。ほかのフィールドは表示されたままで、nullはnullのままです。
- `firebaseJson`は、`--firebase-json`で選んだものも含めて、実際に選択されたFirebase設定ファイルを示します。
- `appCheck.enabled`の下の`in effect`行は、App Checkがサーフェスごと（交換、callable、Auth、Firestore、Storage）に何を提供するかを、起動バナーと同じ用語で示します。strictプロファイルは`appCheck`ブロックなしで交換を提供するため、キーだけではそれは分かりません。JSONでは、その行の`effective`オブジェクトとして含まれます。対象は全プロダクト、または`fireemu up --only`が選択するとおりに`--only <services>`で指定したプロダクトです。`--only`は出力のそれ以外を変えません。

## config lint

```text
fireemu config lint [--config <path>] [--firebase-json <path>] [--json] [--deny-ineffective] [--allow <key>]... [--allow-file <path>]
```

`fireemu config lint`は、設定が指定している、Fireemuが受け付けるが読まない設定を一覧表示します。`fireemu config show`とまったく同じ方法で設定を読み込みます。デーモンが拒否する設定は、同じメッセージと終了コード1で失敗します。各行には、`fireemu up`が起動時に出力する`note:`行と同じテキストが入ります。どちらも1つのキーの一覧から作られるため、効果を持つようになったキーは、lintとnoteの両方から同時に外れます。何も設定していない構成では`no ineffective settings`と出力されます。

デフォルトでは、レポートは情報提供のみで、終了コードは0です。CIジョブで検査として使うには、`--deny-ineffective`を付けます。許可リストのエントリでカバーされていない、効果のない設定が構成にある場合、コマンドは各設定の名前を挙げて終了コード1で終了します。

```sh
fireemu config lint --deny-ineffective --allow bind --allow 'firestore.textSearch.*'
```

- `--allow <key>`は、効果がなくても存在してよい設定を指定します。たとえば、後のリリースのために残しておくキーです。`prefix.*`は、`prefix`以下のすべてのキーをカバーします。このオプションは繰り返し指定できます。許可された設定も`allowed`と表示されて一覧に残りますが、検査は失敗しません。
- `--allow-file <path>`は、ファイルから1行に1つずつ許可リストのエントリを読み込みます。ファイルはUTF-8でなければなりません。バイトオーダーマークとCRLFの改行は受け付けられ、それ以外のエンコーディングは使い方のエラー(終了コード2)です。空行と`#`コメント(行全体でも行末でも)は無視されます。リストが長い場合や、バージョン管理でレビューしたい場合に使います。
- 設定キーでない名前のエントリ(タイプミスや、`trace.*`ではなく`trace`のようなテーブル)は、終了コード2の使い方のエラーになるため、書き間違えたエントリが、何も許可しないまま黙って通ることはありません。
- `--json`は、`config`(検査したファイル、または`null`)、`ineffective`(`key`、`note`、`allowed`を持つ各設定)、`denied`(`--deny-ineffective`で失敗するキー)を出力します。出力されるのはキーとnoteであり、設定値ではありません。
- 正規の設定(`fireemu.toml`または`fireemu.json`)だけが検査されます。見つからない場合、コマンドはその旨を伝えて終了コード0で終了します。

## config schema

`fireemu config schema`は、このバイナリが設定の検証に使うJSON Schemaを、バイト単位でそのまま、ネットワークなしで出力します。

`--out <path>`を指定すると、代わりにファイルに書き出し、何も出力しません。既存の通常ファイルはアトミックに置き換えられるため、コピーはアップグレードに追従します。シンボリックリンクは、`init --force`と同様に拒否されます。

リリース済みバイナリの`fireemu init`は、生成するファイルに、そのリリースのスキーマURLを書き込みます。エディタやツールが、インストール済みバージョンのスキーマを必要とし、そのURLを取得できない場合は、`config schema`を使ってください。
