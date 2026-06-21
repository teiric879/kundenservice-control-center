# Datenschicht (`api/data`)

Zentrale, **austauschbare** DB-Anbindung. Alle Datenbankzugriffe des Servers laufen ausschließlich
hier durch — Routes und UI enthalten **kein SQL**.

## Schichten

```
routes/*.js            Fastify-Handler — nur Validierung + Aufruf von Service/Repository
  │
  ├─ lib/preis-service.js     Geschäftslogik (Klon-Vorlage, Netto→Brutto, aid/pid auflösen)
  │     │
  └─────┴─ data/repositories/*.js   ALLE SQL-Strings (produkte / registry / besucher / einsatzplaner)
              │
              └─ data/driver/        uniformes async-Interface { all, get, run, exec, transaction }
                   ├─ index.js        DB-Auswahl + Verbindungskonfiguration (pro DB eine ENV-Var)
                   └─ libsql.js       konkrete @libsql/client-Implementierung (Turso / file:)

data/ddl.js     Single Source of Truth für das Schema (von beiden Schema-Pfaden genutzt)
data/schema.js  async Schema-Ensure beim Server-Boot
```

## Lokal vs. Turso

- **Lokal:** keine ENV nötig → `file:`-Modus gegen `api/db/{produkte,besucher,einsatzplan}.sqlite`.
- **Turso/Vercel:** je DB `*_DB_URL` (`libsql://…`) + `*_DB_AUTH_TOKEN` setzen (siehe `.env.example`).
  Nur der Connection-String wechselt; derselbe Code läuft lokal wie remote.

### Daten nach Turso übertragen (einmalig, volle Historie)

```bash
turso db create produkte    --from-file api/db/produkte.sqlite
turso db create besucher    --from-file api/db/besucher.sqlite
turso db create einsatzplan --from-file api/db/einsatzplan.sqlite
turso db show <name>            # URL
turso db tokens create <name>  # Auth-Token
```

## Späterer Wechsel auf SQL Server / Azure SQL

Nur ein zweiter Driver mit identischer Signatur (`data/driver/mssql.js`) + Einhängen in
`data/driver/index.js`. Repositories enthalten SQLite-Dialekt-SQL; dialektspezifische Stellen
(`date(?, '+4 days')`, `INSERT OR REPLACE`, `||`, `LIKE`) werden dort angepasst. Routes/Service/UI
bleiben unberührt.

## Hinweis: zwei Schema-Pfade

- `api/data/schema.js` (async) — Server-Boot, libSQL/Turso.
- `api/schema.js` (sync, `node:sqlite`) — **nur** für die Access-Import-Pipeline (`migrate-*.js`).

Beide teilen sich die DDL aus `data/ddl.js`. Schemaänderungen dort vornehmen, dann ggf. in beiden
Setup-Dateien berücksichtigen.
