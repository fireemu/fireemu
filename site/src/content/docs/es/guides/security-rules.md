---
title: Security Rules
description: Carga las Security Rules de Firestore, Storage y Realtime Database, y averigua por qué se denegó una solicitud.
---

Carga tus Security Rules de Firestore, Storage y Realtime Database, consulta qué condición denegó una solicitud y prueba con tokens simulados.

## Cargar reglas

Nombra los archivos de reglas en `firebase.json`, como para la CLI de Firebase:

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" }
}
```

o en `fireemu.toml` (`rules.source` para Firestore, `storage.rules` para Storage). La salida de inicio tiene una línea `firestore rules:` y una `storage rules:` que indican si hay reglas cargadas.

Las reglas de Realtime Database se cargan desde la sección `database` de `firebase.json`: un solo archivo para la instancia predeterminada, o uno por instancia o destino de despliegue. La línea `database rules:` de la salida de inicio nombra cada archivo y su instancia. Consulta [Realtime Database](../../products/realtime-database/#security-rules) para saber qué credenciales acepta cada perfil, qué permite una instancia sin reglas y las diferencias con el emulador oficial.

`@firebase/rules-unit-testing` también puede cargar reglas en tiempo de ejecución: `initializeTestEnvironment` envía a los emuladores las `firestore.rules` y `storage.rules` que le pasas, y se atiende `testEnv.clearFirestore()`.

Qué comprueba la carga:

- La comparación con el emulador oficial se limita a casos grabados.
- La sintaxis no soportada y los casos de evaluación listados se rechazan cuando se cargan las reglas, o producen errores de regla.
- Los ocho patrones grabados que el límite de recursos de determinización del emulador oficial rechaza también se rechazan cuando Fireemu carga las reglas, incluso en ramas de expresión no evaluadas. Esto no establece una equivalencia completa de expresiones regulares ni con producción.

## Un proyecto sin reglas

Con `strict`, un proyecto sin Security Rules se comporta como un proyecto de producción sin una release de reglas:

- toda solicitud de cliente a Firestore se rechaza con `PERMISSION_DENIED`;
- toda solicitud de usuario final a Storage se rechaza con la respuesta 400 "bucket has not been set up" de producción.

El Admin SDK y otras credenciales de propietario no se ven afectados.

Estas respuestas conservan la redacción de producción. Por eso la primera solicitud rechazada de cada base de datos y bucket también imprime en la salida de error estándar un aviso que indica que no hay reglas cargadas y cómo cargarlas.

El perfil `emulator` permite toda solicitud a Firestore, y toda solicitud a Storage de un proyecto `demo-*`, como hace el emulador oficial.

## Por qué se denegó una solicitud

Producción responde a una denegación con un mensaje corto (el `PERMISSION_DENIED` de Firestore "Missing or insufficient permissions.", el 403 de Storage) que no indica qué regla la rechazó. Fireemu también imprime en la salida de error estándar cada denegación de una solicitud de usuario final, con cada condición `allow` que evaluó la solicitud y a qué se evaluó:

```text
note: firestore: Security Rules denied get on "notes/n1" in "database (default)" (request.auth.uid "bob"): no allow statement evaluated to true; line 5:22 `request.auth.uid == resource.data.owner` was false
```

- Establece `rules.denialLog` en `"off"` en `fireemu.toml` para silenciar estas líneas, por ejemplo en una suite que comprueba muchas denegaciones. La respuesta al cliente es la misma en ambos casos.
- La página Rules y `GET /v1/sessions/default/rules/requests` muestran las 100 decisiones de Firestore trazadas más recientes. El trazado empieza con la UI o con la primera lectura de la API de control; cargar un conjunto de reglas nuevo borra el historial. Es una vista de depuración, no un registro completo de solicitudes.

### Límites de diagnóstico

Estos límites afectan solo a los diagnósticos, no a las decisiones de permitir/denegar.

- Los diagnósticos de Rules de Firestore y Storage conservan como máximo 64 valores distintos por expresión.
- Los valores de cadena y los mensajes de error se cortan en un límite de carácter dentro de 1,024 bytes UTF-8.
- El JSON/HTML de cobertura de Firestore y los trazados de solicitudes de control marcan los valores cortados con `truncated: true`; las observaciones omitidas añaden `valuesOmitted` y `valuesCountMayBeLower: true`. Por tanto, los recuentos mostrados pueden ser inferiores al recuento real de un valor.

## Pruebas unitarias con tokens simulados

`authenticatedContext()` de `@firebase/rules-unit-testing` y la opción `mockUserToken` de los SDK de cliente envían un ID token simulado sin firmar. Fireemu lo acepta por defecto, también con `strict`, y construye `request.auth` a partir de sus claims como hace el emulador oficial. Con `strict` solo se acepta esa forma exacta de token; todos los demás tokens se verifican, incluida la caducidad.

Para probar el rechazo de producción a los tokens sin firmar, establece `auth.allowUnsignedIdTokens` en `false` o establece [`productionExact`](../profiles/).

## Detalles del lenguaje de Rules

Casos límite de cómo Fireemu evalúa las Rules.

### `get()` y `exists()` sobre una ruta que no es un documento

`get()` y `exists()` toman una ruta a un documento de la base de datos en la que se ejecuta la solicitud. Estas rutas no nombran ningún documento, así que la llamada es un error de evaluación:

- una ruta a una colección (`/databases/$(database)/documents/users`, un número impar de segmentos después de `documents`);
- una ruta a otra base de datos (`/databases/other/documents/users/u1`);
- una ruta sin `documents` (`/databases/$(database)/users/u1`).

Como cualquier error de Rules, hace fallar la condición: la solicitud se rechaza salvo que el otro lado de un `||` o `&&` decida el resultado (`exists(<such a path>) || true` permite; la respuesta de producción para tal mezcla no se grabó). `!exists(...)` y `get(...) == null` no leen la ruta como "inexistente" y permiten; producción los rechaza, y también el emulador oficial.

Una ruta a un documento que no existe sigue siendo un documento inexistente: `exists()` es `false` y `get()` es `null`.

Una causa habitual es el id de documento que falta por una ruta mal escrita, así que la línea `was an error` del log de denegaciones señala la llamada.

### Consultas y documentos almacenados

Una consulta de Firestore se autoriza a partir de sus filtros, no de los documentos que devolvería, como en producción.

Una excepción: una rama de consulta con un único filtro `documentId() ==` se decide por ese documento tal como está almacenado, sean cuales sean los demás filtros, límite, offset o cursor que tenga, como la deciden producción y el emulador oficial. En la prueba, `resource.data` contiene exactamente los campos por los que filtra u ordena la consulta, de modo que `keys()`, `size()`, `in` y `get(key, default)` responden solo a partir de esos campos.

Una consulta `OR` que mezcla una rama que nombra un documento con una rama que no nombra ninguno difiere según el perfil:

- El perfil `emulator` la autoriza rama por rama, como hace el emulador oficial.
- El perfil `strict` demuestra cada rama a partir de sus filtros, porque producción respondió a esa consulta con un error de índice que falta y su respuesta de Rules no está grabada.

### Cadenas en las reglas

Las Rules de Firestore y Storage indexan y miden una cadena por unidad de código UTF-16, como hace producción: `"é🔥x".size()` es 4 y `"é🔥x"[3] == "x"`. `lower()` y `upper()` cambian solo letras ASCII, y las cadenas nunca se normalizan. Las expresiones regulares siguen tratando un carácter suplementario como un solo carácter.

La mitad de un par surrogate difiere según el perfil:

- Con `strict` es un fragmento que solo es igual a sí mismo, y un patrón de `split()`, `replace()` o `matches()` que contenga un surrogate suelto hace fallar la regla, como respondió producción.
- El perfil `emulator` conserva la unidad suelta, como hace el emulador oficial.

## Relacionado

- [Cloud Firestore](../../products/firestore/)
- [Cloud Storage](../../products/storage/)
- [Realtime Database](../../products/realtime-database/#security-rules)
- [Perfiles y productionExact](../profiles/)
