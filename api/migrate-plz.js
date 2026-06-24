/**
 * Lädt per-PLZ-Preise + Konditionen (plz_prices.json von ExportPlzAll.java) in produkte.sqlite.
 *
 * - Strom:     je (plz, ga) eine Zeile pro Produkt im Band 0-999999 (AP/GP bandunabhängig).
 * - Heizstrom: je (plz, ga, zaehlerart) – Bänder/Produkte wie geliefert.
 * - AutoStrom: je (plz, ga) – Mobil.
 * - Gas:       UNIFORM (regionsweit gleich) → nur Konditionen, als Gebiets-Zeilen (plz IS NULL),
 *              ersetzen die falschen data.js-Konditionen. Preise/Staffeln liefert current_prices.
 * - Konditionen: pid/aid/pid_nt/aid_nt/vl/pg/alb (ALB global 20260101, admin-änderbar).
 *
 * Aufruf: node api/migrate-plz.js   (nach migrate-history.js / migrate-current.js)
 */
const fs = require('fs');
const path = require('path');
const { getProdukte } = require('./db');

const FILE = path.join('C:\\Users\\marck\\Downloads\\accdb-tools', 'plz_prices.json');
if (!fs.existsSync(FILE)) {
  console.error('plz_prices.json nicht gefunden – ExportPlzAll.java zuerst ausführen.');
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// Test-Hook: gegen eine Kopie der DB laufen lassen (PLZ_TEST_DB=Pfad), ohne die Live-DB anzufassen.
const db = process.env.PLZ_TEST_DB
  ? new (require('node:sqlite').DatabaseSync)(process.env.PLZ_TEST_DB)
  : getProdukte();

const insPreis = db.prepare(`
  INSERT INTO preise (sparte, ga, v_von, v_bis, gebiet, plz, ort, produkt_key, zaehlerart, ap_b, gp_b, ap_nt_b, bonus)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
`);
// plz nullable: bei Gas-uniform = NULL (Gebiets-Kondition)
const insKond = db.prepare(`
  INSERT INTO konditionen (sparte, ga, v_von, v_bis, gebiet, plz, zaehlerart, produkt_key, pid, aid, pid_nt, aid_nt, vl, pg, alb, bonus)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);
// wie insKond, aber mit Bonus-Parameter (für Strom-Direkt verbrauchsabhängige Bonus-Staffeln)
const insKondB = db.prepare(`
  INSERT INTO konditionen (sparte, ga, v_von, v_bis, gebiet, plz, zaehlerart, produkt_key, pid, aid, pid_nt, aid_nt, vl, pg, alb, bonus)
  VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Vereinheitlichte, lückenlose Bänder 0..999999 mit Direkt-Bonus je Band.
// Unter der untersten Export-Stufe (z.B. <1500) → Bonus 0. Bei nur einem Band → 0-999999.
function unifyBands(direktBands) {
  const bands = direktBands.map(b => ({ vVon: b.vVon, vBis: b.vBis, bonus: b.bonus || 0 }))
    .sort((a, b) => a.vVon - b.vVon);
  if (bands.length <= 1) return [{ vVon: 0, vBis: 999999, bonus: bands[0] ? bands[0].bonus : 0 }];
  const out = [];
  if (bands[0].vVon > 0) out.push({ vVon: 0, vBis: bands[0].vVon - 1, bonus: 0 });
  for (const b of bands) out.push({ ...b });
  out[out.length - 1].vBis = 999999;
  return out;
}

const STROM_PROD = ['Basis', 'Komfort', 'Direkt'];
const HZ_PROD    = ['WP', 'NS-Gem', 'NS-Get'];
const GAS_PROD   = ['Basis', 'Komfort', 'Klima+'];
const insGa = db.prepare('INSERT OR IGNORE INTO gueltigkeiten (sparte, ga) VALUES (?, ?)');

// Konditionszeile aus JSON für eine Produktliste einfügen (plz = null|string)
function insKondRows(filterFn, prods, sparte, plzOf, vband) {
  const seen = new Set();
  let n = 0;
  for (const r of rows.filter(filterFn)) {
    for (const pk of prods) {
      if (r[`${pk}_pid`] == null) continue;
      const plz = plzOf(r);
      const vVon = vband ? 0 : r.vVon, vBis = vband ? 999999 : r.vBis;
      const za = r.zaehlerart ?? null;
      const key = `${plz}|${r.ga}|${pk}|${vVon}|${vBis}|${za}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insKond.run(sparte, r.ga, vVon, vBis, plz, za, pk,
        r[`${pk}_pid`], r[`${pk}_aid`] ?? 0, r[`${pk}_pid_nt`] ?? null, r[`${pk}_aid_nt`] ?? null,
        r[`${pk}_vl`] ?? 12, r[`${pk}_pg`] ?? 12, r[`${pk}_alb`] ?? null);
      n++;
    }
  }
  return n;
}

db.exec('BEGIN');
try {
  // Alte per-PLZ-Zeilen entfernen (idempotent)
  db.prepare('DELETE FROM preise WHERE plz IS NOT NULL').run();
  db.prepare('DELETE FROM konditionen WHERE plz IS NOT NULL').run();
  // Gas-Konditionen (Gebiet) werden durch die korrekten uniform-Werte ersetzt
  db.prepare('DELETE FROM konditionen WHERE sparte=? AND plz IS NULL').run('gas');

  // Alle Gültigkeiten registrieren (volle Historie im Dropdown)
  for (const r of rows) insGa.run(r.sparte, r.ga);

  // ── STROM: je (plz, ga) vereinheitlichte Bänder; Direkt-Bonus-Staffeln bleiben erhalten ──
  // AP/GP sind bandunabhängig (konstant je Produkt); nur der Direkt-Bonus variiert nach Verbrauch.
  // Damit findPreisRow/findKondRow EINE Zeile je (ga,verbrauch,plz) mit ALLEN Produkten liefern,
  // werden Basis/Komfort je Band mitgeführt; der Bonus liegt produkt-spezifisch in konditionen.bonus.
  const byPg = {}; // plz|ga → {plz,ga,ort, price:{pk:{apB,gpB}}, direktBands:[{vVon,vBis,bonus}]}
  for (const r of rows.filter(r => r.sparte === 'strom' && r.tabelle === 'preise')) {
    const key = r.plz + '|' + r.ga;
    const e = (byPg[key] ??= { plz: r.plz, ga: r.ga, ort: r.ort, price: {}, direktBands: [] });
    for (const pk of STROM_PROD) {
      if (r[`${pk}_apB`] == null) continue;
      if (e.price[pk] == null) e.price[pk] = { apB: r[`${pk}_apB`], gpB: r[`${pk}_gpB`] };
      if (pk === 'Direkt') e.direktBands.push({ vVon: r.vVon, vBis: r.vBis, bonus: r.bonus ?? 0 });
    }
  }
  const kondPg = {}; // plz|ga → {pk:{pid,aid,pidNt,aidNt,vl,pg,alb}}
  for (const r of rows.filter(r => r.sparte === 'strom' && r.tabelle === 'konditionen')) {
    const key = r.plz + '|' + r.ga;
    const e = (kondPg[key] ??= {});
    for (const pk of STROM_PROD) {
      if (r[`${pk}_pid`] == null || e[pk] != null) continue;
      e[pk] = { pid: r[`${pk}_pid`], aid: r[`${pk}_aid`] ?? 0, pidNt: r[`${pk}_pid_nt`] ?? null,
        aidNt: r[`${pk}_aid_nt`] ?? null, vl: r[`${pk}_vl`] ?? 12, pg: r[`${pk}_pg`] ?? 12, alb: r[`${pk}_alb`] ?? null };
    }
  }
  let nStrom = 0, nStromK = 0;
  for (const [key, e] of Object.entries(byPg)) {
    const bands = unifyBands(e.direktBands);
    const k = kondPg[key] || {};
    for (const band of bands) for (const pk of STROM_PROD) {
      if (!e.price[pk]) continue;
      insPreis.run('strom', e.ga, band.vVon, band.vBis, e.plz, e.ort, pk, null, e.price[pk].apB, e.price[pk].gpB, null, 0);
      nStrom++;
      if (!k[pk]) continue;
      const bonus = pk === 'Direkt' ? band.bonus : 0;
      insKondB.run('strom', e.ga, band.vVon, band.vBis, e.plz, pk, k[pk].pid, k[pk].aid, k[pk].pidNt, k[pk].aidNt, k[pk].vl, k[pk].pg, k[pk].alb, bonus);
      nStromK++;
    }
  }

  // ── HEIZSTROM: per (plz, ga, zaehlerart) ──
  let nHz = 0;
  for (const r of rows.filter(r => r.sparte === 'heizstrom' && r.tabelle === 'preise'))
    for (const pk of HZ_PROD)
      if (r[`${pk}_apB`] != null) { insPreis.run('heizstrom', r.ga, r.vVon, r.vBis, r.plz, r.ort, pk, r.zaehlerart ?? null, r[`${pk}_apB`], r[`${pk}_gpB`] ?? null, r[`${pk}_apNtB`] ?? null, 0); nHz++; }
  const nHzK = insKondRows(r => r.sparte === 'heizstrom' && r.tabelle === 'konditionen', HZ_PROD, 'heizstrom', r => r.plz, false);

  // ── AUTOSTROM: per (plz, ga) – Mobil ──
  let nAs = 0;
  for (const r of rows.filter(r => r.sparte === 'autostrom' && r.tabelle === 'preise'))
    if (r['Mobil_apB'] != null) { insPreis.run('autostrom', r.ga, r.vVon, r.vBis, r.plz, r.ort, 'Mobil', null, r['Mobil_apB'], r['Mobil_gpB'] ?? null, null, 0); nAs++; }
  const nAsK = insKondRows(r => r.sparte === 'autostrom' && r.tabelle === 'konditionen', ['Mobil'], 'autostrom', r => r.plz, false);

  // ── GAS: uniform → Gebiets-Konditionen (plz = NULL) ──
  const nGasK = insKondRows(r => r.sparte === 'gas' && r.tabelle === 'konditionen' && r.uniform, GAS_PROD, 'gas', () => null, false);

  db.exec('COMMIT');
  console.log(`✓ per-PLZ geladen: Strom ${nStrom}P/${nStromK}K, Heizstrom ${nHz}P/${nHzK}K, AutoStrom ${nAs}P/${nAsK}K, Gas ${nGasK}K (uniform).`);
  const plzCount = db.prepare('SELECT COUNT(DISTINCT plz) n FROM preise WHERE plz IS NOT NULL').get().n;
  console.log(`  abgedeckte PLZ: ${plzCount}`);
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
