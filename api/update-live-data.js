// Gezieltes, idempotentes Live-Update (Turso) — NUR die zwei offenen Datenpunkte,
// ohne den Rest der DB anzufassen (kein DELETE wie in migrate-to-turso.js).
//
//   1) SteuVE Modul 1: netzentgelt_red = '-134,85 €/a' für WP-M1 & Wallbox-M1.
//   2) Strom „Direkt": Produkt in strom.produkte aufnehmen (+ Label) —
//      aber nur wenn dafür auch Preiszeilen existieren.
//
// Voraussetzung: .env im Projekt-Root mit PRODUKTE_DB_URL + PRODUKTE_DB_AUTH_TOKEN
// (gleiche Datei wie migrate-to-turso.js).
//
// Aufruf:
//   node api/update-live-data.js                 → sichere Änderungen + Report
//   node api/update-live-data.js --seed-strom-direkt
//        → kopiert zusätzlich die strom-„Direkt"-Preis-/Konditionszeilen aus der
//          lokalen produkte.sqlite nach Turso, falls live noch keine existieren.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const ddl = require('../backend/data/ddl');

const NETZENTGELT_M1 = '-134,85 €/a';
const SEED_DIREKT = process.argv.includes('--seed-strom-direkt');

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

const localUrl = (name) => 'file:' + path.join(__dirname, 'db', name).replace(/\\/g, '/');

async function run() {
  loadEnv();
  const url = process.env.PRODUKTE_DB_URL;
  const authToken = process.env.PRODUKTE_DB_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('FEHLER: PRODUKTE_DB_URL / PRODUKTE_DB_AUTH_TOKEN fehlen in .env');
    process.exit(1);
  }
  const db = createClient({ url, authToken, intMode: 'number' });

  // ── 1) SteuVE Modul 1: Netzentgeltreduzierung ──────────────────────────────
  const r1 = await db.execute({
    sql: `UPDATE konditionen SET netzentgelt_red = ?
          WHERE sparte = 'steuve' AND produkt_key IN ('WP-M1','Wallbox-M1')
            AND (netzentgelt_red IS NULL OR netzentgelt_red = '')`,
    args: [NETZENTGELT_M1],
  });
  console.log(`1) SteuVE M1 Netzentgelt: ${r1.rowsAffected} Zeile(n) auf "${NETZENTGELT_M1}" gesetzt.`);

  // ── 2) Strom „Direkt" ──────────────────────────────────────────────────────
  const cnt = await db.execute(
    "SELECT COUNT(*) AS n FROM preise WHERE sparte='strom' AND produkt_key='Direkt'"
  );
  let direktPreise = cnt.rows[0].n;
  console.log(`2) Strom „Direkt": ${direktPreise} Preiszeile(n) live vorhanden.`);

  if (direktPreise === 0 && SEED_DIREKT) {
    direktPreise = await seedDirektFromLocal(db);
  } else if (direktPreise === 0) {
    console.log('   → Keine Preiszeilen. „Direkt" wird NICHT in produkte aufgenommen');
    console.log('     (würde sonst leer/kaputt erscheinen). Optionen:');
    console.log('     • Preise via rebuild-prices-Pipeline importieren, dann erneut laufen lassen, ODER');
    console.log('     • node api/update-live-data.js --seed-strom-direkt  (kopiert lokale Direkt-Zeilen)');
  }

  if (direktPreise > 0) {
    await ensureDirektInProdukte(db);
  }

  // ── 3) Vertragsformulare-Tabelle live anlegen + Formulare kopieren ──────────
  await ensureVertragsformulare(db);

  db.close();
  console.log('\nFertig.');
}

// Tabelle vertragsformulare in Turso anlegen (fehlte bisher) + Zeilen aus lokaler
// produkte.sqlite spiegeln. Idempotent: Tabelle CREATE IF NOT EXISTS, dann DELETE+Insert.
async function ensureVertragsformulare(db) {
  await db.executeMultiple(ddl.VERTRAGSFORMULARE_TABLE);
  for (const sql of ddl.VERTRAGSFORMULARE_ALTERS) { try { await db.execute(sql); } catch { /* Spalte existiert */ } }

  const src = createClient({ url: localUrl('produkte.sqlite'), intMode: 'number' });
  const local = await src.execute('SELECT * FROM vertragsformulare ORDER BY id');
  if (!local.rows.length) {
    console.log('3) Vertragsformulare: Tabelle sichergestellt, lokal 0 Zeilen – nichts zu kopieren.');
    src.close();
    return;
  }
  const cols = local.columns;
  const colList = cols.map((c) => '"' + c + '"').join(',');
  const ph = '(' + cols.map(() => '?').join(',') + ')';

  await db.execute('DELETE FROM vertragsformulare');
  // Einzeln einfügen (PDFs sind groß → kein Riesen-Batch nötig, hält Request klein)
  for (const row of local.rows) {
    await db.execute({
      sql: `INSERT INTO vertragsformulare (${colList}) VALUES ${ph}`,
      args: cols.map((c) => (row[c] === undefined ? null : row[c])),
    });
  }
  src.close();
  console.log(`3) Vertragsformulare: Tabelle angelegt + ${local.rows.length} Formular(e) live kopiert.`);
}

// strom.produkte um „Direkt" ergänzen + Label sicherstellen (idempotent).
async function ensureDirektInProdukte(db) {
  const s = await db.execute("SELECT produkte, labels FROM sparten WHERE sparte='strom'");
  if (!s.rows.length) { console.log('   ! Sparte strom nicht gefunden.'); return; }

  const produkte = JSON.parse(s.rows[0].produkte || '[]');
  const labels = JSON.parse(s.rows[0].labels || '{}');
  let changed = false;

  if (!produkte.includes('Direkt')) {
    const ki = produkte.indexOf('Konstant');      // wie bei Gas: vor „Konstant" einsortieren
    if (ki >= 0) produkte.splice(ki, 0, 'Direkt'); else produkte.push('Direkt');
    changed = true;
  }
  if (labels['Direkt'] !== 'Regionalstrom Direkt') {
    labels['Direkt'] = 'Regionalstrom Direkt';
    changed = true;
  }

  if (changed) {
    await db.execute({
      sql: "UPDATE sparten SET produkte = ?, labels = ? WHERE sparte='strom'",
      args: [JSON.stringify(produkte), JSON.stringify(labels)],
    });
    console.log(`   → strom.produkte aktualisiert: [${produkte.join(', ')}]`);
  } else {
    console.log('   → „Direkt" bereits in strom.produkte – nichts zu tun.');
  }
}

// Kopiert strom-„Direkt"-Zeilen (preise + konditionen) aus lokaler produkte.sqlite.
async function seedDirektFromLocal(db) {
  console.log('   → --seed-strom-direkt: kopiere lokale Direkt-Zeilen …');
  const src = createClient({ url: localUrl('produkte.sqlite'), intMode: 'number' });

  let total = 0;
  for (const table of ['preise', 'konditionen']) {
    const local = await src.execute({
      sql: `SELECT * FROM ${table} WHERE sparte='strom' AND produkt_key='Direkt'`,
      args: [],
    });
    if (!local.rows.length) { console.log(`     ${table}: 0 lokale Zeilen`); continue; }

    const cols = local.columns.filter((c) => c !== 'id');
    const colList = cols.map((c) => '"' + c + '"').join(',');
    const ph = '(' + cols.map(() => '?').join(',') + ')';
    // erst evtl. vorhandene Direkt-Zeilen entfernen (idempotent), dann einfügen
    await db.execute(`DELETE FROM ${table} WHERE sparte='strom' AND produkt_key='Direkt'`);
    const stmts = local.rows.map((row) => ({
      sql: `INSERT INTO ${table} (${colList}) VALUES ${ph}`,
      args: cols.map((c) => (row[c] === undefined ? null : row[c])),
    }));
    await db.batch(stmts, 'write');
    console.log(`     ${table}: ${local.rows.length} Zeilen kopiert`);
    if (table === 'preise') total = local.rows.length;
  }
  src.close();
  return total;
}

run().catch((e) => { console.error('\nFEHLER:', e); process.exit(1); });
