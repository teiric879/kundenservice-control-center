/**
 * Produktiver, ADDITIVER Deploy der neuen Strom-Gültigkeit 2026-06-24 nach Turso.
 *
 * Bewusst KEIN Voll-Copy (migrate-to-turso.js leert alle Tabellen aller DBs und würde
 * cloud-originäre Daten – Besucherlogs, Einsatzplan, evtl. Admin-Stände – überschreiben).
 * Dieses Skript fasst NUR die produkte-DB an und dort NUR sparte='strom', ga='2026-06-24':
 *   idempotent löschen + die lokalen Zeilen (gueltigkeiten/preise/konditionen) einspielen.
 *
 * Voraussetzung: .env mit PRODUKTE_DB_URL / PRODUKTE_DB_AUTH_TOKEN.
 * Start: node api/deploy-ga-strom-2026-06-24-to-turso.js
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('./node_modules/@libsql/client');

const SPARTE = 'strom', GA = '2026-06-24';

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = process.env.PRODUKTE_DB_URL, authToken = process.env.PRODUKTE_DB_AUTH_TOKEN;
if (!url || !authToken) { console.error('PRODUKTE_DB_URL/AUTH_TOKEN fehlt in .env'); process.exit(1); }

const local = new DatabaseSync(path.join(__dirname, 'db', 'produkte.sqlite'));
const dst = createClient({ url, authToken, intMode: 'number' });

// Spalten einer Tabelle ohne autoincrement-id
function cols(table) {
  return local.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => c !== 'id');
}
function localRows(table) {
  return local.prepare(`SELECT * FROM ${table} WHERE sparte=? AND ga=?`).all(SPARTE, GA);
}

async function pushTable(table) {
  const c = cols(table);
  const rows = localRows(table);
  // idempotent: in Prod erst diese GA leeren
  await dst.execute({ sql: `DELETE FROM "${table}" WHERE sparte=? AND ga=?`, args: [SPARTE, GA] });
  if (!rows.length) { console.log(`  ${table}: 0 Zeilen`); return; }
  const colList = c.map((x) => `"${x}"`).join(',');
  const ph = '(' + c.map(() => '?').join(',') + ')';
  const sql = `INSERT INTO "${table}" (${colList}) VALUES ${ph}`;
  const CHUNK = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await dst.batch(slice.map((r) => ({ sql, args: c.map((x) => (r[x] === undefined ? null : r[x])) })), 'write');
    done += slice.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  console.log(`\r  ${table}: ${rows.length} Zeilen        `);
}

(async () => {
  console.log(`Additiver Deploy ${SPARTE} ${GA} → Turso (produkte)…`);
  await pushTable('gueltigkeiten');
  await pushTable('preise');
  await pushTable('konditionen');

  // Verifikation
  const g = await dst.execute({ sql: 'SELECT COUNT(*) n FROM gueltigkeiten WHERE sparte=? AND ga=?', args: [SPARTE, GA] });
  const p = await dst.execute({ sql: 'SELECT COUNT(*) n FROM preise WHERE sparte=? AND ga=?', args: [SPARTE, GA] });
  const k = await dst.execute({ sql: 'SELECT COUNT(*) n FROM konditionen WHERE sparte=? AND ga=?', args: [SPARTE, GA] });
  const bonus = await dst.execute({ sql: "SELECT v_von,v_bis,bonus FROM konditionen WHERE sparte=? AND ga=? AND plz=? AND produkt_key='Direkt' ORDER BY v_von", args: [SPARTE, GA, '53879'] });
  console.log(`\n✓ Turso: gueltig=${g.rows[0].n}, preise=${p.rows[0].n}, konditionen=${k.rows[0].n}`);
  console.log('  53879 Direkt Bonus-Staffeln:', bonus.rows.map((r) => `${r.v_von}-${r.v_bis}:${r.bonus}`).join(' | '));
  dst.close(); local.close();
})().catch((e) => { console.error('\nFEHLER:', e.message); process.exit(1); });
