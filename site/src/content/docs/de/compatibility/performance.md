---
title: Performance
description: Lesen Sie die gemessene Startzeit, den Speicherbedarf und den Durchsatz im Vergleich zum offiziellen Firestore-Emulator und übertragen Sie sie auf Ihre eigene Test-Suite.
---

Fireemu wird mit dem offiziellen Firestore-Emulator anhand derselben SDK-Workloads verglichen. Beide laufen nacheinander auf demselben Linux-Runner von GitHub Actions, wobei Fireemu das Profil `emulator` verwendet. Der Benchmark prüft außerdem die Ergebnisse jeder Operation.

## Ergebnisse

Diese Ergebnisse stammen aus einem `standard`-Lauf bei Commit `f3b942c`, im Vergleich mit dem Firestore-Emulator, den `firebase-tools` 15.28.2 ausführt, mit JDK 21.0.8. Die Verhältnisse werden aus fünf gemessenen Paaren berechnet; die absoluten Werte hängen von der Umgebung ab.

| Metrik | Offizieller Emulator | Fireemu | Vergleich |
|---|---:|---:|---:|
| Start, bis das SDK Firestore verwenden kann | 3.043 ms | 140 ms | 21,6-mal schneller |
| Leerlaufspeicher mit leerer Datenbank (PSS) | 390 MiB | 11 MiB | Etwa 1/34 des Speichers |
| Spitzenspeicher während eines Durchlaufs (cgroup) | 849 MiB | 79 MiB | Etwa 1/10,7 des Speichers |
| Firestore-Durchsatz über 22 Workloads | — | — | 1,1- bis 5,2-mal höher |

Das 95-%-Konfidenzintervall für das Verhältnis der Startzeiten beträgt [21,4; 21,8]. Für das Verhältnis des Spitzenspeichers (offizieller Emulator geteilt durch Fireemu) beträgt es [10,2; 11,1].

Den Workflow finden Sie in [benchmark.yml](https://github.com/fireemu/fireemu/blob/main/.github/workflows/benchmark.yml), den Benchmark in [`tools/bench/`](https://github.com/fireemu/fireemu/tree/main/tools/bench).

## Die Ergebnisse auf eine Test-Suite anwenden

Verwenden Sie die gemessenen Werte für Start und geladenen Speicher nur, um den Teil Ihres eigenen Workflows abzuschätzen, der diese Engines startet. Füllen Sie diese Vorlage aus einem validierten Lauf und Ihren eigenen Prozesszahlen aus:

| Größe | Baseline | Kandidat |
|---|---:|---:|
| Start bis zur SDK-Nutzbarkeit, Sekunden | gemessene Millisekunden / 1000 | gemessene Millisekunden / 1000 |
| PSS im geladenen Leerlauf, MiB pro Engine | gemessene Bytes / 1048576 | gemessene Bytes / 1048576 |
| Frische Engine-Starts in Ihrem Job | beobachtete Anzahl | beobachtete Anzahl |
| Gleichzeitige Engines auf dem beobachteten Plateau | beobachtete Anzahl | beobachtete Anzahl |

- **Sequenzielle Starts.** Der Beitrag des Starts ist die gemessene Zahl der Sekunden pro Start multipliziert mit der beobachteten Anzahl der Starts.
- **Ein stabiles gleichzeitiges Plateau.** Der Beitrag zum Engine-Speicher sind die gemessenen MiB multipliziert mit der beobachteten Anzahl gleichzeitiger Engines.

Weisen Sie diese Beiträge getrennt von Abhängigkeitsinstallation, Builds, SDK-Setup und Testausführung aus. Sie belegen keine Einsparungen für den gesamten CI-Job; messen Sie den vollständigen Job, wenn Sie diese Aussage treffen wollen.

## Für Contributor: eine Änderung vergleichen

Dieser Abschnitt richtet sich an Personen, die Fireemu selbst ändern. Der Linux-Runner akzeptiert außerdem eine vom Aufrufer bereitgestellte Baseline-Binärdatei von Fireemu. Beide Binärdateien verwenden dasselbe Kompatibilitätsprofil, dieselbe Fixture-Form, dieselbe Dienstauswahl und dieselbe SDK-Installation. Jeder gepaarte Durchlauf startet einen frischen Prozess. Das Manifest hält absolute Binärpfade, SHA-256-Digests, Versionen und Harness-Hashes fest. Ändert sich eine Binärdatei während eines Laufs, sind Ergebnisse ungültig oder schlägt die Bereinigung fehl, wird der Vergleich ungültig.

```sh
python3 tools/bench/bench.py --fireemu /path/to/candidate/fireemu --baseline-fireemu /path/to/baseline/fireemu --sdk-root conformance --tier standard --profile emulator --out .bench-candidate
python3 tools/bench/report.py .bench-candidate
```

Standard bleibt der Vergleich des offiziellen Emulators mit Fireemu, mit Berichtsschema in Version 2. Vergleiche von Binärdateien verwenden Schemaversion 3, die expliziten Bezeichnungen `baseline-fireemu`/`candidate-fireemu` und die Messfelder `baseline_*`/`candidate_*`. Verwenden Sie für eine Performance-Aussage mindestens fünf gemessene Paare frischer Prozesse. Der Vergleich identischer Binärdateien ist eine nützliche Kontrolle; ein Intervall, das 1 enthält, belegt keine Verbesserung.

### Fixture-Formen

`--fixture-shape tiny` wählt skalare Dokumente; `--fixture-shape wide-map` wählt 32 verschachtelte Map-Felder. Die Standard-Fixture behält ihre bisherige Nutzlast. Query-Oracle-Felder und die vollständige SDK-Rücklesevalidierung gelten für jede Form. Vergleichen Sie jede Form getrennt.

### Gemischte Dienste

`--mixed-services` lädt Auth, Storage und Firestore sowohl in der isolierten als auch in der überlappenden Phase. Es führt je Klasse 8 validierte Operationen mit Parallelität 2, einem festen Seed, einer Storage-Operation aus Upload, Rücklesen und Löschen mit 64 KiB sowie echte Auth-Konfigurations-, Hub-Registry- und Firestore-Lese-Probes aus. Der Bericht hält getrennte Verteilungen für Latenz und Durchsatz je Klasse fest.

- Ein gemischter Durchlauf erfordert beobachtete Überlappung zwischen Storage und einem anderen Dienst. Das belegt die Überlappung an der Client-Grenze, nicht die gleichzeitige Ausführung im Server.
- Die Latenz der Storage-Operation umfasst Upload, Rücklesen und Löschen; sie kann Wartezeit in der Warteschlange, Ausführungszeit und Lock-Wartezeit nicht trennen.
- Die bestehenden Grenzen von 16 Handlern und 2 Glob-Slots bleiben die Messbasis.
- Die Wiederherstellung von Permits nach einem Abbruch erfordert Laufzeittests, und RSS/PSS gehören zur vollständig geladenen Engine.
- Für Vergleiche mit dem Offiziellen laden Sie den angepinnten Storage-Emulator vorab mit `pnpm -C conformance exec firebase setup:emulators:storage` herunter.
- Die Startbereitschaft validiert außerdem jeden geladenen Dienst.
- Es nimmt kein Functions-Runner teil.
