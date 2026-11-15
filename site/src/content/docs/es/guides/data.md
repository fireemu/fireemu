---
title: Exportar e importar datos
description: Guarda los datos del emulador, cárgalos al iniciar y consérvalos entre ejecuciones.
---

Exporta los datos de un emulador en ejecución a un directorio, impórtalos al iniciar y vuelve a escribirlos cuando termina la ejecución.

## Exportar desde un emulador en ejecución

Ejecuta esto en otra terminal mientras `fireemu up` está en marcha:

```sh
npx fireemu emulators:export ./emulator-data
```

`--force` sobrescribe un destino que no está vacío.

## Importar al iniciar y exportar al salir

`--import <dir>` carga una exportación al iniciar. `--export-on-exit` sin directorio vuelve a escribir el estado en el mismo directorio cuando termina la ejecución:

```sh
npx fireemu exec --import ./emulator-data --export-on-exit -- npm test
```

Qué acepta `--import`:

- Un directorio `--import` vacío inicia sin datos, de modo que la primera ejecución no necesita un comando aparte.
- Un directorio que no existe se rechaza, para que una ruta mal escrita no pueda iniciar una suite vacía, salvo que sea también donde escribe `--export-on-exit`.
- Un directorio que contiene archivos pero no `firebase-export-metadata.json` se rechaza.
- Las importaciones de Realtime Database se validan antes de que ningún producto instale datos. Con `strict`, un surrogate suelto en un valor de cadena JSON importado se rechaza; el perfil `emulator` lo sustituye por `?`, como hace el emulador oficial. Las claves no válidas se rechazan en ambos perfiles. Consulta [Importación de Realtime Database](../../products/realtime-database/#exportación-importación-y-snapshots).

Qué hace `--export-on-exit`:

- Un `--export-on-exit` fallido se imprime como una línea `error:`, y la ejecución sale con 1 cuando el comando tuvo éxito. La CLI oficial solo avisa y sale con 0; Fireemu difiere para que un trabajo de CI que depende de los datos guardados no pueda pasar sin ellos.
- El directorio de exportación puede ser un punto de montaje de volumen, como un volumen de contenedor montado en `/data`. Un punto de montaje no se puede sustituir con un rename atómico, así que la exportación se prepara dentro de él y se mueve a su sitio: el antiguo `firebase-export-metadata.json` sale primero y el nuevo llega el último. Esa sustitución no es atómica: una exportación interrumpida deja un directorio sin el manifiesto, que `--import` rechaza en lugar de cargar una parte.
- Cualquier otro directorio se sigue sustituyendo de forma atómica.

## Dónde exportar

Antes de iniciar una ejecución persistente, inspecciona el destino sin crear directorios ni cambiar permisos:

```sh
npx fireemu doctor --export-dir "$HOME/.local/share/fireemu/emulator-data"
```

En sistemas de tipo Unix, se comprueban la propiedad y los permisos del destino y de cada ancestro existente, incluido el directorio home. Cada uno debe pertenecer a ti o a root y no ser escribible por otros usuarios. La excepción es un directorio propiedad de root con el sticky bit, como `/tmp` (en macOS `/tmp` es un enlace propiedad de root a `/private/tmp`, que se sigue).

- **Directorios compartidos.** En un directorio sticky, otros usuarios pueden crear entradas pero no pueden renombrar ni eliminar las tuyas, así que `--export-on-exit /tmp/emulator-data` funciona. Otro usuario aún puede ocupar el nombre primero, lo que hace rechazar la exportación, por lo que un directorio dedicado propio es la opción más fiable en una máquina compartida. Bajo `/tmp`, un directorio de exportación que ya existe debe ser tuyo y no ser escribible por otros usuarios (`chmod 700`).
- **Rechazado.** Un directorio que otros usuarios pueden escribir sin el sticky bit, o el directorio de otro usuario.
- **Enlaces simbólicos.** Se comprueba cada enlace simbólico de la ruta de exportación. Solo se sigue cuando su propietario es root, o cuando es tuyo en un directorio en el que solo tú (o root) puedes escribir, de modo que un enlace creado por otro usuario en `/tmp` nunca se sigue. Un `..` justo después de un enlace simbólico se rechaza. El directorio que contiene un enlace debe pasar las mismas comprobaciones que un ancestro (un volumen que aplique la propiedad, sin entrada ACL para otros usuarios).
- **Cuándo se ejecutan las comprobaciones.** `--export-on-exit` comprueba antes de que inicie el daemon o el comando hijo y valida de nuevo al exportar, ya que los permisos pueden cambiar. Mantiene abierto el padre del directorio de exportación desde la comprobación previa hasta el final de la ejecución, de modo que no se sigue nada renombrado o enlazado por el camino entretanto.
- **Montajes de volumen.** El destino de un montaje de volumen debe ser escribible aunque su padre no tenga por qué serlo.
- **Archivos con escritura de grupo.** El descubrimiento de configuración permite archivos con escritura de grupo para configuraciones de grupo privado, pero la publicación de la exportación mantiene sus reglas de seguridad de limpieza más estrictas.

### macOS

- **ACL.** Un directorio ancestro con una ACL se rechaza cuando la ACL tiene una entrada `allow` para alguien que no sea el propietario, root o el usuario que ejecuta la exportación, sean cuales sean los permisos que muestre la entrada (el kernel concede derechos que `ls -le` no lista). Las entradas `deny` se aceptan, de modo que un directorio home estándar (que lleva `group:everyone deny delete`) y las carpetas bajo él funcionan.
- **Resolver un rechazo por ACL.** Cuando se rechaza una exportación por una ACL, el mensaje nombra la entrada; elimínala (`chmod -a`) o exporta a otro directorio, por ejemplo uno bajo `$TMPDIR`. Comprueba un ancestro con `/bin/ls -led <directory>`.
- **Volúmenes que ignoran la propiedad.** Se rechaza un destino en un volumen que ignora la propiedad (memorias y tarjetas exFAT y FAT, o un volumen APFS externo con "Ignore ownership on this volume" activado), porque el propietario y el modo de sus directorios no muestran quién puede cambiarlos; exporta a un volumen que aplique la propiedad.
- **Volúmenes sin rename atómico.** Un volumen sin rename atómico de directorios (exFAT, FAT, algunos sistemas de archivos de red) tampoco puede publicar una exportación: usa un directorio en un volumen APFS.

### Windows

`emulators:export` y `--export-on-exit` no están disponibles actualmente. La importación y el resto de los emuladores funcionan.

## Exportar mundos de prueba independientes

En un [mundo de prueba](../test-worlds/), `hub: true` habilita un Hub privado para el comando de exportación de la CLI ya existente del mundo. Usa una ruta de exportación absoluta propiedad del llamador y fuera de `world.directory`:

```js
import { resolve } from 'node:path';
import { createTestWorld } from 'fireemu/testing';

const exportPath = resolve('./emulator-data');
const services = ['auth', 'firestore', 'storage'];
const world = await createTestWorld({ services, hub: true });
try {
  await world.run('fireemu', [
    'emulators:export', exportPath, '--project', world.projectId,
  ]);
} finally {
  await world.dispose();
}
const restored = await createTestWorld({ services, import: exportPath });
try {
  // Connect fresh SDK clients through restored.endpoints or restored.run(...).
} finally {
  await restored.dispose();
}
```

- Pasa `--project` explícitamente.
- El helper posee el puerto del Hub asignado por el SO y el localizador privado; los mundos del mismo proyecto siguen siendo independientes.
- Para un binario de desarrollo, usa su ruta absoluta tanto para `binaryPath` como para el comando de exportación.
- Las importaciones se capturan en una instantánea al crear el mundo, de modo que ediciones posteriores de la exportación original no afectan a reset.
- Las exportaciones fuera del directorio del mundo siguen siendo del llamador tras la liberación.

Consulta la [guía completa de exportación e importación](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#export-and-import-test-data).

## Qué conserva una exportación

| Se conserva | No se conserva |
| --- | --- |
| Usuarios de Auth y credenciales de contraseña | Estado de App Check |
| Documentos de Firestore | Relojes virtuales |
| Bytes y metadatos de Storage | Memoria del proceso de Functions |
| Datos de Realtime Database | La validez de los tokens emitidos anteriormente |

## Relacionado

- [Mundos de prueba](../test-worlds/)
- [Referencia de la CLI](../../reference/cli/)
- [Realtime Database](../../products/realtime-database/#exportación-importación-y-snapshots)
- [Solución de problemas](../troubleshooting/)
