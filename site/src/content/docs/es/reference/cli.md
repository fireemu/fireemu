---
title: CLI
description: Consulta los comandos y las opciones de la línea de comandos de fireemu.
---

Los comandos habituales de `fireemu` y sus opciones. Los bloques de abajo son el texto de ayuda de la versión actual; ejecuta `npx fireemu --help`, o `npx fireemu help <command>`, para ver la ayuda de la versión que tienes instalada. `exec` y `capabilities` aceptan todas las opciones de `up`, que se enumeran una sola vez en [up](#up).

| Comando | Qué hace |
|---|---|
| [`init`](#init) | Crea `fireemu.toml` en el directorio actual |
| [`up`](#up) | Inicia los emuladores y los mantiene en ejecución hasta `Ctrl+C` (alias: `emulators:start`) |
| [`exec`](#exec) | Inicia los emuladores, ejecuta un comando y los detiene (alias: `emulators:exec`) |
| [`emulators:export`](#emulatorsexport) | Exporta el estado de una suite en ejecución a un directorio |
| [`doctor`](#doctor) | Comprueba la instalación: binario, UI, ejecutor de Functions, Node.js |
| [`capabilities`](#capabilities) | Imprime como JSON el manifiesto de capacidades del perfil resuelto |
| [`config show`](#config-show) | Imprime cada clave de configuración con su valor efectivo y su origen |
| [`config lint`](#config-lint) | Enumera los ajustes que una configuración define y que se aceptan pero no tienen efecto; falla por ellos en CI |
| [`config schema`](#config-schema) | Imprime el esquema de configuración incluido en este binario, o lo escribe en un archivo |
| `--version` (también `-V`, `version`) | Imprime la versión y termina |
| `help [command]` (también `--help`, `-h`) | Imprime la lista de comandos, o la ayuda de un comando |

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

### Planificar una ejecución

`--plan` en `up` o `exec` resuelve la ejecución exactamente como lo hace el arranque, imprime lo que haría y no inicia nada. `--json` imprime el mismo plan como JSON (`planVersion` 1). Ejecútalo antes de un trabajo de CI para ver en qué se traducen una línea de comandos y una configuración:

```sh
npx fireemu exec --plan -- npm test
npx fireemu up --plan --json --only firestore,auth --project demo-ci
```

El plan enumera:

- El ID de proyecto y la regla que lo eligió (`--project`, un alias de `.firebaserc`, el valor predeterminado de `.firebaserc`, `daemon.authProject` o el valor predeterminado integrado), los archivos de configuración que se cargaron y las sobrescrituras de línea de comandos que se aplicaron. [`config show`](#config-show) solo lee los archivos, por lo que no incluye las sobrescrituras.
- Cada servicio con su dirección, o el motivo por el que no se inicia (`--only`, ningún codebase de Functions, Pub/Sub no configurado). No sondea ningún puerto; la ejecución enlaza sus puertos al iniciarse.
- El entorno: las variables que la ejecución define para sus servicios y las variables de emulador del entorno padre que permanecen (consulta [Variables de emulador heredadas](#variables-de-emulador-heredadas)). Una credencial en un endpoint heredado se reemplaza por `***`.
- Cada archivo de reglas, de índices, de índices de texto y de código fuente tal como la ejecución lo abre: la ruta absoluta, la ruta tal como está escrita y el directorio contra el que se resuelve una ruta relativa. Las rutas de la configuración canónica se resuelven contra el directorio de trabajo y las rutas de `firebase.json` contra su directorio ([Relative paths](../../guides/configuration/#rutas-relativas)); el plan avisa cuando la configuración canónica está en un directorio distinto del directorio de trabajo, porque el mismo archivo ejecutado desde su propio directorio leería otros archivos.
- Para cada codebase de Functions, el ejecutable y la versión de Node o Python que usaría la ejecución, elegidos por el mismo código que usa el arranque (por lo que cuentan `FIREEMU_NODE`, `PATH`, `VOLTA_HOME`, `engines.node` y el `venv` del codebase), y las versiones instaladas de `firebase-functions` y `firebase-admin`. El plan ejecuta `node --version` y el intérprete de un codebase de Python para averiguarlo.
- Los valores predeterminados de desarrollo vigentes, con los que [`productionExact`](../../guides/profiles/) cambiaría marcados como `relaxed`, y los ajustes que la configuración define y que [no tienen efecto](#config-lint).

El comando termina con código 1, imprimiendo igualmente el plan, cuando la ejecución fallaría por un motivo que el plan puede ver: un codebase de Functions que no puede iniciarse (sin un Node utilizable, un `venv` ausente) o una variable heredada que `--deny-inherited-emulator-env` rechaza. Una configuración que el daemon rechaza falla con el mismo mensaje y el mismo código de salida que `up`.

### Variables de emulador heredadas

`exec` entrega a su comando tu entorno con las variables de los servicios que inicia reemplazadas, como hace `firebase emulators:exec`. Una variable de un servicio que esta ejecución no inicia conserva su valor, de modo que un emulador ausente nunca envía un SDK a producción. También significa que una variable que otra suite dejó en tu shell (un segundo checkout o un trabajo paralelo) apunta tus pruebas a esa suite, así que Fireemu lo avisa:

- De forma predeterminada imprime un `warning:` por cada una de esas variables, la conserva y ejecuta.
- `--deny-inherited-emulator-env` rechaza la ejecución antes de que se inicie nada (código de salida 1) cuando el entorno contiene una variable de emulador de un servicio que la ejecución no inicia. Las variables de los servicios que la ejecución inicia se reemplazan por sus propios valores y nunca se rechazan. También se aplica a `up`, donde las variables pertenecen al shell que lo inicia y a un ejecutor de Functions bajo el perfil `emulator`.
- `--allow-inherited-emulator-env <NAME>` conserva una a propósito, por ejemplo `PUBSUB_EMULATOR_HOST` cuando una suite usa deliberadamente el Pub/Sub de otra. Silencia la advertencia y el rechazo para esa variable, se puede repetir y rechaza un nombre que no sea una variable de emulador. [`--plan`](#planificar-una-ejecución) enumera cada variable heredada y lo que ocurre con ella.

La comprobación reconoce todas las variables de host de emulador que leen los SDK de Firebase y Google Cloud, incluidas `DATA_CONNECT_EMULATOR_HOST` y `FIREBASE_DATA_CONNECT_EMULATOR_HOST` para un servicio que Fireemu no sirve y que, por tanto, nunca se inicia. El Hub y el emulador de Logging son de mejor esfuerzo (un puerto predeterminado ocupado solo los desactiva): la comprobación previa al arranque los trata como iniciados y, una vez enlazados los listeners, la comprobación se ejecuta de nuevo contra los que realmente se enlazaron, antes de que se inicie cualquier ejecutor de Functions o comando. Una sobrescritura de `functions.runner` se muestra con sus argumentos reemplazados por `[redacted]`, porque pueden contener credenciales.

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

`capabilities` resuelve el perfil configurado y las sobrescrituras sin iniciar un daemon. Si falta el inicio del reloj virtual, se informa por la salida de error estándar mientras la salida estándar sigue siendo el JSON de capacidades; el arranque sigue requiriendo ese valor de reloj.

## config show

`fireemu config show` imprime cada clave de configuración en el orden del esquema, con su valor efectivo y su origen. Usa el mismo descubrimiento de configuración que `fireemu up`, pero sin las sobrescrituras de línea de comandos de `up` (`--project`, `--only` y las opciones de puerto) y sin iniciar los emuladores. Para ver el resultado conjunto de los archivos y las sobrescrituras, usa [`fireemu up --plan`](#planificar-una-ejecución).

Usa `--config <path>` o `--firebase-json <path>` para seleccionar archivos, y `--json` para obtener registros con `key`, `value`, `source` y la descripción del esquema.

- Los orígenes distinguen valores explícitos, valores predeterminados, `productionExact`, valores derivados y claves sin definir.
- Cuando el runtime no expone un valor, el comando usa su valor explícito del archivo, su valor predeterminado del esquema (marcado como `default (schema)`) o `(unset)` (`null` con origen `unset` en JSON).
- Una clave que la configuración acepta pero que el daemon no lee (por ejemplo `bind`, `limits.catalog`, `firestore.textSearch.*`, `rules.staticLimitChecks`, `auth.enabled` y `trace.*`) tiene el origen `accepted, no effect`: su valor se muestra tal como está escrito, o `(unset)`, nunca como si estuviera en vigor, y una configuración que define una de ellas imprime una línea `note:` al iniciar.
- Los valores que contienen secretos se enmascaran como `[redacted]` en texto y en JSON: `pubsub.authentication.localBearerToken`, cada valor de `auth.apiKeys`, `auth.customTokenSigners`, el `clientSecret` de los proveedores OIDC y las entradas `debugTokenSha256` de las apps de App Check. Los demás campos siguen visibles y los nulos siguen siendo nulos.
- `firebaseJson` muestra el archivo de configuración de Firebase realmente seleccionado, incluido el elegido con `--firebase-json`.
- Bajo `appCheck.enabled`, una línea `in effect` muestra lo que App Check sirve por superficie (intercambio, callables, Auth, Firestore, Storage), en los términos del banner de inicio; la clave por sí sola no lo indica, porque el perfil estricto sirve el intercambio sin un bloque `appCheck`. JSON lo incluye como el objeto `effective` de la fila. Cubre todos los productos, o los productos que nombra `--only <services>`, tal como los selecciona `fireemu up --only`; `--only` no cambia nada más en la salida.

## config lint

```text
fireemu config lint [--config <path>] [--firebase-json <path>] [--json] [--deny-ineffective] [--allow <key>]... [--allow-file <path>]
```

`fireemu config lint` enumera los ajustes que una configuración define y que Fireemu acepta pero no lee. Carga la configuración exactamente como lo hace `fireemu config show`; una configuración que el daemon rechaza falla con el mismo mensaje y con código de salida 1. Cada línea lleva el mismo texto que la línea `note:` que `fireemu up` imprime al iniciar, y ambas proceden de una única lista de claves, de modo que una clave que empieza a tener efecto sale a la vez del lint y de la nota. Una configuración que no define ninguna imprime `no ineffective settings`.

De forma predeterminada el informe es solo informativo y el código de salida es 0. Añade `--deny-ineffective` en un trabajo de CI para convertirlo en una comprobación: el comando termina con código 1, nombrando cada ajuste, cuando la configuración define alguno que ninguna entrada de la lista de permitidos cubre.

```sh
fireemu config lint --deny-ineffective --allow bind --allow 'firestore.textSearch.*'
```

- `--allow <key>` nombra un ajuste que puede estar presente aunque no tenga efecto, por ejemplo una clave que conservas para una versión posterior. `prefix.*` cubre todas las claves bajo `prefix`. La opción se puede repetir. Los ajustes permitidos siguen apareciendo en la lista, marcados como `allowed`, y no hacen fallar la comprobación.
- `--allow-file <path>` lee las entradas de la lista de permitidos de un archivo, una por línea. El archivo debe estar en UTF-8; se aceptan una marca de orden de bytes (BOM) y los finales de línea CRLF, y cualquier otra codificación es un error de uso (código de salida 2). Se ignoran las líneas en blanco y los comentarios `#` (de línea completa o al final de línea). Úsalo cuando la lista sea larga o deba revisarse en el control de versiones.
- Una entrada que no nombra ninguna clave de configuración (una errata, o una tabla como `trace` en lugar de `trace.*`) es un error de uso con código de salida 2, de modo que una entrada mal escrita no pueda quedarse sin permitir nada en silencio.
- `--json` imprime `config` (el archivo comprobado, o `null`), `ineffective` (cada ajuste con `key`, `note` y `allowed`) y `denied` (las claves que fallan con `--deny-ineffective`). Informa de claves y notas, no de valores de configuración.
- Solo se comprueba la configuración canónica (`fireemu.toml` o `fireemu.json`). Cuando no se encuentra ninguna, el comando lo indica y termina con código 0.

## config schema

`fireemu config schema` imprime el esquema JSON con el que este binario valida la configuración, byte por byte y sin red.

`--out <path>` lo escribe en un archivo en su lugar y no imprime nada. Un archivo regular existente se reemplaza de forma atómica, de modo que la copia sigue a una actualización; un enlace simbólico se rechaza, igual que hace `init --force`.

`fireemu init` de un binario publicado escribe en los archivos que genera la URL del esquema de su versión. Usa `config schema` cuando un editor o una herramienta necesite el esquema de la versión instalada y no pueda descargar esa URL.
