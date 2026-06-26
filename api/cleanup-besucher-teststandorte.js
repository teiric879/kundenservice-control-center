// Einmalige Bereinigung: Test-Standorte (z. B. „Testbot") aus der besuche-Tabelle entfernen.
//
// WARUM: Standort-Buttons/Dropdowns im Dashboard + in der Schnellerfass-Leiste werden
// DATENGETRIEBEN gebaut (topStandorte() bzw. aus allen Besuchen). Beim Testen entstand ein
// Standort „Testbot", der dadurch als Button erscheint und Donut/KPIs/Summen verfälscht.
// Real existieren nur „Euskirchen" und „Kall". „(ohne Angabe)" bleibt erhalten (echte
// Besuche ohne Standort-Angabe aus Alt-Importen).
//
// Wirkt auf BEIDE Datenbanken:
//   • Turso (Production)  – via BESUCHER_DB_URL / BESUCHER_DB_AUTH_TOKEN aus .env
//   • lokale api/db/besucher.sqlite (Dev)
//
// SICHERHEIT: Standardlauf ist ein DRY-RUN (zeigt nur Standort-Verteilung, löscht NICHTS).
// Erst mit  --apply  wird gelöscht.
//
// Start (Kontrolle):  node api/cleanup-besucher-teststandorte.js
// Start (löschen):    node api/cleanup-besucher-teststandorte.js --apply

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const APPLY = process.argv.includes('--apply');
// Turso (Production) wird nur mit explizitem Flag berührt. Standardmäßig wirkt das Script
// ausschließlich auf die lokale Datei – schützt die Production-Daten vor versehentlichem Lauf.
const INCLUDE_TURSO = process.argv.includes('--include-turso');

// Kanonische, echte Standorte. Alles andere (außer dem Platzhalter „(ohne Angabe)") gilt als
// Test-/Junk-Standort und wird mit --apply entfernt.
const KEEP = ['Euskirchen', 'Kall', '(ohne Angabe)'];

// ── .env minimal einlesen (Muster wie api/migrate-add-besuche-kategorie-index.js) ──
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function placeholders(arr) { return arr.map(() => '?').join(','); }

// WHERE-Bedingung für Junk: Test-Standort (nicht in KEEP) ODER Test-Kategorie (…TEST…).
const JUNK_WHERE = `standort NOT IN (${placeholders(KEEP)}) OR upper(kategorie) LIKE '%TEST%'`;

async function cleanupTarget(label, client) {
  console.log(`\n── ${label} ──`);
  // 1) Standort-Verteilung
  const dist = await client.execute('SELECT standort, COUNT(*) AS c FROM besuche GROUP BY standort ORDER BY c DESC');
  if (!dist.rows.length) { console.log('  (keine Daten)'); return; }
  console.log('  Standorte:');
  for (const row of dist.rows) {
    const standort = row[0], c = Number(row[1]), junk = !KEEP.includes(standort);
    console.log(`    ${junk ? '✗' : '·'} ${String(standort).padEnd(20)} ${c}` + (junk ? '   ← Test/Junk' : ''));
  }
  // 2) Test-Kategorien
  const kat = await client.execute("SELECT kategorie, COUNT(*) AS c FROM besuche WHERE upper(kategorie) LIKE '%TEST%' GROUP BY kategorie ORDER BY c DESC");
  if (kat.rows.length) {
    console.log('  Test-Kategorien:');
    for (const row of kat.rows) console.log(`    ✗ ${String(row[0]).padEnd(20)} ${Number(row[1])}   ← Test/Junk`);
  }

  // 3) Zu löschende Zeilen zählen
  const cntRes = await client.execute({ sql: `SELECT COUNT(*) FROM besuche WHERE ${JUNK_WHERE}`, args: KEEP });
  const toDelete = Number(cntRes.rows[0][0]);
  if (!toDelete) { console.log('  → nichts zu löschen.'); return; }

  if (!APPLY) {
    console.log(`  → DRY-RUN: ${toDelete} Zeile(n) würden gelöscht (Aufruf mit --apply zum Ausführen).`);
    return;
  }
  const del = await client.execute({ sql: `DELETE FROM besuche WHERE ${JUNK_WHERE}`, args: KEEP });
  console.log(`  ✓ gelöscht: ${Number(del.rowsAffected || 0)} Zeile(n).`);
}

async function main() {
  loadEnv();
  console.log(APPLY ? '== MODUS: LÖSCHEN (--apply) ==' : '== MODUS: DRY-RUN (nichts wird gelöscht) ==');
  console.log('Behalten:', KEEP.join(', '));

  // a) lokale Datei (Dev)
  const localPath = path.join(__dirname, 'db', 'besucher.sqlite');
  if (fs.existsSync(localPath)) {
    const local = createClient({ url: 'file:' + localPath.replace(/\\/g, '/'), intMode: 'number' });
    try { await cleanupTarget('LOKAL  api/db/besucher.sqlite', local); }
    finally { local.close && local.close(); }
  } else {
    console.log('\n── LOKAL ── (Datei nicht vorhanden, übersprungen)');
  }

  // b) Turso (Production) – nur mit explizitem --include-turso UND echter libsql://-URL.
  const url = process.env.BESUCHER_DB_URL;
  const authToken = process.env.BESUCHER_DB_AUTH_TOKEN;
  if (!INCLUDE_TURSO) {
    console.log('\n── TURSO ── (übersprungen — nur mit --include-turso berücksichtigt)');
  } else if (url && (url.startsWith('libsql://') || url.startsWith('https://'))) {
    const turso = createClient({ url, authToken: authToken || undefined, intMode: 'number' });
    try { await cleanupTarget('TURSO  (Production)', turso); }
    finally { turso.close && turso.close(); }
  } else {
    console.log('\n── TURSO ── (BESUCHER_DB_URL fehlt/kein libsql:// — übersprungen)');
  }

  console.log('\nFertig.' + (APPLY ? '' : ' (DRY-RUN — mit --apply erneut ausführen, um zu löschen.)'));
}

main().catch((e) => { console.error('Cleanup fehlgeschlagen:', e); process.exit(1); });
