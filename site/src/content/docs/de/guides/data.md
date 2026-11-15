---
title: Daten exportieren und importieren
description: Speichern Sie Emulator-Daten, laden Sie sie beim Start und behalten Sie sie zwischen Läufen.
---

Exportieren Sie die Daten eines laufenden Emulators in ein Verzeichnis, importieren Sie sie beim Start und schreiben Sie sie am Ende des Laufs zurück.

## Aus einem laufenden Emulator exportieren

Führen Sie dies in einem anderen Terminal aus, während `fireemu up` läuft:

```sh
npx fireemu emulators:export ./emulator-data
```

`--force` überschreibt ein nicht leeres Ziel.

## Beim Start importieren und beim Beenden exportieren

`--import <dir>` lädt einen Export beim Start. `--export-on-exit` ohne Verzeichnis schreibt den Zustand am Ende des Laufs in dasselbe Verzeichnis zurück:

```sh
npx fireemu exec --import ./emulator-data --export-on-exit -- npm test
```

Was `--import` akzeptiert:

- Ein leeres `--import`-Verzeichnis startet ohne Daten, sodass der erste Lauf keinen separaten Befehl braucht.
- Ein fehlendes Verzeichnis wird abgelehnt, damit ein falsch getippter Pfad keine leere Suite starten kann, es sei denn, dorthin schreibt auch `--export-on-exit`.
- Ein Verzeichnis, das Dateien, aber keine `firebase-export-metadata.json` enthält, wird abgelehnt.
- Importe der Realtime Database werden validiert, bevor ein Produkt Daten installiert. Unter `strict` wird ein einzelnes Surrogat in einem importierten JSON-String-Wert abgelehnt; das Profil `emulator` ersetzt es durch `?`, wie es der offizielle Emulator tut. Ungültige Schlüssel werden in beiden Profilen abgelehnt. Siehe [Import in die Realtime Database](../../products/realtime-database/#export-import-und-snapshots).

Was `--export-on-exit` tut:

- Ein fehlgeschlagenes `--export-on-exit` wird als Zeile `error:` ausgegeben, und der Lauf endet mit Status 1, wenn der Befehl erfolgreich war. Die offizielle CLI warnt nur und endet mit 0; Fireemu weicht ab, damit ein CI-Job, der von den gespeicherten Daten abhängt, nicht ohne sie bestehen kann.
- Das Export-Verzeichnis darf ein Mount-Punkt eines Volumes sein, etwa ein Container-Volume, das unter `/data` eingehängt ist. Ein Mount-Punkt lässt sich nicht durch ein atomares Umbenennen ersetzen, daher wird der Export darin zwischengespeichert und an Ort und Stelle verschoben, wobei die alte `firebase-export-metadata.json` zuerst verschwindet und die neue zuletzt eintrifft. Dieses Ersetzen ist nicht atomar: Ein unterbrochener Export hinterlässt ein Verzeichnis ohne das Manifest, das `--import` ablehnt, statt einen Teil davon zu laden.
- Jedes andere Verzeichnis wird weiterhin atomar ersetzt.

## Wohin exportieren

Bevor Sie einen persistenten Lauf starten, prüfen Sie das Ziel, ohne Verzeichnisse anzulegen oder Berechtigungen zu ändern:

```sh
npx fireemu doctor --export-dir "$HOME/.local/share/fireemu/emulator-data"
```

Auf Unix-ähnlichen Systemen werden das Ziel und jedes vorhandene übergeordnete Verzeichnis auf Eigentümer und Berechtigungen geprüft, einschließlich des Home-Verzeichnisses. Jedes muss Ihnen oder root gehören und darf für andere Benutzer nicht beschreibbar sein. Die Ausnahme ist ein Verzeichnis, das root gehört und das Sticky-Bit hat, etwa `/tmp` (unter macOS ist `/tmp` ein Link, der root gehört, auf `/private/tmp`, dem gefolgt wird).

- **Gemeinsam genutzte Verzeichnisse.** In einem Sticky-Verzeichnis können andere Benutzer Einträge anlegen, Ihre aber nicht umbenennen oder entfernen, daher funktioniert `--export-on-exit /tmp/emulator-data`. Ein anderer Benutzer kann den Namen aber zuerst belegen, wodurch der Export abgelehnt wird; auf einem gemeinsam genutzten Rechner ist ein eigenes dediziertes Verzeichnis daher die zuverlässigere Wahl. Unterhalb von `/tmp` muss ein bereits vorhandenes Export-Verzeichnis Ihnen gehören und für andere Benutzer nicht beschreibbar sein (`chmod 700`).
- **Abgelehnt.** Ein Verzeichnis, das andere Benutzer ohne Sticky-Bit beschreiben können, oder das Verzeichnis eines anderen Benutzers.
- **Symlinks.** Jeder Symlink auf dem Export-Pfad wird geprüft. Ihm wird nur gefolgt, wenn er root gehört oder wenn er Ihnen gehört und in einem Verzeichnis liegt, das nur Sie (oder root) beschreiben können, sodass ein Link, den ein anderer Benutzer in `/tmp` anlegt, nie verfolgt wird. `..` unmittelbar nach einem Symlink wird abgelehnt. Das Verzeichnis, das einen Link enthält, muss dieselben Prüfungen bestehen wie ein übergeordnetes Verzeichnis (ein Volume, das Eigentümerschaft durchsetzt, kein ACL-Eintrag für andere Benutzer).
- **Wann die Prüfungen laufen.** `--export-on-exit` prüft, bevor der Daemon oder der Kindbefehl startet, und validiert beim Exportieren erneut, da sich Berechtigungen ändern können. Es hält das übergeordnete Verzeichnis des Export-Verzeichnisses vom Preflight bis zum Ende des Laufs geöffnet, sodass nichts, was dazwischen umbenannt oder verlinkt wird, verfolgt wird.
- **Volume-Mounts.** Das Ziel eines Volume-Mounts muss beschreibbar sein, auch wenn sein übergeordnetes Verzeichnis es nicht sein muss.
- **Gruppenbeschreibbare Dateien.** Die Konfigurationserkennung erlaubt gruppenbeschreibbare Dateien für Setups mit privater Gruppe, aber die Veröffentlichung eines Exports behält ihre strengeren Sicherheitsregeln für das Aufräumen bei.

### macOS

- **ACLs.** Ein übergeordnetes Verzeichnis mit einer ACL wird abgelehnt, wenn die ACL einen `allow`-Eintrag für jemand anderen als den Eigentümer, root oder den Benutzer enthält, der den Export ausführt, unabhängig von den Berechtigungen, die der Eintrag zeigt (der Kernel gewährt Rechte, die `ls -le` nicht auflistet). `deny`-Einträge werden akzeptiert, sodass ein Standard-Home-Verzeichnis (das `group:everyone deny delete` trägt) und die Ordner darunter funktionieren.
- **Eine ACL-Ablehnung beheben.** Wird ein Export wegen einer ACL abgelehnt, nennt die Meldung den Eintrag; entfernen Sie ihn (`chmod -a`) oder exportieren Sie in ein anderes Verzeichnis, zum Beispiel eines unter `$TMPDIR`. Prüfen Sie ein übergeordnetes Verzeichnis mit `/bin/ls -led <directory>`.
- **Volumes, die Eigentümerschaft ignorieren.** Ein Ziel auf einem Volume, das Eigentümerschaft ignoriert (exFAT- und FAT-Sticks und -Karten oder ein externes APFS-Volume mit eingeschaltetem „Eigentümer auf diesem Volume ignorieren“), wird abgelehnt, weil Eigentümer und Modus seiner Verzeichnisse nicht zeigen, wer sie ändern kann; exportieren Sie auf ein Volume, das Eigentümerschaft durchsetzt.
- **Volumes ohne atomares Umbenennen.** Ein Volume ohne atomares Umbenennen von Verzeichnissen (exFAT, FAT, manche Netzwerk-Dateisysteme) kann einen Export ebenfalls nicht veröffentlichen: Verwenden Sie ein Verzeichnis auf einem APFS-Volume.

### Windows

`emulators:export` und `--export-on-exit` sind derzeit nicht verfügbar. Der Import und die übrigen Emulatoren funktionieren.

## Unabhängige Testwelten exportieren

In einer [Testwelt](../test-worlds/) aktiviert `hub: true` einen privaten Hub für den vorhandenen CLI-Exportbefehl der Welt. Verwenden Sie einen absoluten, vom Aufrufer verwalteten Export-Pfad außerhalb von `world.directory`:

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

- Übergeben Sie `--project` ausdrücklich.
- Der Helfer besitzt den vom Betriebssystem zugewiesenen Port und den privaten Locator des Hubs; Welten desselben Projekts bleiben unabhängig.
- Verwenden Sie für eine Entwicklungs-Binärdatei ihren absoluten Pfad sowohl für `binaryPath` als auch für den Exportbefehl.
- Importe werden bei der Erstellung als Snapshot gesichert, sodass spätere Änderungen am ursprünglichen Export das Zurücksetzen nicht beeinflussen.
- Exporte außerhalb des Welt-Verzeichnisses bleiben nach dem Dispose in der Verantwortung des Aufrufers.

Siehe die [vollständige Anleitung zu Export und Import](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#export-and-import-test-data).

## Was ein Export bewahrt

| Bewahrt | Nicht bewahrt |
| --- | --- |
| Auth-Benutzer und Passwort-Credentials | App-Check-Zustand |
| Firestore-Dokumente | Virtuelle Uhren |
| Storage-Bytes und Metadaten | Arbeitsspeicher der Functions-Prozesse |
| Daten der Realtime Database | Die Gültigkeit zuvor ausgestellter Tokens |

## Siehe auch

- [Testwelten](../test-worlds/)
- [CLI-Referenz](../../reference/cli/)
- [Realtime Database](../../products/realtime-database/#export-import-und-snapshots)
- [Fehlerbehebung](../troubleshooting/)
