/**
 * Additiver Import der NEUEN Strom-Gültigkeit 2026-06-24 (Regionalstrom Direkt).
 *
 * Hintergrund: Spät am 2026-06-23 kam ein neuer Preisstand NUR für Strom/Direkt:
 *  - Direkt-Preis aktualisiert (z.B. EUS 32,25 → 31,89 ct/kWh), neue Angebots-IDs.
 *  - Erstmals ein VERBRAUCHSABHÄNGIGER Bonus (nur EUS, brutto):
 *      1500–2499 → 182 €,  2500–2999 → 260 €,  3000–3499 → 290 €,  3500+ → 339,99 €.
 *  - Basis/Komfort unverändert (Carry-forward).
 *
 * Warum ein Sonderskript statt rebuild: Nutzer-Vorgabe „nichts überschreiben". Dieses Skript
 * fügt AUSSCHLIESSLICH die GA 2026-06-24 für Strom ein und lässt alle anderen Stände unangetastet.
 *
 * Bonus-Modell (Entscheidung): Der Direkt-Bonus wird IMMER angezeigt (nicht an das
 * Neukundenbonus-Häkchen gebunden) → gespeichert in konditionen.bonus PRO PRODUKT pro Band.
 * calcTarif liest `kond[produkt].bonus` bereits per Verbrauchsband → kein Code-Eingriff nötig.
 *
 * Web-App-Constraint: findPreisRow/findKondRow liefern EINE Zeile je (ga, verbrauch, plz) für
 * ALLE Produkte. Deshalb werden je Band Basis+Komfort+Direkt zusammen abgelegt (vereinheitlichte
 * Bänder), Direkt-Bonus produkt-spezifisch in den Konditionen.
 *
 * Quelle: plz_prices_NEW.json + (Gebiets-Repräsentanten daraus). quelle='import'.
 * Aufruf: node api/migrate-add-ga-strom-2026-06-24.js
 */
const fs = require('fs');
const path = require('path');
const { getProdukte } = require('./db');

const GA = '2026-06-24';
const SPARTE = 'strom';
const PROD = ['Basis', 'Komfort', 'Direkt'];
// Repräsentativ-PLZ je Gebiet (für die Gebiets-Fallback-Zeilen, plz IS NULL)
const REP = { 'EUS': '53879', 'BHM': '53332', 'WTB': '53343', 'übrige': '53340' };

const SRC = path.join('C:\\Users\\marck\\Downloads\\accdb-tools', 'plz_prices.json');
if (!fs.existsSync(SRC)) { console.error('plz_prices.json fehlt – ExportPlzAll ausführen (rebuild-prices.bat Schritt 6).'); process.exit(1); }
const rows = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const db = getProdukte();

// ── Aus dem Export je PLZ die Produkt-Daten + Direkt-Bonus-Bänder sammeln ──────────
function collectPlz(plz) {
  const pr = rows.filter(r => r.sparte === SPARTE && r.ga === GA && r.plz === plz && r.tabelle === 'preise');
  const kr = rows.filter(r => r.sparte === SPARTE && r.ga === GA && r.plz === plz && r.tabelle === 'konditionen');
  if (!pr.length) return null;

  const price = {}; // pk → {apB,gpB}
  const kond  = {}; // pk → {pid,aid,pidNt,aidNt,vl,pg,alb}
  const direktBands = []; // [{vVon,vBis,bonus}]

  for (const r of pr) for (const pk of PROD) {
    if (r[`${pk}_apB`] == null) continue;
    if (!price[pk]) price[pk] = { apB: r[`${pk}_apB`], gpB: r[`${pk}_gpB`] ?? null };
    if (pk === 'Direkt') direktBands.push({ vVon: r.vVon, vBis: r.vBis, bonus: r.bonus ?? 0 });
  }
  for (const r of kr) for (const pk of PROD) {
    if (r[`${pk}_pid`] == null) continue;
    if (!kond[pk]) kond[pk] = {
      pid: r[`${pk}_pid`], aid: r[`${pk}_aid`] ?? 0,
      pidNt: r[`${pk}_pid_nt`] ?? null, aidNt: r[`${pk}_aid_nt`] ?? null,
      vl: r[`${pk}_vl`] ?? 12, pg: r[`${pk}_pg`] ?? 12, alb: r[`${pk}_alb`] ?? null,
    };
  }
  return { price, kond, direktBands };
}

// Vereinheitlichte, lückenlose Bänder 0..999999 mit Direkt-Bonus je Band.
// Unter der untersten Export-Stufe (z.B. <1500) → Bonus 0 (Nutzer-Vorgabe).
function unifyBands(direktBands) {
  const bands = direktBands.filter(b => b.apBonus !== undefined || true)
    .map(b => ({ vVon: b.vVon, vBis: b.vBis, bonus: b.bonus || 0 }))
    .sort((a, b) => a.vVon - b.vVon);
  if (bands.length <= 1) return [{ vVon: 0, vBis: 999999, bonus: bands[0] ? bands[0].bonus : 0 }];
  const out = [];
  if (bands[0].vVon > 0) out.push({ vVon: 0, vBis: bands[0].vVon - 1, bonus: 0 });
  for (const b of bands) out.push({ ...b });
  out[out.length - 1].vBis = 999999; // oberste Stufe bis ans Ende verlängern
  return out;
}

const insPreis = db.prepare(`
  INSERT INTO preise (sparte, ga, v_von, v_bis, gebiet, plz, ort, produkt_key, zaehlerart, ap_b, gp_b, bonus, quelle)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 'import')
`);
const insKond = db.prepare(`
  INSERT INTO konditionen (sparte, ga, v_von, v_bis, gebiet, plz, zaehlerart, produkt_key, pid, aid, pid_nt, aid_nt, vl, pg, alb, bonus, quelle)
  VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')
`);
const insGa = db.prepare(`INSERT OR IGNORE INTO gueltigkeiten (sparte, ga, quelle) VALUES (?, ?, 'import')`);

// Schreibt für einen Träger (per-PLZ ODER Gebiet) die vereinheitlichten Band-Zeilen.
function writeEntries({ price, kond, direktBands }, { plz, ort, gebiet }) {
  const bands = unifyBands(direktBands);
  let nP = 0, nK = 0;
  for (const band of bands) {
    for (const pk of PROD) {
      if (!price[pk]) continue;
      insPreis.run(SPARTE, GA, band.vVon, band.vBis, gebiet, plz, ort, pk, price[pk].apB, price[pk].gpB);
      nP++;
      const k = kond[pk];
      if (!k) continue;
      const bonus = pk === 'Direkt' ? band.bonus : 0;
      insKond.run(SPARTE, GA, band.vVon, band.vBis, gebiet, plz, pk, k.pid, k.aid, k.pidNt, k.aidNt, k.vl, k.pg, k.alb, bonus);
      nK++;
    }
  }
  return { nP, nK };
}

// ── Lauf ───────────────────────────────────────────────────────────────────────────
const existing = db.prepare('SELECT COUNT(*) n FROM preise WHERE sparte=? AND ga=?').get(SPARTE, GA).n;
console.log(`Bestehende Strom-Zeilen für ${GA}: ${existing} (werden idempotent ersetzt, nur diese GA).`);

const allPlz = [...new Set(rows.filter(r => r.sparte === SPARTE && r.ga === GA && r.plz).map(r => r.plz))];
console.log(`Per-PLZ im Export für ${GA}: ${allPlz.length} PLZ.`);

db.exec('BEGIN');
try {
  // Idempotent: nur die GA 2026-06-24 (Strom) leeren – nichts anderes anfassen.
  db.prepare('DELETE FROM preise       WHERE sparte=? AND ga=?').run(SPARTE, GA);
  db.prepare('DELETE FROM konditionen  WHERE sparte=? AND ga=?').run(SPARTE, GA);

  insGa.run(SPARTE, GA);

  let pTot = 0, kTot = 0, plzDone = 0, bonusPlz = 0;
  // per-PLZ
  for (const plz of allPlz) {
    const data = collectPlz(plz);
    if (!data) continue;
    const ort = (rows.find(r => r.sparte === SPARTE && r.ga === GA && r.plz === plz && r.ort) || {}).ort ?? null;
    if (unifyBands(data.direktBands).some(b => b.bonus > 0)) bonusPlz++;
    const { nP, nK } = writeEntries(data, { plz, ort, gebiet: null });
    pTot += nP; kTot += nK; plzDone++;
  }
  // Gebiets-Fallback (plz IS NULL) aus den Repräsentanten
  let gTot = 0;
  for (const [geb, plz] of Object.entries(REP)) {
    const data = collectPlz(plz);
    if (!data) { console.warn(`  ! Rep-PLZ ${plz} (${geb}) fehlt im Export – Gebiet übersprungen.`); continue; }
    const { nP, nK } = writeEntries(data, { plz: null, ort: null, gebiet: geb });
    gTot += nP + nK;
  }

  db.exec('COMMIT');
  console.log(`\n✓ GA ${GA} eingefügt:`);
  console.log(`  per-PLZ: ${plzDone} PLZ → ${pTot} Preis- / ${kTot} Konditions-Zeilen (davon ${bonusPlz} PLZ mit Direkt-Bonus-Staffeln).`);
  console.log(`  Gebiets-Fallback: ${gTot} Zeilen (${Object.keys(REP).join(', ')}).`);
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
