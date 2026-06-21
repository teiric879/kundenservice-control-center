# e-regio · Kundencenter Analytics – Dashboard-Prototyp

Eigenständiges, **offline-fähiges** Web-Dashboard für die Kundenbesuche der Kundencenter
Kall & Euskirchen. Echte, anonyme Daten (43.401 Besuche, 2016–2026) aus
`persönliche Kundenbesuche.accdb` – keine Kundennamen (DSGVO-unkritisch).

## Öffnen
`index.html` im Browser öffnen (Doppelklick). Keine Installation, kein Internet nötig –
Daten in `data.js`, Schriften lokal in `fonts/`.

## Design
- **Stil:** Glassmorphism, dunkles immersives Theme
- **CI-Farbe:** **#003431** (e-regio) als Basis, „Clean-Energy"-Mint als Akzent
- **Typografie:** Space Grotesk (Headlines) + DM Sans (Text) – **selbst-gehostet** (woff2, offline)
- **Dynamik:** Count-up der Kennzahlen, animierter Linienverlauf, Donut-Sweep, wachsende Balken,
  driftende Hintergrund-Glows, weiche Hover-Effekte – respektiert `prefers-reduced-motion`
- Eigene SVG-Charts, **keine externen Bibliotheken**; SVG-Icons (keine Emojis)

## Inhalt
- **Dashboard:** KPIs (heute/Woche/Monat/Jahr + Vergleich + Sparkline), Besuchsverlauf
  (adaptiv täglich/monatlich/jährlich), Donut je Standort, Top-Kategorien, Wochentag, Uhrzeit.
  Filter: Standort + Zeitraum.
- **Besuch erfassen:** Bedien-Demo (Standort → Anliegen). Speichert nur lokal (Demo).
- **Info:** Kurzbeschreibung.

## Dateien
| Datei | Zweck |
|---|---|
| `index.html` · `styles.css` · `app.js` | App |
| `fonts/` · `fonts.css` | Selbst-gehostete Schriften (offline) |
| `data.js` | Besuchsdaten (aus Access via `accdb-tools/ExportVisits.java`) |

## Datenqualität (Beobachtung)
Feld *Kategorie* hat **29** statt 23 Werte (Altwerte „Vertrag", „sonstiges", „PV", „-").
Standort-Tippfehler „kall"/„Kall" zusammengeführt; 7.622 Zeilen 2016–2019 ohne Standort → „(ohne Angabe)".
Final: feste Auswahlliste + Mapping über Tabelle `Kategorie Migration`.

## Vom Prototyp zur produktiven App
PostgreSQL statt `data.js` · echte Erfassung (Schreiben in DB) · Login/Rechte ·
optional erfassenden Mitarbeiter mitspeichern · Integration mit dem Produkt-ID-Preistool.
