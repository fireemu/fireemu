---
title: Von der Local Emulator Suite migrieren
description: Stellen Sie ein Projekt von firebase emulators:exec auf Fireemu um und beheben Sie die Tests, die unter dem Profil strict fehlschlagen.
---

Fireemu liest Ihre vorhandene `firebase.json`, verwendet dieselben Standardports und akzeptiert die offiziellen Befehlsnamen. Die meisten Projekte wechseln daher, indem sie einen einzigen Befehl ändern.

## Bevor Sie beginnen

Prüfen Sie, ob die Produkte, die Sie verwenden, in der [Liste der unterstützten Produkte](../../#supported-products) stehen. Die Local Emulator Suite stellt auch App Hosting, Data Connect und Extensions bereit, was Fireemu nicht tut, und die Realtime Database wird nur teilweise unterstützt.

## Die Befehle umstellen

1. Installieren Sie Fireemu und erstellen Sie eine `fireemu.toml`, die auf Ihre `firebase.json` verweist:

   ```sh
   npm install --save-dev fireemu
   npx fireemu init --firebase-json firebase.json
   ```

   Behalten Sie `profile = "strict"`, den Standard, bei.

2. Ersetzen Sie die Befehle:

   | Vorher | Nachher |
   |---|---|
   | `firebase emulators:exec "npm test"` | `fireemu exec -- npm test` |
   | `firebase emulators:start` | `fireemu up` |

   `fireemu emulators:exec` und `fireemu emulators:start` funktionieren ebenfalls, und `exec` akzeptiert die offizielle Form mit einem Skript in Anführungszeichen.

3. Führen Sie Ihre Tests aus.

## Wenn ein Test unter `strict` fehlschlägt

Ein Test, der mit dem offiziellen Emulator bestanden hat, unter `strict` aber fehlschlägt, zeigt oft ein Verhalten, dem Ihre Anwendung auch in der Produktion begegnen würde. Korrigieren Sie den Test oder die Anwendung, oder lockern Sie nur die konkrete Einstellung unten. Vermeiden Sie es, das gesamte Profil auf `emulator` umzustellen.

### Unsignierte Emulator-ID-Tokens

`authenticatedContext()` aus `@firebase/rules-unit-testing` und `mockUserToken` des Client-SDK funktionieren unter `strict` standardmäßig.

- Setzen Sie `auth.allowUnsignedIdTokens` auf `false`, um ihren Fallback auf den Security-Rules-Oberflächen zu deaktivieren und die Ablehnung durch die Produktion zu testen.
- Verwenden Sie für einen Ablehnungstest die Standardwerte `iat: 0` / `exp: 3600` des SDK-Helfers mit einer Uhr nach dem Ablauf. Von Fireemu ausgestellte Tokens, die die normale Verifikation bestehen, werden weiterhin akzeptiert.
- Verwenden Sie `auth.idTokenSigning = "session-rsa"`, um alle unsignierten ID-Tokens abzulehnen.

Siehe [Unsignierte Mock-ID-Tokens](../../products/auth/#unsigned-mock-id-tokens).

### Benannte Datenbanken

Deklarieren Sie jede benannte Datenbank im Array `firestore` der `firebase.json`, mit ihren Dateien für `rules` und `indexes`, oder legen Sie sie über die Admin-API an, so wie die Produktion es verlangt. Eine zur Laufzeit angelegte Datenbank hat keine Security Rules, bis Sie welche für sie laden (siehe [Firestore](../../products/firestore/#named-databases)).

### Zusammengesetzte Indizes

Abfragen werden gegen Ihre deklarierten Indizes geprüft, so wie die Produktion sie prüft. Deklarieren Sie den Index, den eine Abfrage braucht, in `firestore.indexes.json`, auf die von `firebase.json` verwiesen wird.

- Eine Abfrage, deren Index fehlt, wird wie in der Produktion mit `FAILED_PRECONDITION` und einem Link zum Index abgelehnt.
- Ein zusammengesetzter Index mit nur einem Feld wird beim Laden der Datei abgelehnt, so wie `firebase deploy` ihn ablehnt: Verwenden Sie `fieldOverrides`.
- Um solche Abfragen weiter auszuführen, während Sie die Indizes ergänzen, setzen Sie `firestore.missingIndexes` auf `"report"`: Die Abfrage wird ausgeführt, und jeder fehlende Index wird pro Datenbank einmal auf der Standardfehlerausgabe gemeldet, mit dem Ablehnungstext der Produktion und dem Eintrag für `firestore.indexes.json`. `productionExact` ändert diesen Schlüssel nicht.
- Bei OR-Abfragen listen zusätzliche Diagnosen auf der Standardfehlerausgabe alle verschiedenen fehlenden Zweig-Indizes auf, sodass Sie deren Definitionen gemeinsam ergänzen können. `strict` liefert weiterhin den bestehenden SDK-Fehler mit dem ersten Link zur Index-Erstellung, und das Profil `emulator` führt die Abfrage weiterhin aus. Wiederholte Vorschläge werden dedupliziert, und der Diagnose-Cache ist begrenzt.

### Einstellungen, die Ihr Produktionsprojekt widerspiegeln

Setzen Sie diese passend zu Ihrem Produktionsprojekt, statt das Profil zu wechseln:

| Einstellung | Was sie unter `strict` bewirkt |
|---|---|
| `auth.improvedEmailPrivacy` | Schutz vor E-Mail-Enumeration, bei einem neuen Produktionsprojekt eingeschaltet. Setzen Sie `false` nur, wenn Ihr Produktionsprojekt ihn ausgeschaltet hat; Anmeldungen antworten dann mit `EMAIL_NOT_FOUND` und `INVALID_PASSWORD`, wie es der offizielle Auth-Emulator tut. |
| `auth.mfa` | Die Multi-Faktor-Konfiguration Ihres Projekts. `strict` startet mit aktivierten SMS und TOTP; `productionExact` startet mit ausgeschaltetem Multi-Faktor, wie ein neues Produktionsprojekt. Siehe [Authentication](../../products/auth/#multi-factor-authentication). |
| `firestore.enforceLimits` | Die Produktion erzwingt immer die Abfragegrenzen der Standard Edition. Mit `false` gelangen Abfragen durch, die die Produktion ablehnt; lassen Sie es daher eingeschaltet, sofern Sie keinen besonderen Grund haben. Unter `strict` schaltet es nur die Abfragegrenzen um. |

## Unterschiede zur offiziellen CLI

- Ein fehlgeschlagenes `--export-on-exit` lässt den Lauf mit Status 1 enden, wenn der Befehl erfolgreich war. Die offizielle CLI warnt nur und endet mit 0; Fireemu weicht ab, damit ein CI-Job, der von den gespeicherten Daten abhängt, nicht ohne sie bestehen kann.
- Unter Unix wird eine gefundene `fireemu.toml` oder `firebase.json` nur geladen, wenn ihr Eigentümer vertrauenswürdig ist. Siehe [Konfigurationsdateien](../../guides/configuration/#file-ownership-checks).
- Unter `strict` verhält sich ein Projekt ohne Security Rules wie ein Produktionsprojekt ohne Rules-Release: Client-Anfragen werden abgelehnt. Siehe [Security Rules](../../guides/security-rules/).

## Siehe auch

- [Ihre App verbinden](../connect/)
- [Profile und productionExact](../../guides/profiles/)
- [Kompatibilitätstabellen](../../compatibility/)
- [Einschränkungen](../../compatibility/limitations/)
