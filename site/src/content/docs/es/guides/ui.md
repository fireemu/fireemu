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
| **Authentication, Firestore and Storage** | Explorar y gestionar usuarios, documentos y objetos. La página Authentication también lista los códigos de acción por correo (con sus enlaces) y los códigos SMS pendientes, actualizados cada pocos segundos mientras la pestaña está visible, para un flujo de inicio de sesión o verificación que sigues a mano en un navegador. Authentication también filtra usuarios por estado y MFA, edita como JSON la configuración del emulador de Auth del proyecto y avanza el reloj virtual hasta la siguiente ventana TOTP; Firestore edita un documento como JSON simple, lo duplica, copia el JSON, un valor o una ruta de campo, barre los documentos TTL caducados, hace caducar los streams Listen activos y copia o borra los informes de índices ausentes; Storage edita los metadatos personalizados de un objeto. |
| **Functions** | Ver las funciones registradas con el runtime de cada una (Node.js o Python, y el `runtime` que declara tu `firebase.json`), sus triggers, resultados de invocación y logs, y el estado del runtime: trabajo pendiente, en ejecución, esperando un reintento o en dead-letter, eventos de Auth retenidos mientras la cola de eventos está llena, tareas en curso, el estado del runner de cada codebase y los exports que el runner encontró y no pudo servir. Ejecutar de inmediato una función programada, o avanzar el reloj hasta su siguiente ocurrencia. El panel de invocación guarda una lista de invocaciones recientes que se pueden volver a cargar, permite elegir un usuario de Authentication (la UI genera un ID token para ese usuario), copia la llamada como `curl` y muestra los logs en una vista estructurada. |
| **Pub/Sub** | Listar, crear y borrar topics, suscripciones y snapshots, publicar un mensaje, extraer (pull) y confirmar (ack) mensajes, y hacer seek de una suscripción a un snapshot. Se muestra cuando se ejecuta el emulador de Pub/Sub. |
| **Remote Config** | Leer la plantilla del proyecto predeterminado (parámetros, condiciones, historial de versiones y ETag), validar o publicar una plantilla, volver a una versión anterior y enviar un evento de actualización sintético a los handlers de `onConfigUpdated`. Usa el mismo almacén de plantillas que la [administración local de plantillas](https://github.com/fireemu/fireemu/blob/main/docs/remote-config.md), así que las versiones y los ETag coinciden con lo que ve el Admin SDK. Editar y publicar solo funciona en el proyecto predeterminado. |
| **Hosting** | Ver el sitio que sirve Fireemu, su URL local, el directorio público (con un aviso cuando no existía al iniciar) y los rewrites, redirects y headers en el orden en que se aplican. La página lee tu `firebase.json`; no registra solicitudes. |
| **Realtime Database** | Explorar los datos en una ruta, reemplazarlos, parchearlos o borrarlos como administrador local, verlos como un árbol de datos, leer y reemplazar las Rules de la instancia, y ejecutar una solicitud anónima para ver cómo la responden las Rules. |
| **Alerts** | Publicar alertas de Firebase a las funciones que las escuchan. |
| **Rules** | Leer las 100 decisiones de Security Rules de Firestore trazadas más recientes, con resultados de expresión acotados; mostrar solo las decisiones denegadas o filtrarlas por ruta, método o UID, y ver la cobertura de las reglas cargadas. El trazado empieza con la UI o con la primera lectura de la API de control; un conjunto de reglas nuevo borra el historial. Consulta [Security Rules](../security-rules/) para los límites de diagnóstico. |
| **App Check** | Ver las apps registradas y los debug tokens. |
| **Runtime** | Mover el reloj virtual hacia delante, o hacia atrás con **Allow moving backwards**, instalar un plan de fallos (consulta abajo) y cargar el catálogo de límites aplicados (**Load limits**) y el manifiesto de capacidades (**Load capabilities**). |

## Moverse por la UI

- **Paleta de comandos**: pulsa <kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>⌘</kbd>+<kbd>K</kbd> en macOS) o selecciona **Search or jump to** en la barra lateral. Escribe el nombre de una página para abrirla, una ruta de Firestore como `users/alice` para abrir ese documento o esa colección en la base de datos predeterminada, o elige una acción: cambiar la sesión, cambiar el tema, copiar las líneas de `.env` o congelar, reanudar y avanzar el reloj virtual (+1 hora o +1 día).
- **Reloj y plan de fallos en la cabecera**: la cabecera tiene controles rápidos del reloj (+1 minuto, +15 minutos, +1 hora, +1 día, congelar y reanudar). Mientras hay un plan de fallos instalado, muestra además un indicador con el número de reglas y cuántas se activaron, y una acción **Clear fault plan** que pide confirmación.
- **Tema**: el botón de la parte inferior de la barra lateral alterna entre la configuración del sistema, claro y oscuro. Una elección explícita se recuerda en este navegador.
- **Cifras de Overview**: los recuadros muestran lo que contiene la sesión seleccionada (datos de documentos de Firestore, usuarios de Authentication, objetos de Storage, funciones registradas) y enlazan a cada página. Una cifra que el daemon no informa se muestra como un guion, no como cero.
- **Fragmentos de conexión**: Overview ofrece la misma configuración de conexión como líneas de `.env`, exports de shell, código del Web SDK y código del Admin SDK, y cada dirección de servicio tiene un botón **Copy**.
- **Campos de Firestore**: los campos de un documento forman un árbol. Cada fila muestra el nombre, el tipo (se distinguen enteros y dobles) y el valor; los mapas y arrays se abren bajo demanda. Una referencia a la base de datos que estás explorando es un enlace a ese documento.
- **Búsqueda en Functions**: el cuadro situado sobre las funciones registradas filtra la tabla por nombre, región o trigger.
- **Atajos de teclado**: pulsa <kbd>?</kbd> (o selecciona **Shortcuts** en la barra lateral) para ver la lista. <kbd>/</kbd> abre la paleta de comandos, y <kbd>g</kbd> seguida de la tecla de una página abre esa página, por ejemplo <kbd>g</kbd> <kbd>f</kbd> para Firestore. Las teclas sueltas no hacen nada mientras un campo de texto tiene el foco.
- **Tiempos relativos**: las marcas de tiempo van seguidas de su distancia respecto al reloj virtual de la sesión, como `(3 min ago)` o `(in 2 h)`. La distancia se mide respecto al reloj virtual, no al reloj de tu ordenador, así que cambia cuando avanzas el reloj.
- **Subida y vista previa en Storage**: suelta uno o más archivos sobre la tarjeta **Objects**, o selecciona varios en el selector de archivos, para subirlos a la carpeta que estás viendo. Los archivos se envían de uno en uno; el primer fallo detiene el resto de ese lote e indica el archivo. Los archivos que sueltas mientras hay una subida en curso esperan a que termine y luego se suben a la carpeta que estaba abierta cuando los soltaste. Los detalles de un objeto muestran una vista previa para imágenes rasterizadas (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO) de hasta 10 MiB y para contenido de tipo texto (texto, JSON, XML y similares) de hasta 256 KiB. Las imágenes SVG no tienen vista previa; usa **Download**. El texto siempre se muestra como texto y nunca se renderiza como HTML.
- **Logs de funciones como JSON**: selecciona **Format JSON** encima de los logs para mostrar con sangría el objeto o array JSON de una línea. Los filtros de nivel y de texto siguen comparando las líneas tal como se escribieron.

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
