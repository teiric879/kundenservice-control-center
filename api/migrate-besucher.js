const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { initBesucher } = require('./schema');
const { getBesucher } = require('./db');

const DATA_JS = path.join(__dirname, '..', 'besucher-dashboard', 'data.js');

const sandbox = { window: {} };
const code = fs.readFileSync(DATA_JS, 'utf8');
vm.runInNewContext(code, sandbox);

const { STANDORTE, KATEGORIEN, VISITS } = sandbox.window;

if (!VISITS) {
  console.error('window.VISITS nicht gefunden in besucher-dashboard/data.js');
  process.exit(1);
}

initBesucher();
const db = getBesucher();

db.exec('DELETE FROM besuche;');

const ins = db.prepare(
  'INSERT INTO besuche (datum, standort, kategorie, stunde) VALUES (?, ?, ?, ?)'
);

// VISITS format: [standortIdx, katIdx, ymd, hour, dow]
db.exec('BEGIN');
try {
  for (const v of VISITS) {
    const [sIdx, kIdx, ymd, hour] = v;
    const standort = STANDORTE[sIdx] ?? '(unbekannt)';
    const kategorie = kIdx >= 0 ? (KATEGORIEN[kIdx] ?? null) : null;
    ins.run(ymd, standort, kategorie, hour ?? -1);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
console.log(`Migration abgeschlossen: ${VISITS.length} Besuche aus ${STANDORTE.length} Standorten`);
