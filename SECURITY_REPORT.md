# Security Report — Kundenservice Control Center

**Datum:** 2026-06-25
**Scope:** Vanilla-JS-Frontend + Fastify-API (`backend/`, gebündelt zu `api/index.js`) + SQLite/Turso, Deployment auf Vercel.
**Durchgeführt von:** Automatisierter Semgrep-Audit + manuelle Code-Prüfung + Remediation.

---

## 1. Zusammenfassung

| | Vorher | Nachher |
|---|---|---|
| **Semgrep – Custom-Regeln** (Projekt-spezifisch) | 2× ERROR, 2× WARNING | **0** |
| **Semgrep – Registry** (p/javascript, p/nodejs, p/owasp-top-ten, p/secrets) | 0 High/Critical | **0 High/Critical** |
| **npm audit** | 6 High, 1 Moderate, 0 Critical | 6 High, 1 Moderate, 0 Critical *(Dep-Tree, siehe §6)* |
| **Kritische App-Lücken (manuell gefunden)** | 4 | **0 offen** (alle gefixt) |

**Ergebnis:** Es verbleiben **keine High/Critical-Findings** im Anwendungscode. Die
verbliebenen `npm audit`-Highs liegen ausschließlich im **Dependency-Tree** (Fastify-4-Kette
+ `xlsx`) und lassen sich nur über einen **Breaking-Major-Upgrade** beheben — bewusst nicht
automatisch durchgeführt (siehe §6, mit Handlungsempfehlung).

> **Wichtig:** Die Semgrep-Community-Regeln (Registry) fanden 0 Findings — die schwersten
> Lücken (fehlende Auth, offener CORS, SSRF) sind **Design-Level** und wurden durch die
> **manuelle Prüfung** gefunden. Zum Beleg per Tool wurde ein projektspezifisches
> Custom-Ruleset (`.semgrep-custom.yml`) erstellt, das diese Muster vorher/nachher misst.

---

## 2. Methodik & Tooling

- **Semgrep 1.168.0** (per `pip` installiert; das Semgrep-*Guardian*-Plugin lief in eine
  kaputte OAuth-Schleife und wurde deaktiviert — der reine CLI-Scanner lief unabhängig).
- Regelsätze: `p/javascript`, `p/nodejs`, `p/owasp-top-ten`, `p/secrets` (582 Regeln
  geladen, 111 anwendbar) + eigenes `.semgrep-custom.yml`.
- **npm audit** für Dependency-Schwachstellen.
- **Manuelle Prüfung** aller Routen, Repos, Frontends (Auth, SQL, XSS, CORS, SSRF,
  Secrets, Header).
- **Lokaler Boot- & Smoke-Test** der API (Auth-Gate 401/200, SSRF-Block 400, CORS-Reflexion,
  Helmet-Header, Rate-Limit-Header) vor dem Bundle-Build.

Scan-Ausschlüsse via `.semgrepignore` (node_modules, generiertes `api/index.js`, lokale DB).
Hinweis: Semgreps Registry-HTML-Engine erzeugt eine **Partial-Parse-Warnung** in
`admin/index.html:832` (Sonderzeichen `& · §` in einer langen Inline-Zeile) — kein
Code-Defekt; die Datei ist valides UTF-8 und wurde vom Custom-Ruleset fehlerfrei gescannt.

---

## 3. Findings pro Kategorie

| # | Kategorie | Schwere | Status | Kurzbefund |
|---|-----------|---------|--------|-----------|
| 1 | **SQL Injection** | — | ✅ Sauber | Alle Queries parametrisiert (`?`-Platzhalter über Repo-/Driver-Abstraktion). Keine String-Konkatenation in SQL. |
| 2 | **XSS** | High | ✅ Fixed | Unvollständige Escaper + roher `innerHTML` von DB-Daten. Escaper vervollständigt, Attribute escaped, CSS-Farben sanitisiert. |
| 3 | **CSRF** | Medium | ✅ Mitigated | Schreibende Admin-Ops jetzt Token-pflichtig (Bearer); CORS auf Allowlist. Reine GET-Reads bleiben offen (unkritisch). |
| 4 | **SSRF** | Critical | ✅ Fixed | `fetch(row.source_value)` ohne Prüfung → URL-Validierung (Schema, DNS, private/loopback-IPs), Timeout, Größenlimit. |
| 5 | **Authentication** | Critical | ✅ Fixed | API war komplett offen; Client-Passwort hardcoded. Shared-Secret-Bearer-Gate + serverseitige Token-Prüfung. |
| 6 | **Authorization** | Critical | ✅ Fixed (Kern) | Admin-/Import-/Vertrags-/Seed-Routen hinter `requireAdmin`. Rest-Risiko §5 dokumentiert. |
| 7 | **Secrets** | Critical¹ | ⚠️ Advisory | rw-Turso-Tokens + Vercel-OIDC in `.env*`. **Gitignored, nicht in git-Historie.** Rotation = manuell (§7). `.env.example` ergänzt. |
| 8 | **Environment Variables** | Low | ✅ Improved | Fail-closed-Prüfung für `ADMIN_API_TOKEN` in Produktion; `.env.example` als Vorlage. |
| 9 | **API Security** | High | ✅ Fixed | Generische Fehlermeldungen (kein DB-Error-Leak), Input-Validierung, destruktive `/seed-test` geschützt. |
| 10 | **Security Headers** | High | ✅ Fixed | `@fastify/helmet` auf API + Baseline-Header in `vercel.json` (HSTS, nosniff, Frame-Options, Referrer/Permissions-Policy). |
| 11 | **Rate Limiting** | High | ✅ Fixed | `@fastify/rate-limit` global (300/min/IP) + strenger (20/min) auf Bulk-Import. |
| 12 | **Dependency Vulns** | High | ⚠️ Advisory | 6 High im Dep-Tree (Fastify-4-Kette, `xlsx`); nur per Breaking-Upgrade behebbar (§6). |

¹ *Schwere theoretisch Critical, reales Rest-Risiko niedrig — Tokens lokal, gitignored, nie committet.*

---

## 4. Durchgeführte Fixes (Detail)

### 4.1 Authentication / Authorization (Critical)
**Problem:** Jeder Endpunkt war ohne Anmeldung erreichbar — inkl. Preisänderungen,
Daten-Importe, Vertrags-Upload/-Löschung und ein destruktives `GET /seed-test`
(löscht + befüllt Mitbewerber-Daten neu). Einziger Schutz: ein hardcoded Passwort
`eregio2026#` im Browser-JS (per DevTools trivial umgehbar).

**Fix:**
- Neu `backend/lib/auth.js` → `requireAdmin` preHandler, vergleicht `Authorization: Bearer`
  mit `ADMIN_API_TOKEN` per **constant-time** (`crypto.timingSafeEqual`). In Produktion
  ohne gesetztes Token: **fail-closed** (503). Lokal: dokumentierter Dev-Fallback + Warn-Log.
- Gate gesetzt auf: `POST/PUT/DELETE /api/admin/gueltigkeit`, `POST /api/admin/import/*`,
  `POST/PUT/DELETE /api/vertragsformulare`, `GET /api/mitbewerber/seed-test`.
- Frontend `admin/index.html`: **hardcoded Passwort entfernt**. Login prüft das Passwort
  jetzt serverseitig (`GET /api/admin/auth-check`) und nutzt es als Bearer-Token. Ein
  fetch-Wrapper hängt den Header automatisch an alle API-Aufrufe. Das Secret liegt damit
  nie im ausgelieferten JS.

**Verifiziert:** Admin-POST ohne Token → `401`; mit korrektem Token → `200`;
`seed-test` ohne Token → `401`; offene Reads (`/api/produktdaten`) → `200`.

### 4.2 SSRF (Critical)
**Problem:** `GET /api/vertragsformulare/:id/file` rief `fetch(row.source_value)` auf eine
gespeicherte URL ohne jede Prüfung → Zugriff auf interne Dienste / Cloud-Metadaten
(`169.254.169.254`) möglich.

**Fix:** `assertSafeUrl()` erlaubt nur `http`/`https`, löst den Host per DNS auf und
blockt private/loopback/link-local-Adressen (IPv4 + IPv6, inkl. IPv4-mapped). Zusätzlich
`redirect: 'error'`, `AbortController`-Timeout (8s) und Größenlimit (25 MB).

**Verifiziert:** URL auf `169.254.169.254` bzw. `127.0.0.1` → sauberes `400 "PDF-URL nicht erlaubt"`.

### 4.3 Path Traversal (Medium)
**Problem:** Legacy `local`-Quelle nutzte `path.resolve(row.source_value)` ohne Schranke
(`../../etc/...`, Symlinks).
**Fix:** Auflösung gegen festes Basis-Verzeichnis `LOCAL_PDF_BASE` + `fs.realpathSync`;
Ausbruch (`..`/absolut) → `403`.

### 4.4 CORS (High)
**Problem:** `origin: (origin, cb) => cb(null, true)` reflektierte **jeden** Origin.
**Fix:** Allowlist (`kundenservice-control-center.vercel.app` + localhost; erweiterbar via
`CORS_EXTRA_ORIGINS`). **Verifiziert:** fremder Origin wird nicht reflektiert, erlaubter schon.

### 4.5 Security Headers (High)
`@fastify/helmet` auf der API (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
`X-DNS-Prefetch-Control`, `X-Download-Options`). CSP bewusst aus, da die API JSON/PDF liefert
und die HTML-Seiten statisch über Vercel ausgeliefert werden. Zusätzlich Baseline-Header für
**alle** statischen Seiten in `vercel.json` (HSTS, nosniff, Frame-Options, Referrer-Policy,
Permissions-Policy). **Verifiziert** per Response-Header-Check.

### 4.6 Rate Limiting (High)
`@fastify/rate-limit`: global 300/min/IP, Bulk-Import 20/min. **Verifiziert** (`x-ratelimit-limit: 300`).

### 4.7 XSS (High)
- `admin/index.html` `escHtml`: fehlende `>` und `'`/`"` ergänzt.
- `einsatzplaner/app.js`: `esc()` um Quotes erweitert; bisher unescaptes `kuerzel`/`name`
  in allen Templates gewrappt; neue `safeColor()` (nur `#hex`/`rgb`/`hsl`/benannt) für alle
  aus der DB stammenden Farbwerte in `style=`/`--ac` → schützt vor CSS-Injection.
- `besucher-dashboard/app.js`: `esc()` ergänzt und auf alle DB-Labels in `innerHTML`/SVG angewandt.
- `produkt-id-tool/modules/pdf-modal.js`: Formular-Name (`e.name`) per `escPdf()` escaped.

### 4.8 API-Härtung & Validierung (Medium)
- `admin-preise.js`: DB-Fehler werden geloggt (`req.log.error`), Client bekommt generische
  Meldung („Interner Fehler …") statt roher `e.message` → kein Schema-/Query-Leak.
- `besucher.js` POST: Format-/Längen-Checks (Datum `YYYY-MM-DD`, `stunde` 0–23, Längenlimits).
- `admin-preise.js` PUT: fehlende Datums-Validierung ergänzt.

---

## 5. Bekanntes Rest-Risiko (dokumentiert, bewusst offen)

- **`POST /api/besucher`** (Besucher-Erfassungsleiste) und **`einsatzplaner`-Schreibrouten**
  (Agents/Assignments/Notes) bleiben **ohne Token**, da sie von Nicht-Admin-Mitarbeiter-UIs
  ohne Login genutzt werden. Schreibzugriff ist damit weiter offen.
  **Empfehlung:** mittelfristig ein leichtgewichtiges Mitarbeiter-Token o. Ä. einführen
  und diese Routen ebenfalls hinter ein Gate stellen. (Input-Validierung für `besucher`
  ist bereits ergänzt.)

---

## 6. Dependency-Schwachstellen (npm audit)

`npm audit`: **0 Critical, 6 High, 1 Moderate.** Alle im transitiven Dependency-Tree:

| Paket | Schwere | Advisory | Fix |
|---|---|---|---|
| `fast-uri` (≤3.1.1) → `fastify`-Kette | High | Path Traversal / Host Confusion (GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc) | nur via `fastify@5` (**Breaking Major**) |
| `xlsx` (*) | High | Prototype Pollution + ReDoS (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) | **kein npm-Fix** (SheetJS nur noch via CDN) |
| `esbuild` (≤0.24.2) | Moderate | Dev-Server Request-Leak (GHSA-67mh-4wv8-2f99) | `esbuild@0.28` (**Breaking**); nur Dev-Tool |

**Bewertung:** Nicht „sicher" automatisch behebbar — ein Fastify-4→5-Upgrade ist ein
Breaking Change und braucht eine eigene Migration + Tests; `xlsx` erfordert einen Wechsel
auf die SheetJS-CDN-Variante. Reales Risiko hier moderat (interne App; ReDoS/Dev-Server).

**Empfohlene Follow-ups (separat geplant):**
1. Fastify 4 → 5 migrieren (behebt `fast-uri`/`fast-json-stringify`-Kette).
2. `xlsx` auf `https://cdn.sheetjs.com/...` umstellen.
3. `esbuild` auf aktuelle Version heben (nur Dev/Build).

---

## 7. Manuelle Aktionen für den Betreiber (nicht automatisierbar)

1. **`ADMIN_API_TOKEN` setzen** — in Vercel (Environment) und lokal in `.env`. Stark wählen.
   In Produktion MUSS es gesetzt sein (sonst antworten Admin-Routen mit `503`).
2. **Secrets rotieren** (Vorsichtsmaßnahme — kein Leak bekannt, aber lagen im Klartext in
   `.env`/`.env.local`):
   - 3 Turso-rw-Tokens im Turso-Dashboard neu erzeugen.
   - Vercel-OIDC-Token (`.env.local`) via Vercel CLI neu holen.
   - Werte nur im Vercel-Env-Dashboard / lokaler `.env` halten (beide gitignored).
3. **Deploy:** Fixes sind im Bundle (`api/index.js` neu gebaut), aber **noch nicht
   deployt** — push/redeploy bei Gelegenheit selbst.

---

## 8. Geänderte / neue Dateien

**Backend:** `backend/lib/auth.js` (neu), `backend/app.js`, `backend/routes/{admin-preise,
admin-import,vertragsformulare,mitbewerber,besucher}.js`, `api/index.js` (neu gebaut).
**Frontend:** `admin/index.html`, `einsatzplaner/app.js`, `besucher-dashboard/app.js`,
`produkt-id-tool/modules/pdf-modal.js`.
**Config:** `vercel.json` (Header), `.env.example` (neu), `package.json` (helmet + rate-limit).
**Audit-Artefakte:** `.semgrep-custom.yml`, `.semgrepignore` (für künftige Scans).

---

## 9. Reproduktion der Scans

```bash
# Custom-Regeln (Projekt-spezifisch)
semgrep scan --config .semgrep-custom.yml \
  backend admin einsatzplaner besucher-dashboard produkt-id-tool shared scripts api index.html

# Registry-Regelsätze
semgrep scan --config p/javascript --config p/nodejs --config p/owasp-top-ten --config p/secrets \
  --timeout 120 --max-target-bytes 0 \
  backend admin einsatzplaner besucher-dashboard produkt-id-tool shared scripts api index.html

# Dependencies
npm audit
```
