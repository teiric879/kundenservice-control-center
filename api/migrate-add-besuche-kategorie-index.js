// Additive Turso-Migration: Index idx_besuche_kategorie auf besuche(kategorie).
//
// WARUM: backend/data/ddl.js legt diesen Index lokal an, aber das Schema-Setup wird auf
// Vercel-Production bewusst übersprungen (backend/app.js → ensureSchemas nur lokal). Deshalb
// muss der Index einmalig direkt gegen die Turso-„besucher"-DB angelegt werden. Er beschleunigt
// das `GROUP BY kategorie` in besucherRepo.topKategorien (Erfass-Leiste / erfass-config).
//
// Rein ADDITIV & IDEMPOTENT (CREATE INDEX IF NOT EXISTS) — beliebig oft ausführbar, fasst
// keine Daten an.
//
// Voraussetzung: .env im Projekt-Root mit BESUCHER_DB_URL (+ optional BESUCHER_DB_AUTH_TOKEN).
// Start:  node api/migrate-add-besuche-kategorie-index.js

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

  const besucher = connect('BESUCHER_DB_URL', 'BESUCHER_DB_AUTH_TOKEN');
  await besucher.execute('CREATE INDEX IF NOT EXISTS idx_besuche_kategorie ON besuche(kategorie)');

  const r = await besucher.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_besuche_kategorie'");
  console.log(`✓ besucher: idx_besuche_kategorie ${r.rows.length ? 'vorhanden' : 'FEHLT (?)'}`);

  console.log('\nFertig. Migration ist additiv & idempotent — erneutes Ausführen ist gefahrlos.');
}

main().catch((e) => { console.error('Migration fehlgeschlagen:', e); process.exit(1); });
