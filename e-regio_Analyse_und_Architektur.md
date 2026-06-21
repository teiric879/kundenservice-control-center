# e-regio – Ablösung der Access-Tools durch eine schnelle Web-App
### Analyse & Architekturkonzept

*Stand: 18.06.2026 · Grundlage: Auslesen der beiden Access-DBs `Produkt-ID Tool .accdb` und `persönliche Kundenbesuche.accdb`*

---

## 1. Ausgangslage & Ziel

Zwei Access-Datenbanken sollen in **eine schnellere Web-App** überführt werden:

1. **Produkt-ID Tool** – Preis-/Angebots-Engine für die Kundenberater (Preisvergleiche, Produkt-ID/Angebots-ID-Ausgabe).
2. **Persönliche Kundenbesuche** – Besuchererfassung an 2 Standorten (Kall, Euskirchen), zusätzlich mit einem **Dashboard**.

**Getroffene Entscheidungen:**
| Thema | Entscheidung |
|---|---|
| Plattform | **Web-App** (Browser, beide Standorte) |
| Betrieb | **On-Premise** im Firmennetz (DSGVO, Access-Anbindung) |
| Preise | **Werden weiter in Access gepflegt; die App liest daraus** |
| Besuchertracking | Mit **Dashboard** wie Referenz-Screenshot |
| Gleichzeitige Nutzer | **bis zu 30** |

---

## 2. Analyse: Besuchertracking-DB *(vollständig)*

Schlanke „Zähler"-Datenbank.

| Tabelle | Inhalt | Zeilen |
|---|---|---|
| `Standort` | **Kall**, **Euskirchen** | 2 |
| `Kategorien` | 23 Besuchsthemen | 23 |
| `Mitarbeiter` | 3 Namen – **wird in Besuchen NICHT verknüpft** | 3 |
| `Kundenbesuche` | Kerntabelle | **43.401** |
| `Kategorie Migration` | alte→neue Kategorie-Zuordnung | 22 |

**`Kundenbesuche`**: `Standort, Kategorie, Zähler(=1), Datum, Uhrzeit, Tag, Monat, Jahr, KW`
→ Datums-Bestandteile redundant abgelegt. Daten **2016–heute**, zuletzt ~10.000 Besuche/Jahr.

Vorhandene Auswertungen (Access-Abfragen): **je KW**, **je Wochentag**, **je Stunde** – ideale Basis fürs Dashboard.

**Kategorien:** 00 Abschlag · 01 Umzug · 02 Stammdaten · 03 Bankverbindung · 04 Zählerstand · 05 Tarifberatung · 06 Abrechnung · 07 Vertrag · 09 Hausanschluss · 10 Lieferantenwechsel · 11 Photovoltaik · 12 Wallbox · 13 Forderungsmanagement · 14/15 Wasser · 16/17 Sonstiges · 18 Preisanpassung · 19 Marktraumumstellung · 30 Bargeldverkehr · 31 abteilungsfremd · 32 Preisbremse · 33 Solarstrompaket

> **Hinweis:** Der *erfassende Mitarbeiter* wird pro Besuch nicht gespeichert. Im neuen Tool optional ergänzbar.

**Bewertung:** Fachlich einfach, vollständig verstanden, 1:1 migrierbar. Geringes Risiko.

---

## 3. Analyse: Produkt-ID Tool *(vollständig)*

Eine **komplexe Preis- und Angebots-Engine** (52 Tabellen, 50 Formulare, 18 Berichte, 1 VBA-Modul).

### 3.1 Produktlinien
Strom · Gas · Heizstrom (Wärmepumpe/Nachtspeicher) · AutoStrom · SteuVE (steuerbare Verbrauchseinrichtungen) – jeweils für **eigenes Netzgebiet** und **externe Gebiete** (PLZ-genau).

### 3.2 Aufbau je Produktlinie (Beispiel Strom, Nr. 300er)
- `*_Produkte_Preise` – Arbeitspreis (AP) & Grundpreis (GP), netto/brutto, je Tarifvariante (Komfort, Basis, Direkt, Klima, Konstant …)
- `*_Produkte_Konditionen` – **Produkt-ID**, **Angebots-ID**, Vertragslaufzeit (VL), Preisgarantie (PG), Bonus
- `*_Produkte_Vergleich` – Vergleichs-/Wettbewerbstarif (für Ersparnisberechnung)
- Auswahl-Abfragen `30x_..._Auswahl_Preise/Konditionen` – filtern nach **gültig ab**, **Verbrauch**, **Gebiet**, Zählerart …
- `*_Vergleichspreis`, `*_TB_Berechnung` (Teilbetrag/Abschlag mit `Gas_Verbrauchsgewichtung`)

### 3.3 Externe Gebiete (große Tabellen)
PLZ/Ort/Netz-genaue Preise für Gebiete außerhalb des eigenen Netzes:
`TB 600/700/800_Preise externes Gebiet` mit **100.000–153.000 Zeilen**; per UNION/MAKE-TABLE-Abfragen zu „Interface Angebots-ID Extern"-Tabellen (SAP-Felder: VPPWERK, VPRPROID, VPPPS …) aufbereitet.

### 3.4 Bedienoberfläche (Formulare)
- Einstieg: `Start` → Produktauswahl
- Eingabe: `e-regio_<Produkt>_Vergleich` (+ `_extern`, `_TB_Berechnung`)
  Parameter: Verbrauch, Gebiet (1=übrige, 2=BHM, 3=WTB, 4=EUS), Vertragsbeginn, Gültigkeit, Neukundenbonus, Aktionsbonus, Vergleichstarif, USt-Satz …
- Ausgabe: `xx4_<Produkt>_Produkt_Kunde_n` (Kundensicht) und `…_Sachbearbeiter_n` (mit Produkt-ID/Angebots-ID)
- Druck: 18 „Beispielberechnung"-Berichte

### 3.5 Datenfluss-Besonderheit ⚠️ (zentral fürs Konzept)
18 Tabellen `TB Import …` sind **verknüpft** mit einem **gemeinsamen Backend**:
`H:\K-K-D\Hilfsmittel\Produkte für Kundenportal.accdb`

→ **Dort** landen die importierten Rohpreise; das Produkt-ID-Tool verlinkt sie und baut per Append/Make-Table seine Arbeitstabellen. **Das ist die „Preise werden in Access aktualisiert"-Quelle.**

### 3.6 Rechenlogik
- USt: Preise brutto@19 % gespeichert, dann mit form-seitigem `UstProzentsatz` neu hochgerechnet (für temporäre USt-Senkungen).
- Boni: Neukundenbonus/Aktionsbonus verbrauchsabhängig (Switch-Staffeln).
- Laufzeit/Preisgarantie via `DateAdd`-Logik.
- **Eigene VBA-Funktion `MyRound`** (Modul `Eigene_Funktionen`) wird überall zum Runden genutzt.

**Bewertung:** Fachlich anspruchsvoll, viel Geschäftslogik, eng an Access-Formulare gekoppelt. **Hauptaufwand des Projekts.**

---

## 3a. Vollständige Datenherkunft (geklärt) 🔗

```
  SAP IS-U (Werk 59)              Manuell gepflegt
  WERK59_* Exporte           \\rge.lan\filesrv\...\K-K-D\40 Hilfsmittel\
  (Straßen-/Vertragsstamm)      Tabellen manuell gepflegt.accdb (RGE_ProduktID)
          │                              │
          └──────────────┬───────────────┘
                         ▼
        H:  Produkte für Kundenportal.accdb   (= \\rge.lan\filesrv\...\K-K\K-K-D)
        - Produkte Strom (40), Produkte Gas (15)  ← Produktstamm m. Produkt-/Angebots-ID
        - TB Import * (PLZ/Netz, Gültigkeit, Verbrauchsband, GP/AP/Bonus, Kosten/Marge)
        - TB 002 PLZ Ort, „010 Ausgabe Produkte …" (Export f. Kundenportal)
                         │  (verknüpfte Tabellen)
                         ▼
        Produkt-ID Tool .accdb   ← Berater-Oberfläche (Preisvergleich, Produkt-/Angebots-ID)
```

**Erkenntnisse:**
- Quelle ganz oben: **SAP (Werk 59)** + eine **manuell gepflegte** Access-Datei auf `\\rge.lan\filesrv`.
- Das Backend speist offenbar auch ein **Online-Kundenportal** (Abfragen „010 Ausgabe Produkte …").
- `Einfügefehler` (2.157 Zeilen) = Protokoll fehlgeschlagener Importe.

## 4. Offene Punkte / benötigt für 1:1-Nachbau

| # | Was | Status |
|---|---|---|
| 1 | **VBA-Code** Modul `Eigene_Funktionen` (`MyRound`, `ToZahl`, `ToChar`, `SuchZahl`) | ✅ **erhalten** – `MyRound` = kaufm. Runden `Fix(Zahl*10^n + Sgn(Zahl)*0,5)/10^n` |
| 2 | **Backend** `Produkte für Kundenportal.accdb` | ✅ **ausgelesen** (28 Tabellen, Datenherkunft geklärt, s. 3a) |
| 3 | Gebietscodes | ✅ **geklärt:** BHM=Bornheim, WTB=Wachtberg, EUS=Euskirchen, sonst „übrige" |
| 4 | **Update-Prozess** der Preise | ✅ **geklärt:** unregelmäßig (spotmarktgetrieben, 1–2 Tage bis mehrere Monate) → **manueller Sync-Button im Admin-Bereich**, kein tägliches Polling |
| 5 | **Tarifvarianten-Matrix** je Produktlinie | ⏳ teils sichtbar, Bestätigung sinnvoll |
| 6 | **Formular-Details** (Feldlisten, Pflichtfelder, Ereignis-Logik) | ⏳ für originalgetreue UI (Screenshots genügen) |

**Aktuelle Gültigkeitsstichtage** (Stand 18.06.2026): Gas **22.05.2026** · Strom **18.06.2026** · Heizstrom **22.05.2026** · Steuerbare §14a **18.06.2026**.

---

## 5. Zielarchitektur (On-Premise Web-App)

```
                  ┌─────────────────────────────────────────────┐
                  │           Firmennetz / On-Prem-Server        │
                  │                                              │
  Access-Pflege   │   ┌──────────────┐   Sync-Job (geplant)     │
  (H:\...\         │   │ Access-Preise │──────────┐              │
  Produkte für    │──▶│ (bleibt!)     │          ▼              │
  Kundenportal)   │   └──────────────┘   ┌─────────────────┐    │
                  │                       │  PostgreSQL DB  │    │
  30 Berater  ───▶│   ┌──────────────┐   │  - Preise (read)│    │
  (Browser)       │   │  Web-App      │◀─▶│  - Besuche (r/w)│    │
                  │   │  .NET + React │   └─────────────────┘    │
                  │   └──────────────┘                          │
                  └─────────────────────────────────────────────┘
```

- **Datenbank:** **PostgreSQL** (kostenlos, on-prem, 30+ Nutzer mühelos – Access bremst hier deutlich).
- **Preis-Datenfluss:** Pflege bleibt in Access. Ein **Sync** liest die Access-Preise (gleiche Jackcess-Technik, mit der diese Analyse entstand) und lädt sie nach PostgreSQL. Ausgelöst über einen **„Sync"-Button im Admin-Bereich** (da Preisänderungen unregelmäßig/spotmarktgetrieben sind) mit Anzeige „zuletzt synchronisiert am …"; optionaler Zeitplan als Fallback. Die App liest schnell aus PostgreSQL – **kein** direkter Zugriff von 30 Nutzern auf die Access-Datei.
- **Preis-Logik:** Auswahl-Abfragen + `MyRound` werden **im Backend nachgebaut** (sauberes SQL/Code).
- **Backend:** **.NET (C#/ASP.NET Core)** – passt zu Windows/On-Prem und Access-Interop. (Alternativen: Node/TypeScript, Python/FastAPI.)
- **Frontend:** **React** – zwei Bereiche: Preisrechner & Besucher-Dashboard.
- **Besuchsdaten:** 43k Zeilen einmalig migrieren; Neuerfassung direkt in der App.
- **DSGVO:** `Kundenbesuche` enthält **keine** Kundennamen (nur Kategorie/Zeit/Standort) → unkritisch; alles on-prem, mit Benutzer-/Rechteverwaltung.

---

## 6. Vorgehen in Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0 – Discovery** ✅ | Beide DBs ausgelesen & analysiert | Dieses Dokument |
| **1 – Lücken schließen** | VBA, H:-Backend, Formular-/Fachdetails (Abschnitt 4) | Vollständiges Datenmodell |
| **2 – Fundament** | PostgreSQL-Schema, Access→PG-Sync, Besuchsdaten-Migration | Lauffähige Datenbasis |
| **3 – Besuchermodul** | Schnelle Erfassung + **Dashboard** | Erster sichtbarer Nutzen, validiert den Stack |
| **4 – Preis-Engine** | Logik je Produktlinie (Strom zuerst), Ergebnis-Screens, Produkt-/Angebots-ID, Beispielrechnung-PDF | Kernfunktion |
| **5 – Externe Gebiete & Rollout** | PLZ/Netz-Preise, Teilbetrag, beide Center, Schulung | Produktivbetrieb |

**Empfehlung Startpunkt:** **Phase 3 (Besuchermodul + Dashboard)** zuerst – fachlich einfach, voll spezifiziert, schnell vorzeigbar, und validiert die gesamte Architektur. Die komplexe Preis-Engine läuft parallel in der Detailklärung (Phase 1).

---

## 7. Risiken & Hinweise

- **Preis-Engine = Hauptaufwand**: viel Logik, USt-/Bonus-Sonderfälle, exakte Rundung – muss sorgfältig getestet werden (Alt-Tool vs. neue App vergleichen).
- **H:-Backend** ist ein Single Point of Truth für Preise – Update-Prozess muss sauber an den Sync gekoppelt werden.
- **Access als Pflege-Oberfläche** bleibt vorerst – langfristig optional ablösbar.
- **Migration der Besuchsdaten** ist unkritisch (saubere, flache Struktur).
```
