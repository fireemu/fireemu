---
title: Migra desde la Local Emulator Suite
description: Pasa un proyecto de firebase emulators:exec a Fireemu y resuelve las pruebas que fallan con el perfil strict.
---

Fireemu lee tu `firebase.json` existente, sirve los mismos puertos predeterminados y acepta los nombres de comando oficiales, de modo que la mayoría de los proyectos se migran cambiando un solo comando.

## Antes de empezar

Comprueba que los productos que usas están en la [lista de productos compatibles](../../#supported-products). La Local Emulator Suite también sirve App Hosting, Data Connect y Extensions, que Fireemu no sirve, y Realtime Database es parcial.

## Cambia los comandos

1. Instala Fireemu y crea un `fireemu.toml` que haga referencia a tu `firebase.json`:

   ```sh
   npm install --save-dev fireemu
   npx fireemu init --firebase-json firebase.json
   ```

   Mantén `profile = "strict"`, el valor predeterminado.

2. Reemplaza los comandos:

   | Antes | Después |
   |---|---|
   | `firebase emulators:exec "npm test"` | `fireemu exec -- npm test` |
   | `firebase emulators:start` | `fireemu up` |

   `fireemu emulators:exec` y `fireemu emulators:start` también funcionan, y `exec` acepta la forma oficial de script entre comillas.

3. Ejecuta tus pruebas.

## Cuando una prueba falla con `strict`

Una prueba que pasaba en el emulador oficial pero falla con `strict` suele mostrar un comportamiento que tu aplicación también encontraría en producción. Corrige la prueba o la aplicación, o relaja solo el ajuste concreto de abajo. Evita cambiar todo el perfil a `emulator`.

### ID tokens de emulador sin firmar

`authenticatedContext()` de `@firebase/rules-unit-testing` y `mockUserToken` del SDK de cliente funcionan con `strict` por defecto.

- Define `auth.allowUnsignedIdTokens` como `false` para desactivar su alternativa en las superficies de Security Rules y comprobar que producción los rechaza.
- Para una prueba de rechazo, usa los valores predeterminados `iat: 0` / `exp: 3600` del helper del SDK con un reloj posterior a la expiración. Los tokens emitidos por Fireemu que pasan la verificación normal se siguen aceptando.
- Usa `auth.idTokenSigning = "session-rsa"` para rechazar todos los ID tokens sin firmar.

Consulta [Tokens de ID simulados sin firmar](../../products/auth/#tokens-de-id-simulados-sin-firma).

### Bases de datos con nombre

Declara cada base de datos con nombre en el array `firestore` de `firebase.json`, con sus archivos `rules` e `indexes`, o créala mediante la Admin API, tal como producción necesita que se cree. Una base de datos creada en tiempo de ejecución no tiene Security Rules hasta que cargas alguna para ella (consulta [Firestore](../../products/firestore/#bases-de-datos-con-nombre)).

### Índices compuestos

Las consultas se comprueban contra tus índices declarados, como las comprueba producción. Declara el índice que necesita una consulta en `firestore.indexes.json`, referenciado desde `firebase.json`.

- Una consulta cuyo índice falta se rechaza con `FAILED_PRECONDITION` y un enlace al índice, como en producción.
- Un índice compuesto con un solo campo se rechaza al cargar el archivo, como lo rechaza `firebase deploy`: usa `fieldOverrides`.
- Para seguir ejecutando esas consultas mientras añades los índices, define `firestore.missingIndexes` como `"report"`: la consulta se ejecuta y cada índice que falta se informa una vez por base de datos en la salida de error estándar, con el texto de rechazo de producción y la entrada de `firestore.indexes.json`. `productionExact` no cambia esta clave.
- Para las consultas OR, los diagnósticos complementarios de la salida de error estándar enumeran todos los índices de rama distintos que faltan, de modo que puedas añadir sus definiciones juntas. `strict` sigue devolviendo el error existente del SDK con el primer enlace de creación de índice, y el perfil `emulator` sigue sirviendo la consulta. Las sugerencias repetidas se deduplican y la caché de diagnósticos está acotada.

### Ajustes que reflejan tu proyecto de producción

Define estos para que coincidan con tu proyecto de producción en lugar de cambiar el perfil:

| Ajuste | Qué hace con `strict` |
|---|---|
| `auth.improvedEmailPrivacy` | Protección contra la enumeración de correos electrónicos, activada en un proyecto de producción nuevo. Define `false` solo si tu proyecto de producción la desactivó; entonces los inicios de sesión responden `EMAIL_NOT_FOUND` e `INVALID_PASSWORD` como lo hace el emulador oficial de Auth. |
| `auth.mfa` | La configuración de autenticación multifactor de tu proyecto. `strict` empieza con SMS y TOTP habilitados; `productionExact` empieza con la autenticación multifactor desactivada, como un proyecto de producción nuevo. Consulta [Authentication](../../products/auth/#autenticación-multifactor). |
| `firestore.enforceLimits` | Producción siempre aplica los límites de consulta de la edición Standard. `false` deja pasar consultas que producción rechaza, así que déjalo activado salvo que tengas un motivo concreto. Con `strict` solo cambia los límites de consulta. |

## Diferencias con la CLI oficial

- Un `--export-on-exit` fallido hace que la ejecución termine con código 1 aunque el comando haya tenido éxito. La CLI oficial solo avisa y termina con 0; Fireemu es distinto para que un trabajo de CI que depende de los datos guardados no pueda pasar sin ellos.
- En Unix, un `fireemu.toml` o `firebase.json` descubierto solo se carga cuando su propietario es de confianza. Consulta [Archivos de configuración](../../guides/configuration/#comprobaciones-de-propiedad-de-archivos).
- Con `strict`, un proyecto sin Security Rules se comporta como un proyecto de producción sin una versión de reglas publicada: las solicitudes de cliente se rechazan. Consulta [Security Rules](../../guides/security-rules/).

## Relacionado

- [Conecta tu app](../connect/)
- [Perfiles y productionExact](../../guides/profiles/)
- [Tablas de compatibilidad](../../compatibility/)
- [Limitaciones](../../compatibility/limitations/)
