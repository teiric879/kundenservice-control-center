// Async Schema-Setup für den Server-Boot (libSQL/Turso-Pfad).
//
// Stellt die Tabellen idempotent sicher — wichtig für eine frische Turso-DB. Teilt sich die DDL
// mit dem sync Migrate-Pfad (api/schema.js) über api/data/ddl.js, damit nichts auseinanderläuft.
//
// PERFORMANCE (2026-06-30): Früher lief der komplette DDL-/ALTER-/Seed-Block bei JEDEM Cold-Start
// — ~47 sequentielle Turso-Round-Trips (u.a. 18 blinde ALTERs + 16 einzelne Agent-INSERTs) ≈ 2–3 s
// vor der ersten Antwort. Jetzt:
//   • PRAGMA user_version als Migrations-Wächter: ist die DB schon auf SCHEMA_VERSION, wird der
//     gesamte Setup übersprungen (nur 1 billiger Read pro DB). DDL/ALTER/Seed laufen nur noch
//     einmalig nach einem Schema-Versionssprung.
//   • Alle CREATE-Statements je DB in EINEM executeMultiple (statt ~8 Einzel-Execs).
//   • Agent-Seed als EIN batch() (statt 16 Einzel-INSERTs).
//   • Admin-Seed (count()) nur bei tatsächlicher (Erst-)Migration.
//
// Schema ändern? → SCHEMA_VERSION erhöhen (+ ggf. neue ALTERs/Tabellen in ddl.js). Beim nächsten
// Boot läuft der Setup dann genau einmal und setzt user_version neu.

const { getDb } = require('./driver');
const ddl = require('./ddl');

const SCHEMA_VERSION = 1;

// Versionsmarker in einer Tabelle (NICHT via PRAGMA user_version — Turso lehnt das
// Setzen mit HTTP 400 ab). Reines Standard-SQL, das überall läuft.
async function getSchemaVersion(db) {
  try {
    const r = await db.get('SELECT version FROM schema_meta WHERE id = 1');
    return r ? Number(r.version || 0) : 0;     // Tabelle existiert, aber leer → 0
  } catch { return 0; }                         // Tabelle fehlt (noch nicht migriert) → 0
}
async function setSchemaVersion(db) {
  try {
    await db.exec('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)');
    await db.run('INSERT OR REPLACE INTO schema_meta (id, version) VALUES (1, ?)', [Number(SCHEMA_VERSION)]);
  } catch (e) {
    // Marker-Schreiben darf den Boot NIE crashen: schlimmstenfalls läuft der (idempotente)
    // Setup beim nächsten Cold-Start erneut (langsamer, aber korrekt).
    console.error('[schema] Versionsmarker konnte nicht gesetzt werden:', e.message);
  }
}

// ALTER … ADD COLUMN wirft auf bereits vorhandener Spalte → einzeln absichern.
// Läuft nur noch im (seltenen) Migrationsfall, daher ist try/catch hier unkritisch.
async function tryAlters(db, statements) {
  for (const sql of statements) {
    try { await db.exec(sql); } catch { /* Spalte existiert bereits */ }
  }
}

async function ensureProdukte() {
  const db = getDb('produkte');
  if (await getSchemaVersion(db) >= SCHEMA_VERSION) return false;  // schon aktuell → Setup überspringen
  try {
    // Alle CREATE TABLE/INDEX (IF NOT EXISTS) in EINEM Round-Trip.
    await db.exec([
      ddl.PRODUKTE_TABLES,
      ddl.PRODUKTE_POST_INDEXES,
      ddl.PRODUKTE_REGISTRY,
      ddl.VERTRAGSFORMULARE_TABLE,
      ddl.STANDALONE_FORMULARE_TABLE,
      ddl.ENET_BETREIBER_TABLE,
      ddl.ENET_OVERRIDE_TABLE,
      ddl.USERS_TABLE,
    ].join('\n'));
    await tryAlters(db, [
      ...ddl.PRODUKTE_ALTERS,
      ...ddl.VERTRAGSFORMULARE_ALTERS,
      ...ddl.ENET_BETREIBER_ALTERS,
    ]);
    await setSchemaVersion(db);
    return true;                                                   // migriert → Admin-Seed sinnvoll
  } catch (e) {
    // Setup darf den Boot NIE crashen (Tabellen existieren in Prod ohnehin schon).
    console.error('[schema] ensureProdukte fehlgeschlagen:', e.message);
    return false;
  }
}

async function ensureBesucher() {
  const db = getDb('besucher');
  if (await getSchemaVersion(db) >= SCHEMA_VERSION) return;
  try {
    await db.exec(ddl.BESUCHER_TABLES);
    await tryAlters(db, ddl.BESUCHER_ALTERS);
    await setSchemaVersion(db);
  } catch (e) {
    console.error('[schema] ensureBesucher fehlgeschlagen:', e.message);
  }
}

async function ensureEinsatzplan() {
  const db = getDb('einsatzplan');
  if (await getSchemaVersion(db) >= SCHEMA_VERSION) return;
  try {
    await db.exec(ddl.EINSATZPLAN_TABLES);
    // Stammbesetzung seeden (INSERT OR IGNORE → kein Überschreiben bestehender Stände),
    // alle in EINEM batch()-Round-Trip statt 16 Einzel-INSERTs.
    const stmts = ddl.INITIAL_AGENTS.map(([name, kuerzel, color]) => ({
      sql: 'INSERT OR IGNORE INTO ep_agents (name, kuerzel, color) VALUES (?,?,?)',
      args: [name, kuerzel, color],
    }));
    if (stmts.length) await db.batch(stmts);
    await setSchemaVersion(db);
  } catch (e) {
    console.error('[schema] ensureEinsatzplan fehlgeschlagen:', e.message);
  }
}

// Liefert true, wenn die produkte-DB (erst-)migriert wurde → Aufrufer kann den Admin-Seed anstoßen.
// Wirft NIE (jede ensureX ist intern gekapselt) → der Server-Boot kann am Schema-Setup nicht scheitern.
async function ensureSchemas() {
  const [migratedProdukte] = await Promise.all([
    ensureProdukte(),
    ensureBesucher(),
    ensureEinsatzplan(),
  ]);
  return { migratedProdukte };
}

module.exports = { ensureSchemas, ensureProdukte, ensureBesucher, ensureEinsatzplan, SCHEMA_VERSION };
