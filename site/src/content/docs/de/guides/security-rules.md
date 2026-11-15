---
title: Security Rules
description: Laden Sie Security Rules für Firestore, Storage und die Realtime Database und finden Sie heraus, warum eine Anfrage abgelehnt wurde.
---

Laden Sie Ihre Security Rules für Firestore, Storage und die Realtime Database, sehen Sie, welche Bedingung eine Anfrage abgelehnt hat, und testen Sie mit Mock-Tokens.

## Rules laden

Nennen Sie die Rules-Dateien in `firebase.json`, wie bei der Firebase CLI:

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" }
}
```

oder in `fireemu.toml` (`rules.source` für Firestore, `storage.rules` für Storage). Die Startausgabe enthält eine Zeile `firestore rules:` und eine Zeile `storage rules:`, die angeben, ob Rules geladen sind.

Rules der Realtime Database werden aus dem Abschnitt `database` der `firebase.json` geladen: eine einzelne Datei für die Standardinstanz oder eine pro Instanz oder Deploy-Ziel. Die Zeile `database rules:` der Startausgabe nennt jede Datei und ihre Instanz. Welche Credentials jedes Profil akzeptiert, was eine Instanz ohne Rules erlaubt und worin sich das vom offiziellen Emulator unterscheidet, steht unter [Realtime Database](../../products/realtime-database/#security-rules).

`@firebase/rules-unit-testing` kann Rules auch zur Laufzeit laden: `initializeTestEnvironment` sendet die übergebenen `firestore.rules` und `storage.rules` an die Emulatoren, und `testEnv.clearFirestore()` wird bereitgestellt.

Was das Laden prüft:

- Der Vergleich mit dem offiziellen Emulator beschränkt sich auf aufgezeichnete Fälle.
- Die aufgeführten nicht unterstützten Syntax- und Auswertungsfälle werden beim Laden der Rules abgelehnt oder erzeugen Rule-Fehler.
- Die acht aufgezeichneten Muster, die der offizielle Emulator wegen seiner Ressourcengrenze bei der Determinisierung ablehnt, werden auch von Fireemu beim Laden von Rules abgelehnt, selbst in nicht ausgewerteten Ausdruckszweigen. Das belegt weder eine vollständige Äquivalenz bei regulären Ausdrücken noch eine Äquivalenz mit der Produktion.

## Ein Projekt ohne Rules

Unter `strict` verhält sich ein Projekt ohne Security Rules wie ein Produktionsprojekt ohne Rules-Release:

- jede Client-Anfrage an Firestore wird mit `PERMISSION_DENIED` abgelehnt;
- jede Endbenutzer-Anfrage an Storage wird mit der 400-Antwort „bucket has not been set up“ der Produktion abgelehnt.

Das Admin SDK und andere Owner-Credentials sind nicht betroffen.

Diese Antworten behalten den Wortlaut der Produktion. Daher gibt die erste abgelehnte Anfrage für jede Datenbank und jeden Bucket zusätzlich eine Warnung auf der Standardfehlerausgabe aus, die sagt, dass keine Rules geladen sind und wie man sie lädt.

Das Profil `emulator` erlaubt jede Firestore-Anfrage und jede Storage-Anfrage für ein `demo-*`-Projekt, wie es der offizielle Emulator tut.

## Warum eine Anfrage abgelehnt wurde

Die Produktion beantwortet eine Ablehnung mit einer kurzen Meldung (bei Firestore `PERMISSION_DENIED` „Missing or insufficient permissions.“, bei Storage ein 403), die nicht sagt, welche Rule abgelehnt hat. Fireemu gibt außerdem jede Ablehnung einer Endbenutzer-Anfrage auf der Standardfehlerausgabe aus, mit jeder `allow`-Bedingung, die die Anfrage ausgewertet hat, und ihrem Ergebnis:

```text
note: firestore: Security Rules denied get on "notes/n1" in "database (default)" (request.auth.uid "bob"): no allow statement evaluated to true; line 5:22 `request.auth.uid == resource.data.owner` was false
```

- Setzen Sie `rules.denialLog` in `fireemu.toml` auf `"off"`, um diese Zeilen zu unterdrücken, etwa in einer Suite, die viele Ablehnungen prüft. Die Antwort an den Client ist in beiden Fällen dieselbe.
- Die Seite „Rules“ und `GET /v1/sessions/default/rules/requests` zeigen die neuesten 100 nachverfolgten Firestore-Entscheidungen. Die Nachverfolgung beginnt mit der UI oder dem ersten lesenden Zugriff auf die Steuer-API; das Laden eines neuen Regelsatzes löscht den Verlauf. Das ist eine Debugging-Ansicht, kein vollständiges Anfrageprotokoll.

### Grenzen der Diagnose

Diese Grenzen betreffen nur die Diagnose, nicht die Entscheidungen über Erlauben oder Ablehnen.

- Die Diagnosen der Rules von Firestore und Storage behalten höchstens 64 verschiedene Werte pro Ausdruck.
- String-Werte und Fehlermeldungen werden an einer Zeichengrenze innerhalb von 1.024 UTF-8-Bytes gekürzt.
- Das Coverage-JSON/-HTML von Firestore und die Anfrage-Traces der Steuerung markieren gekürzte Werte mit `truncated: true`; ausgelassene Beobachtungen fügen `valuesOmitted` und `valuesCountMayBeLower: true` hinzu. Angezeigte Zählungen können daher niedriger sein als die tatsächliche Zahl für einen Wert.

## Unit-Tests mit Mock-Tokens

`authenticatedContext()` aus `@firebase/rules-unit-testing` und die Option `mockUserToken` der Client-SDKs senden ein unsigniertes Mock-ID-Token. Fireemu akzeptiert es standardmäßig, auch unter `strict`, und bildet `request.auth` aus seinen Claims, wie es der offizielle Emulator tut. Unter `strict` wird nur genau diese Token-Form akzeptiert; jedes andere Token wird verifiziert, einschließlich der Ablaufzeit.

Um die Ablehnung unsignierter Tokens durch die Produktion zu testen, setzen Sie `auth.allowUnsignedIdTokens` auf `false` oder setzen Sie [`productionExact`](../profiles/).

## Details zur Rules-Sprache

Randfälle, wie Fireemu Rules auswertet.

### `get()` und `exists()` auf einem Pfad, der kein Dokument ist

`get()` und `exists()` nehmen einen Pfad zu einem Dokument der Datenbank, in der die Anfrage läuft. Diese Pfade benennen kein Dokument, daher ist der Aufruf ein Auswertungsfehler:

- ein Pfad zu einer Collection (`/databases/$(database)/documents/users`, eine ungerade Anzahl von Segmenten nach `documents`);
- ein Pfad zu einer anderen Datenbank (`/databases/other/documents/users/u1`);
- ein Pfad ohne `documents` (`/databases/$(database)/users/u1`).

Wie jeder Rules-Fehler lässt er die Bedingung scheitern: Die Anfrage wird abgelehnt, es sei denn, die andere Seite eines `||` oder `&&` entscheidet das Ergebnis (`exists(<such a path>) || true` erlaubt; die Antwort der Produktion für eine solche Mischung wurde nicht aufgezeichnet). `!exists(...)` und `get(...) == null` lesen den Pfad nicht als „fehlend“ und erlauben; die Produktion lehnt sie ab, und der offizielle Emulator ebenso.

Ein Pfad zu einem Dokument, das nicht existiert, bleibt ein fehlendes Dokument: `exists()` ist `false` und `get()` ist `null`.

Eine fehlende Dokument-ID durch einen falsch getippten Pfad ist die übliche Ursache, daher weist die Zeile `was an error` des Ablehnungsprotokolls auf den Aufruf hin.

### Abfragen und die gespeicherten Dokumente

Eine Firestore-Abfrage wird anhand ihrer Filter autorisiert, nicht anhand der Dokumente, die sie zurückgeben würde, wie in der Produktion.

Eine Ausnahme: Ein Abfragezweig mit einem einzelnen Filter `documentId() ==` wird durch dieses Dokument, wie gespeichert, entschieden, unabhängig von anderen Filtern, Limit, Offset oder Cursor, so wie Produktion und offizieller Emulator ihn entscheiden. Im Nachweis enthält `resource.data` genau die Felder, nach denen die Abfrage filtert oder sortiert, sodass `keys()`, `size()`, `in` und `get(key, default)` nur aus diesen Feldern antworten.

Eine `OR`-Abfrage, die einen Zweig mit einem benannten Dokument mit einem Zweig ohne benanntes Dokument mischt, unterscheidet sich je nach Profil:

- Das Profil `emulator` autorisiert sie Zweig für Zweig, wie es der offizielle Emulator tut.
- Das Profil `strict` weist jeden Zweig anhand seiner Filter nach, weil die Produktion diese Abfrage mit einem Fehler wegen fehlenden Index beantwortete und ihre Rules-Antwort nicht aufgezeichnet ist.

### Strings in Rules

Die Rules von Firestore und Storage indizieren und messen einen String nach UTF-16-Code-Units, wie es die Produktion tut: `"é🔥x".size()` ist 4 und `"é🔥x"[3] == "x"`. `lower()` und `upper()` ändern nur ASCII-Buchstaben, und Strings werden nie normalisiert. Reguläre Ausdrücke behandeln ein ergänzendes Zeichen weiterhin als ein Zeichen.

Eine Hälfte eines Surrogatpaars unterscheidet sich je nach Profil:

- Unter `strict` ist sie ein Fragment, das nur sich selbst entspricht, und ein Muster in `split()`, `replace()` oder `matches()`, das ein einzelnes Surrogat enthält, lässt die Rule scheitern, wie die Produktion antwortete.
- Das Profil `emulator` behält die einzelne Einheit, wie es der offizielle Emulator tut.

## Siehe auch

- [Cloud Firestore](../../products/firestore/)
- [Cloud Storage](../../products/storage/)
- [Realtime Database](../../products/realtime-database/#security-rules)
- [Profile und productionExact](../profiles/)
