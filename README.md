# MeterBook

Zählerstände per Foto erfassen, Verbrauch und Kosten auswerten. Selbst gehostet.

- **Android-App** – Zähler fotografieren, der Stand wird automatisch erkannt (Claude), du bestätigst. Funktioniert auch ohne Netz, z. B. im Keller: die Ablesung wird gesendet, sobald wieder Verbindung besteht. Erinnert wöchentlich oder monatlich ans Ablesen.
- **Web-Frontend** – Zähler, Zählwerke (z. B. HT/NT), Tarife mit Gültigkeitszeiträumen, Abschläge, Gerätewechsel, Diagramme, Abrechnungsperioden, PDF-Jahresbericht, Excel-Export, Import alter Ablesungen, Nutzerverwaltung.
- **Server** – NestJS + SQLite in einem Docker-Container, mehrere Nutzer mit getrennten Daten.

```
server/   NestJS-API (TypeScript, Prisma/SQLite)
web/      Web-Frontend (React, Mantine)
android/  Android-App (Kotlin, Jetpack Compose)
```

## Server einrichten (Docker)

1. Repository auf den Server holen (oder in Dockhand als Git-Stack anlegen).
2. `.env.example` nach `.env` kopieren und ausfüllen:
   - `JWT_SECRET` – zufällige Zeichenkette, z. B. `openssl rand -hex 32`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` – erster Administrator (nur beim allerersten Start)
   - `ANTHROPIC_API_KEY` – für die automatische Erkennung (leer = aus)
   - optional `BACKUP_TOKEN`, `BACKUP_INTERVAL_HOURS`, `PHOTO_RETENTION_DAYS` – siehe [Sicherung](#sicherung) und [Fotos](#fotos)
3. Starten:
   ```bash
   docker compose up -d
   ```
4. Cloudflare Tunnel auf `http://<host>:3000` zeigen lassen. Die Web-Oberfläche liegt unter `/`, die API unter `/api`.

> Falls du **Cloudflare Access** vor die Seite schaltest: Die App meldet sich selbst an und kommt nicht durch die Access-Anmeldung. Für den Pfad `/api/*` braucht es dann eine Bypass-Regel.

Daten liegen in `./data` (SQLite-Datei `meterbook.db`, Ordner `photos/` und `backups/`).

### Daten-Ordner unter Windows

Unter Windows mit Docker Desktop ist `./data` ein Windows-Ordner, der in den Linux-Container eingebunden wird. Für eine Datenbankdatei ist das langsamer und beim Sperren der Datei weniger zuverlässig als ein **benanntes Docker-Volume**. Umstieg ohne Datenverlust:

1. Im Web unter **Sicherung → Jetzt sichern**, dann die Sicherung herunterladen.
2. In `docker-compose.yml` `- ./data:/data` durch `- meterbook-data:/data` ersetzen und unten `volumes: { meterbook-data: {} }` einkommentieren, `docker compose up -d`.
3. Mit dem Admin-Zugang aus der `.env` anmelden, **Sicherung → Aus Datei wiederherstellen**.

Danach liegen die automatischen Sicherungen im Volume; zum Kopieren auf ein anderes Gerät siehe [Sicherung](#sicherung).

### Versionen und Updates

Images liegen in der GitHub Container Registry unter `ghcr.io/kuehnert/meterbook`:

| Tag | Bedeutung |
|---|---|
| `0.2.0` | genau dieses Release – **für den Betrieb empfohlen** |
| `0.2` | neuestes Release der Reihe 0.2.x |
| `latest` | neuestes Release |
| `edge` | aktueller Stand von `main` – nur für die [Testumgebung](#testumgebung) |

In `docker-compose.yml` die gewünschte Version eintragen, z. B. `image: ghcr.io/kuehnert/meterbook:0.2.0`. Update: Version erhöhen, dann `docker compose pull && docker compose up -d`. Die Version des laufenden Servers steht im Web unter **Einstellungen**.

Da das Repo privat ist, auf dem Server einmal `docker login ghcr.io` mit einem GitHub-Token (Recht `read:packages`).

Neues Release veröffentlichen (setzt die Version in Server, Web und Android, committet, taggt und pusht):

```bash
node scripts/release.mjs 0.2.1 --push
```

Selbst bauen statt Image: in `docker-compose.yml` `build: .` statt `image:` eintragen und `docker compose up -d --build`.

### Testumgebung

Neue Versionen erst ausprobieren, bevor sie auf die echten Daten losgelassen werden:

- **Server:** `docker-compose.dev.yml` startet neben der Produktion einen zweiten Stack mit dem Image `edge` (jeder Push auf `main`), eigenem Ordner `data-dev/`, Port 3001 und eigenem Admin. Im Web steht oben ein orangefarbenes **dev**.
  ```bash
  cp .env.example .env.dev        # eigenes JWT_SECRET und eigener Admin!
  docker compose -f docker-compose.dev.yml --env-file .env.dev up -d
  ```
  Für eine eigene Adresse im Cloudflare Tunnel z. B. `meterbook-dev.example.de` → `http://<host>:3001`.
- **Echte Daten zum Testen:** in der Produktion eine Sicherung herunterladen und in der Testumgebung unter **Sicherung → Aus Datei wiederherstellen** einspielen. Die Produktion bleibt unberührt.
- **App:** Die Debug-Version heißt **MeterBook Dev** (`net.mister_k.meterbook.dev`) und lässt sich neben der echten App installieren – mit eigener Server-Adresse und Anmeldung.
- **Ablauf:** auf `main` entwickeln → `edge` in der Testumgebung prüfen → `node scripts/release.mjs X.Y.Z --push` → Version in der Produktions-`docker-compose.yml` erhöhen.

## Sicherung

Eine Sicherung ist eine ZIP-Datei mit allen Nutzern (inkl. Passwort-Hashes), Zählern, Ablesungen, Tarifen, Abschlägen und Fotos – unabhängig von der Datenbank.

- **Automatisch:** alle `BACKUP_INTERVAL_HOURS` Stunden (Standard 24) nach `/data/backups`; die letzten `BACKUP_KEEP` (14) automatischen bleiben, manuelle bleiben, bis man sie löscht.
- **Im Web** (Administratoren): **Sicherung** – jetzt sichern, herunterladen, löschen, wiederherstellen (vorher wird der aktuelle Stand automatisch gesichert), Fotos aufräumen.
- **Per Skript über HTTP** (`BACKUP_TOKEN` setzen), z. B. täglich per Windows-Aufgabenplanung oder cron auf einem anderen Rechner – so liegt eine Kopie nicht auf derselben Platte:
  ```bash
  curl -fsS -H "Authorization: Bearer $BACKUP_TOKEN" https://meterbook.example.de/api/backup -o meterbook-$(date +%F).zip
  ```
  Mit `?store=true` bleibt zusätzlich eine Kopie auf dem Server.
- **Per Skript im Container:**
  ```bash
  docker exec meterbook node dist/cli.js backup                  # nach /data/backups
  docker exec meterbook node dist/cli.js list
  docker exec meterbook node dist/cli.js restore /data/backups/<datei>.zip --yes
  docker cp meterbook:/data/backups ./meterbook-backups           # Sicherungen herauskopieren
  ```

Nach einem Wiederherstellen müssen sich alle neu anmelden.

### Datenmitnahme für Nutzer

Jeder Nutzer kann unter **Einstellungen → Meine Daten** alle eigenen Daten als ZIP herunterladen und wieder einlesen – z. B. auf einem neu aufgesetzten Server. Beim Einlesen wird nur ergänzt: Zähler mit gleichem Namen werden zusammengeführt, Ablesungen zum selben Zeitpunkt nicht verdoppelt. Vorher zeigt **Prüfen**, was dazukäme.

## Fotos

Fotos werden nach `PHOTO_RETENTION_DAYS` Tagen gelöscht (Standard 400, `0` = nie); die Ablesungen mit Wert und Erkennungsergebnis bleiben. 400 Tage decken eine ganze Abrechnungsperiode plus die Zeit bis zur Jahresabrechnung ab – falls man einen Stand gegenüber dem Versorger belegen muss. Fotos, die keinem Zähler zugeordnet werden konnten, verschwinden nach einem Tag.

## Datenbank

MeterBook nutzt **SQLite**: eine Datei, kein zusätzlicher Dienst. Für einige Haushalte mit wöchentlichen Ablesungen (einige tausend Zeilen im Jahr) ist das schneller als jeder Datenbankserver – Postgres brächte hier keinen spürbaren Gewinn, aber einen zweiten Container und aufwendigere Sicherungen. Sollte sich das ändern, ist der Umstieg über das Sicherungsformat möglich: Sicherung erstellen, Server mit Postgres aufsetzen, Sicherung einspielen.

## Erste Schritte

1. Im Web-Frontend anmelden, unter **Zähler hinzufügen** die Zähler anlegen. Vorlagen gibt es für Strom (digital, 1.8.0), Heizstrom HT/NT (Stichtag Juli) und Wasser.
2. Beim Zähler unter **Tarife & Abschläge** Preise eintragen. Bei Preisänderungen einfach einen neuen Tarif ab dem Stichtag anlegen; die Kosten werden zeitanteilig aufgeteilt.
3. Alte Jahreswerte unter **Berichte & Export → Importieren** einlesen (Vorlage zum Herunterladen).
4. App installieren, Server-Adresse und Zugangsdaten eingeben, ablesen.

Für weitere Personen (z. B. Familie) legt ein Administrator unter **Nutzer** ein eigenes Konto an. Jedes Konto sieht nur seine eigenen Zähler.

## Wie gerechnet wird

- Zwischen zwei Ablesungen wird linear interpoliert; daraus entstehen Werte für Wochen, Monate und Abrechnungsperioden. Liegen um eine Periodengrenze mehr als 45 Tage zwischen den Ablesungen, ist der Wert als *geschätzt* markiert.
- Laufende Perioden werden anhand des Verlaufs im Vorjahr hochgerechnet (Heizstrom im Winter höher), sonst mit dem Jahresdurchschnitt.
- Gerätewechsel (Endstand alt / Anfangsstand neu) werden herausgerechnet, die Reihe läuft ohne Sprung weiter.
- Plausibilitätsprüfung beim Erfassen: fallender Stand, ungewöhnlich hoher oder niedriger Verbrauch.

## Entwicklung

```bash
cd server && cp .env.example .env && npm install && npx prisma migrate dev && npm run dev
cd web && npm install && npm run dev          # http://localhost:5173, API-Proxy auf :3000
cd server && npm test                          # Tests der Verbrauchs- und Kostenrechnung, Zahlen, Zeitstempel
cd web && npm test                             # Tests der Datums- und Zahleneingabe
```

Android: Ordner `android/` in Android Studio öffnen. `./gradlew assembleDebug` baut **MeterBook Dev**, `./gradlew assembleRelease` die echte App.
