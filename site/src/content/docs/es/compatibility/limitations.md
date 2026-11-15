---
title: Limitaciones
description: Comprueba lo que Fireemu no admite y lo que ningún emulador local puede reproducir antes de confiar en un resultado local.
---

Fireemu aún no reproduce todas las funciones ni todos los comportamientos de Firebase en producción. Estas son las principales limitaciones; la lista no es exhaustiva. Comprueba las APIs concretas en el [manifiesto de capacidades](../#manifiesto-de-capacidades), o ejecuta:

```sh
npx fireemu capabilities
```

## Productos no compatibles

App Hosting y Data Connect no son compatibles por ahora. La compatibilidad con Firebase Extensions no está prevista.

## Productos con compatibilidad parcial

- **Realtime Database.** Se sirve y se verifica contra producción solo para sus casos grabados (consulta [Verificación contra producción](../#verificación-de-producción)). La compatibilidad más amplia con producción no está verificada, y no hay una declaración de paridad con el emulador oficial. Detalles: [Realtime Database](../../products/realtime-database/#differences-from-the-official-emulator) y la lista de abajo.

## Funciones no compatibles

### Cloud Firestore

- La API Enterprise Pipeline admite un subconjunto limitado de operaciones de lectura (consulta [Enterprise pipelines](../../products/firestore/#enterprise-pipelines)).
- La búsqueda de texto de la edición Enterprise ofrece una búsqueda léxica local finita y controles de construcción explícitos. El análisis y el ranking son aproximaciones; `productionExact` rechaza la semántica de búsqueda no observada.

### Authentication

- No se admiten los flujos de inicio de sesión que hablan con proveedores de identidad externos, el intercambio hospedado de códigos de autorización ni el descubrimiento y la rotación de claves en vivo.
- La verificación local configurada de OIDC/SAML firmados se admite mediante la ruta de aserciones firmadas de strict, usando las claves públicas de `auth.idpSigners` o los certificados configurados del proveedor SAML.
- Las comprobaciones SAML finitas cubren los campos de estado, destino, emisor, audiencia y validez presentes, y las respuestas a solicitudes conocidas emitidas por el daemon. Los campos ausentes, las horas que no se pueden analizar y otras combinaciones no grabadas siguen sin observarse.

### Cloud Storage

- Verificar la firma de una URL firmada o de una política POST (se comprueban su expiración y sus condiciones).
- ACL de objetos distintas de la lectura para `allUsers`, IAM y acceso público a nivel de bucket.
- Composición de objetos (`compose`) y configuración de notificaciones.
- **CORS de Storage grabado con `strict`.** `conformance/storage-strictness-obs/recordings/run-2.json` registra respuestas de metadatos de la API JSON, de contenido multimedia, de buckets, de listados y de errores de ACL con UBLA, preflights de subida, inicio de subidas reanudables, cancelación y lecturas de sesiones canceladas con CORS de bucket ausente, vacío y configurado. Strict usa los valores de CORS grabados sin requerir `productionExact`; el perfil emulator conserva su comportamiento actual. La conservación de mayúsculas y minúsculas mixtas en las cabeceras solicitadas, el comportamiento de PATCH y de conmutación de UBLA, y la aplicación de las listas expose a otras respuestas son suposiciones no grabadas. La creación acepta las indicaciones grabadas de región y de soft-delete desactivado sin modelar esos servicios. Las pruebas locales cubren la exportación e importación de UBLA y los buckets creados vacíos. Consulta [CORS de buckets](../../products/storage/#bucket-cors).

### Realtime Database

- Verificada contra producción solo para sus casos grabados (consulta [Verificación contra producción](../#verificación-de-producción)); la compatibilidad más amplia con producción no está verificada, y no hay una declaración de paridad con el emulador oficial. La comparación se limita a los casos grabados del emulador oficial.
- La sintaxis no admitida y los casos de evaluación enumerados (construcciones de expresiones regulares, mapeos de mayúsculas y minúsculas y las demás diferencias que allí se enumeran) se rechazan al cargar las reglas o producen errores de reglas. `query.endBefore`, `query.isOrderByChild()`, los nombres `OrderByKey`, `OrderByValue` y `OrderByPriority`, `http.encodeURL()`, las lecturas de métodos sin llamada y los callees ternarios se cargan y se evalúan como se grabó que lo hacía producción.
- Los ocho patrones grabados que el límite de recursos de determinización del emulador oficial rechaza también se rechazan cuando Fireemu carga las reglas, incluso en ramas de expresión no evaluadas. Esto no establece una equivalencia completa de expresiones regulares ni con producción.
- La entrega de triggers de Functions se ha observado para un conjunto limitado de handlers y escrituras grabados; los casos más amplios siguen sin verificarse.
- El comportamiento tomado del emulador oficial donde producción no se ha observado puede cambiar.

Consulta [Realtime Database](../../products/realtime-database/#differences-from-the-official-emulator).

### Cloud Functions

- Los triggers de productos para los que Fireemu no entrega eventos, como Data Connect (aplazado). Los handlers de Remote Config se ejecutan solo mediante la acción de inyección local, y la forma de su evento en producción no se ha observado.
- Los codebases de Dart, y la entrada de CloudEvents en protobuf distinta de los eventos de Firestore. Los eventos de Firestore llegan al SDK de Python como protobuf, y a las funciones de 2.ª generación de Node como protobuf con `strict`.
- La forma exacta de los eventos de archivado de Storage sigue sin grabarse.
- Los codebases de Python sirven funciones HTTP, callable, de Firestore, de Pub/Sub, de Storage, de Eventarc, de Realtime Database, programadas, de colas de tareas y de bloqueo de Auth. Solo ven el tiempo real (sin reloj virtual), recargan los cambios del código fuente de la aplicación e ignoran las ediciones de su `venv` y de las cachés de bytecode de Python, y se ejecutan solo en macOS y Linux. Reinicia Fireemu después de cambiar las dependencias instaladas. Los App Check tokens de sus callables los verifica el SDK de Python contra las claves del emulador de App Check (sin consumo de uso limitado, y una configuración explícita de App Check se niega a iniciarse). Consulta [Cloud Functions (Python)](../../products/functions-python/).

### Cloud Pub/Sub

- Esquemas, entrega a suscripciones de BigQuery y Cloud Storage, entrega exactly-once y transformaciones de mensajes.
- `UpdateTopic` solo admite las máscaras de actualización `labels` y, en el perfil emulator, `message_storage_policy` y `kms_key_name`; `DetachSubscription` no está implementado.
- `messageStoragePolicy` se almacena tal como se envía y nunca se comprueba contra las regiones de Google Cloud; el perfil `strict` la rechaza.
- Los nombres de clave y las etiquetas (tags) de los temas se almacenan tal como se envían y nunca se validan en el perfil emulator; el perfil strict los rechaza.

### App Check

- Atestación mediante Play Integrity, App Attest, DeviceCheck o reCAPTCHA, y protección contra repetición con tokens de uso limitado. Se admiten las pruebas locales con debug tokens.

## Limitaciones del control local

- Las sesiones comparten relojes, reglas, Functions y la barrera de admisión.
- Los snapshots se mantienen en memoria durante la vida del daemon; no capturan el trabajo pendiente de Functions.
- `awaitIdle` no espera al trabajo de Text Index ni proporciona barreras causales entre sesiones.

## Diferencias que ningún emulador local elimina

Una operación local correcta no garantiza el mismo resultado en producción. Fireemu no reproduce la contabilidad real de cuotas, la facturación, IAM, las políticas de organización, las diferencias regionales o de red, ni los despliegues graduales de los servicios. El rendimiento local no predice la latencia ni el rendimiento (throughput) de producción.

Las Security Rules y el comportamiento de las APIs se implementan a partir de la documentación y de observaciones del comportamiento real de Firebase. Los cambios en Firebase, o las condiciones que no se han probado, pueden introducir diferencias que aún no se han registrado.

## Límites locales

Algunos límites existen solo en Fireemu, para acotar el uso de memoria: los [límites del historial de Firestore](../../products/firestore/#transactions-and-history) y el [límite opcional de bytes almacenados de Storage](../../products/storage/#limit-the-stored-bytes).

## Cambios entre versiones

La configuración y el comportamiento pueden cambiar entre versiones. Consulta el [CHANGELOG](https://github.com/fireemu/fireemu/blob/main/CHANGELOG.md).

## Relacionado

- [Tablas de compatibilidad](../)
- [Perfiles y productionExact](../../guides/profiles/)
- [Rendimiento](../performance/)
