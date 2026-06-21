# e-regio – Projektübergabe (Stand 18.06.2026)

> Dieses Dokument ist als erster Message in einem neuen Chat gedacht.
> Es enthält den vollständigen Projektstand, damit keine Kontextlücken entstehen.

---

## 1. Auftraggeber & Ziel

**e-regio GmbH & Co. KG** – regionaler Energieversorger im Raum Euskirchen/Kall, NRW.

Zwei Microsoft-Access-Datenbanken sollen in **eine einzige, schnellere On-Premise-Web-App** überführt werden, die im Firmennetz läuft und von bis zu **30 gleichzeitigen Nutzern** (Kundenberater) bedient werden kann.

| Datenbank | Zweck | Status |
|---|---|---|
| `persönliche Kundenbesuche.accdb` | Besuchertracking Kall & Euskirchen + Dashboard | ✅ **Prototyp fertig** |
| `Produkt-ID Tool .accdb` | Preis-/Angebots-Engine für Kundenberater | 🔜 **Nächste Phase** |

---

## 2. Getroffene Architektur-Entscheidungen

| Thema | Entscheidung |
|---|---|
| Plattform | Web-App im Browser (beide Standorte über Firmennetz) |
| Hosting | On-Premise – kein Cloud-Zugriff |
| Preisdaten | Weiterhin in Access gepflegt; App liest via Sync |
| Sync-Strategie | **Manueller „Sync"-Button** im Admin-Bereich (spotmarktgetrieben, unregelmäßig: 1 Tag bis Monate) |
| Gleichzeitige Nutzer | bis zu 30 |
| Schriftarten | Space Grotesk + DM Sans – **selbst-gehostet** (offline-fähig, keine CDN) |
| CI-Farben | Primär `#003431` (Dunkelgrün), Sekundär `#bf9200` (Gold) |
| Design-Stil | Glassmorphism, dunkles immersives Theme |

---

## 3. Infrastruktur & Tools

| Tool | Zweck | Pfad / Version |
|---|---|---|
| **Jackcess 4.0.5** | Liest `.accdb` inkl. Access 365 v5-Format (ACE OLEDB schafft das nicht) | `C:\Users\marck\Downloads\accdb-tools\` |
| **Microsoft OpenJDK 21** | Für Jackcess-Java-Tools | `C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\bin\java.exe` |
| **Microsoft ACE OLEDB 16.0** | Für ältere `.accdb` per ADODB | installiert |
| **jwebserver** (JDK built-in) | Lokaler Preview-Server | Port **8123**, config: `.claude\launch.json`, Server-ID: `dashboard` |
| **Python 3.12** | Für ui-ux-pro-max Skill-Script | installiert via winget |

### Java-Hilfstools (alle in `C:\Users\marck\Downloads\accdb-tools\`)

| Datei | Funktion |
|---|---|
| `Schema.java` | Liest DB-Schema (Tabellen, Spalten, Abfragen) – überspringt LINKED tables |
| `Objects.java` | Listet Formulare/Berichte/Makros/Module via MSysObjects |
| `ExportVisits.java` | Exportiert alle 43.401 Besuche nach `data.js` (window.VISITS etc.) |

---

## 4. Modul 1: Besucher-Dashboard ✅ FERTIG

### 4.1 Dateien

```
C:\Users\marck\Documents\Claude Code\besucher-dashboard\
├── index.html          # App-Struktur (3 Views: Dashboard / Erfassen / Info)
├── styles.css          # Glassmorphism-Theme, CI-Farben, Micro-Interactions
├── app.js              # Gesamte Logik (kein Framework, Vanilla JS strict mode)
├── data.js             # 43.401 Besuche als window.VISITS (853 KB, generiert)
├── fonts.css           # @font-face für self-hosted woff2
└── fonts/              # spacegrotesk-500/600/700 + dmsans-400/500/600/700 .woff2
```

### 4.2 Datenformat

```js
window.VISITS    = [[sIdx, kIdx, ymd, hour, dow], ...]
// sIdx = Index in STANDORTE-Array
// kIdx = Index in KATEGORIEN-Array  
// ymd  = Jahr*10000 + Monat*100 + Tag (z.B. 20260618)
// hour = Stunde 0–23
// dow  = Wochentag 0=Mo … 6=So

window.STANDORTE = ["Euskirchen", "Kall", "(ohne Angabe)"]
// "(ohne Angabe)": 7.622 Zeilen 2016–2019 ohne Standort-Angabe

window.KATEGORIEN = [
  "00 Abschlag", "01 Umzug", "02 Stammdaten", "03 Bankverbindung",
  "04 Zählerstand", "05 Tarifberatung", "06 Abrechnung", "07 Vertrag",
  "09 Hausanschluss", "10 Lieferantenwechsel", "11 Photovoltaik",
  "12 Wallbox", "13 Forderungsmanagement", "14 Wasser - Alfter",
  "15 Wasser - WEB", "16 Sonstiges - Commodity", "17 Sonstiges - Non-Commodity",
  "18 Preisanpassung", "19 Marktraumumstellung", "30 Bargeldverkehr",
  "31 abteilungsfremde Besuche", "32 Preisbremse", "33 Solarstrompaket",
  // + Legacy-Einträge: "Vertrag", "sonstiges", "PV", "-", "(ohne)" – werden gefiltert
]

window.META = { total: 43401, min: "2016-01-04", max: "2026-06-18" }
```

### 4.3 Umgesetzte Features

**Dashboard-View:**
- 4 KPI-Kacheln: Heute / Diese Woche / Dieser Monat / Dieses Jahr (je mit Delta vs. Vorperiode + Sparkline)
- 3 Standort-Kacheln: Besucher Gesamt · Euskirchen · Kall (periodenabhängig)
- Besuchsverlauf: animierter SVG-Linienchart (adaptiv täglich/monatlich/jährlich)
- Je Standort: animierter Donut-Chart
- Top-Kategorien: horizontale Balken (Top 9, farbkodiert)
- Nach Wochentag & Nach Uhrzeit: vertikale Balken mit Gold-Gradient
- Filter: Standort-Dropdown + Zeitraum-Segmentbuttons (Heute / Monat / Jahr / 12 Mon. / Zeitraum / Gesamt)
- Count-up-Animationen, Linienchart-Draw-Animation, Donut-Sweep, wachsende Balken
- Tooltip-System für alle Charts
- `prefers-reduced-motion` respektiert

**Besuch erfassen-View:**
- Standort-Auswahl: Euskirchen / Kall (mit Spring-Bounce-Animation)
- Kategorie-Grid: 24 Buttons alphabetisch, numerische Präfixe ausgeblendet
- Pro Button: Einzelzählung je Standort (Euskirchen: X / Kall: Y)
- Micro-Interactions: Gold-Shimmer-Sweep on hover · Gold-Ring-Burst on click · Count-Pop on increment
- **Live-Tracking:** Jede Erfassung wird sofort in `V` (window.VISITS) eingefügt → Dashboard aktualisiert sich in Echtzeit
- Persistenz: `localStorage.capVisits` (Array) + `localStorage.capCounts` (Objekt) – werden beim Laden gemergt

**Info-View:**
- Kurzbeschreibung + Datensatz-Stats

### 4.4 Bekannte Probleme / Limitierungen des Prototyps

| Problem | Beschreibung | Produktions-Lösung |
|---|---|---|
| `capCounts` reset | Button-Zähler zeigt kumulativ seit Installation, nicht nur „heute" | Tages-Reset via Datum-Check in localStorage |
| Kein echter DB-Write | Erfassung nur lokal (Demo) | PostgreSQL-Backend + REST-API |
| `nowYmd` gedeckelt | `min(heute, META.max)` → bei neuem Datum nach Export läuft Uhr rückwärts | Kein maxYmd-Cap in Produktion |
| Duplikate in KAT | Legacy-Kategorien „Vertrag", „sonstiges", „PV", „-" in Rohdaten | Kategorie-Migration-Tabelle aus Access umsetzen |
| Keine Authentifizierung | Prototyp offen | Login + Rechteverwaltung in Produktion |
| data.js = statisch | Preise/Daten veralten | Sync-Job + PostgreSQL |

### 4.5 Wie data.js neu generiert wird

```powershell
# Im Verzeichnis accdb-tools:
cd C:\Users\marck\Downloads\accdb-tools
javac -cp ".;jackcess-4.0.5.jar;commons-lang3-3.12.0.jar;commons-logging-1.2.jar" ExportVisits.java
java -cp ".;jackcess-4.0.5.jar;commons-lang3-3.12.0.jar;commons-logging-1.2.jar" ExportVisits `
  "C:\Users\marck\Downloads\persönliche Kundenbesuche.accdb" `
  "C:\Users\marck\Documents\Claude Code\besucher-dashboard\data.js"
```

---

## 5. Modul 2: Produkt-ID Tool 🔜 NÄCHSTE PHASE

### 5.1 Quell-Datenbanken

| Datei | Pfad | Format | Inhalt |
|---|---|---|---|
| `Produkt-ID Tool .accdb` | bei Marck lokal | Access 365 v5 (**ACE OLEDB schafft das NICHT** – nur Jackcess!) | 52 Tabellen, 50 Formulare, 18 Berichte, VBA |
| `Produkte für Kundenportal.accdb` | `H:\K-K-D\Hilfsmittel\` (Firmennetz) | Access | Backend mit Rohpreisen (28 Tabellen) |

Ausgelesene Schemata:
- `C:\Users\marck\Downloads\accdb-tools\produktid_schema_utf8.txt` – vollständiges Schema Produkt-ID Tool
- `C:\Users\marck\Downloads\accdb-tools\produktid_objects.txt` – Formulare, Berichte, Module
- `C:\Users\marck\Downloads\accdb-tools\backend_schema.txt` – Schema des Backends
- `C:\Users\marck\Downloads\accdb-tools\backend_objects.txt` – Objekte des Backends

VBA-Quellcode: `C:\Users\marck\Downloads\wetransfer_produkte-fur-kundenportal-accdb_2026-06-18_1241\VBA.txt`

### 5.2 Datenfluss (Produktion)

```
SAP IS-U Werk 59
  (WERK59_*-Exporte)
       │
       ▼
Tabellen manuell gepflegt.accdb
  (\\rge.lan\filesrv\...\K-K-D\40 Hilfsmittel\)
  Tabelle: RGE_ProduktID
       │
       ▼
Produkte für Kundenportal.accdb          ← H:-Laufwerk-Backend
  (\\rge.lan\filesrv\Geschaeftsbereich_K\K-K\K-K-D\Hilfsmittel\)
  28 Tabellen: Produkte Strom, Produkte Gas, TB Import *...
       │  (verknüpft via 18 "TB Import ..."-Tabellen)
       ▼
Produkt-ID Tool .accdb                   ← Berater-UI (52 Tabellen)
  Gibt aus: Produkt-ID / Angebots-ID (SAP) + Preisvergleich
```

### 5.3 Produktlinien

| Linie | Besonderheit |
|---|---|
| Strom | eigenes + externes Netzgebiet (PLZ-genau) |
| Gas | eigenes + externes Netzgebiet |
| Heizstrom | Wärmepumpe / Nachtspeicher |
| AutoStrom | Elektromobilität |
| SteuVE | Steuerbare Verbrauchseinrichtungen §14a |

### 5.4 Gebietscodes

```
1 = „übrige"   (Standardgebiet)
2 = BHM        (Bornheim)
3 = WTB        (Wachtberg)
4 = EUS        (Euskirchen)

SQL-Logik im Backend:
Switch([Ort]="Bornheim","BHM",[Ort]="Wachtberg","WTB",True,"übrige")
```

### 5.5 Kritische VBA-Funktion: MyRound

**Kaufmännisches Runden** (half-away-from-zero) – muss 1:1 im Backend nachgebaut werden:

```vba
Function MyRound(Zahl As Double, Optional Stellen As Integer = 2) As Double
    MyRound = Fix("" & Zahl * (10 ^ Stellen) + Sgn(Zahl) * 0.5) / (10 ^ Stellen)
End Function
```

In JavaScript/TypeScript:
```typescript
function myRound(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.trunc(value * factor + Math.sign(value) * 0.5) / factor;
}
```

Weitere VBA-Helfer: `ToZahl`, `ToChar`, `SuchZahl` (String-Konvertierungen) – im VBA.txt-File.

### 5.6 Aktuelle Gültigkeitsstichtage (Stand 18.06.2026)

| Produktlinie | Gültig ab |
|---|---|
| Gas | 22.05.2026 |
| Strom | 18.06.2026 |
| Heizstrom | 22.05.2026 |
| Steuerbare §14a | 18.06.2026 |

### 5.7 Tabellen-Struktur (Prinzip je Produktlinie, Beispiel Strom = 300er)

```
30x_Strom_Produkte_Preise        → AP/GP netto+brutto, je Tarifvariante
30x_Strom_Produkte_Konditionen   → Produkt-ID, Angebots-ID, VL, PG, Bonus
30x_Strom_Produkte_Vergleich     → Wettbewerbstarif für Ersparnisberechnung
30x_Strom_Auswahl_Preise         → Filterabfrage (gültig ab, Verbrauch, Gebiet, Zählerart)
30x_Strom_Auswahl_Konditionen    → wie oben für Konditionen
30x_Strom_Vergleichspreis        → berechneter Vergleichspreis
30x_Strom_TB_Berechnung          → Teilbetrag/Abschlag-Berechnung
```

Externe Gebiete:
```
TB 600_Preise externes Gebiet    → bis 153.000 Zeilen (PLZ-genau)
TB 700_Preise externes Gebiet
TB 800_Preise externes Gebiet
Interface Angebots-ID Extern     → SAP-Felder: VPPWERK, VPRPROID, VPPPS...
```

### 5.8 Bedienoberfläche des Access-Tools (Formulare)

```
Start                            → Produktauswahl
e-regio_<Produkt>_Vergleich      → Eingabe: Verbrauch, Gebiet, Vertragsbeginn,
                                   Gültigkeit, Neukundenbonus, Aktionsbonus,
                                   Vergleichstarif, USt-Satz
e-regio_<Produkt>_Vergleich_extern → Zusatzmaske für externe Gebiete
e-regio_<Produkt>_TB_Berechnung  → Teilbetrag-/Abschlagsberechnung
xx4_<Produkt>_Produkt_Kunde_n    → Ausgabe Kundensicht
xx4_<Produkt>_Sachbearbeiter_n   → Ausgabe mit Produkt-ID / Angebots-ID
```

---

## 6. Geplante Produktions-Architektur

```
Browser (Kundenberater)
    │  HTTP/REST
    ▼
Backend (.NET 8 / ASP.NET Core oder Node.js)
    ├── Besucher-API   → PostgreSQL (Besuche lesen/schreiben)
    ├── Produkt-API    → PostgreSQL (Preise lesen, MyRound-Logik)
    └── Admin-API      → Sync-Button: liest Access → schreibt PG
          │
          ├── PostgreSQL (On-Premise)
          │     ├── besucher.*  (Besuche, Standorte, Kategorien)
          │     └── produkt.*   (Produkte, Preise, Konditionen, Gebiete, PLZ)
          │
          └── Access-Backend (H:\...)  ← nur bei Sync gelesen
                Produkte für Kundenportal.accdb
```

**Admin-Bereich**: „Sync"-Button mit „zuletzt synchronisiert am…"-Anzeige + optionalem Zeitplan-Fallback.

---

## 7. Offene Aufgaben (Produkt-Tool Phase)

### Sofort-Prio (Prototyp Strom)
- [ ] PostgreSQL-Schema entwerfen (Preise, Konditionen, Gebiete, PLZ-Mapping)
- [ ] Sync-Job: Access → PG für Strom-Tabellen
- [ ] Backend-API: Preisabfrage Strom (Verbrauch + Gebiet + Datum → Produkt-ID + Preise)
- [ ] Frontend: Eingabemaske Strom (analog Access-Formular)
- [ ] Frontend: Ausgabe Strom (Kundensicht + Sachbearbeitersicht)
- [ ] MyRound in Backend-Sprache implementieren und testen

### Mittelfristig
- [ ] Weitere Produktlinien: Gas, Heizstrom, AutoStrom, SteuVE
- [ ] Externe Gebiete (PLZ-Tabellen, 100k-153k Zeilen)
- [ ] Preisvergleich / Wettbewerbstarif-Berechnung
- [ ] 18 Berichte als PDF-Export oder Web-Druck
- [ ] Admin-Sync-Button mit Logging
- [ ] Login / Rechteverwaltung

### Besucher-Modul (nachziehen)
- [ ] Echter DB-Write (statt localStorage)
- [ ] `capCounts` tagesbasiert statt kumulativ
- [ ] Kategorie-Migration-Tabelle umsetzen (Legacy-Mapping)
- [ ] Optional: Erfassenden Mitarbeiter mitspeichern

---

## 8. Design-System (für alle neuen Seiten übernehmen)

```css
:root {
  --ci:    #003431;  /* e-regio CI Primär */
  --acc:   #bf9200;  /* CI Sekundär (Gold) – Akzentfarbe */
  --acc-2: #8c6b00;
  --acc-hi:#e0ad1f;
  --gold:  #E9C682;
  --bg0:   #021614;
  --bg1:   #00302C;
  --bg2:   #004B43;
}
/* Stil: Glassmorphism – backdrop-filter:blur(16-20px), rgba(255,255,255,.045) */
/* Icons: nur SVG (Heroicons-ähnlich, viewBox="0 0 24 24") – keine Emojis */
/* Typo: Space Grotesk (Headlines) + DM Sans (Text) – self-hosted woff2 */
/* Animationen: prefers-reduced-motion respektieren */
```

---

## 9. Wichtige Hinweise für den nächsten Chat

1. **Access 365 v5-Format**: Das `Produkt-ID Tool .accdb` wurde mit Access 365 erstellt und kann **nicht** mit ACE OLEDB 16.0 geöffnet werden. Nur **Jackcess** liest es. Java-Tools liegen fertig vor.

2. **H:-Laufwerk**: `\\rge.lan\filesrv\Geschaeftsbereich_K\K-K` – nur im Firmennetz erreichbar. Für lokales Arbeiten: Kopie des Backends auf lokalem Pfad.

3. **Sync-Timing**: Preisänderungen sind **unregelmäßig** (spotmarktgetrieben). Kein tägliches Polling – nur manueller Sync-Button.

4. **MyRound ist geschäftskritisch**: Alle Preisberechnungen müssen exakt das gleiche Ergebnis wie die VBA-Funktion liefern. Testfälle aus echten Access-Daten ableiten.

5. **Produkt-IDs und Angebots-IDs gehen nach SAP**: Fehler hier bedeuten falsche SAP-Buchungen. Sorgfältige Validierung notwendig.

6. **Lokaler Preview-Server**: `jwebserver` läuft auf Port 8123, Server-ID `dashboard`. Für neue Module eigenen Port wählen oder in `.claude\launch.json` ergänzen.

---

*Erstellt: 18.06.2026 · Bearbeiter: Marck (e-regio) + Claude Code*
