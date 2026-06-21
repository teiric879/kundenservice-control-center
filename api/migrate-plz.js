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
const db = getProdukte();

const insPreis = db.prepare(`
  INSERT INTO preise (sparte, ga, v_von, v_bis, gebiet, plz, ort, produkt_key, zaehlerart, ap_b, gp_b, ap_nt_b, bonus)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
`);
// plz nullable: bei Gas-uniform = NULL (Gebiets-Kondition)
const insKond = db.prepare(`
  INSERT INTO konditionen (sparte, ga, v_von, v_bis, gebiet, plz, zaehlerart, produkt_key, pid, aid, pid_nt, aid_nt, vl, pg, alb, bonus)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);

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

  // ── STROM: collapse je (plz, ga) ──
  const byPg = {};
  for (const r of rows.filter(r => r.sparte === 'strom' && r.tabelle === 'preise')) {
    const key = r.plz + '|' + r.ga;
    (byPg[key] ??= { plz: r.plz, ga: r.ga, ort: r.ort, prod: {} });
    for (const pk of STROM_PROD)
      if (r[`${pk}_apB`] != null && byPg[key].prod[pk] == null)
        byPg[key].prod[pk] = { apB: r[`${pk}_apB`], gpB: r[`${pk}_gpB`] };
  }
  let nStrom = 0;
  for (const e of Object.values(byPg))
    for (const pk of STROM_PROD)
      if (e.prod[pk]) { insPreis.run('strom', e.ga, 0, 999999, e.plz, e.ort, pk, null, e.prod[pk].apB, e.prod[pk].gpB, null, 0); nStrom++; }
  const nStromK = insKondRows(r => r.sparte === 'strom' && r.tabelle === 'konditionen', STROM_PROD, 'strom', r => r.plz, true);

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
