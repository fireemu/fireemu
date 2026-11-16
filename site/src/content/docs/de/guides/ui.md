---
title: Emulator UI
description: Prüfen und verwalten Sie Daten, Functions, Entscheidungen der Security Rules und die Uhr im Browser.
---

`fireemu up` stellt die Emulator UI unter `http://127.0.0.1:4000/ui/` bereit. Verwenden Sie sie, um Daten zu durchsuchen und zu ändern, Funktionen auszuführen, Entscheidungen der Security Rules zu lesen und die Uhr zu bewegen.

## Die UI öffnen

```sh
# Another port
npx fireemu up --ui-port 4001

# No UI
npx fireemu up --ui-port 0

# exec starts no UI unless asked
npx fireemu exec --ui -- npm test
```

Ist der Standardport belegt, startet `up` ohne die UI; prüfen Sie die Startausgabe.

## Was sie zeigt

| Seite | Was Sie tun können |
| --- | --- |
| **Overview** | Projekt, Version, virtuelle Uhr (eingefroren oder der Echtzeit folgend) und laufende Dienste sehen sowie die `Host`-Namen, auf die die Emulatoren antworten: die eingebauten Namen, die Einträge, die Sie mit `network.allowedHosts` hinzugefügt haben, und ob Namen aus einem einzelnen Label erlaubt sind. |
| **Authentication, Firestore und Storage** | Benutzer, Dokumente und Objekte durchsuchen und verwalten. Die Seite Authentication listet außerdem die ausstehenden E-Mail-Aktionscodes (mit ihren Links) und SMS-Codes auf, alle paar Sekunden aktualisiert, solange der Tab sichtbar ist, für einen Anmelde- oder Verifizierungsablauf, den Sie von Hand im Browser verfolgen. |
| **Functions** | Registrierte Funktionen mit der Laufzeit jeder einzelnen sehen (Node.js oder Python und das `runtime`, das Ihre `firebase.json` deklariert), ihre Trigger, Aufrufergebnisse und Logs sowie den Laufzeitstatus: ausstehende, laufende, auf eine Wiederholung wartende oder in den Dead-Letter-Bereich gelegte Arbeit, Auth-Events, die zurückgehalten werden, während die Event-Warteschlange voll ist, laufende Aufgaben, den Zustand des Runners jeder Codebasis und die Exporte, die der Runner gefunden und nicht bereitstellen konnte. Eine geplante Funktion sofort ausführen oder die Uhr zu ihrem nächsten Vorkommen vorstellen. |
| **Hosting** | Die von Fireemu bereitgestellte Site, ihre lokale URL, das öffentliche Verzeichnis (mit einer Warnung, wenn es beim Start nicht existierte) sowie die Rewrites, Redirects und Header in der Reihenfolge ihrer Anwendung sehen. Die Seite liest Ihre `firebase.json`; sie zeichnet keine Anfragen auf. |
| **Realtime Database** | Die Daten an einem Pfad durchsuchen, sie als lokaler Administrator ersetzen, patchen oder löschen, die Rules der Instanz lesen und ersetzen und eine anonyme Anfrage ausführen, um zu sehen, wie die Rules sie beantworten. |
| **Alerts** | Firebase-Alerts an Funktionen veröffentlichen, die auf sie lauschen. |
| **Rules** | Die neuesten 100 nachverfolgten Entscheidungen der Firestore Security Rules mit begrenzten Ausdrucksergebnissen lesen. Die Nachverfolgung beginnt mit der UI oder dem ersten lesenden Zugriff auf die Steuer-API; ein neuer Regelsatz löscht den Verlauf. Zu den Grenzen der Diagnose siehe [Security Rules](../security-rules/). |
| **App Check** | Registrierte Apps und Debug-Tokens sehen. |
| **Runtime** | Die virtuelle Uhr vorstellen oder mit **Allow moving backwards** zurückstellen und einen Fault-Plan installieren (siehe unten). |

## Einen Fault-Plan installieren

Auf der Seite „Runtime“ unter **Fault plan**:

1. Wählen Sie ein Rezept zum Wiederholen eines Functions-Events, zur doppelten Zustellung, zum Verzögern oder Überschreiten des Zeitlimits eines Versuchs oder zum Scheitern der ersten Versuche und geben Sie seine Parameter ein.
2. Wählen Sie **Fill plan**. Es legt den Plan in den JSON-Editor; es installiert ihn nicht.
3. Prüfen oder bearbeiten Sie das JSON und wählen Sie **Install**, um ihn auf die ausgewählte Sitzung anzuwenden.

Ein parsebarer Plan bietet außerdem kopierbare Snippets für `fireemu/testing` und die Steuer-API, um denselben Plan aus einem Test zu installieren. **Clear** entfernt den installierten Plan.

## Datenbankauswahl und Reproduktion von Abfragen

### Eine Firestore-Datenbank auswählen

Das Feld für die Firestore-Datenbank bietet die bekannten Datenbanken des aktuellen Projekts und zuletzt geöffnete Namen an. Sie können auch direkt einen Namen eingeben und **Open database** wählen.

- Der Katalog wird erneut geprüft, wenn sich die Auswahl ändert; **Refresh** prüft ihn, ohne die Auswahl zu ändern.
- Eine fehlgeschlagene Katalogabfrage wird getrennt von einer Datenbank gemeldet, die in einer erfolgreichen Katalogantwort fehlt.
- Zuletzt verwendete Namen sind auf die ausgewählte Sitzung und das ausgewählte Projekt begrenzt und werden nur im Session Storage des Browser-Tabs gehalten.

### Eine Abfrage mit dem Node.js SDK reproduzieren

Der Abschnitt **Node.js SDK reproduction** des Abfragefensters erzeugt ein Skript mit dem Low-Level-Firestore-Node.js-SDK. Das bewahrt typisierte Abfragewerte, einschließlich 64-Bit-Ganzzahlen und Zeitstempel-Nanosekunden.

Installieren Sie die im Skript aufgeführten Pakete, speichern Sie es als `query.cjs` und setzen Sie `FIRESTORE_EMULATOR_HOST` auf Ihren lokalen Firestore-Port, bevor Sie es ausführen. Das Skript lehnt Endpunkte außerhalb von Loopback ab. Wie Konsolenabfragen verwendet es lokalen Administratorzugriff und testet keine Security Rules für Clients.

Abfrageentwürfe werden pro Datenbank gehalten. Firestore-Ansichten aktualisieren betroffene Dokumente anhand ihrer geänderten Pfade, mit einer Aktualisierung der Mitgliedschaft, wenn einer Zeile eine verwendbare Aktualisierungszeit fehlt.

## Verbindungsprüfungen und teilbare Functions-Filter

### Verbindungs-Badge

Das Verbindungs-Badge in der Kopfzeile beschreibt Antworten der Steuer-API, nicht den Zustand jedes Produkt-Listeners.

- Seine letzte erfolgreiche Prüfung verwendet die Wanduhrzeit, unabhängig von der virtuellen Uhr des Emulators.
- Eine fehlgeschlagene Prüfung behält den vorherigen erfolgreichen Zeitstempel; ein Wechsel der ausgewählten Sitzung löscht ihn, bis dieses Ziel antwortet.
- Verbindungsänderungen werden für Hilfstechnologien angekündigt.

### Links für Functions-Filter

Die Filter für Funktionsnamen und Log-Level der Functions werden in der URL gehalten. Der Suchtext bleibt im Session Storage des Tabs, begrenzt auf die ausgewählte Sitzung und das ausgewählte Projekt, es sei denn, Sie wählen ausdrücklich **Include search text in the shared link** und verwenden **Copy filter link**. Prüfen Sie den Suchtext, bevor Sie ihn teilen.

- Links enthalten Filtereinstellungen, keine gespeicherte Kopie von Log-Einträgen; Einträge sind möglicherweise nicht mehr vorhanden, wenn eine andere Person den Link öffnet.
- Ist der Browser-Speicher nicht verfügbar, wird privater Text nur gehalten, solange die Seite eingehängt bleibt.
- Ein Event-Link wählt seine Sitzung aus, auch beim erneuten Besuch über „Zurück“ oder „Vor“ des Browsers. Ist das Event nicht mehr vorhanden, meldet die Seite, dass es abgelaufen ist.

### Zwischenablage

Schlägt der Zugriff auf die Zwischenablage fehl, bietet die Seite „Overview“ ein fokussiertes, schreibgeschütztes Textfeld zum manuellen Kopieren über die Tastatur an, statt einen Erfolg zu melden.

## Siehe auch

- [Zeit und geplante Funktionen](../time/)
- [Security Rules](../security-rules/)
- [Testwelten](../test-worlds/#eine-welt-in-der-ui-untersuchen)
- [CLI-Referenz](../../reference/cli/)
