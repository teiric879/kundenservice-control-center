// Lädt registry.json (aus ExportRegistry.java) in die SQLite-Registry-Tabellen.
// Einmalig ausführen, danach ist SQLite autoritativ für aid/pid.
//   node api/migrate-registry.js [pfad/zu/registry.json]
const fs = require('fs');
const path = require('path');
const { getProdukte } = require('./db');
const { initProdukte } = require('./schema');

const REG_PATH = process.argv[2]
  || path.join('C:', 'Users', 'marck', 'Downloads', 'accdb-tools', 'registry.json');

function main() {
  if (!fs.existsSync(REG_PATH)) {
    console.error('registry.json nicht gefunden:', REG_PATH);
    console.error('Zuerst ExportRegistry.java laufen lassen (s. rebuild-prices.bat / Memory).');
    process.exit(1);
  }
  initProdukte();
  const db = getProdukte();
  const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));

  db.exec('BEGIN');
  db.exec('DELETE FROM aid_registry; DELETE FROM aid_registry_nt; DELETE FROM pid_map;');

  const insHt = db.prepare('INSERT OR REPLACE INTO aid_registry (sparte, ap_n, gp_n, aid) VALUES (?,?,?,?)');
  for (const r of reg.aidHt || []) insHt.run(r.sparte, r.ap, r.gp, r.aid);

  const insNt = db.prepare('INSERT OR REPLACE INTO aid_registry_nt (sparte, ap_n, aid_nt) VALUES (?,?,?)');
  for (const r of reg.aidNt || []) insNt.run(r.sparte, r.ap, r.aidNt);

  const insPid = db.prepare(
    'INSERT OR REPLACE INTO pid_map (sparte, produkt_key, zaehlerart, pid, pid_nt, vl, pg) VALUES (?,?,?,?,?,?,?)'
  );
  for (const r of reg.pidMap || []) {
    insPid.run(r.sparte, r.produktKey, r.zaehlerart || '', r.pid, r.pidNt ?? null, r.vl ?? 12, r.pg ?? 12);
  }
  db.exec('COMMIT');

  const cnt = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  console.log('Registry geladen:');
  console.log('  aid_registry   :', cnt('aid_registry'));
  console.log('  aid_registry_nt:', cnt('aid_registry_nt'));
  console.log('  pid_map        :', cnt('pid_map'));
  console.log(db.prepare('SELECT sparte, COUNT(*) c FROM aid_registry GROUP BY sparte').all());
}

main();
