---
title: Variables de entorno
description: Consulta las variables de entorno que Fireemu define para tu comando y para el código de Functions, y las que lee.
---

Esta lista se ha tomado del código fuente del binario `fireemu` y del paquete npm. Todo lo que no figura aquí es un detalle de implementación y puede cambiar.

## Definidas por `fireemu exec`

`exec` entrega a su comando las variables de los emuladores que están en ejecución, y nada más de su propia cosecha. Los nombres y los formatos siguen lo que escribe `firebase emulators:exec`.

Las variables de los emuladores que no se seleccionan se dejan como las tenía tu entorno, de modo que un emulador ausente nunca envía un SDK a producción por accidente. `exec` imprime una advertencia por cada una, y `--deny-inherited-emulator-env` rechaza la ejecución en su lugar (consulta [Variables de emulador heredadas](../cli/#variables-de-emulador-heredadas)).

| Variable | Valor | Cuándo |
|---|---|---|
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_FIRESTORE_EMULATOR_ADDRESS` | `host:port` de Firestore | Firestore está en ejecución |
| `FIREBASE_AUTH_EMULATOR_HOST` | `host:port` de Authentication | Authentication está en ejecución |
| `FIREBASE_STORAGE_EMULATOR_HOST` | `host:port` de Storage | Storage está en ejecución |
| `STORAGE_EMULATOR_HOST` | URL de Storage (`http://host:port`) para las bibliotecas cliente de Cloud Storage. Con App Check de Storage en `enforced` y `appCheck.storageServerRequests` en `"capability"`, también incluye una capacidad de Admin por ejecución (consulta [App Check](../../products/app-check/)) | Storage está en ejecución |
| `FIREBASE_DATABASE_EMULATOR_HOST` | `host:port` de Realtime Database | Realtime Database está en ejecución |
| `PUBSUB_EMULATOR_HOST` | `host:port` de Pub/Sub | Pub/Sub está en ejecución |
| `CLOUD_EVENTARC_EMULATOR_HOST` | URL de Eventarc (`http://host:port`) | Functions está en ejecución |
| `CLOUD_TASKS_EMULATOR_HOST` | `host:port` de Cloud Tasks | Functions está en ejecución |
| `FIREEMU_FUNCTIONS_HOST` | `host:port` de Functions | Functions está en ejecución |
| `FIREEMU_APP_CHECK_EMULATOR_HOST`, `FIREEMU_APP_CHECK_JWKS_URL` | Host de intercambio de App Check y URL del JWKS | App Check está disponible (consulta [App Check](../../products/app-check/)) |
| `FIREBASE_EMULATOR_HUB` | `host:port` del Emulator Hub | El Hub está en ejecución |
| `FIREBASE_LOGGING_EMULATOR_HOST` | `host:port` del emulador de Logging | El emulador de Logging está en ejecución |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | El ID de proyecto | Siempre |
| `FIREBASE_CONFIG` | Se define a partir del ID de proyecto | Salvo que tu entorno ya la tenga |
| `FIREEMU_CONTROL_URL` | URL base de la API de control, terminada en `/v1/` | Siempre |
| `FIREEMU_CONTROL_TOKEN` | Token bearer de la API de control; lo usan `fireemu/testing` y los scripts de [Cloud Firestore](../../products/firestore/#fail-a-ci-job-on-a-missing-index) | Siempre |

`fireemu up` no define variables en tu shell. Su salida de arranque imprime cada `host:port` (por ejemplo `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`), y la UI del emulador los muestra en la página Overview, en "Environment for SDKs".

## Definidas para el código de Functions

Un codebase de Functions se ejecuta con las mismas variables de host de emulador de los servicios que están en ejecución, además de `FUNCTIONS_EMULATOR=true`, las variables del ID de proyecto y `FIREBASE_CONFIG`.

Solo se hereda del daemon una lista corta de variables. Las credenciales se retienen a propósito: `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN` y `CLOUDSDK_*` no llegan al código de las funciones. Las variables `FIREEMU_RUNNER*` son internas.

## Leídas por Fireemu

| Variable | Efecto |
|---|---|
| `FIREEMU_BINARY_PATH` | El launcher `fireemu` ejecuta este binario en lugar del del paquete de la plataforma. Para una plataforma sin binario publicado, o un binario que compilaste tú. |
| `FIREEMU_NODE` | Ruta absoluta del ejecutable de Node.js que ejecuta los codebases de Functions. Se rechaza cuando no es una ruta absoluta a un archivo ejecutable. Sin ella, Fireemu busca `node` en los directorios de `PATH` (y en los de Volta, consulta `VOLTA_HOME`). |
| `FIREEMU_RUNNER_NODE`, `FIREEMU_RUNNER_PYTHON` | Ruta de un script ejecutor de Functions (`index.mjs`, `runner.py`) que se usa en lugar del incluido. Es un error si el archivo no existe. |
| `FIREEMU_WORKER_THREADS` | Número de hilos de trabajo asíncronos, de 1 a 64. Valor predeterminado: el número de núcleos disponibles, con un máximo de 4. |
| `FIREEMU_MAX_BLOCKING_THREADS` | Límite superior de hilos bloqueantes, de 1 a 512. Valor predeterminado: 64. |
| `FIREEMU_CONTROL_TOKEN` | `fireemu doctor --connect` la envía como token bearer a la API de control. Dentro de `fireemu exec` ya está definida. |
| `FIREBASE_CONFIG` | Cuando `exec` la encuentra definida, conserva tu valor en lugar de escribir uno a partir del ID de proyecto. |
| `PATH`, `VOLTA_HOME` | Dónde se busca Node.js cuando `FIREEMU_NODE` no está definida. |
| `HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA` | Dónde se guarda la caché de la clave de firma de sesión de Authentication (un directorio solo del propietario); sin una caché utilizable, la clave se genera en memoria en cada arranque. |
| `SUDO_UID` | Cuando Fireemu se ejecuta como root, el usuario indicado aquí también es un propietario de confianza de los archivos de configuración descubiertos. Consulta las [comprobaciones de propiedad de archivos](../../guides/configuration/#file-ownership-checks). |
| `ComSpec` | En Windows, el shell que ejecuta la forma de script de `fireemu exec "script"`. Valor predeterminado: `cmd.exe`. |
| `FIREEMU_TRACE_WEBCHANNEL`, `FIREEMU_TRACE_STORAGE` | Cualquier valor imprime una traza de solicitudes (`[webchannel] ...`, `[storage] ...`) en la salida de error estándar, para diagnosticar un problema de cliente. No es para ejecuciones normales. |
