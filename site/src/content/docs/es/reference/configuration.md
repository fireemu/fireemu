---
title: Esquema de configuración
description: Encuentra el esquema JSON de fireemu.toml y la guía de cada sección de configuración de nivel superior.
---

`fireemu.toml` se describe mediante un esquema JSON. Los mismos ajustes se pueden escribir como TOML (`fireemu.toml`) o como JSON (`fireemu.json`); consulta [Archivos de configuración](../../guides/configuration/) para saber qué archivo se carga.

Fireemu valida el archivo al iniciar, incluidas las reglas que el esquema no puede expresar, y se detiene con un error ante un valor que no acepta. `npx fireemu config show` imprime cada clave con su valor efectivo y su origen.

## Obtener el esquema

- [fireemu.schema.json en este sitio](../../../spec/config/fireemu.schema.json).
- [spec/config/fireemu.schema.json en GitHub](https://github.com/fireemu/fireemu/blob/main/spec/config/fireemu.schema.json). El mismo archivo existe en cada etiqueta de versión, `https://raw.githubusercontent.com/fireemu/fireemu/v<version>/spec/config/fireemu.schema.json`, que es lo que `fireemu init` de un binario publicado escribe en un archivo nuevo (una compilación desde el código fuente escribe la ubicación de `main`).
- `npx fireemu config schema --out fireemu.schema.json` escribe el esquema incluido en el binario que ejecutas: las claves que acepta son las claves con las que valida.

## Secciones de nivel superior

| Sección | Qué configura | Guía |
|---|---|---|
| `schemaVersion` | Siempre `1` | |
| `profile`, `productionExact` | Comportamiento de producción o del emulador oficial | [Perfiles y productionExact](../../guides/profiles/) |
| `firebaseJson` | El `firebase.json` del que leer puertos, reglas, índices y Functions | [Archivos de configuración](../../guides/configuration/) |
| `firestore` | Edición, modo de API, índices, límites, historial | [Cloud Firestore](../../products/firestore/) |
| `rules` | Origen de las Firestore Security Rules, y el registro de denegaciones de Firestore y Storage | [Security Rules](../../guides/security-rules/) |
| `auth` | `requireClientApiKey` (`false` por defecto) hace que el perfil emulator rechace con el 403 del emulador oficial las solicitudes de cliente sin clave de API ni cabecera Authorization; strict no cambia. También configura los métodos de inicio de sesión, la política de contraseñas, MFA, tenants, proveedores, tokens, y si las superficies de Security Rules de Firestore, Storage y Realtime Database aceptan ID tokens simulados sin firmar (`allowUnsignedIdTokens`) | [Authentication](../../products/auth/) |
| `storage` | Security Rules de Storage, tamaño de objeto, límites de cuerpo en búfer y de bytes almacenados, declaración de buckets (`undeclaredBuckets`), CORS de buckets (`cors`) y claves de URL firmadas (`signedUrlKeys`) | [Cloud Storage](../../products/storage/) |
| `database` | Qué permite una instancia de Realtime Database sin archivo de reglas (`defaultAccess`); `auth.allowUnsignedIdTokens` decide, en ambos perfiles, si sus reglas aceptan los tokens simulados de `@firebase/rules-unit-testing` | [Realtime Database](../../products/realtime-database/) |
| `hosting` | Dos valores predeterminados de desarrollo del perfil strict: `cacheControl` (`"none"` por defecto; `"production"` con `productionExact` añade `Cache-Control: max-age=3600` a los archivos) y `clientCountry` (`"honoured"` por defecto; `"ignored"` con `productionExact`) | [Firebase Hosting](../../products/hosting/#perfiles) |
| `remoteConfig` | `updateUser` (`email` es obligatorio; `name` e `imageUrl` son opcionales): la identidad que la administración local de plantillas de Remote Config informa como `updateUser`. Desactivado por defecto | [Plantillas de Remote Config](https://github.com/fireemu/fireemu/blob/main/docs/remote-config.md) |
| `functions` | Codebase, ejecutor, reloj de la aplicación, triggers no servidos, una lista fija de funciones servidas (`manifest`), `isolation` (`"codebase"` por defecto; `"function"` con `productionExact`: un proceso ejecutor por función, iniciado en su primer trigger), `taskNameReuse`, `taskDispatchDeadlineSeconds`, `taskRetryDefaults` y `taskRetryBackoff` (valores predeterminados de desarrollo de las colas de Cloud Tasks que `productionExact` ajusta a los de producción, consulta [Perfiles](../../guides/profiles/)), y `authBlockingToken` (`"emulated"` por defecto; `"production"` con `productionExact` bajo `strict`, entrega un token firmado que el ejecutor de Python verifica con las reglas del SDK; las funciones de Node reciben el mismo token con la forma de producción pero no lo verifican, por lo que se comportan como antes) | [Cloud Functions](../../products/functions/) |
| `scheduler` | Zona horaria, recuperación de ejecuciones perdidas y solapamiento de las funciones programadas | [Tiempo y funciones programadas](../../guides/time/) |
| `pubsub`, `eventarc` | Ajustes de autenticación y de entrega; `pubsub.restNegativeCache` (`"off"` por defecto; `"production"` es una activación explícita bajo strict que reproduce el `404` en caché de unos 10 s tras un `404` real que producción mostró en una conexión; `productionExact` no lo selecciona) | [Pub/Sub y Eventarc](../../products/pubsub-eventarc/) |
| `appCheck` | Apps, tokens de depuración y aplicación forzada | [App Check](../../products/app-check/) |
| `daemon` | Puertos, proyecto, hora de inicio, cómo avanza el reloj (`clock`) | [Tiempo y funciones programadas](../../guides/time/) |
| `network` | Escuchar fuera del loopback (`allowNonLoopbackHosts`) y los nombres `Host` adicionales a los que responden los emuladores (`allowedHosts`, la defensa contra DNS rebinding) | [CI y contenedores](../../guides/ci-and-containers/#nombres-de-host-que-responden-los-emuladores) |
| `bind` | Se acepta, actualmente sin efecto: el daemon enlaza la dirección de loopback, y `emulators.<name>.host` en `firebase.json` define un host por servicio | [CI y contenedores](../../guides/ci-and-containers/) |
| `projects` | Si solo se aceptan IDs de proyecto con prefijo `demo-` (`requireDemoPrefix`), y si una solicitud que nombra otro proyecto se sirve o se rechaza (`unknownProjects`) | [Perfiles y productionExact](../../guides/profiles/) |
| `limits` | Reservado para catálogos de límites, advertencias, contabilidad de cuotas y sobrescrituras de plan. Ningún miembro cambia aún el comportamiento: cada uno se acepta sin efecto, o acepta solo su valor vacío o predeterminado y rechaza cualquier otro. Los límites de Firestore se activan con `firestore.enforceLimits` | |
| `events` | Entrega de eventos de triggers de funciones: `maxAttempts` para funciones declaradas con `retry` (4 por defecto); `delivery` solo acepta `exactly-once-test` | [Perfiles y productionExact](../../guides/profiles/) |
| `trace` | Se acepta, actualmente sin efecto | |

Una clave que se acepta sin efecto imprime una línea `note:` cuando una ejecución la carga. Para hacer fallar un trabajo de CI por un ajuste así, ejecuta `fireemu config lint --deny-ineffective`. Los enumera y termina con código 1 salvo que una entrada `--allow` cubra cada uno (consulta [`config lint`](../cli/#config-lint)).

## Límites de tamaño de Storage

| Clave | Define | Valor predeterminado | Máximo |
|---|---|---|---|
| `storage.maxObjectBytes` | El tamaño máximo de un objeto. El límite del cuerpo de la solicitud es este valor más 4194304 bytes | 268435456 bytes | 2143289343 |
| `storage.bufferedBodyBudgetBytes` | El presupuesto, para todo el proceso, de cuerpos de solicitud de Storage en búfer | 1073741824 bytes | 2147483647 |

Ambos valores deben ser números enteros positivos. Consulta [Cloud Storage](../../products/storage/) para los límites independientes de bytes almacenados y de subidas reanudables.
