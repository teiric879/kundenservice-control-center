// Liest enet-betreiber-bundesweit.json (vom Java-Extraktor EnetExport) und schreibt die
// Datensätze in die Turso-`produkte`-DB (Tabelle enet_betreiber). DELETE + Batch-INSERT.
//
// Usage:  node tools/enet/push-turso.js <pfad-zur-json>
// ENV (eine der Varianten):
//   TURSO_PRODUKTE_URL / TURSO_PRODUKTE_TOKEN   (wie bestehende migrate-Skripte)
//   PRODUKTE_DB_URL    / PRODUKTE_DB_AUTH_TOKEN  (wie der Laufzeit-Driver)
//   TURSO_DATABASE_URL / TURSO_AUTH_TOKEN        (generisch)

const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: '.env.local' }); } catch { /* optional */ }
const { createClient } = require('@libsql/client');

const URL =
  process.env.TURSO_PRODUKTE_URL || process.env.PRODUKTE_DB_URL || process.env.TURSO_DATABASE_URL;
const TOKEN =
  process.env.TURSO_PRODUKTE_TOKEN || process.env.PRODUKTE_DB_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

if (!URL) {
  console.error('Fehlende DB-URL (TURSO_PRODUKTE_URL / PRODUKTE_DB_URL / TURSO_DATABASE_URL).');
  process.exit(1);
}

const jsonPath = process.argv[2] || path.join(__dirname, 'enet-betreiber-bundesweit.json');
const stand = new Date().toISOString().slice(0, 10);
const CHUNK = 500;

async function main() {
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`[push-turso] ${rows.length} Datensätze aus ${jsonPath}`);

  const db = createClient({ url: URL, authToken: TOKEN || undefined });

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS enet_betreiber (
      plz TEXT NOT NULL, ort TEXT, sparte TEXT NOT NULL,
      netzbetreiber TEXT, nb_tel TEXT, nb_url TEXT,
      grundversorger TEXT, gv_tel TEXT, stand TEXT,
      PRIMARY KEY (plz, ort, sparte)
    );
    CREATE INDEX IF NOT EXISTS idx_enet_plz ON enet_betreiber(plz, sparte);
    CREATE INDEX IF NOT EXISTS idx_enet_ort ON enet_betreiber(lower(ort));
  `);

  await db.execute('DELETE FROM enet_betreiber');

  const sql = `INSERT OR REPLACE INTO enet_betreiber
    (plz, ort, sparte, netzbetreiber, nb_tel, nb_url, grundversorger, gv_tel, stand)
    VALUES (?,?,?,?,?,?,?,?,?)`;

  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map((r) => ({
      sql,
      args: [r.plz, r.ort || '', r.sparte, r.nb_name || '', r.nb_tel || '', r.nb_url || '',
             r.gv_name || '', r.gv_tel || '', stand],
    }));
    await db.batch(batch, 'write');
    done += batch.length;
    if (done % 5000 < CHUNK) console.log(`  … ${done}/${rows.length}`);
  }

  const c = await db.execute('SELECT COUNT(*) AS n FROM enet_betreiber');
  console.log(`[push-turso] fertig — ${c.rows[0].n} Zeilen in enet_betreiber (Stand ${stand}).`);
}

main().catch((e) => { console.error('Fehler:', e); process.exit(1); });
