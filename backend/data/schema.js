// Async Schema-Setup für den Server-Boot (libSQL/Turso-Pfad).
//
// Stellt die Tabellen idempotent sicher — wichtig für eine frische Turso-DB. Teilt sich die DDL
// mit dem sync Migrate-Pfad (api/schema.js) über api/data/ddl.js, damit nichts auseinanderläuft.
//
// Hinweis: Die einmalige ep_assignments-„v2"-Tabellenumstellung (PRAGMA-basiert) aus api/schema.js
// wird hier bewusst NICHT repliziert — sie betrifft nur sehr alte lokale Dateien; eine frische
// Turso-DB bekommt direkt das finale Schema, eine aus dem Datei-Dump kopierte hat es bereits.

const { getDb } = require('./driver');
const ddl = require('./ddl');

// ALTER … ADD COLUMN wirft auf bereits vorhandener Spalte → einzeln absichern.
async function tryAlters(db, statements) {
  for (const sql of statements) {
    try { await db.exec(sql); } catch { /* Spalte existiert bereits */ }
  }
}

async function ensureProdukte() {
  const db = getDb('produkte');
  await db.exec(ddl.PRODUKTE_TABLES);
  await tryAlters(db, ddl.PRODUKTE_ALTERS);
  await db.exec(ddl.PRODUKTE_POST_INDEXES);
  await db.exec(ddl.PRODUKTE_REGISTRY);
  await db.exec(ddl.VERTRAGSFORMULARE_TABLE);
  await tryAlters(db, ddl.VERTRAGSFORMULARE_ALTERS);
}

async function ensureBesucher() {
  const db = getDb('besucher');
  await db.exec(ddl.BESUCHER_TABLES);
}

async function ensureEinsatzplan() {
  const db = getDb('einsatzplan');
  await db.exec(ddl.EINSATZPLAN_TABLES);
  // Stammbesetzung seeden (INSERT OR IGNORE → kein Überschreiben bestehender Stände).
  const ins = 'INSERT OR IGNORE INTO ep_agents (name, kuerzel, color) VALUES (?,?,?)';
  for (const [name, kuerzel, color] of ddl.INITIAL_AGENTS) {
    await db.run(ins, [name, kuerzel, color]);
  }
}

async function ensureSchemas() {
  await ensureProdukte();
  await ensureBesucher();
  await ensureEinsatzplan();
}

module.exports = { ensureSchemas, ensureProdukte, ensureBesucher, ensureEinsatzplan };
