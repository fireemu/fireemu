---
title: Einschränkungen
description: Prüfen Sie, was Fireemu nicht unterstützt und was kein lokaler Emulator nachbilden kann, bevor Sie sich auf ein lokales Ergebnis verlassen.
---

Fireemu bildet noch nicht jedes Feature und jedes Verhalten der Firebase-Produktion nach. Dies sind die wichtigsten Einschränkungen; die Liste ist nicht vollständig. Einzelne APIs prüfen Sie im [Capability-Manifest](../#capability-manifest) oder mit:

```sh
npx fireemu capabilities
```

## Nicht unterstützte Produkte

App Hosting und Data Connect werden derzeit nicht unterstützt. Die Unterstützung von Firebase Extensions ist nicht geplant.

## Teilweise unterstützte Produkte

- **Realtime Database.** Wird bereitgestellt und nur für die aufgezeichneten Fälle gegen die Produktion verifiziert (siehe [Verifikation gegen die Produktion](../#verifikation-gegen-die-produktion)). Eine breitere Kompatibilität mit der Produktion ist nicht verifiziert, und es gibt keinen Paritätsanspruch gegenüber dem offiziellen Emulator. Details: [Realtime Database](../../products/realtime-database/#unterschiede-zum-offiziellen-emulator) und die Liste unten.

## Nicht unterstützte Features

### Cloud Firestore

- Die Enterprise-Pipeline-API unterstützt nur eine begrenzte Teilmenge von Leseoperationen (siehe [Enterprise-Pipelines](../../products/firestore/#enterprise-pipelines)).
- Die Enterprise-Textsuche bietet eine endliche lokale lexikalische Suche und explizite Steuerung des Index-Builds. Analyse und Ranking sind Näherungen; `productionExact` lehnt nicht beobachtete Suchsemantik ab.

### Authentication

- Anmeldeabläufe, die mit externen Identitätsanbietern kommunizieren, der gehostete Austausch von Autorisierungscodes sowie die Live-Schlüsselermittlung und -rotation werden nicht unterstützt.
- Die lokale Verifikation konfigurierter signierter OIDC-/SAML-Assertions wird vom strikten Pfad für signierte Assertions unterstützt, mit den öffentlichen Schlüsseln aus `auth.idpSigners` oder den konfigurierten Zertifikaten des SAML-Anbieters.
- Die endlichen SAML-Prüfungen decken vorhandene Felder für Status, Ziel (Destination), Aussteller (Issuer), Zielgruppe (Audience) und Gültigkeit sowie Antworten auf bekannte, vom Daemon ausgestellte Anfragen ab. Fehlende Felder, nicht parsebare Zeitangaben und andere nicht aufgezeichnete Kombinationen bleiben unbeobachtet.

### Cloud Storage

- Die Verifikation der Signatur einer signierten URL oder einer POST-Policy (Ablaufzeit und Bedingungen werden geprüft).
- Objekt-ACLs außer dem Lesezugriff für `allUsers`, IAM und öffentlicher Zugriff auf Bucket-Ebene.
- Objektkomposition (`compose`) und Benachrichtigungskonfiguration.
- **Aufgezeichnetes Storage-CORS unter `strict`.** `conformance/storage-strictness-obs/recordings/run-2.json` zeichnet Antworten der JSON-API für Metadaten, Medien, Buckets, Auflistungen und UBLA-ACL-Fehler, Upload-Preflights, die Initiierung fortsetzbarer Uploads (resumable), Abbrüche und Lesezugriffe auf abgebrochene Sitzungen auf, jeweils mit fehlender, leerer und konfigurierter Bucket-CORS. Strict verwendet die aufgezeichneten CORS-Werte, ohne `productionExact` zu verlangen; das Profil `emulator` behält sein bisheriges Verhalten bei. Das Beibehalten der Groß-/Kleinschreibung angeforderter Header, das Verhalten von UBLA-PATCH und -Umschaltung sowie die Anwendung der Expose-Listen auf andere Antworten sind nicht aufgezeichnete Annahmen. Beim Erstellen werden die aufgezeichnete Region und die deaktivierten Soft-Delete-Hinweise akzeptiert, ohne diese Dienste zu modellieren. Lokale Tests decken den UBLA-Export/-Import und leere erstellte Buckets ab. Siehe [Bucket-CORS](../../products/storage/#bucket-cors).

### Realtime Database

- Nur für die aufgezeichneten Fälle gegen die Produktion verifiziert (siehe [Verifikation gegen die Produktion](../#verifikation-gegen-die-produktion)); eine breitere Kompatibilität mit der Produktion ist nicht verifiziert, und es gibt keinen Paritätsanspruch gegenüber dem offiziellen Emulator. Der Vergleich beschränkt sich auf aufgezeichnete Fälle des offiziellen Emulators.
- Die aufgeführten nicht unterstützten Syntax- und Auswertungsfälle (Konstrukte regulärer Ausdrücke, Groß-/Kleinschreibungs-Abbildungen und die übrigen dort genannten Unterschiede) werden beim Laden der Rules abgelehnt oder erzeugen Rule-Fehler. `query.endBefore`, `query.isOrderByChild()`, die Namen `OrderByKey`, `OrderByValue` und `OrderByPriority`, `http.encodeURL()`, Methodenlesezugriffe ohne Aufruf und ternäre Aufrufziele werden so geladen und ausgewertet, wie es für die Produktion aufgezeichnet wurde.
- Die acht aufgezeichneten Muster, die der offizielle Emulator wegen seiner Ressourcengrenze bei der Determinisierung ablehnt, werden auch von Fireemu beim Laden von Rules abgelehnt, selbst in nicht ausgewerteten Ausdruckszweigen. Das belegt weder eine vollständige Äquivalenz bei regulären Ausdrücken noch eine Äquivalenz mit der Produktion.
- Die Zustellung von Functions-Triggern wurde für eine begrenzte Menge aufgezeichneter Handler und Schreibvorgänge beobachtet; breitere Fälle bleiben unverifiziert.
- Verhalten, das vom offiziellen Emulator übernommen wurde, wo die Produktion nicht beobachtet wurde, kann sich ändern.

Siehe [Realtime Database](../../products/realtime-database/#unterschiede-zum-offiziellen-emulator).

### Cloud Functions

- Trigger für Produkte, für die Fireemu keine Events zustellt, etwa Data Connect (zurückgestellt). Remote-Config-Handler laufen nur über die lokale Injektionsaktion: Eine über die lokale Vorlagenverwaltung von Fireemu veröffentlichte Vorlage löst sie noch nicht aus, obwohl die Veröffentlichungs-Events der Produktion am 2026-11-21 aufgezeichnet wurden.
- Dart-Codebasen sowie der Eingang von Protobuf-CloudEvents außer bei Firestore-Events. Firestore-Events erreichen das Python SDK als Protobuf und Node-Funktionen der 2. Generation unter `strict` als Protobuf.
- Die genaue Form von Storage-Archive-Events bleibt unaufgezeichnet.
- Python-Codebasen stellen HTTP-, Callable-, Firestore-, Pub/Sub-, Storage-, Eventarc-, Realtime-Database-, geplante, Task-Queue- und Auth-Blocking-Funktionen bereit. Sie sehen nur die Echtzeit (keine virtuelle Uhr), laden Änderungen am Anwendungsquellcode neu, ignorieren dabei aber Änderungen an ihrer `venv` und an den Python-Bytecode-Caches, und laufen nur unter macOS und Linux. Starten Sie Fireemu neu, nachdem Sie installierte Abhängigkeiten geändert haben. Die App-Check-Tokens ihrer Callables werden vom Python SDK gegen die Schlüssel des App-Check-Emulators verifiziert (ohne Verbrauch von Limited-Use-Tokens, und eine explizite App-Check-Konfiguration verhindert den Start). Siehe [Cloud Functions (Python)](../../products/functions-python/).

### Cloud Pub/Sub

- Schemas, die Zustellung über BigQuery- und Cloud-Storage-Subscriptions, Exactly-once-Zustellung und Nachrichtentransformationen.
- `UpdateTopic` unterstützt nur die Update-Masken `labels` und, im Profil `emulator`, `message_storage_policy` und `kms_key_name`; `DetachSubscription` ist nicht implementiert.
- `messageStoragePolicy` wird so gespeichert, wie es gesendet wurde, und nie gegen die Regionen von Google Cloud geprüft; das Profil `strict` lehnt es ab.
- Schlüsselnamen und Tags von Topics werden im Profil `emulator` so gespeichert, wie sie gesendet wurden, und nie validiert; das Profil `strict` lehnt sie ab.

### App Check

- Attestierung über Play Integrity, App Attest, DeviceCheck oder reCAPTCHA sowie Replay-Schutz mit Limited-Use-Tokens. Lokales Testen mit Debug-Tokens wird unterstützt.

## Einschränkungen der lokalen Steuerung

- Sitzungen teilen sich Uhren, Rules, Functions und die Admission-Barriere.
- Snapshots werden für die Lebensdauer des Daemons im Arbeitsspeicher gehalten; sie erfassen keine ausstehende Functions-Arbeit.
- `awaitIdle` wartet nicht auf Arbeit am Text-Index und bietet keine kausalen Barrieren über Sitzungen hinweg.

## Unterschiede, die kein lokaler Emulator beseitigt

Eine erfolgreiche lokale Operation garantiert nicht dasselbe Ergebnis in der Produktion. Fireemu bildet weder die echte Quotenabrechnung noch Billing, IAM, Organisationsrichtlinien, regionale oder Netzwerkunterschiede oder Service-Rollouts nach. Die lokale Performance sagt nichts über Latenz oder Durchsatz in der Produktion voraus.

Security Rules und API-Verhalten werden anhand der Dokumentation und anhand von Beobachtungen des tatsächlichen Verhaltens von Firebase implementiert. Änderungen in Firebase oder nicht getestete Bedingungen können Unterschiede einführen, die noch nicht aufgezeichnet wurden.

## Lokale Grenzen

Einige Grenzen gibt es nur in Fireemu, um den Speicherverbrauch zu begrenzen: die [Grenzen für den Firestore-Verlauf](../../products/firestore/#transaktionen-und-verlauf) und das optionale [Limit für gespeicherte Bytes in Storage](../../products/storage/#gespeicherte-bytes-begrenzen).

## Änderungen zwischen Versionen

Konfiguration und Verhalten können sich zwischen Releases ändern. Siehe das [CHANGELOG](https://github.com/fireemu/fireemu/blob/main/CHANGELOG.md).

## Siehe auch

- [Kompatibilitätstabellen](../)
- [Profile und productionExact](../../guides/profiles/)
- [Performance](../performance/)
