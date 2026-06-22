// Einmal-Migration: lokale SQLite-Dateien → Turso (libSQL-Cloud).
//
// Liest die Quell-DBs unter api/db/*.sqlite und kopiert ALLE User-Tabellen 1:1
// in die per .env konfigurierten Turso-DBs. Idempotent: pro Tabelle wird remote
// zuerst geleert (DELETE), dann neu befüllt — beliebig oft wiederholbar.
//
// Voraussetzung: .env im Projekt-Root mit den 6 Werten (siehe .env.example):
//   PRODUKTE_DB_URL / PRODUKTE_DB_AUTH_TOKEN
//   BESUCHER_DB_URL / BESUCHER_DB_AUTH_TOKEN
//   EINSATZPLAN_DB_URL / EINSATZPLAN_DB_AUTH_TOKEN
//
// Start:  node api/migrate-to-turso.js

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const ddl = require('../backend/data/ddl.js');

// ── .env minimal einlesen (kein dotenv nötig) ────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) {
    console.error('FEHLER: .env nicht gefunden unter ' + p);
    console.error('Lege .env an (Vorlage: .env.example) und trage die 6 Turso-Werte ein.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const LOCAL_DIR = path.join(__dirname, 'db');
const localUrl = (name) => 'file:' + path.join(LOCAL_DIR, name).replace(/\\/g, '/');

// DB-Definitionen: Quelle (lokal), Ziel (ENV), Schema-DDL zum idempotenten Anlegen.
const DBS = [
  {
    name: 'produkte',
    local: localUrl('produkte.sqlite'),
    urlEnv: 'PRODUKTE_DB_URL', tokenEnv: 'PRODUKTE_DB_AUTH_TOKEN',
    ddl: [ddl.PRODUKTE_TABLES, ddl.PRODUKTE_POST_INDEXES, ddl.PRODUKTE_REGISTRY],
    alters: ddl.PRODUKTE_ALTERS,
  },
  {
    name: 'besucher',
    local: localUrl('besucher.sqlite'),
    urlEnv: 'BESUCHER_DB_URL', tokenEnv: 'BESUCHER_DB_AUTH_TOKEN',
    ddl: [ddl.BESUCHER_TABLES],
    alters: [],
  },
  {
    name: 'einsatzplan',
    local: localUrl('einsatzplan.sqlite'),
    urlEnv: 'EINSATZPLAN_DB_URL', tokenEnv: 'EINSATZPLAN_DB_AUTH_TOKEN',
    ddl: [ddl.EINSATZPLAN_TABLES],
    alters: [],
  },
];

const CHUNK = 200; // Zeilen pro Batch-Request (Round-Trip-Optimierung)

async function userTables(client) {
  const r = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' " +
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' ORDER BY name"
  );
  return r.rows.map((row) => row.name);
}

async function columns(client, table) {
  const r = await client.execute('PRAGMA table_info("' + table + '")');
  return r.rows.map((row) => row.name);
}

async function migrateDb(def) {
  const url = process.env[def.urlEnv];
  const authToken = process.env[def.tokenEnv];
  if (!url || !authToken) {
    console.error(`  ! ${def.urlEnv}/${def.tokenEnv} fehlt in .env — übersprungen`);
    return;
  }

  console.log(`\n=== ${def.name} ===`);
  const src = createClient({ url: def.local, intMode: 'number' });
  const dst = createClient({ url, authToken, intMode: 'number' });

  // 1) Schema remote sicherstellen (idempotent).
  for (const block of def.ddl) await dst.executeMultiple(block);
  for (const sql of def.alters) { try { await dst.execute(sql); } catch { /* Spalte existiert */ } }

  // 2) Pro Tabelle: leeren + zeilenweise kopieren.
  const tables = await userTables(src);
  for (const table of tables) {
    const cols = await columns(src, table);
    const all = await src.execute('SELECT * FROM "' + table + '"');
    const rows = all.rows;

    await dst.execute('DELETE FROM "' + table + '"');

    const colList = cols.map((c) => '"' + c + '"').join(',');
    const placeholders = '(' + cols.map(() => '?').join(',') + ')';
    const insertSql = 'INSERT INTO "' + table + '" (' + colList + ') VALUES ' + placeholders;

    let done = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const stmts = slice.map((row) => ({
        sql: insertSql,
        args: cols.map((c) => (row[c] === undefined ? null : row[c])),
      }));
      await dst.batch(stmts, 'write');
      done += slice.length;
      process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
    }
    console.log(`\r  ${table}: ${rows.length} Zeilen kopiert        `);
  }

  src.close();
  dst.close();
}

(async () => {
  loadEnv();
  const t0 = Date.now();
  for (const def of DBS) await migrateDb(def);
  console.log(`\nFertig in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
})().catch((e) => { console.error('\nFEHLER:', e); process.exit(1); });
