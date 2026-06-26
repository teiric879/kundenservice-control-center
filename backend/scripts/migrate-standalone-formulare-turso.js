// Legt die standalone_formulare-Tabelle auf der Turso-Produkte-DB an.
// Additiv & idempotent (CREATE TABLE IF NOT EXISTS) – ändert nichts Bestehendes.
//
// Liest die Turso-Zugangsdaten aus .env im Projekt-Root (gleiches Muster wie
// api/migrate-to-turso.js – kein dotenv nötig):
//   PRODUKTE_DB_URL / PRODUKTE_DB_AUTH_TOKEN
//
// Start:  node backend/scripts/migrate-standalone-formulare-turso.js

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const ddl = require('../data/ddl');

// ── .env minimal einlesen (kein dotenv nötig) ────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(p)) {
    console.error('FEHLER: .env nicht gefunden unter ' + p);
    process.exit(1);
  }
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function migrate() {
  loadEnv();
  const url = process.env.PRODUKTE_DB_URL;
  const authToken = process.env.PRODUKTE_DB_AUTH_TOKEN;
  if (!url) {
    console.error('FEHLER: PRODUKTE_DB_URL fehlt in .env');
    process.exit(1);
  }
  console.log('Verbinde mit Turso Produkte-DB…');
  const db = createClient({ url, authToken });
  await db.execute(ddl.STANDALONE_FORMULARE_TABLE);
  console.log('✓ Tabelle standalone_formulare angelegt (bzw. bereits vorhanden)');
  process.exit(0);
}

migrate().catch(err => { console.error('Fehler:', err); process.exit(1); });
