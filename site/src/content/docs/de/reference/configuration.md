---
title: Konfigurationsschema
description: Finden Sie das JSON Schema von fireemu.toml und die Anleitung zu jedem Konfigurationsabschnitt der obersten Ebene.
---

`fireemu.toml` wird durch ein JSON Schema beschrieben. Dieselben Einstellungen können als TOML (`fireemu.toml`) oder als JSON (`fireemu.json`) geschrieben werden; welche Datei geladen wird, steht unter [Konfigurationsdateien](../../guides/configuration/).

Fireemu validiert die Datei beim Start, einschließlich Regeln, die das Schema nicht ausdrücken kann, und stoppt mit einem Fehler bei einem Wert, den es nicht akzeptiert. `npx fireemu config show` gibt jeden Schlüssel mit wirksamem Wert und Quelle aus.

## Das Schema abrufen

- [fireemu.schema.json auf dieser Site](../../../spec/config/fireemu.schema.json).
- [spec/config/fireemu.schema.json auf GitHub](https://github.com/fireemu/fireemu/blob/main/spec/config/fireemu.schema.json). Dieselbe Datei existiert an jedem Release-Tag, `https://raw.githubusercontent.com/fireemu/fireemu/v<version>/spec/config/fireemu.schema.json`, und genau das schreibt `fireemu init` einer veröffentlichten Binärdatei in eine neue Datei (ein Build aus dem Quellcode schreibt den Ort `main`).
- `npx fireemu config schema --out fireemu.schema.json` schreibt das in die ausgeführte Binärdatei eingebettete Schema: Die Schlüssel, die sie akzeptiert, sind die Schlüssel, mit denen sie validiert.

## Abschnitte der obersten Ebene

| Abschnitt | Was er konfiguriert | Anleitung |
|---|---|---|
| `schemaVersion` | Immer `1` | |
| `profile`, `productionExact` | Verhalten der Produktion oder des offiziellen Emulators | [Profile und productionExact](../../guides/profiles/) |
| `firebaseJson` | Die `firebase.json`, aus der Ports, Rules, Indizes und Functions gelesen werden | [Konfigurationsdateien](../../guides/configuration/) |
| `firestore` | Edition, API-Modus, Indizes, Grenzen, Verlauf | [Cloud Firestore](../../products/firestore/) |
| `rules` | Quelle der Firestore Security Rules und das Ablehnungsprotokoll für Firestore und Storage | [Security Rules](../../guides/security-rules/) |
| `auth` | `requireClientApiKey` (Standard `false`) lässt das Profil emulator Client-Anfragen ohne API-Schlüssel oder Authorization-Header mit dem 403 des offiziellen Emulators ablehnen; strict bleibt unverändert. Konfiguriert außerdem Anmeldemethoden, Passwortrichtlinie, MFA, Mandanten, Anbieter, Tokens und ob die Security-Rules-Oberflächen von Firestore, Storage und Realtime Database unsignierte Mock-ID-Tokens akzeptieren (`allowUnsignedIdTokens`) | [Authentication](../../products/auth/) |
| `storage` | Storage Security Rules, Objektgröße, Grenzen für gepufferte Bodys und gespeicherte Bytes, Bucket-Deklaration (`undeclaredBuckets`), Bucket-CORS (`cors`) und Schlüssel für signierte URLs (`signedUrlKeys`) | [Cloud Storage](../../products/storage/) |
| `database` | Was eine Realtime-Database-Instanz ohne Rules-Datei erlaubt (`defaultAccess`); `auth.allowUnsignedIdTokens` entscheidet in beiden Profilen, ob ihre Rules Mock-Tokens von `@firebase/rules-unit-testing` akzeptieren | [Realtime Database](../../products/realtime-database/) |
| `hosting` | Zwei Entwicklungsstandards des Profils strict: `cacheControl` (standardmäßig `"none"`, mit `productionExact` fügt `"production"` Dateien `Cache-Control: max-age=3600` hinzu) und `clientCountry` (standardmäßig `"honoured"`, mit `productionExact` `"ignored"`) | [Firebase Hosting](../../products/hosting/#profile) |
| `remoteConfig` | `updateUser` (`email` ist erforderlich, `name` und `imageUrl` sind optional): die Identität, die die lokale Remote-Config-Template-Verwaltung als `updateUser` meldet. Standardmäßig aus | [Remote-Config-Templates](https://github.com/fireemu/fireemu/blob/main/docs/remote-config.md) |
| `functions` | Codebasis, Runner, Anwendungsuhr, nicht bereitgestellte Trigger, eine feste Liste bereitgestellter Funktionen (`manifest`), `isolation` (standardmäßig `"codebase"`, mit `productionExact` `"function"`: ein Runner-Prozess pro Funktion, bei ihrem ersten Trigger gestartet), `taskNameReuse`, `taskDispatchDeadlineSeconds`, `taskRetryDefaults` und `taskRetryBackoff` (Entwicklungsstandards für Cloud-Tasks-Queues, die `productionExact` auf die der Produktion setzt, siehe [Profile](../../guides/profiles/)) sowie `authBlockingToken` (standardmäßig `"emulated"`, mit `productionExact` unter `strict` `"production"`, das ein signiertes Token liefert, das der Python-Runner nach den Regeln des SDK verifiziert; Node-Funktionen erhalten dasselbe Token in der Form der Produktion, verifizieren es aber nicht und verhalten sich daher wie zuvor) | [Cloud Functions](../../products/functions/) |
| `scheduler` | Zeitzone, Nachholen und Überlappung geplanter Funktionen | [Zeit und geplante Funktionen](../../guides/time/) |
| `pubsub`, `eventarc` | Einstellungen für Authentifizierung und Zustellung; `pubsub.restNegativeCache` (standardmäßig `"off"`; `"production"` ist ein ausdrückliches Opt-in unter strict, das das etwa 10 s lang zwischengespeicherte `404` nach einem echten `404` nachbildet, das die Produktion auf einer Verbindung zeigte; `productionExact` wählt es nicht aus) | [Pub/Sub und Eventarc](../../products/pubsub-eventarc/) |
| `appCheck` | Apps, Debug-Tokens und Durchsetzung | [App Check](../../products/app-check/) |
| `daemon` | Ports, Projekt, Startzeit, wie sich die Uhr bewegt (`clock`) | [Zeit und geplante Funktionen](../../guides/time/) |
| `network` | Lauschen außerhalb von Loopback (`allowNonLoopbackHosts`) und die zusätzlichen `Host`-Namen, auf die die Emulatoren antworten (`allowedHosts`, die Schutzmaßnahme gegen DNS-Rebinding) | [CI und Container](../../guides/ci-and-containers/#hostnamen-auf-die-die-emulatoren-antworten) |
| `bind` | Akzeptiert, derzeit ohne Wirkung: Der Daemon bindet die Loopback-Adresse, und `emulators.<name>.host` in `firebase.json` setzt einen Host pro Dienst | [CI und Container](../../guides/ci-and-containers/) |
| `projects` | Ob nur Projekt-IDs mit `demo-` akzeptiert werden (`requireDemoPrefix`) und ob eine Anfrage, die ein anderes Projekt nennt, bedient oder abgelehnt wird (`unknownProjects`) | [Profile und productionExact](../../guides/profiles/) |
| `limits` | Reserviert für Grenzkataloge, Warnungen, Quota-Abrechnung und Plan-Überschreibungen. Kein Mitglied ändert bisher das Verhalten: Jedes wird ohne Wirkung akzeptiert oder akzeptiert nur seinen leeren oder Standardwert und lehnt jeden anderen ab. Die Grenzen von Firestore werden mit `firestore.enforceLimits` umgeschaltet | |
| `events` | Zustellung von Function-Trigger-Events: `maxAttempts` für Funktionen, die mit `retry` deklariert sind (Standard 4); `delivery` akzeptiert nur `exactly-once-test` | [Profile und productionExact](../../guides/profiles/) |
| `trace` | Akzeptiert, derzeit ohne Wirkung | |

Ein Schlüssel, der ohne Wirkung akzeptiert wird, gibt eine Zeile `note:` aus, wenn ein Lauf ihn lädt. Um einen CI-Job an einer solchen Einstellung scheitern zu lassen, führen Sie `fireemu config lint --deny-ineffective` aus. Es listet sie auf und endet mit Status 1, sofern nicht ein Eintrag mit `--allow` jede abdeckt (siehe [`config lint`](../cli/#config-lint)).

## Größengrenzen von Storage

| Schlüssel | Setzt | Standard | Maximum |
|---|---|---|---|
| `storage.maxObjectBytes` | Die maximale Größe eines Objekts. Die Obergrenze für den Request-Body ist dieser Wert plus 4194304 Bytes | 268435456 Bytes | 2143289343 |
| `storage.bufferedBodyBudgetBytes` | Das prozessweite Budget für gepufferte Storage-Request-Bodys | 1073741824 Bytes | 2147483647 |

Beide Werte müssen positive ganze Zahlen sein. Die getrennten Grenzen für gespeicherte Bytes und fortsetzbare Uploads (resumable) stehen unter [Cloud Storage](../../products/storage/).
