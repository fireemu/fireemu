---
title: UI del emulador
description: Inspecciona y gestiona en el navegador los datos, las Functions, las decisiones de Security Rules y el reloj.
---

`fireemu up` sirve la UI del emulador en `http://127.0.0.1:4000/ui/`. Úsala para explorar y cambiar datos, ejecutar funciones, leer decisiones de Security Rules y mover el reloj.

## Abrir la UI

```sh
# Another port
npx fireemu up --ui-port 4001

# No UI
npx fireemu up --ui-port 0

# exec starts no UI unless asked
npx fireemu exec --ui -- npm test
```

Si el puerto predeterminado está ocupado, `up` inicia sin la UI; comprueba la salida de inicio.

## Qué muestra

| Página | Qué puedes hacer |
| --- | --- |
| **Overview** | Ver el proyecto, la versión, el reloj virtual (congelado, o siguiendo el tiempo real) y los servicios en ejecución, y los nombres de `Host` a los que responden los emuladores: los nombres integrados, las entradas que añadiste con `network.allowedHosts` y si se permiten los nombres de una sola etiqueta. |
| **Authentication, Firestore and Storage** | Explorar y gestionar usuarios, documentos y objetos. |
| **Functions** | Ver las funciones registradas con el runtime de cada una (Node.js o Python, y el `runtime` que declara tu `firebase.json`), sus triggers, resultados de invocación y logs, y el estado del runtime: trabajo pendiente, en ejecución, esperando un reintento o en dead-letter, eventos de Auth retenidos mientras la cola de eventos está llena, tareas en curso, el estado del runner de cada codebase y los exports que el runner encontró y no pudo servir. Ejecutar de inmediato una función programada, o avanzar el reloj hasta su siguiente ocurrencia. |
| **Hosting** | Ver el sitio que sirve Fireemu, su URL local, el directorio público (con un aviso cuando no existía al iniciar) y los rewrites, redirects y headers en el orden en que se aplican. La página lee tu `firebase.json`; no registra solicitudes. |
| **Realtime Database** | Explorar los datos en una ruta, reemplazarlos, parchearlos o borrarlos como administrador local, leer y reemplazar las Rules de la instancia, y ejecutar una solicitud anónima para ver cómo la responden las Rules. |
| **Alerts** | Publicar alertas de Firebase a las funciones que las escuchan. |
| **Rules** | Leer las 100 decisiones de Security Rules de Firestore trazadas más recientes, con resultados de expresión acotados. El trazado empieza con la UI o con la primera lectura de la API de control; un conjunto de reglas nuevo borra el historial. Consulta [Security Rules](../security-rules/) para los límites de diagnóstico. |
| **App Check** | Ver las apps registradas y los debug tokens. |
| **Runtime** | Mover el reloj virtual hacia delante, o hacia atrás con **Allow moving backwards**, e instalar un plan de fallos (consulta abajo). |

## Instalar un plan de fallos

En la página Runtime, bajo **Fault plan**:

1. Selecciona una receta para reintentar un evento de Functions, entrega duplicada, retrasar o agotar el tiempo de un intento, o hacer fallar los primeros intentos, e introduce sus parámetros.
2. Elige **Fill plan**. Coloca el plan en el editor JSON; no lo instala.
3. Revisa o edita el JSON y elige **Install** para aplicarlo a la sesión seleccionada.

Un plan que se puede analizar también ofrece fragmentos copiables de `fireemu/testing` y de la API de control para instalar el mismo plan desde una prueba. **Clear** elimina el plan instalado.

## Selección de base de datos y reproducción de consultas

### Seleccionar una base de datos de Firestore

El campo de base de datos de Firestore ofrece las bases de datos conocidas del proyecto actual y los nombres abiertos recientemente. También puedes introducir un nombre directamente y elegir **Open database**.

- El catálogo se vuelve a comprobar cuando cambia la selección; **Refresh** lo comprueba sin cambiar la selección.
- Una solicitud de catálogo fallida se informa por separado de una base de datos que no figura en una respuesta de catálogo correcta.
- Los nombres recientes se limitan a la sesión y al proyecto seleccionados y se conservan solo en el almacenamiento de sesión de la pestaña del navegador.

### Reproducir una consulta con el SDK de Node.js

La sección **Node.js SDK reproduction** del panel de consultas genera un script que usa el SDK de bajo nivel de Firestore para Node.js. Esto conserva los valores tipados de la consulta, incluidos los enteros de 64 bits y los nanosegundos de las marcas de tiempo.

Instala los paquetes listados en el script, guárdalo como `query.cjs` y establece `FIRESTORE_EMULATOR_HOST` en tu puerto local de Firestore antes de ejecutarlo. El script rechaza los endpoints que no son loopback. Como las consultas de la consola, usa acceso de administrador local en lugar de probar las Security Rules del cliente.

Los borradores de consulta se conservan por base de datos. Las vistas de Firestore actualizan los documentos afectados por sus rutas modificadas, con una actualización de pertenencia cuando una fila carece de una hora de actualización utilizable.

## Comprobaciones de conexión y filtros de Functions compartibles

### Indicador de conexión

El indicador de conexión de la cabecera describe las respuestas de la API de control, no el estado de cada listener de producto.

- Su última comprobación correcta usa la hora de reloj de pared, con independencia del reloj virtual del emulador.
- Una comprobación fallida conserva la marca de tiempo correcta anterior; cambiar la sesión seleccionada la borra hasta que ese destino responde.
- Los cambios de conexión se anuncian a las tecnologías de asistencia.

### Enlaces de filtros de Functions

Los filtros de nombre de función y de nivel de log de Functions se conservan en la URL. El texto de búsqueda permanece en el almacenamiento de sesión de la pestaña, limitado a la sesión y al proyecto seleccionados, salvo que selecciones explícitamente **Include search text in the shared link** y uses **Copy filter link**. Revisa el texto de búsqueda antes de compartirlo.

- Los enlaces contienen ajustes de filtros, no una copia guardada de los registros de log; es posible que los registros ya no se conserven cuando otro lector abra el enlace.
- Cuando el almacenamiento del navegador no está disponible, el texto privado se conserva solo mientras la página sigue montada.
- Un enlace de evento selecciona su sesión, también al volver a visitarlo con Atrás o Adelante del navegador. Si el evento ya no se conserva, la página informa de que ha caducado.

### Portapapeles

Cuando falla el acceso al portapapeles, la página Overview ofrece un campo de texto enfocado y de solo lectura para copiar manualmente con el teclado, en lugar de informar de un éxito.

## Relacionado

- [Tiempo y funciones programadas](../time/)
- [Security Rules](../security-rules/)
- [Mundos de prueba](../test-worlds/#inspeccionar-un-mundo-en-la-ui)
- [Referencia de la CLI](../../reference/cli/)
