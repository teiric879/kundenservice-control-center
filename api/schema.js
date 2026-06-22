// SYNC Schema-Setup (node:sqlite) — ausschließlich für die Access-Import-Pipeline (migrate-*.js).
// Der Server nutzt den async-Pfad in data/schema.js. Beide teilen sich die DDL aus data/ddl.js.
const { getProdukte, getBesucher, getEinsatzplaner } = require('./db');
const ddl = require('./data/ddl');

function initProdukte() {
  const db = getProdukte();
  db.exec(ddl.PRODUKTE_TABLES);
  // Spalten-Migration: nachträglich hinzufügen falls noch nicht vorhanden
  for (const sql of ddl.PRODUKTE_ALTERS) { try { db.exec(sql); } catch {} }
  db.exec(ddl.PRODUKTE_POST_INDEXES);
  // Registry-Tabellen (Spiegel des SAP-/Access-Standes; alleinige Quelle für aid/pid)
  db.exec(ddl.PRODUKTE_REGISTRY);
  db.exec(ddl.VERTRAGSFORMULARE_TABLE);
  for (const sql of ddl.VERTRAGSFORMULARE_ALTERS) { try { db.exec(sql); } catch {} }
}

function initBesucher() {
  const db = getBesucher();
  db.exec(ddl.BESUCHER_TABLES);
}

function initEinsatzplaner() {
  const db = getEinsatzplaner();
  db.exec(ddl.EINSATZPLAN_TABLES);

  // Migrate existing DB: add time columns if missing
  const cols = db.prepare('PRAGMA table_info(ep_assignments)').all();
  if (cols.length > 0 && !cols.some(c => c.name === 'time_from')) {
    db.exec(`
      BEGIN;
      CREATE TABLE ep_assignments_v2 (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        date      TEXT NOT NULL,
        location  TEXT NOT NULL,
        slot      TEXT NOT NULL,
        agent_id  INTEGER NOT NULL,
        time_from TEXT NOT NULL DEFAULT '08:00',
        time_to   TEXT NOT NULL DEFAULT '16:00',
        UNIQUE(date, location, slot, time_from)
      );
      INSERT INTO ep_assignments_v2 (id, date, location, slot, agent_id, time_from, time_to)
        SELECT id, date, location, slot, agent_id, '08:00', '16:00' FROM ep_assignments;
      DROP TABLE ep_assignments;
      ALTER TABLE ep_assignments_v2 RENAME TO ep_assignments;
      DROP INDEX IF EXISTS idx_ep_asgn_date;
      CREATE INDEX idx_ep_asgn_date ON ep_assignments(date);
      COMMIT;
    `);
  }

  const ins = db.prepare('INSERT OR IGNORE INTO ep_agents (name, kuerzel, color) VALUES (?,?,?)');
  for (const [name, kuerzel, color] of ddl.INITIAL_AGENTS) ins.run(name, kuerzel, color);
}

module.exports = { initProdukte, initBesucher, initEinsatzplaner };
