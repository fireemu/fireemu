---
title: CLI
description: Schlagen Sie die Befehle und Optionen der Kommandozeile fireemu nach.
---

Die gängigen `fireemu`-Befehle und ihre Optionen. Die Blöcke unten sind der Hilfetext des aktuellen Releases; führen Sie `npx fireemu --help` oder `npx fireemu help <command>` aus, um die Hilfe der installierten Version zu erhalten. `exec` und `capabilities` akzeptieren jede Option von `up`, die einmal unter [up](#up) aufgeführt ist.

| Befehl | Was er tut |
|---|---|
| [`init`](#init) | Erstellt `fireemu.toml` im aktuellen Verzeichnis |
| [`up`](#up) | Startet die Emulatoren und hält sie am Laufen, bis `Ctrl+C` gedrückt wird (Alias: `emulators:start`) |
| [`exec`](#exec) | Startet die Emulatoren, führt einen Befehl aus und beendet sie (Alias: `emulators:exec`) |
| [`emulators:export`](#emulatorsexport) | Exportiert den Zustand einer laufenden Suite in ein Verzeichnis |
| [`doctor`](#doctor) | Prüft die Installation: Binärdatei, UI, Functions-Runner, Node.js |
| [`capabilities`](#capabilities) | Gibt das Capability-Manifest des aufgelösten Profils als JSON aus |
| [`config show`](#config-show) | Gibt jeden Konfigurationsschlüssel mit wirksamem Wert und Quelle aus |
| [`config lint`](#config-lint) | Listet die Einstellungen einer Konfiguration auf, die akzeptiert werden, aber keine Wirkung haben; lässt in CI daran scheitern |
| [`config schema`](#config-schema) | Gibt das in dieser Binärdatei mitgelieferte Konfigurationsschema aus oder schreibt es in eine Datei |
| `--version` (auch `-V`, `version`) | Gibt die Version aus und beendet sich |
| `help [command]` (auch `--help`, `-h`) | Gibt die Befehlsliste oder die Hilfe eines Befehls aus |

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

### Einen Lauf planen

`--plan` bei `up` oder `exec` löst den Lauf genau so auf, wie es der Start tut, gibt aus, was er tun würde, und startet nichts. `--json` gibt denselben Plan als JSON aus (`planVersion` 1). Führen Sie es vor einem CI-Job aus, um zu sehen, was eine Kommandozeile und eine Konfiguration zusammen ergeben:

```sh
npx fireemu exec --plan -- npm test
npx fireemu up --plan --json --only firestore,auth --project demo-ci
```

Der Plan listet:

- Die Projekt-ID und die Regel, die sie gewählt hat (`--project`, ein Alias in `.firebaserc`, der Standard aus `.firebaserc`, `daemon.authProject` oder der eingebaute Standard), die geladenen Konfigurationsdateien und die angewendeten Überschreibungen der Kommandozeile. [`config show`](#config-show) liest nur die Dateien und enthält daher die Überschreibungen nicht.
- Jeden Dienst mit seiner Adresse oder dem Grund, warum er nicht startet (`--only`, keine Functions-Codebasis, Pub/Sub nicht konfiguriert). Es prüft keinen Port; der Lauf bindet seine Ports, wenn er startet.
- Die Umgebung: die Variablen, die der Lauf für seine Dienste setzt, und die Emulator-Variablen der übergeordneten Umgebung, die erhalten bleiben (siehe [Geerbte Emulator-Variablen](#inherited-emulator-variables)). Ein Credential in einem geerbten Endpunkt wird durch `***` ersetzt.
- Jede Rules-, Index-, Text-Index- und Quelldatei, so wie der Lauf sie öffnet: den absoluten Pfad, den Pfad wie geschrieben und das Verzeichnis, gegen das ein relativer Pfad aufgelöst wird. Pfade in der kanonischen Konfiguration werden gegen das Arbeitsverzeichnis aufgelöst und Pfade in `firebase.json` gegen deren Verzeichnis ([Relative Pfade](../../guides/configuration/#relative-paths)); der Plan warnt, wenn die kanonische Konfiguration in einem anderen Verzeichnis liegt als dem Arbeitsverzeichnis, weil dieselbe Datei, aus ihrem eigenen Verzeichnis gestartet, andere Dateien lesen würde.
- Für jede Functions-Codebasis die ausführbare Node- oder Python-Datei und die Version, die der Lauf verwenden würde, gewählt durch den Code, den der Start verwendet (daher zählen `FIREEMU_NODE`, `PATH`, `VOLTA_HOME`, `engines.node` und die `venv` der Codebasis), sowie die installierten Versionen von `firebase-functions` und `firebase-admin`. Der Plan führt dazu `node --version` und den Interpreter einer Python-Codebasis aus.
- Die wirksamen Entwicklungsstandards, wobei die, die [`productionExact`](../../guides/profiles/) umschalten würde, als `relaxed` markiert sind, und die Einstellungen der Konfiguration, die [keine Wirkung](#config-lint) haben.

Der Befehl endet mit Status 1, wobei der Plan trotzdem ausgegeben wird, wenn der Lauf aus einem Grund scheitern würde, den der Plan erkennen kann: eine Functions-Codebasis, die nicht starten kann (kein verwendbares Node, eine fehlende `venv`), oder eine geerbte Variable, die `--deny-inherited-emulator-env` ablehnt. Eine Konfiguration, die der Daemon ablehnt, scheitert mit derselben Meldung und demselben Exit-Code wie `up`.

### Geerbte Emulator-Variablen

`exec` gibt seinem Befehl Ihre Umgebung, wobei die Variablen der Dienste, die es startet, ersetzt sind, wie es `firebase emulators:exec` tut. Eine Variable für einen Dienst, den dieser Lauf nicht startet, behält ihren Wert, sodass ein fehlender Emulator ein SDK nie in die Produktion schickt. Das heißt aber auch, dass eine Variable, die eine andere Suite in Ihrer Shell hinterlassen hat (ein zweiter Checkout oder ein paralleler Job), Ihre Tests auf diese Suite richtet, weshalb Fireemu sie meldet:

- Standardmäßig gibt es für jede solche Variable eine `warning:` aus, behält sie und läuft.
- `--deny-inherited-emulator-env` lehnt den Lauf ab, bevor etwas startet (Exit-Code 1), wenn die Umgebung eine Emulator-Variable für einen Dienst enthält, den der Lauf nicht startet. Die Variablen der Dienste, die der Lauf startet, werden durch seine eigenen Werte ersetzt und nie abgelehnt. Es gilt auch für `up`, wo die Variablen zur Shell gehören, die es startet, und zu einem Functions-Runner unter dem Profil `emulator`.
- `--allow-inherited-emulator-env <NAME>` behält eine absichtlich, zum Beispiel `PUBSUB_EMULATOR_HOST`, wenn eine Suite bewusst das Pub/Sub einer anderen verwendet. Es unterdrückt Warnung und Ablehnung für diese Variable, kann wiederholt werden und lehnt einen Namen ab, der keine Emulator-Variable ist. [`--plan`](#plan-a-run) listet jede geerbte Variable und was mit ihr geschieht.

Die Prüfung erkennt jede Emulator-Host-Variable, die die SDKs von Firebase und Google Cloud lesen, einschließlich `DATA_CONNECT_EMULATOR_HOST` und `FIREBASE_DATA_CONNECT_EMULATOR_HOST` für einen Dienst, den Fireemu nicht bereitstellt und der nie gestartet wird. Der Hub und der Logging-Emulator sind Best-Effort (ein belegter Standardport deaktiviert sie nur): Die Prüfung vor dem Start behandelt sie als gestartet, und sobald die Listener gebunden sind, läuft die Prüfung erneut gegen die, die tatsächlich gebunden wurden, bevor ein Functions-Runner oder Befehl startet. Eine Überschreibung `functions.runner` wird mit durch `[redacted]` ersetzten Argumenten angezeigt, weil diese Credentials enthalten können.

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

`capabilities` löst das konfigurierte Profil und die Überschreibungen auf, ohne einen Daemon zu starten. Ein fehlender Start der virtuellen Uhr wird auf der Standardfehlerausgabe gemeldet, während die Standardausgabe Capability-JSON bleibt; der Start erfordert diesen Uhrwert weiterhin.

## config show

`fireemu config show` gibt jeden Konfigurationsschlüssel in Schema-Reihenfolge mit wirksamem Wert und Quelle aus. Es verwendet dieselbe Konfigurationserkennung wie `fireemu up`, aber ohne die Kommandozeilen-Überschreibungen von `up` (`--project`, `--only` und die Port-Flags) und ohne die Emulatoren zu starten. Um das Ergebnis aus Dateien und Überschreibungen zusammen zu sehen, verwenden Sie [`fireemu up --plan`](#plan-a-run).

Verwenden Sie `--config <path>` oder `--firebase-json <path>`, um Dateien auszuwählen, und `--json` für Datensätze mit `key`, `value`, `source` und der Schema-Beschreibung.

- Die Quellen unterscheiden explizite Werte, Standardwerte, `productionExact`, abgeleitete Werte und nicht gesetzte Schlüssel.
- Stellt die Laufzeit keinen Wert bereit, verwendet der Befehl seinen expliziten Dateiwert, seinen Schema-Standard (markiert als `default (schema)`) oder `(unset)` (in JSON `null` mit der Quelle `unset`).
- Ein Schlüssel, den die Konfiguration akzeptiert, den der Daemon aber nicht liest (zum Beispiel `bind`, `limits.catalog`, `firestore.textSearch.*`, `rules.staticLimitChecks`, `auth.enabled` und `trace.*`), hat die Quelle `accepted, no effect`: Sein Wert wird wie geschrieben angezeigt oder als `(unset)`, nie so, als wäre er wirksam, und eine Konfiguration, die einen setzt, gibt beim Start eine Zeile `note:` aus.
- Secret-haltige Werte werden in Text und JSON als `[redacted]` maskiert: `pubsub.authentication.localBearerToken`, jeder Wert von `auth.apiKeys`, `auth.customTokenSigners`, das `clientSecret` von OIDC-Anbietern und die Einträge `debugTokenSha256` von App-Check-Apps. Andere Felder bleiben sichtbar, und Nullwerte bleiben null.
- `firebaseJson` zeigt die tatsächlich ausgewählte Firebase-Konfigurationsdatei, einschließlich einer mit `--firebase-json` gewählten.

## config lint

```text
fireemu config lint [--config <path>] [--firebase-json <path>] [--json] [--deny-ineffective] [--allow <key>]... [--allow-file <path>]
```

`fireemu config lint` listet die Einstellungen einer Konfiguration auf, die Fireemu akzeptiert, aber nicht liest. Es lädt die Konfiguration genau wie `fireemu config show`; eine Konfiguration, die der Daemon ablehnt, scheitert mit derselben Meldung und dem Exit-Code 1. Jede Zeile trägt denselben Text wie die Zeile `note:`, die `fireemu up` beim Start ausgibt, und beide stammen aus einer gemeinsamen Schlüsselliste, sodass ein Schlüssel, der wirksam wird, Lint und Hinweis gemeinsam verlässt. Eine Konfiguration, die keine setzt, gibt `no ineffective settings` aus.

Standardmäßig ist der Bericht informativ und der Exit-Code 0. Fügen Sie in einem CI-Job `--deny-ineffective` hinzu, um daraus eine Prüfung zu machen: Der Befehl endet mit Status 1 und nennt jede Einstellung, wenn die Konfiguration eine setzt, die kein Eintrag der Allow-Liste abdeckt.

```sh
fireemu config lint --deny-ineffective --allow bind --allow 'firestore.textSearch.*'
```

- `--allow <key>` nennt eine Einstellung, die vorhanden sein darf, obwohl sie keine Wirkung hat, zum Beispiel einen Schlüssel, den Sie für ein späteres Release behalten. `prefix.*` deckt jeden Schlüssel unterhalb von `prefix` ab. Die Option kann wiederholt werden. Erlaubte Einstellungen werden weiterhin aufgelistet, als `allowed` markiert, und lassen die Prüfung nicht scheitern.
- `--allow-file <path>` liest Einträge der Allow-Liste aus einer Datei, einen pro Zeile. Die Datei muss UTF-8 sein; eine Byte-Order-Mark und CRLF-Zeilenenden werden akzeptiert, jede andere Kodierung ist ein Nutzungsfehler (Exit-Code 2). Leerzeilen und `#`-Kommentare (ganzzeilig oder nachgestellt) werden ignoriert. Verwenden Sie sie, wenn die Liste lang ist oder in der Versionskontrolle geprüft werden soll.
- Ein Eintrag, der keinen Konfigurationsschlüssel nennt (ein Tippfehler oder eine Tabelle wie `trace` statt `trace.*`), ist ein Nutzungsfehler mit Exit-Code 2, sodass ein falsch geschriebener Eintrag nicht stillschweigend nichts erlauben kann.
- `--json` gibt `config` (die geprüfte Datei oder `null`), `ineffective` (jede Einstellung mit `key`, `note` und `allowed`) und `denied` (die Schlüssel, die unter `--deny-ineffective` scheitern) aus. Es meldet Schlüssel und Hinweise, keine Konfigurationswerte.
- Nur die kanonische Konfiguration (`fireemu.toml` oder `fireemu.json`) wird geprüft. Wird keine gefunden, sagt der Befehl das und endet mit 0.

## config schema

`fireemu config schema` gibt das JSON Schema aus, mit dem diese Binärdatei die Konfiguration validiert, Byte für Byte und ohne Netzwerk.

`--out <path>` schreibt es stattdessen in eine Datei und gibt nichts aus. Eine vorhandene reguläre Datei wird atomar ersetzt, sodass die Kopie einem Upgrade folgt; ein symbolischer Link wird abgelehnt, wie es `init --force` tut.

`fireemu init` einer veröffentlichten Binärdatei schreibt die Schema-URL ihres Releases in die Dateien, die es erzeugt. Verwenden Sie `config schema`, wenn ein Editor oder Werkzeug das Schema der installierten Version braucht und diese URL nicht abrufen kann.
