const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { initProdukte } = require('./schema');
const { getProdukte } = require('./db');

const DATA_JS = path.join(__dirname, '..', 'produkt-id-tool', 'data.js');

const sandbox = { window: {} };
const code = fs.readFileSync(DATA_JS, 'utf8');
vm.runInNewContext(code, sandbox);
const PRODUKTDATEN = sandbox.window.PRODUKTDATEN;

if (!PRODUKTDATEN) {
  console.error('window.PRODUKTDATEN nicht gefunden in data.js');
  process.exit(1);
}

initProdukte();
const db = getProdukte();

db.exec('DELETE FROM konditionen; DELETE FROM preise; DELETE FROM gueltigkeiten; DELETE FROM sparten;');

const insSparte = db.prepare(`
  INSERT OR REPLACE INTO sparten (sparte, label, ust, nkb_schwelle, gebiete, has_nt, produkte, labels, typen, module)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insGa = db.prepare('INSERT OR IGNORE INTO gueltigkeiten (sparte, ga) VALUES (?, ?)');

const insPreis = db.prepare(`
  INSERT INTO preise (sparte, ga, v_von, v_bis, gebiet, produkt_key, ap_b, gp_b, ap_n, gp_n, ap_nt_b, ap_nt_n, bonus)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insKond = db.prepare(`
  INSERT INTO konditionen (sparte, ga, v_von, v_bis, gebiet, produkt_key, pid, aid, pid_nt, aid_nt, vl, pg, alb, bonus, netzentgelt_red)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN');
try {
  for (const [sparteKey, s] of Object.entries(PRODUKTDATEN)) {
    insSparte.run(
      sparteKey,
      s.label,
      s.ust ?? 19,
      s.nkbSchwelle ?? 0,
      s.gebiete ? JSON.stringify(s.gebiete) : null,
      s.hasNt || s.hasNT ? 1 : 0,
      JSON.stringify(s.produkte),
      JSON.stringify(s.labels),
      s.typen ? JSON.stringify(s.typen) : null,
      s.module ? JSON.stringify(s.module) : null,
    );

    for (const ga of s.gueltigkeiten) {
      insGa.run(sparteKey, ga);
    }

    for (const row of s.preise) {
      const { ga, vVon, vBis, gebiet, bonus } = row;
      for (const pk of s.produkte) {
        const p = row[pk];
        if (!p) continue;
        insPreis.run(
          sparteKey, ga, vVon, vBis, gebiet ?? null, pk,
          p.apB ?? null, p.gpB ?? null,
          p.apN ?? null, p.gpN ?? null,
          p.apNtB ?? null, p.apNtN ?? null,
          bonus ?? 0,
        );
      }
    }

    for (const row of s.konditionen) {
      const { ga, vVon, vBis, gebiet } = row;
      for (const pk of s.produkte) {
        const k = row[pk];
        if (!k) continue;
        insKond.run(
          sparteKey, ga, vVon, vBis, gebiet ?? null, pk,
          k.pid ?? 0, k.aid ?? 0,
          k.pidNt ?? null, k.aidNt ?? null,
          k.vl ?? 12, k.pg ?? 12,
          k.alb ?? null,
          k.bonus ?? 0,
          k.netzentgeltRed ?? null,
        );
      }
    }
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

console.log('Migration abgeschlossen:', Object.keys(PRODUKTDATEN).join(', '));
