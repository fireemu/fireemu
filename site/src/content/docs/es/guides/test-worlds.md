---
title: Mundos de prueba
description: Ejecuta pruebas de integración en paralelo en mundos independientes, cada uno con su propio reloj, sus puertos y sus datos, usando el helper fireemu/testing.
---

El helper `fireemu/testing` inicia mundos independientes para pruebas en paralelo. Cada mundo tiene su propio daemon, puertos, reloj y datos, incluso con el mismo ID de proyecto. Úsalo cuando una prueba cambie el reloj, las Rules o las Functions: una sesión dentro de un daemon comparte las tres cosas con el daemon.

Un mundo fija el inicio de su reloj, de modo que el reloj permanece detenido y una prueba lo mueve a mano (consulta [Tiempo y funciones programadas](../time/)).

## Alcance del reloj y reinicio

Lee estas dos secciones antes de escribir una prueba: indican qué no alcanza un movimiento del reloj y qué deja obsoleto `reset()`.

### Qué alcanza un movimiento del reloj

`world.clock` mueve el reloj del daemon. No mueve el reloj de tu proceso de prueba ni el de nada de lo que inicies.

| Superficie | ¿Lo mueve `world.clock`? |
| --- | --- |
| `Date`, `Date.now()`, `new Date()` en Functions | Sí, por defecto en un mundo (`functions.clock.date` es `virtual`). |
| `request.time` de las Security Rules, y las marcas de tiempo de Auth, Storage y App Check | Sí. |
| Horas de programación de Cloud Tasks, backoff de reintentos y reposición de tasa | Sí, por defecto en un mundo (`functions.clock.tasks` es `virtual`). |
| Funciones programadas | Sí. |
| Temporizadores de JavaScript en Functions (`setTimeout`, `setInterval`) | No por defecto (`functions.clock.timers` es `real`). Con `timers: 'virtual'`, un movimiento los hace vencer y `world.clock.runDue()` los ejecuta. |
| El proceso de prueba: `Date.now()`, `performance.now()`, sus temporizadores | No. Pasa instantes explícitos a tus propios helpers. |
| Comandos iniciados con `world.run()`: su `Date.now()` y su `performance.now()` | No. Solo reciben el enrutamiento hacia el mundo. |
| Servicios externos y cualquier otra cosa fuera del daemon | No. |

### Qué invalida `reset()`

`world.reset()` detiene el daemon e inicia uno nuevo, una nueva *generación*, a partir de la instantánea tomada cuando se creó el mundo.

- Todo lo que leíste de la generación anterior queda obsoleto: `world.endpoints`, `world.environment`, `world.uiUrl`, las instancias de SDK y los clientes construidos a partir de ellos, y los clientes de control creados con la URL y el token de control antiguos. Vuelve a leer los getters y reconecta cuando `reset()` se resuelva.
- `world.control()`, `world.clock.*` y `world.run()` usan siempre la generación actual. Un cliente creado con `createControlClient({ env: world.environment })` o con un origen y un token explícitos conserva el endpoint y la credencial de la generación anterior: créalo de nuevo después de `reset()`.
- Los comandos iniciados con `world.run()` en la generación anterior se terminan.
- `reset()` vuelve a la *instantánea de creación*, no a tus fuentes actuales. Las ediciones hechas al código de Functions, a las Rules, a los índices o a la configuración después de crear el mundo no se recogen. Crea un mundo nuevo para usarlas.

## Iniciar un mundo

```js
import { withTestWorld } from 'fireemu/testing';

await withTestWorld(
  {
    projectId: 'demo-parallel',
    clockStart: '2026-01-31T23:59:00Z',
    functionsSource: './functions',
    services: ['auth', 'firestore', 'storage', 'functions'],
  },
  async (world) => {
    await world.clock.advance(59999); // milliseconds: one millisecond before midnight
    await world.run(process.execPath, ['./trial-before-expiry.mjs']);
    await world.clock.advance(1);
    await world.run(process.execPath, ['./trial-expired.mjs']);
  },
);
```

- `world.run` lanza un comando con el proyecto y los hosts de emulador del mundo.
- `world.reset()` inicia el mundo de nuevo desde su instantánea de creación.
- `world.dispose()` detiene el mundo y elimina sus archivos. `withTestWorld` lo libera por ti, también cuando el callback lanza una excepción.

Los mundos separados aíslan sus relojes, Rules, Functions y estado de los servicios.

El cliente `fireemu/control` también funciona en comandos `fireemu exec` y comparte con `world.control()` la resolución de URL y la autenticación, de modo que quien llama no necesita concatenar URL de control (consulta la [guía de mundos de prueba](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md)).

### Varios mundos en una prueba

- Con `Promise.all`, da a cada mundo su propio `withTestWorld()` para que todos los mundos se liberen incluso cuando falla uno hermano.
- Los mundos que deben coexistir dentro de una prueba se crean con `Promise.allSettled` y se liberan en `finally`.
- `Promise.all([createTestWorld(), ...])` seguido de `try/finally` pierde los mundos que ya iniciaron cuando falla una creación (consulta la [guía de mundos de prueba](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds)).

## Avanzar el reloj y esperar el trabajo

`world.clock.advanceAndSettle(duration, { scope, timeoutSeconds, runTimers })` avanza el reloj, ejecuta los temporizadores virtuales vencidos y espera a que el daemon esté inactivo, en ese orden. El alcance predeterminado es `runnable`, que no espera el trabajo programado más allá del movimiento. Se rechaza cuando el movimiento falla o la espera agota su tiempo.

```js
const { clock, timers, idle } = await world.clock.advanceAndSettle({ seconds: 60 });
```

Un `awaitIdle` concurrente y un movimiento del reloj también funcionan, porque un `awaitIdle` pendiente no retiene las llamadas posteriores al reloj del mismo mundo:

```js
await Promise.all([
  world.control('POST', 'sessions/default:awaitIdle', { timeoutSeconds: 20 }),
  world.clock.advance({ seconds: 60 }),
]);
```

`reset()` y `dispose()` cancelan una espera pendiente en lugar de esperar a que agote su presupuesto. Las reglas de ordenación están en la [guía de mundos de prueba](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#advance-the-clock-and-wait-for-work).

## Esperar el trabajo ejecutable

`POST /v1/sessions/default:awaitIdle` acepta `{ "scope": "runnable" }` (desde v0.26.0). En un mundo:

```js
await world.control('POST', 'sessions/default:awaitIdle', { scope: 'runnable' });
```

- El alcance `runnable` excluye de la espera las programaciones futuras de tareas y el backoff de reintentos futuros. El alcance predeterminado sigue esperando todo el trabajo.
- Las tareas vencidas bloqueadas por límites de tasa o de concurrencia, y las solicitudes HTTP activas, siguen pendientes. Avanza el reloj correspondiente o espera el trabajo activo; los diagnósticos identifican la fase de espera y el plazo.
- No espera a temporizadores de JavaScript arbitrarios creados por el usuario.

Consulta [alcances de inactividad y relojes de tareas](https://github.com/fireemu/fireemu/blob/main/docs/tasks-idle.md).

## Fixtures para Vitest y Playwright

Crea el mundo en un fixture, da a cada prueba su propia app Admin SDK con nombre y elimina la app al terminar. Después de `reset()`, elimina la app, vuelve a leer `world.endpoints` y crea una app nueva. La app Admin predeterminada se almacena en caché a nivel de proceso y no se puede redirigir a un mundo.

### Limpiar el host de Firestore heredado

El SDK de Firestore de Firebase Admin da a `FIRESTORE_EMULATOR_HOST` precedencia sobre `db.settings({ host })`. Ejecuta Vitest y Playwright directamente, sin envolver el runner en un `fireemu exec` externo, y limpia el host heredado una vez en el proceso runner dedicado antes de que inicie los workers. Por ejemplo, en shells POSIX:

```sh
env -u FIRESTORE_EMULATOR_HOST npx vitest run
env -u FIRESTORE_EMULATOR_HOST npx playwright test
```

Las protecciones de los fixtures siguientes fallan antes de conectar si un worker aún tiene esa variable. No cambies el `process.env` compartido desde cada prueba. Cuando una prueba mantiene intencionadamente un host de emulador en su entorno, ejecuta esa prueba mediante `world.run()` para que su proceso hijo reciba los endpoints del mundo.

### Ejemplos de fixtures

```ts
// Vitest: test/world.ts
import { test as base } from 'vitest';
import { createTestWorld, type TestWorld } from 'fireemu/testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function assertFirestoreHostIsNotInherited() {
  if ('FIRESTORE_EMULATOR_HOST' in process.env) {
    throw new Error('Start Vitest with FIRESTORE_EMULATOR_HOST cleared before workers start');
  }
}

export const test = base.extend<{ world: TestWorld; admin: { db: () => Firestore; reset: () => Promise<Firestore> } }>({
  world: async ({}, use) => {
    assertFirestoreHostIsNotInherited();
    const world = await createTestWorld({ services: ['auth', 'firestore'] });
    try {
      await use(world);
    } finally {
      await world.dispose();
    }
  },
  admin: async ({ world }, use) => {
    assertFirestoreHostIsNotInherited();
    let app: App | undefined;
    let db: Firestore;
    const connect = () => {
      const { host, port } = world.endpoints.firestore!;
      app = initializeApp({ projectId: world.projectId }, `world-${world.id}-${world.generation}`);
      db = getFirestore(app);
      db.settings({ host: `${host}:${port}`, ssl: false });
      return db;
    };
    connect();
    try {
      await use({
        db: () => db,
        reset: async () => {
          await deleteApp(app!);
          app = undefined;
          await world.reset();
          return connect();
        },
      });
    } finally {
      if (app) await deleteApp(app);
    }
  },
});
```

```ts
// Playwright: one world per worker, a clean generation and a new Admin app per test
import { test as base } from '@playwright/test';
import { createTestWorld, type TestWorld } from 'fireemu/testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function assertFirestoreHostIsNotInherited() {
  if ('FIRESTORE_EMULATOR_HOST' in process.env) {
    throw new Error('Start Playwright with FIRESTORE_EMULATOR_HOST cleared before workers start');
  }
}

export const test = base.extend<{ db: Firestore }, { world: TestWorld }>({
  world: [
    async ({}, use) => {
      assertFirestoreHostIsNotInherited();
      const world = await createTestWorld({ services: ['auth', 'firestore'] });
      try {
        await use(world);
      } finally {
        await world.dispose();
      }
    },
    { scope: 'worker' },
  ],
  db: async ({ world }, use, testInfo) => {
    assertFirestoreHostIsNotInherited();
    await world.reset(); // endpoints below are read after the reset
    const { host, port } = world.endpoints.firestore!;
    const app = initializeApp({ projectId: world.projectId }, `test-${testInfo.testId}-${world.generation}`);
    const db = getFirestore(app);
    db.settings({ host: `${host}:${port}`, ssl: false });
    try {
      await use(db);
    } finally {
      await deleteApp(app);
    }
  },
});
```

Los clientes que leen el host de su emulador del entorno, como Admin Auth, no se pueden apuntar a un mundo mediante una app con nombre: ejecuta ese código con `world.run()`, que pasa `world.environment` al proceso hijo.

## TypeScript

`fireemu/testing` y `fireemu/control` incluyen declaraciones de tipos para la resolución de módulos estricta `NodeNext` y para bundlers; importa los subpaths directamente, sin un paquete de tipos aparte.

```ts
import { withTestWorld, type TestWorldOptions } from 'fireemu/testing';
import { createControlClient } from 'fireemu/control';

const options = { services: ['auth', 'firestore'] as const } satisfies TestWorldOptions;
const projectId: string = await withTestWorld(options, (world) => world.projectId);

const client = createControlClient({ origin: 'http://127.0.0.1:9000', token: 'your-control-token' });
const response: unknown = await client.request('GET', 'sessions/default');
```

- Un nombre de servicio mal escrito, un modo de reloj no soportado o una opción desconocida es un error de compilación.
- Las propiedades del mundo y del cliente son de solo lectura, `uiUrl` es `string | undefined` y cada endpoint de servicio es opcional porque solo inician los servicios seleccionados.
- Las solicitudes de control genéricas se resuelven como `unknown`: acota la respuesta antes de leer campos.
- Los tipos no demuestran límites en tiempo de ejecución (por ejemplo, `runDue` necesita un presupuesto entero de 1 a 10000); el helper los comprueba cuando se ejecuta.

Consulta la [guía de mundos de prueba](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#typescript-consumers) para los detalles.

## Inspeccionar un mundo en la UI

La UI está desactivada por defecto. Para inspeccionar un mundo en la UI de depuración, pasa `ui: true` a `createTestWorld()` y abre `world.uiUrl`.

- Cada mundo habilitado recibe su propio puerto loopback y comparte su estado en vivo de Firestore, Auth, Storage y Functions.
- Mantén el mundo activo mientras lo inspeccionas; `dispose()` también detiene su UI.
- Después de `reset()`, vuelve a leer `world.uiUrl` y reabre la página.

Consulta [mundos de prueba](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#inspect-a-world-in-the-ui) para un ejemplo interactivo.

## Exportar e importar

Activa `hub: true` para exportar un mundo de prueba e importar sus datos en uno nuevo; consulta [Exportar mundos de prueba independientes](../data/#exportar-mundos-de-prueba-independientes).

## Coste de las instantáneas

Un mundo copia las fuentes de Functions, los enlaces de dependencias y las raíces de `NODE_PATH` solo cuando carga Functions: con `services` omitido (la selección predeterminada incluye Functions cuando la configuración nombra una fuente o un manifiesto), o listando `functions` o `functions:<codebase>`.

Una selección como `['auth', 'firestore']` se salta todo eso y quita la sección de Functions de la configuración de la instantánea. Las funciones de bloqueo de Auth y las funciones activadas por eventos se ejecutan en el servicio Functions, así que selecciona `functions` para usarlas.

`world.snapshotStats` informa de lo que costó cada copia:

- `initial` es la copia única de tus entradas.
- Cada entrada de `generations` es la copia que inició una generación (la creación y cada `reset()`).
- Cada una tiene `files`, `directories`, `symlinks`, `bytes`, `method` (`copy`, `clone` o `mixed`) y `elapsedMs`.

Establece `FIREEMU_TEST_WORLD_STATS=1` para imprimir una línea por copia en stderr.

```js
const { initial, generations } = world.snapshotStats;
console.log(initial.functions, initial.files, initial.elapsedMs, generations.at(-1).method);
```

Las copias de generación usan copy-on-write donde la plataforma lo soporta (`cp -c` de macOS en APFS; reflinks en sistemas de archivos de Linux que los permiten) y una copia simple en caso contrario; en ambos casos cada generación es dueña de sus bytes. Consulta [qué copia una instantánea](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#what-a-snapshot-copies-and-what-it-costs).

## Instantáneas y tiempos de espera

| Opción | Acota | Predeterminado |
| --- | --- | --- |
| `snapshotTimeoutMs` | La instantánea inicial de las entradas y la preparación de la primera generación en conjunto, y cada preparación de reset por separado. Acepta enteros de 1 a 2,147,483,647. | 60,000 ms |
| `startupTimeoutMs` | La disponibilidad del daemon tras la preparación. | 60,000 ms |

- Un tiempo de espera agotado o una cancelación detiene la copia de archivos, espera a que se asienten las copias activas y limpia las instantáneas parciales, incluidos los directorios copiados de solo lectura.
- Los archivos de configuración deben resolverse a archivos regulares. Los árboles copiados pueden contener directorios, archivos regulares y enlaces de dependencias soportados, pero se rechazan otros tipos de sistema de archivos.
- Si la preparación agota su tiempo, reduce las dependencias sin usar o aumenta `snapshotTimeoutMs`; aumentar el tiempo de espera de disponibilidad no ayuda.
- Reset retira primero la generación anterior, de modo que una preparación fallida no deja el daemon antiguo en ejecución.

### Instantáneas de dependencias y NODE_PATH global

Los mundos con Functions toman una instantánea de las fuentes y dependencias locales para que las ediciones del llamador no afecten a reset. El `NODE_PATH` ambiental se limpia por defecto (desde v0.27.0), mientras que las variables de entorno ordinarias del padre siguen heredándose. Las fuentes locales y los `node_modules` ancestros se siguen copiando en la instantánea.

- Para conservar los globales, pasa `env: { ...process.env }`, o suministra un `env.NODE_PATH` reducido con solo los directorios que necesitas. Un objeto de entorno que contiene `NODE_PATH` es una opción expresa incluso cuando se construye con un spread.
- `nodePathExcludes` omite nombres exactos de paquetes sin usar, incluidos los nombres con scope, antes de seguir sus enlaces. Los fallos de dependencias requeridas siguen siendo errores.
- Antes de v0.27.0, los mundos también copiaban los directorios heredados de `NODE_PATH`, incluidos los repositorios de desarrollo globales enlazados, por lo que un repositorio enlazado sin usar podía ralentizar el inicio o hacer fallar la copia antes de que empezaran las pruebas. En esas versiones, pasa `env: { ...process.env, NODE_PATH: '' }` para dependencias solo locales.

Consulta [límites de las instantáneas de dependencias](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds).

## Relacionado

- [Tiempo y funciones programadas](../time/)
- [Exportar e importar datos](../data/#exportar-mundos-de-prueba-independientes)
- [UI del emulador](../ui/)
- [Cloud Functions](../../products/functions/)
