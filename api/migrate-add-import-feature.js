// Additive Turso-Migration für das Admin-Datenupload-Feature (import_history + besuche.ts).
//
// WARUM separat von migrate-to-turso.js: jenes Skript ist destruktiv (DELETE + Neubefüllen
// aus den lokalen Dateien) und würde produktiv erfasste Daten überschreiben. Dieses Skript
// ist rein ADDITIV und IDEMPOTENT — es legt nur die fehlenden Strukturen an und fasst keine
// Daten an. Beliebig oft ausführbar.
//
// Wendet auf die per .env konfigurierten Turso-DBs an:
//   • produkte:  CREATE TABLE import_history (+ Index)   — IF NOT EXISTS
//   • besucher:  ALTER TABLE besuche ADD COLUMN ts TEXT   — Fehler "duplicate column" wird ignoriert
//
// Voraussetzung: .env im Projekt-Root mit PRODUKTE_DB_URL/-AUTH_TOKEN und BESUCHER_DB_URL/-AUTH_TOKEN.
// Start:  node api/migrate-add-import-feature.js

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

// ── .env minimal einlesen (kein dotenv nötig) ────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) {
    console.error('FEHLER: .env nicht gefunden unter ' + p);
    console.error('Lege .env an (Vorlage: .env.example) und trage die Turso-Werte ein.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const IMPORT_HISTORY = `
  CREATE TABLE IF NOT EXISTS import_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    kind        TEXT NOT NULL,
    source_file TEXT,
    added       INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    detail      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_import_history_ts ON import_history(ts);
`;

function connect(urlEnv, tokenEnv) {
  const url = process.env[urlEnv];
  const authToken = process.env[tokenEnv];
  if (!url) { console.error(`FEHLER: ${urlEnv} fehlt in .env`); process.exit(1); }
  if (!url.startsWith('libsql://') && !url.startsWith('https://')) {
    console.error(`FEHLER: ${urlEnv} zeigt nicht auf Turso (libsql://…) — Abbruch zum Schutz lokaler Dateien.`);
    process.exit(1);
  }
  return createClient({ url, authToken: authToken || undefined, intMode: 'number' });
}

async function main() {
  loadEnv();

  // ── produkte: import_history ───────────────────────────────────────────────
  const produkte = connect('PRODUKTE_DB_URL', 'PRODUKTE_DB_AUTH_TOKEN');
  await produkte.executeMultiple(IMPORT_HISTORY);
  const t = await produkte.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='import_history'");
  console.log(`✓ produkte: import_history ${t.rows.length ? 'vorhanden' : 'FEHLT (?)'}`);

  // ── besucher: Spalte ts ─────────────────────────────────────────────────────
  const besucher = connect('BESUCHER_DB_URL', 'BESUCHER_DB_AUTH_TOKEN');
  try {
    await besucher.execute('ALTER TABLE besuche ADD COLUMN ts TEXT');
    console.log('✓ besucher: Spalte besuche.ts hinzugefügt');
  } catch (e) {
    if (/duplicate column/i.test(e.message)) console.log('✓ besucher: Spalte besuche.ts existiert bereits');
    else throw e;
  }

  console.log('\nFertig. Migration ist additiv & idempotent — erneutes Ausführen ist gefahrlos.');
}

main().catch((e) => { console.error('Migration fehlgeschlagen:', e); process.exit(1); });
