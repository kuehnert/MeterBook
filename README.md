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
3. Starten:
   ```bash
   docker compose up -d
   ```
4. Cloudflare Tunnel auf `http://<host>:3000` zeigen lassen. Die Web-Oberfläche liegt unter `/`, die API unter `/api`.

> Falls du **Cloudflare Access** vor die Seite schaltest: Die App meldet sich selbst an und kommt nicht durch die Access-Anmeldung. Für den Pfad `/api/*` braucht es dann eine Bypass-Regel.

Daten liegen in `./data` (SQLite-Datei `meterbook.db` und Ordner `photos/`). **Sicherung = diesen Ordner kopieren.**

### Versionen und Updates

Images liegen in der GitHub Container Registry unter `ghcr.io/kuehnert/meterbook`:

| Tag | Bedeutung |
|---|---|
| `0.1.1` | genau dieses Release – **für den Betrieb empfohlen** |
| `0.1` | neuestes Release der Reihe 0.1.x |
| `latest` | neuestes Release |
| `edge` | aktueller Stand von `main`, ungetestet |

In `docker-compose.yml` die gewünschte Version eintragen, z. B. `image: ghcr.io/kuehnert/meterbook:0.1.1`. Update: Version erhöhen, dann `docker compose pull && docker compose up -d`. Die Version des laufenden Servers steht im Web unter **Einstellungen**.

Da das Repo privat ist, auf dem Server einmal `docker login ghcr.io` mit einem GitHub-Token (Recht `read:packages`).

Neues Release veröffentlichen (setzt die Version in Server, Web und Android, committet, taggt und pusht):

```bash
node scripts/release.mjs 0.1.2 --push
```

Selbst bauen statt Image: in `docker-compose.yml` `build: .` statt `image:` eintragen und `docker compose up -d --build`.

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
cd server && npm test                          # Tests der Verbrauchs- und Kostenrechnung
```

Android: Ordner `android/` in Android Studio öffnen.
