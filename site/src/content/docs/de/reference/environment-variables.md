---
title: Umgebungsvariablen
description: Schlagen Sie die Umgebungsvariablen nach, die Fireemu für Ihren Befehl und für Functions-Code setzt, sowie die, die es liest.
---

Diese Liste stammt aus dem Quellcode der Binärdatei `fireemu` und des npm-Pakets. Alles, was hier nicht aufgeführt ist, ist ein Implementierungsdetail und kann sich ändern.

## Von `fireemu exec` gesetzt

`exec` übergibt seinem Befehl die Variablen der laufenden Emulatoren und sonst nichts Eigenes. Namen und Formate folgen dem, was `firebase emulators:exec` schreibt.

Variablen für Emulatoren, die nicht ausgewählt sind, bleiben so, wie Ihre Umgebung sie hatte, sodass ein fehlender Emulator ein SDK nie versehentlich in die Produktion schickt. `exec` gibt für jede eine Warnung aus, und `--deny-inherited-emulator-env` lehnt den Lauf stattdessen ab (siehe [Geerbte Emulator-Variablen](../cli/#inherited-emulator-variables)).

| Variable | Wert | Wann |
|---|---|---|
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_FIRESTORE_EMULATOR_ADDRESS` | `host:port` von Firestore | Firestore läuft |
| `FIREBASE_AUTH_EMULATOR_HOST` | `host:port` von Authentication | Authentication läuft |
| `FIREBASE_STORAGE_EMULATOR_HOST` | `host:port` von Storage | Storage läuft |
| `STORAGE_EMULATOR_HOST` | Storage-URL (`http://host:port`) für die Cloud-Storage-Clientbibliotheken. Bei Storage-App-Check `enforced` und `appCheck.storageServerRequests` auf `"capability"` trägt sie zusätzlich eine Admin-Capability pro Lauf (siehe [App Check](../../products/app-check/)) | Storage läuft |
| `FIREBASE_DATABASE_EMULATOR_HOST` | `host:port` der Realtime Database | Die Realtime Database läuft |
| `PUBSUB_EMULATOR_HOST` | `host:port` von Pub/Sub | Pub/Sub läuft |
| `CLOUD_EVENTARC_EMULATOR_HOST` | Eventarc-URL (`http://host:port`) | Functions laufen |
| `CLOUD_TASKS_EMULATOR_HOST` | `host:port` von Cloud Tasks | Functions laufen |
| `FIREEMU_FUNCTIONS_HOST` | `host:port` von Functions | Functions laufen |
| `FIREEMU_APP_CHECK_EMULATOR_HOST`, `FIREEMU_APP_CHECK_JWKS_URL` | Host für den App-Check-Austausch und JWKS-URL | App Check ist verfügbar (siehe [App Check](../../products/app-check/)) |
| `FIREBASE_EMULATOR_HUB` | `host:port` des Emulator Hub | Der Hub läuft |
| `FIREBASE_LOGGING_EMULATOR_HOST` | `host:port` des Logging-Emulators | Der Logging-Emulator läuft |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | Die Projekt-ID | Immer |
| `FIREBASE_CONFIG` | Aus der Projekt-ID gesetzt | Sofern Ihre Umgebung sie nicht bereits hat |
| `FIREEMU_CONTROL_URL` | Basis-URL der Steuer-API, endet auf `/v1/` | Immer |
| `FIREEMU_CONTROL_TOKEN` | Bearer-Token für die Steuer-API; wird von `fireemu/testing` und von den Skripten in [Cloud Firestore](../../products/firestore/#fail-a-ci-job-on-a-missing-index) verwendet | Immer |

`fireemu up` setzt keine Variablen in Ihrer Shell. Seine Startausgabe gibt jedes `host:port` aus (zum Beispiel `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`), und die Emulator UI zeigt sie auf der Seite „Overview“ unter „Environment for SDKs“.

## Für Functions-Code gesetzt

Eine Functions-Codebasis läuft mit denselben Emulator-Host-Variablen für die laufenden Dienste sowie mit `FUNCTIONS_EMULATOR=true`, den Variablen der Projekt-ID und `FIREBASE_CONFIG`.

Nur eine kurze Liste von Variablen wird vom Daemon geerbt. Credentials werden absichtlich zurückgehalten: `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN` und `CLOUDSDK_*` erreichen den Funktionscode nicht. Die Variablen `FIREEMU_RUNNER*` sind intern.

## Von Fireemu gelesen

| Variable | Wirkung |
|---|---|
| `FIREEMU_BINARY_PATH` | Der Launcher `fireemu` führt diese Binärdatei statt der des Plattformpakets aus. Für eine Plattform ohne veröffentlichte Binärdatei oder für eine selbst gebaute Binärdatei. |
| `FIREEMU_NODE` | Absoluter Pfad der Node.js-Programmdatei, die Functions-Codebasen ausführt. Wird abgelehnt, wenn es kein absoluter Pfad zu einer ausführbaren Datei ist. Ohne sie sucht Fireemu `node` in den Verzeichnissen von `PATH` (und denen von Volta, siehe `VOLTA_HOME`). |
| `FIREEMU_RUNNER_NODE`, `FIREEMU_RUNNER_PYTHON` | Pfad eines Functions-Runner-Skripts (`index.mjs`, `runner.py`), das statt des mitgelieferten verwendet wird. Ein Fehler, wenn die Datei nicht existiert. |
| `FIREEMU_WORKER_THREADS` | Anzahl der asynchronen Worker-Threads, 1 bis 64. Standard: die Anzahl der verfügbaren Kerne, höchstens 4. |
| `FIREEMU_MAX_BLOCKING_THREADS` | Obergrenze blockierender Threads, 1 bis 512. Standard: 64. |
| `FIREEMU_CONTROL_TOKEN` | `fireemu doctor --connect` sendet es als Bearer-Token an die Steuer-API. In `fireemu exec` ist es bereits gesetzt. |
| `FIREBASE_CONFIG` | Findet `exec` sie gesetzt, behält es Ihren Wert, statt einen aus der Projekt-ID zu schreiben. |
| `PATH`, `VOLTA_HOME` | Wo nach Node.js gesucht wird, wenn `FIREEMU_NODE` nicht gesetzt ist. |
| `HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA` | Wo der Cache des Signierschlüssels der Authentication-Sitzung liegt (ein Verzeichnis nur für den Eigentümer); ohne verwendbaren Cache wird der Schlüssel bei jedem Start im Arbeitsspeicher erzeugt. |
| `SUDO_UID` | Läuft Fireemu als root, ist der hier genannte Benutzer ebenfalls ein vertrauenswürdiger Eigentümer gefundener Konfigurationsdateien. Siehe [Prüfung des Dateieigentümers](../../guides/configuration/#file-ownership-checks). |
| `ComSpec` | Unter Windows die Shell, die die Skriptform `fireemu exec "script"` ausführt. Standard: `cmd.exe`. |
| `FIREEMU_TRACE_WEBCHANNEL`, `FIREEMU_TRACE_STORAGE` | Jeder Wert gibt einen Anfrage-Trace (`[webchannel] ...`, `[storage] ...`) auf der Standardfehlerausgabe aus, um ein Client-Problem zu diagnostizieren. Nicht für reguläre Läufe. |
