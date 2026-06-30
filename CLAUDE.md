# Kundenservice Control Center — Design-Framework (e-regio CD)

Verbindliche Design-Richtlinie für **dieses Projekt**. Quelle: „CD Manual e-regio 05/2025".
Bei jeder UI-/Export-Arbeit hier einhalten. Tokens leben in [`shared/tokens.css`](shared/tokens.css).

## Farben (autoritativ aus dem CD Manual)

### Primär
| Rolle | Hex | Token |
|---|---|---|
| e-regio **Grün** (dominante Marke, Text/Linien/Headlines) | `#004442` | `--ci` |
| e-regio **Gelb** (Primärakzent, gezielt – CTAs, Highlights) | `#ffc300` | `--acc` |

### Sekundär
| Rolle | Hex | Token |
|---|---|---|
| Gelb dunkler (Verläufe, „Preis im 1. Jahr") | `#dea600` | `--acc-2` |
| Gold als Text (kontraststark auf hell) | `#8a6a00` | `--acc-ink` |
| Anthrazit (Copy-Alternative zu Grün) | `#282828` | – |
| Türkis (hervorgehobene Flächen / Infoboxen) | `#c8e6e1` | `--turq` |
| Türkis-2 | `#a0c8c2` | `--turq-2` |
| Weiß | `#ffffff` | – |

### Hell-Look (App-eigene Ableitungen)
- Kartenfläche warmweiß `--glass:#fffdf7`, Hover `--glass-hi:#f6f2e6`
- Rahmen `--stroke:#e6e1d2`, aktiv `--stroke-hi:#d6cfba`
- Text: Primär `--ink:#063b37`, sekundär `--muted:#5d7d77`, tertiär `--muted-2:#8aa39d`
- Status: positiv `--pos:#0f7a5a`, negativ `--neg:#c0492a`
- Ergänzende Palette (Infografiken): `#a0c8c2 · #e0f0ec · #f8f6ec · #ffe47e · #fff8c4`

## Typografie
- **Hausschrift: Buenos Aires** (kommerziell, NICHT im Projekt). Headlines = Semibold + Light Italic.
- **Digitaler CD-Ersatz: Calibri** → freier, metrik-identischer Klon **Carlito** ist im Repo
  (`produkt-id-tool/fonts/Carlito-*.ttf`). Für CD-treue Module Carlito nutzen.
- Bestehende Module nutzen **Hanken Grotesk** (Display, Buenos-Aires-Annäherung) + **DM Sans** (Body)
  aus [`shared/fonts.css`](shared/fonts.css). Konsistenz pro Modul wahren – nicht mischen.
- Tabellen/Zahlen: Tabular-Figures (`font-variant-numeric:tabular-nums`).

## Logo / Signet
- Asset: `shared/eregio-logo-gruen.png`. Schutzzone = Höhe des „e" rundum. Proportionen nie ändern.
- Auf hellem Grund: Gelb & Grün. Gelb muss als Primärfarbe immer präsent sein.

## Komponenten-Konventionen
- **Karten:** `--glass` Fläche, `--stroke` Rahmen, Radius ~14–18px, weiche Schatten.
- **Buttons (CTA):** solides Gelb `--acc`, Text in `--ci`, Pill-Form. Pro Screen genau **eine** primäre CTA.
- **Tarif-/Infobox-Kacheln:** CD-Infobox = Türkis-Fläche + grüner Text (siehe Produkt-ID-Tool Vergleichskarte).
- **Fokus:** sichtbarer Ring `2px solid var(--ci)`.
- Icons: SVG (kein Emoji), einheitliche Strichstärke; keine Raster-Icons.

## PDF-/Druck-Export (Management-Report-Look)
- Export = `window.print()` + `@media print`. **Immer nur den Druck anfassen, nie die Bildschirm-Ansicht.**
- Reine **weiße** Seite (kein beiger App-Farbverlauf) und **weiße Karten** (`--glass`-Flächen auf `#fff` zwingen,
  inkl. `background-image:none`). App-Chrome (Sidebar/Tabs/Filter/Floating-Bars) ausblenden.
- Kennzahlen/Headlines in `--ci` Grün, Akzente in CD-Gold, dünne CD-Hairlines statt beiger Rahmen.
- Dokumentkopf: Logo + Titel (Grün) + grüne Trennlinie + Erstellt-am-Stempel.
- `print-color-adjust:exact`, `@page{margin:0}` (keine Browser-Kopf-/Fußzeile).

## Arbeitsregeln
- **Vor Commit immer fragen** (nie automatisch committen/pushen).
- Statische Module werden per `?v=`-Query gecacht: Bei JS/CSS-Änderungen **Versionsnummer hochzählen**,
  sonst liefert der Browser die alte Datei (häufige Fehlerquelle).
