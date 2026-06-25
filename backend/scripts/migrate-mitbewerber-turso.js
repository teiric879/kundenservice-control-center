// Legt die mitbewerber_preise-Tabelle auf der Turso-DB an.
// Usage: node backend/scripts/migrate-mitbewerber-turso.js
// Benötigt TURSO_DB_URL + TURSO_AUTH_TOKEN aus .env.local

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_PRODUKTE_URL || process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_PRODUKTE_TOKEN || process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log('Verbinde mit Turso DB…');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS mitbewerber_preise (
      id               TEXT PRIMARY KEY,
      anbieter         TEXT NOT NULL,
      sparte           TEXT NOT NULL,
      plz_gebiet       TEXT,
      arbeitspreis     REAL,
      grundpreis       REAL,
      bonus            REAL,
      bonus_bedingung  TEXT,
      gueltig_ab       TEXT,
      gueltig_bis      TEXT,
      quelle           TEXT NOT NULL DEFAULT 'scrape',
      aktualisiert_am  TEXT NOT NULL,
      hash_content     TEXT
    )
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mitbewerber_lookup ON mitbewerber_preise(sparte, plz_gebiet)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mitbewerber_anbieter ON mitbewerber_preise(anbieter, sparte)`);

  console.log('✓ Tabelle mitbewerber_preise angelegt');
  process.exit(0);
}

migrate().catch(err => { console.error('Fehler:', err); process.exit(1); });
