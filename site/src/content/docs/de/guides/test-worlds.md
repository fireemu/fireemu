---
title: Testwelten
description: Führen Sie parallele Integrationstests in unabhängigen Welten mit jeweils eigener Uhr, eigenen Ports und eigenen Daten aus, mit dem Helfer fireemu/testing.
---

Der Helfer `fireemu/testing` startet unabhängige Welten für parallele Tests. Jede Welt hat ihren eigenen Daemon, eigene Ports, eine eigene Uhr und eigene Daten, auch bei gleicher Projekt-ID. Verwenden Sie eine, wenn ein Test die Uhr, Rules oder Functions ändert: Eine Sitzung innerhalb eines Daemons teilt alle drei mit dem Daemon.

Eine Welt fixiert ihren Uhrenstart, sodass ihre Uhr stillsteht und ein Test sie von Hand weiterstellt (siehe [Zeit und geplante Funktionen](../time/)).

## Geltungsbereich der Uhr und Zurücksetzen

Lesen Sie diese beiden Abschnitte, bevor Sie einen Test schreiben: Sie sagen, was eine Uhrbewegung nicht erreicht und was `reset()` veralten lässt.

### Was eine Uhrbewegung erreicht

`world.clock` bewegt die Uhr des Daemons. Sie bewegt weder die Uhr Ihres Testprozesses noch die von irgendetwas, das Sie starten.

| Oberfläche | Von `world.clock` bewegt? |
| --- | --- |
| Functions `Date`, `Date.now()`, `new Date()` | Ja, in einer Welt standardmäßig (`functions.clock.date` ist `virtual`). |
| `request.time` der Security Rules sowie Zeitstempel von Auth, Storage und App Check | Ja. |
| Zeitpunkte von Cloud-Tasks-Plänen, Retry-Backoff und Nachfüllen der Rate | Ja, in einer Welt standardmäßig (`functions.clock.tasks` ist `virtual`). |
| Geplante Funktionen (Scheduled Functions) | Ja. |
| JavaScript-Timer der Functions (`setTimeout`, `setInterval`) | Standardmäßig nein (`functions.clock.timers` ist `real`). Mit `timers: 'virtual'` macht eine Bewegung sie fällig, und `world.clock.runDue()` führt sie aus. |
| Der Testprozess: `Date.now()`, `performance.now()`, seine Timer | Nein. Übergeben Sie ausdrückliche Zeitpunkte an Ihre eigenen Helfer. |
| Mit `world.run()` gestartete Befehle: ihr `Date.now()` und `performance.now()` | Nein. Sie erhalten lediglich das Routing zur Welt. |
| Externe Dienste und alles andere außerhalb des Daemons | Nein. |

### Was `reset()` ungültig macht

`world.reset()` stoppt den Daemon und startet einen neuen, eine neue *Generation*, aus dem Snapshot, der bei der Erstellung der Welt angelegt wurde.

- Alles, was Sie aus der alten Generation gelesen haben, ist veraltet: `world.endpoints`, `world.environment`, `world.uiUrl`, SDK-Instanzen und daraus gebaute Clients sowie Steuer-Clients, die aus der alten Steuer-URL und dem alten Token erstellt wurden. Lesen Sie die Getter erneut und verbinden Sie sich neu, nachdem `reset()` aufgelöst wurde.
- `world.control()`, `world.clock.*` und `world.run()` verwenden immer die aktuelle Generation. Ein Client, der mit `createControlClient({ env: world.environment })` oder mit ausdrücklichem Origin und Token erstellt wurde, behält Endpunkt und Credential der alten Generation: Erstellen Sie ihn nach `reset()` neu.
- Mit `world.run()` in der alten Generation gestartete Befehle werden beendet.
- `reset()` kehrt zum *Erstellungs-Snapshot* zurück, nicht zu Ihren aktuellen Quellen. Änderungen an Functions-Code, Rules, Indizes oder Konfiguration nach der Erstellung der Welt werden nicht übernommen. Erstellen Sie eine neue Welt, um sie zu verwenden.

## Eine Welt starten

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

- `world.run` startet einen Befehl mit dem Projekt und den Emulator-Hosts der Welt.
- `world.reset()` startet die Welt erneut aus ihrem Erstellungs-Snapshot.
- `world.dispose()` stoppt die Welt und entfernt ihre Dateien. `withTestWorld` übernimmt das für Sie, auch wenn der Callback einen Fehler wirft.

Getrennte Welten isolieren ihre Uhren, Rules, Functions und ihren Dienstzustand.

Der Client `fireemu/control` funktioniert auch in `fireemu exec`-Befehlen und teilt mit `world.control()` die URL-Auflösung und die Authentifizierung, sodass Aufrufer Steuer-URLs nicht zusammensetzen müssen (siehe die [Anleitung zu Testwelten](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md)).

### Mehrere Welten in einem Test

- Geben Sie bei `Promise.all` jeder Welt ihr eigenes `withTestWorld()`, damit jede Welt auch dann freigegeben wird, wenn eine andere scheitert.
- Welten, die innerhalb eines Tests nebeneinander bestehen müssen, werden mit `Promise.allSettled` erstellt und in `finally` freigegeben.
- `Promise.all([createTestWorld(), ...])` gefolgt von `try/finally` lässt die Welten, die gestartet wurden, auslaufen (leaken), wenn eine Erstellung fehlschlägt (siehe die [Anleitung zu Testwelten](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds)).

## Eine Hosting-Website testen

Wählen Sie `hosting`, um die Websites aus `firebase.json` über Ports Ihrer Testwelt bereitzustellen. Wenn Hosting Anfragen an Functions umschreibt, wählen Sie auch `functions` und die von diesen Funktionen verwendeten Dienste aus.

```js
import { withTestWorld } from 'fireemu/testing';

await withTestWorld(
  { firebaseJson: 'firebase.json', services: ['hosting', 'functions', 'firestore'] },
  async (world) => {
    const url = world.hostingUrl;
    if (!url) throw new Error('The world has no Hosting site');
    await page.goto(url);
  },
);
```

`world.hostingUrl` ist die URL der ersten Website. `world.endpoints.hosting` beschreibt deren Endpunkt. `world.hostingSites` enthält `site` und `url` für jede Website in der Reihenfolge der Konfiguration. Eine Website ohne Namen oder Bereitstellungsziel verwendet die Projekt-ID der Testwelt. Wenn Hosting deaktiviert ist, sind die primäre URL und der Endpunkt `undefined`. Die Liste der Websites ist leer.

Parallele Browser-Worker können dieselbe Projekt-ID und dieselben relativen API-Pfade verwenden. Jeder Worker öffnet die URL seiner eigenen Testwelt. Ein Reset stellt die bei der Erstellung gespeicherten öffentlichen Dateien sowie die Regeln für Firestore und Realtime Database wieder her. Lesen Sie die Hosting-URLs nach jedem Reset erneut.

## Die Uhr in Kalendereinheiten verstellen

`world.clock.advance` akzeptiert auch eine Zeitspanne nach ISO 8601 oder Kalendereinheiten. `world.clock.to` stellt die Uhr auf den Anfang oder das Ende eines Tages, Monats oder Jahres. Für Kalendereinheiten und solche Zielpunkte gilt `timeZone`, ohne diese Angabe die Einstellung `scheduler.defaultTimeZone` der Welt und sonst UTC. Die Regeln stehen unter [Zeit und geplante Funktionen](../time/#die-uhr-um-eine-zeitspanne-oder-auf-eine-kalendergrenze-stellen).

```js
await world.clock.advance({ months: 1 });                      // Aus dem 31. Januar wird der 28. oder 29. Februar
await world.clock.advance('PT36H');                            // Tatsächlich verstrichene Zeit
await world.clock.advance({ days: -3 }, { allowBackwards: true });
await world.clock.to('endOfMonth');                            // 23:59:59.999999 Uhr Ortszeit
await world.clock.to('startOfMonth', { duration: { months: 1 }, timeZone: 'Asia/Tokyo' });
```

Eine Zahl steht weiterhin für Millisekunden. Objekte der Form `{ seconds }` oder `{ millis }` verstellen die Uhr wie bisher um die exakte Zeitspanne. Kalendereinheiten lassen sich nicht mit `millis` kombinieren und müssen alle dasselbe Vorzeichen haben. `world.clock.to` verwendet `clock:set`. Für ein Ziel vor der aktuellen Zeit ist daher `allowBackwards: true` erforderlich. `advanceAndSettle` akzeptiert dieselben Zeitspannen und unterstützt unter anderem die Optionen `timeZone` und `allowBackwards`. Die Optionen `timeZone` und `allowBackwards` gelten bei `advance` und `advanceAndSettle` für ISO-8601-Zeichenketten und Objekte mit Kalendereinheiten. Zahlen und die Formen `{ seconds }` und `{ millis }` weisen diese Optionen zurück.

## Die Uhr vorstellen und auf Arbeit warten

`world.clock.advanceAndSettle(duration, { scope, timeoutSeconds, runTimers })` stellt die Uhr vor, führt fällige virtuelle Timer aus und wartet darauf, dass der Daemon im Leerlauf ist, in dieser Reihenfolge. Der Standard-Scope ist `runnable`, der nicht auf Arbeit wartet, die über die Bewegung hinaus geplant ist. Es wird abgelehnt (Promise-Rejection), wenn die Bewegung fehlschlägt oder das Warten das Zeitlimit überschreitet.

```js
const { clock, timers, idle } = await world.clock.advanceAndSettle({ seconds: 60 });
```

Ein gleichzeitiges `awaitIdle` und eine Uhrbewegung funktionieren ebenfalls, weil ein ausstehendes `awaitIdle` spätere Uhr-Aufrufe derselben Welt nicht aufhält:

```js
await Promise.all([
  world.control('POST', 'sessions/default:awaitIdle', { timeoutSeconds: 20 }),
  world.clock.advance({ seconds: 60 }),
]);
```

`reset()` und `dispose()` brechen ein ausstehendes Warten ab, statt sein Budget abzuwarten. Die Reihenfolgeregeln stehen in der [Anleitung zu Testwelten](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#advance-the-clock-and-wait-for-work).

## Auf ausführbare Arbeit warten

`POST /v1/sessions/default:awaitIdle` akzeptiert `{ "scope": "runnable" }` (seit v0.26.0). In einer Welt:

```js
await world.control('POST', 'sessions/default:awaitIdle', { scope: 'runnable' });
```

- Der Scope `runnable` schließt zukünftige Task-Pläne und zukünftigen Retry-Backoff vom Warten aus. Der Standard-Scope wartet weiterhin auf alle Arbeit.
- Fällige Aufgaben, die durch Raten- oder Parallelitätsgrenzen blockiert sind, und aktive HTTP-Anfragen bleiben ausstehend. Stellen Sie die zutreffende Uhr vor oder warten Sie auf die aktive Arbeit; die Diagnose nennt die wartende Phase und die Frist.
- Es wartet nicht auf beliebige, vom Benutzer erzeugte JavaScript-Timer.

Siehe [Idle-Scopes und Task-Uhren](https://github.com/fireemu/fireemu/blob/main/docs/tasks-idle.md).

## Fixtures für Vitest und Playwright

Erstellen Sie die Welt in einer Fixture, geben Sie jedem Test seine eigene benannte Admin-SDK-App und löschen Sie die App beim Teardown. Löschen Sie die App nach `reset()`, lesen Sie `world.endpoints` erneut und erstellen Sie eine neue App. Die Standard-Admin-App wird prozessweit zwischengespeichert und lässt sich nicht auf eine Welt umleiten.

### Den geerbten Firestore-Host entfernen

Das Firestore-SDK von Firebase Admin gibt `FIRESTORE_EMULATOR_HOST` Vorrang vor `db.settings({ host })`. Führen Sie Vitest und Playwright direkt aus, ohne den Runner in ein äußeres `fireemu exec` zu verpacken, und entfernen Sie den geerbten Host einmal im dedizierten Runner-Prozess, bevor er Worker startet. Zum Beispiel in POSIX-Shells:

```sh
env -u FIRESTORE_EMULATOR_HOST npx vitest run
env -u FIRESTORE_EMULATOR_HOST npx playwright test
```

Die Fixture-Wächter unten scheitern vor dem Verbinden, wenn ein Worker diese Variable noch hat. Ändern Sie nicht aus jedem Test das gemeinsame `process.env`. Wenn ein Test absichtlich einen Emulator-Host in seiner Umgebung behält, führen Sie diesen Test über `world.run()` aus, damit sein Kindprozess die Endpunkte der Welt erhält.

### Fixture-Beispiele

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

Clients, die ihren Emulator-Host aus der Umgebung lesen, etwa Admin Auth, lassen sich über eine benannte App nicht auf eine Welt richten: Führen Sie diesen Code mit `world.run()` aus, das `world.environment` an den Kindprozess übergibt.

## TypeScript

`fireemu/testing` und `fireemu/control` liefern Typdeklarationen für striktes `NodeNext` und die Modulauflösung von Bundlern; importieren Sie die Subpfade direkt, ohne separates Typpaket.

```ts
import { withTestWorld, type TestWorldOptions } from 'fireemu/testing';
import { createControlClient } from 'fireemu/control';

const options = { services: ['auth', 'firestore'] as const } satisfies TestWorldOptions;
const projectId: string = await withTestWorld(options, (world) => world.projectId);

const client = createControlClient({ origin: 'http://127.0.0.1:9000', token: 'your-control-token' });
const response: unknown = await client.request('GET', 'sessions/default');
```

- Ein falsch geschriebener Dienstname, ein nicht unterstützter Uhrmodus oder eine unbekannte Option ist ein Kompilierfehler.
- Eigenschaften von Welt und Client sind schreibgeschützt (readonly), `uiUrl` ist `string | undefined`, und jeder Dienst-Endpunkt ist optional, weil nur die ausgewählten Dienste starten.
- Generische Steueranfragen lösen zu `unknown` auf: Grenzen Sie die Antwort ein, bevor Sie Felder lesen.
- Die Typen belegen keine Laufzeitgrenzen (zum Beispiel braucht `runDue` ein ganzzahliges Budget von 1 bis 10000); der Helfer prüft diese, wenn er läuft.

Details siehe die [Anleitung zu Testwelten](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#typescript-consumers).

## Eine Welt in der UI untersuchen

Die UI ist standardmäßig deaktiviert. Um eine Welt in der Debug-UI zu untersuchen, übergeben Sie `ui: true` an `createTestWorld()` und öffnen Sie `world.uiUrl`.

- Jede aktivierte Welt erhält einen eigenen Loopback-Port und teilt ihren Live-Zustand von Firestore, Auth, Storage und Functions.
- Halten Sie die Welt am Leben, während Sie sie untersuchen; `dispose()` stoppt auch ihre UI.
- Lesen Sie nach `reset()` erneut `world.uiUrl` und öffnen Sie die Seite neu.

Ein interaktives Beispiel finden Sie unter [Testwelten](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#inspect-a-world-in-the-ui).

## Export und Import

Aktivieren Sie `hub: true`, um eine Testwelt zu exportieren und ihre Daten in eine frische zu importieren; siehe [Unabhängige Testwelten exportieren](../data/#unabhängige-testwelten-exportieren).

## Kosten des Snapshots

Eine Welt kopiert Functions-Quellen, Abhängigkeits-Links und `NODE_PATH`-Wurzeln nur, wenn sie Functions lädt: `services` weggelassen (die Standardauswahl enthält Functions, wenn die Konfiguration eine Quelle oder ein Manifest nennt) oder mit `functions` oder `functions:<codebase>` in der Liste.

Eine Auswahl wie `['auth', 'firestore']` überspringt all das und entfernt den Abschnitt Functions aus der als Snapshot gesicherten Konfiguration. Auth-Blocking-Funktionen und ereignisgesteuerte Funktionen laufen im Functions-Dienst, wählen Sie also `functions`, um sie zu verwenden.

`world.snapshotStats` meldet, was jede Kopie gekostet hat:

- `initial` ist die einmalige Kopie Ihrer Eingaben.
- Jeder Eintrag in `generations` ist die Kopie, die eine Generation gestartet hat (Erstellung und jedes `reset()`).
- Jeder hat `files`, `directories`, `symlinks`, `bytes`, `method` (`copy`, `clone` oder `mixed`) und `elapsedMs`.

Setzen Sie `FIREEMU_TEST_WORLD_STATS=1`, um pro Kopie eine Zeile auf stderr auszugeben.

```js
const { initial, generations } = world.snapshotStats;
console.log(initial.functions, initial.files, initial.elapsedMs, generations.at(-1).method);
```

Generationskopien verwenden Copy-on-Write, wo die Plattform es unterstützt (macOS `cp -c` auf APFS; Reflinks auf Linux-Dateisystemen, die sie erlauben), und sonst eine einfache Kopie; jede Generation besitzt in beiden Fällen ihre eigenen Bytes. Siehe [was ein Snapshot kopiert](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#what-a-snapshot-copies-and-what-it-costs).

## Snapshots und Zeitlimits

| Option | Begrenzt | Standard |
| --- | --- | --- |
| `snapshotTimeoutMs` | Den anfänglichen Eingabe-Snapshot und die Vorbereitung der ersten Generation zusammen sowie jede Reset-Vorbereitung einzeln. Akzeptiert Ganzzahlen von 1 bis 2.147.483.647. | 60.000 ms |
| `startupTimeoutMs` | Die Bereitschaft des Daemons nach der Vorbereitung. | 60.000 ms |

- Zeitüberschreitung oder Abbruch stoppt das Kopieren von Dateien, wartet, bis aktive Kopien abgeschlossen sind, und räumt unvollständige Snapshots auf, einschließlich schreibgeschützter kopierter Verzeichnisse.
- Konfigurationsdateien müssen zu regulären Dateien aufgelöst werden. Kopierte Bäume können Verzeichnisse, reguläre Dateien und unterstützte Abhängigkeits-Links enthalten, andere Dateisystemtypen werden aber abgelehnt.
- Überschreitet die Vorbereitung das Zeitlimit, verengen Sie ungenutzte Abhängigkeiten oder erhöhen Sie `snapshotTimeoutMs`; das Erhöhen des Bereitschafts-Zeitlimits hilft nicht.
- Das Zurücksetzen beendet zuerst die vorherige Generation, sodass eine fehlgeschlagene Vorbereitung den alten Daemon nicht weiterlaufen lässt.

### Abhängigkeits-Snapshots und globaler NODE_PATH

Functions-Welten sichern lokale Quellen und Abhängigkeiten als Snapshot, sodass Änderungen des Aufrufers das Zurücksetzen nicht beeinflussen. Ein vorhandener `NODE_PATH` wird standardmäßig geleert (seit v0.27.0), während gewöhnliche Umgebungsvariablen des übergeordneten Prozesses weiterhin vererbt werden. Lokale Quellen und übergeordnete `node_modules` werden weiterhin als Snapshot gesichert.

- Um globale Pfade zu behalten, übergeben Sie `env: { ...process.env }` oder einen eingegrenzten `env.NODE_PATH` mit nur den Verzeichnissen, die Sie brauchen. Ein Umgebungsobjekt, das `NODE_PATH` enthält, ist ein Opt-in, auch wenn es mit einem Spread erzeugt wurde.
- `nodePathExcludes` lässt genaue Namen ungenutzter Pakete aus, einschließlich Scoped-Namen, bevor ihren Links gefolgt wird. Fehler bei erforderlichen Abhängigkeiten bleiben Fehler.
- Vor v0.27.0 kopierten Welten auch geerbte `NODE_PATH`-Verzeichnisse, einschließlich verlinkter globaler Entwicklungs-Repositorys, sodass ein ungenutztes verlinktes Repository den Start verlangsamen oder das Kopieren scheitern lassen konnte, bevor die Tests begannen. Übergeben Sie in diesen Versionen für rein lokale Abhängigkeiten `env: { ...process.env, NODE_PATH: '' }`.

Siehe [Grenzen der Abhängigkeits-Snapshots](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#create-parallel-worlds).

## Siehe auch

- [Zeit und geplante Funktionen](../time/)
- [Daten exportieren und importieren](../data/#unabhängige-testwelten-exportieren)
- [Emulator UI](../ui/)
- [Cloud Functions](../../products/functions/)
