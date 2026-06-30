# enet → Netzbetreiber & Grundversorger

Pipeline, die je PLZ den **Netzbetreiber (NB)** und **Grundversorger (GV)** für Strom und Gas
bereitstellt. Quelle: enet-NNE-Vollexporte (Access-DB in einem ZIP, je ~230 MB / entpackt ~1,1–1,4 GB).

## Bestandteile
- **`EnetExport.java`** – liest beide Access-DBs (Jackcess) und schreibt `enet-betreiber-bundesweit.json`
  (PLZ, Ort, sparte, NB/GV inkl. Telefon/Website wo vorhanden).
- **`push-turso.js`** – schreibt das JSON in die Turso-`produkte`-DB (Tabelle `enet_betreiber`,
  `DELETE` + Batch-`INSERT`).
- **`lib/`** – Jackcess + Commons-Jars.
- **`../../.github/workflows/enet-update.yml`** – führt das wöchentlich automatisch aus.

## Datenmodell
- Gas: `PLZ_Netzbetreiber_Gas` → `ND_VNBG_Nr` (NB) + `Grundversorger_Nr` (GV) → `NetzBetreiber` / `Gasversorger`.
- Strom: `Postleitzahlen_Netzbetreiber` → `Netz_Nr` → `Netze` → `VNB_Nr` (NB) + `Grundversorger_Nr` (GV) → `Netzbetreiber` / `EVU`.
- Kontakt: NB hat Telefon + Website; Gas-GV hat Telefon; Strom-GV nur Name. **Kein Ort, keine E-Mail.**

## GitHub einrichten (einmalig)
**Repository → Settings → Secrets and variables → Actions**

Variables:
- `ENET_DL_STROM` = `https://www.enet-navigator.de/dl/48ab91432c6762262dd5f9eb982485af`
- `ENET_DL_GAS`   = `https://www.enet-navigator.de/dl/443d5a25f39753fb45cc91018f085647`

Secrets (DB-Zugang der `produkte`-DB):
- `TURSO_PRODUKTE_URL` + `TURSO_PRODUKTE_TOKEN`
  (alternativ `PRODUKTE_DB_URL` + `PRODUKTE_DB_AUTH_TOKEN`)

> Die `dl/`-Tokens können in enet rotieren. Ändern sie sich, nur die Variables anpassen – kein Code-Deploy nötig.

## Lokal ausführen
```bash
# 1) ZIPs herunterladen, accdb entpacken (nns_access.accdb / nng_access.accdb)
# 2) Extrahieren:
CP="tools/enet/lib/jackcess-4.0.5.jar:tools/enet/lib/commons-logging-1.3.0.jar:tools/enet/lib/commons-lang3-3.14.0.jar"
javac -cp "$CP" -d tools/enet tools/enet/EnetExport.java
java  -cp "tools/enet:$CP" EnetExport nns_access.accdb nng_access.accdb tools/enet/enet-betreiber-bundesweit.json
# 3) In DB schreiben (ENV: TURSO_PRODUKTE_URL/_TOKEN oder PRODUKTE_DB_URL/_AUTH_TOKEN):
node tools/enet/push-turso.js tools/enet/enet-betreiber-bundesweit.json
```

## API (vom Frontend genutzt)
- `GET /api/enet/lookup?plz=53879` → `{ strom:{nb,gv}, gas:{nb,gv} }` (Produkt-ID-Tool).
- `GET /api/enet/search?q=…`        → PLZ-Präfix oder Ort-Teilstring (Marktlage).
