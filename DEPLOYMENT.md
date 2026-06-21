# Deployment-Anleitung — Vercel + Turso

## Architektur-Überblick

```
Browser  →  Vercel CDN          (statische HTML/CSS/JS-Dateien)
         →  Vercel Serverless   (api/vercel.js → Fastify → Repositories)
                                ↓
                         Turso (libSQL-Cloud)
                    ┌─── eregio-produkte
                    ├─── eregio-besucher
                    └─── eregio-einsatzplan
```

Lokal: `http://127.0.0.1:8124` (Frontend) + `http://127.0.0.1:3001` (API, Fastify)
Produktion: Alles unter `https://your-app.vercel.app` — gleiche URL, kein CORS-Problem.

---

## Voraussetzungen

- Node.js >= 20
- [Turso CLI](https://docs.turso.tech/cli/installation)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- Lokale SQLite-Dateien unter `api/db/` (Quelldaten für den Upload)

### Turso CLI installieren

**Windows (PowerShell als Admin):**
```powershell
winget install turso
```

**Alternativ via Scoop:**
```powershell
scoop install turso
```

---

## Schritt 1 — Turso-Account & Login

```bash
turso auth login
```

Öffnet den Browser für OAuth. Danach:

```bash
turso auth whoami   # Prüfen ob Login erfolgreich
```

---

## Schritt 2 — Turso-Datenbanken anlegen (mit Daten-Upload)

Die bestehenden SQLite-Dateien werden 1:1 hochgeladen — die komplette Historie kommt mit.

```bash
turso db create eregio-produkte    --from-file api/db/produkte.sqlite
turso db create eregio-besucher    --from-file api/db/besucher.sqlite
turso db create eregio-einsatzplan --from-file api/db/einsatzplan.sqlite
```

Upload-Fortschritt wird angezeigt. Je nach Dateigröße 1–3 Minuten.

Prüfen:
```bash
turso db list
```

---

## Schritt 3 — URLs und Auth-Token ermitteln

**Datenbank-URLs** (Format: `libsql://eregio-produkte-<account>.turso.io`):

```bash
turso db show eregio-produkte    --url
turso db show eregio-besucher    --url
turso db show eregio-einsatzplan --url
```

**Auth-Token** (einmalig erstellen, sofort sichern — wird nur einmal angezeigt):

```bash
turso db tokens create eregio-produkte
turso db tokens create eregio-besucher
turso db tokens create eregio-einsatzplan
```

Die 6 Werte notieren — sie werden in Schritt 5 benötigt.

---

## Schritt 4 — Vercel-Projekt anlegen

### Option A: Vercel CLI (empfohlen, kein Git nötig)

```bash
vercel login
vercel link    # Neues Projekt anlegen oder bestehendes verknüpfen
```

Fragen bejahen / Standard-Einstellungen übernehmen:
- Framework Preset: **Other**
- Root Directory: `.` (Projektroot)
- Build Command: `npm run vercel-build`
- Output Directory: `.` (kein Build-Schritt für das Frontend)

### Option B: Via GitHub

1. `git init && git add . && git commit -m "initial"`
2. Repo auf GitHub pushen
3. Im [Vercel Dashboard](https://vercel.com/new) → "Import Git Repository"
4. Einstellungen wie Option A

---

## Schritt 5 — Umgebungsvariablen setzen

**Über Vercel CLI:**

```bash
vercel env add PRODUKTE_DB_URL
# Wert eingeben: libsql://eregio-produkte-<account>.turso.io

vercel env add PRODUKTE_DB_AUTH_TOKEN
# Wert eingeben: <token aus Schritt 3>

vercel env add BESUCHER_DB_URL
vercel env add BESUCHER_DB_AUTH_TOKEN

vercel env add EINSATZPLAN_DB_URL
vercel env add EINSATZPLAN_DB_AUTH_TOKEN
```

Für jeden Wert fragt die CLI nach dem Environment (Production / Preview / Development).
Für Produktions-Deploy: **Production** wählen.

**Alternativ im Vercel Dashboard:**
Settings → Environment Variables → alle 6 Variablen eintragen.

> **Sicherheit:** Die Auth-Token landen ausschließlich in Vercel's verschlüsseltem
> Secret-Speicher. Sie werden NIEMALS an den Browser weitergeleitet — alle DB-Zugriffe
> laufen serverseitig durch `api/vercel.js`.

---

## Schritt 6 — Deployment

```bash
vercel --prod
```

Ablauf:
1. Vercel erkennt `vercel.json` und `package.json`
2. `npm run vercel-build` wird ausgeführt: `cd api && npm install`
   (installiert Linux-Binaries für `@libsql/client`)
3. `api/vercel.js` wird als Serverless Function deployt
4. Alle statischen Dateien (HTML/CSS/JS) gehen ans CDN

Am Ende erscheint die URL: `https://your-app.vercel.app`

---

## Schritt 7 — Verifizieren

```bash
# Health-Check der API
curl https://your-app.vercel.app/api/health
# Erwartete Antwort: {"ok":true}

# Besucher-Endpunkt
curl https://your-app.vercel.app/api/besucher

# Frontend
# Browser: https://your-app.vercel.app
```

Alle 4 Module testen:
- `/` — Startseite
- `/besucher-dashboard/` — Besucher-Dashboard
- `/produkt-id-tool/` — Produkt-ID-Tool
- `/einsatzplaner/` — Einsatzplaner
- `/admin/` — Admin

---

## ENV-Variablen Referenz

| Variable | Beschreibung |
|---|---|
| `PRODUKTE_DB_URL` | `libsql://eregio-produkte-<account>.turso.io` |
| `PRODUKTE_DB_AUTH_TOKEN` | Auth-Token für eregio-produkte |
| `BESUCHER_DB_URL` | `libsql://eregio-besucher-<account>.turso.io` |
| `BESUCHER_DB_AUTH_TOKEN` | Auth-Token für eregio-besucher |
| `EINSATZPLAN_DB_URL` | `libsql://eregio-einsatzplan-<account>.turso.io` |
| `EINSATZPLAN_DB_AUTH_TOKEN` | Auth-Token für eregio-einsatzplan |

Ohne diese Variablen fällt der Driver automatisch auf lokale SQLite-Dateien zurück
(`api/db/*.sqlite`) — das funktioniert lokal, aber nicht auf Vercel (read-only filesystem).

---

## Lokale Entwicklung bleibt unverändert

```bat
start-server.bat   # startet Fastify auf 127.0.0.1:3001
```

Frontend via `http://127.0.0.1:8124` öffnen. Das Frontend erkennt `127.0.0.1`
automatisch und spricht den lokalen API-Server an — kein Umbau nötig.

---

## Troubleshooting

**`Error: TURSO_DATABASE_URL nicht gesetzt`**
→ ENV-Variablen in Vercel fehlen oder falscher Environment-Scope.
→ `vercel env ls` zeigt alle gesetzten Variablen.

**`better-sqlite3` oder `node:sqlite` Fehler auf Vercel**
→ Diese Pakete sind nur für die lokale Import-Pipeline (`api/migrate-*.js`).
→ Sie werden nie von `api/vercel.js` geladen — kein Problem.

**Timeout bei großen Abfragen (> 30s)**
→ `maxDuration` in `vercel.json` erhöhen (max. 300s auf Pro-Plan).

**CORS-Fehler**
→ Im Produktions-Betrieb zeigt Browser und API dieselbe Vercel-Domain → kein CORS.
→ Nur bei lokalem Frontend gegen Prod-API: in `@fastify/cors` Origin-Whitelist ergänzen.
