/**
 * Migriert alle historischen Preise + Konditionen aus all_prices.json in produkte.sqlite.
 * Löscht vorher nur die aus Access stammenden Zeilen (sparte != 'steuve' bleibt intakt
 * sofern SteuVE nicht in Access-History vorhanden ist).
 * Führt einen vollständigen Ersatz durch: alle Zeilen werden neu geschrieben.
 */
const fs = require('fs');
const path = require('path');
const { initProdukte } = require('./schema');
const { getProdukte } = require('./db');

const JSON_FILE = path.join(
  'C:\\Users\\marck\\Downloads\\accdb-tools',
  'all_prices.json'
);

if (!fs.existsSync(JSON_FILE)) {
  console.error('all_prices.json nicht gefunden. Zuerst ExportAllPrices.java ausführen.');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
console.log(`Geladene Zeilen aus all_prices.json: ${rows.length}`);

// SteuVE Historik aus TB 900 (ExportSteuVEHistory.java)
const STEUVE_FILE = path.join('C:\\Users\\marck\\Downloads\\accdb-tools', 'steuve_history.json');
if (fs.existsSync(STEUVE_FILE)) {
  const steuveRows = JSON.parse(fs.readFileSync(STEUVE_FILE, 'utf8'));
  rows.push(...steuveRows);
  console.log(`SteuVE-History ergänzt: ${steuveRows.length} Zeilen aus steuve_history.json`);
} else {
  console.log('steuve_history.json nicht gefunden – übersprungen.');
}

initProdukte();
const db = getProdukte();

// Bestehende Import-Zeilen löschen (sparten-Meta bleibt). Im Admin gepflegte Stände
// (quelle='manuell') überleben einen versehentlichen Rebuild – SQLite ist jetzt autoritativ.
db.exec(`DELETE FROM preise        WHERE quelle IS NULL OR quelle <> 'manuell';
         DELETE FROM konditionen   WHERE quelle IS NULL OR quelle <> 'manuell';
         DELETE FROM gueltigkeiten WHERE quelle IS NULL OR quelle <> 'manuell';`);

const insGa = db.prepare('INSERT OR IGNORE INTO gueltigkeiten (sparte, ga) VALUES (?, ?)');

const insPreis = db.prepare(`
  INSERT INTO preise (sparte, ga, v_von, v_bis, gebiet, produkt_key, zaehlerart, ap_b, gp_b, ap_n, gp_n, ap_nt_b, bonus)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insKond = db.prepare(`
  INSERT INTO konditionen (sparte, ga, v_von, v_bis, gebiet, produkt_key, pid, aid, pid_nt, aid_nt, vl, pg, alb, bonus, netzentgelt_red)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Produkt-Definitionen je Sparte (für Gültigkeiten-Registrierung)
const SPARTE_PRODUKTE = {
  gas:       ['Basis', 'Komfort', 'Klima+', 'Direkt', 'Konstant'],
  strom:     ['Basis', 'Komfort', 'Klima+', 'Konstant', 'Direkt'],
  heizstrom: ['WP', 'NS-Gem', 'NS-Get'],
  autostrom: ['Mobil', 'MobilPlus'],
  steuve:    ['WP-M1', 'WP-M3', 'Wallbox-M1', 'Wallbox-M2'],
};

db.exec('BEGIN');
try {
  for (const r of rows) {
    const { sparte, tabelle, ga, vVon, vBis, gebiet } = r;
    insGa.run(sparte, ga);

    const produkte = SPARTE_PRODUKTE[sparte] ?? [];

    if (tabelle === 'preise') {
      for (const pk of produkte) {
        const apB  = r[`${pk}_apB`]   ?? null;
        const gpB  = r[`${pk}_gpB`]   ?? null;
        const apN  = r[`${pk}_apN`]   ?? null;
        const gpN  = r[`${pk}_gpN`]   ?? null;
        const apNtB = r[`${pk}_apNtB`] ?? null;
        if (apB == null && gpB == null && apN == null) continue;
        insPreis.run(sparte, ga, vVon ?? 0, vBis ?? 999999, gebiet ?? null, pk, r.zaehlerart ?? null,
          apB, gpB, apN, gpN, apNtB, r.bonus ?? 0);
      }
    } else {
      for (const pk of produkte) {
        const pid   = r[`${pk}_pid`]    ?? null;
        const aid   = r[`${pk}_aid`]    ?? null;
        const pidNt = r[`${pk}_pid_nt`] ?? null;
        const aidNt = r[`${pk}_aid_nt`] ?? null;
        const vl    = r[`${pk}_vl`]     ?? 12;
        const pg    = r[`${pk}_pg`]     ?? 12;
        const bon   = r[`${pk}_bonus`]  ?? r.bonus ?? 0;
        if (pid == null) continue;
        const alb = r[`${pk}_alb`] ?? null;
        insKond.run(sparte, ga, vVon ?? 0, vBis ?? 999999, gebiet ?? null, pk,
          pid, aid ?? 0, pidNt, aidNt, vl, pg, alb, bon, null);
      }
    }
  }

  // Aktuelle Preise aus data.js nachtragen (TB Import-Verknüpfungen, nicht in History-Tabellen)
  const vm = require('vm');
  const dataJs = fs.readFileSync(
    path.join(__dirname, '..', 'produkt-id-tool', 'data.js'), 'utf8'
  );
  const sandbox = { window: {} };
  vm.runInNewContext(dataJs, sandbox);
  const PRODUKTDATEN = sandbox.window.PRODUKTDATEN ?? {};

  for (const [sparteKey, s] of Object.entries(PRODUKTDATEN)) {
    for (const ga of s.gueltigkeiten) insGa.run(sparteKey, ga);

    // WICHTIG: data.js-PREISE werden NICHT als Quelle genutzt. SyncDataJs liefert für
    // Heizstrom/AutoStrom/SteuVE teils NETTO-Werte und für Strom veraltete Stände →
    // alle Brutto-Preise kommen aus all_prices/tb_history/current_prices/steuve_history.
    // Nur die KONDITIONEN (PIDs/Angebots-IDs/VL/PG) aus data.js werden übernommen.
    for (const row of s.konditionen) {
      for (const pk of s.produkte) {
        const k = row[pk];
        if (!k) continue;
        const exists = db.prepare(
          'SELECT 1 FROM konditionen WHERE sparte=? AND ga=? AND v_von=? AND v_bis=? AND (gebiet IS ? OR gebiet=?) AND produkt_key=? LIMIT 1'
        ).get(sparteKey, row.ga, row.vVon, row.vBis, row.gebiet ?? null, row.gebiet ?? null, pk);
        if (exists) continue;
        insKond.run(sparteKey, row.ga, row.vVon, row.vBis, row.gebiet ?? null, pk,
          k.pid ?? 0, k.aid ?? 0, k.pidNt ?? null, k.aidNt ?? null,
          k.vl ?? 12, k.pg ?? 12, k.alb ?? null, k.bonus ?? 0, k.netzentgeltRed ?? null);
      }
    }
  }
  console.log('Aktuelle Preise aus data.js ergänzt (fehlende ga-Daten).');

  // Historische per-PLZ-Preise aus TB 600/700/800 (viele 2026-Daten die in History-Tabellen fehlen)
  const TB_FILE = path.join('C:\\Users\\marck\\Downloads\\accdb-tools', 'tb_history.json');
  if (fs.existsSync(TB_FILE)) {
    const tbRows = JSON.parse(fs.readFileSync(TB_FILE, 'utf8'));
    let tbCount = 0;
    for (const r of tbRows) {
      const { sparte, tabelle, ga, vVon, vBis, gebiet, zaehlerart } = r;
      insGa.run(sparte, ga);
      if (tabelle !== 'preise') continue;
      const produkte = SPARTE_PRODUKTE[sparte] ?? [];
      for (const pk of produkte) {
        const apB   = r[`${pk}_apB`]   ?? null;
        const gpB   = r[`${pk}_gpB`]   ?? null;
        const apNtB = r[`${pk}_apNtB`] ?? null;
        if (apB == null && gpB == null) continue;
        const exists = db.prepare(
          'SELECT 1 FROM preise WHERE sparte=? AND ga=? AND v_von=? AND v_bis=? AND (gebiet IS ? OR gebiet=?) AND produkt_key=? AND (zaehlerart IS ? OR zaehlerart=?) LIMIT 1'
        ).get(sparte, ga, vVon ?? 0, vBis ?? 999999, gebiet ?? null, gebiet ?? null, pk, zaehlerart ?? null, zaehlerart ?? null);
        if (exists) continue;
        insPreis.run(sparte, ga, vVon ?? 0, vBis ?? 999999, gebiet ?? null, pk, zaehlerart ?? null,
          apB, gpB, null, null, apNtB, r.bonus ?? 0);
        tbCount++;
      }
    }
    console.log(`TB-History-Preise ergänzt: ${tbCount} neue Zeilen aus ${tbRows.length} TB-Einträgen.`);
  } else {
    console.log('tb_history.json nicht gefunden – übersprungen.');
  }

  // Aktuelle Preise aus Kundenportal-DB (per-Produkt-Daten, korrekte Daten je Produkt)
  const KP_FILE = path.join('C:\\Users\\marck\\Downloads\\accdb-tools', 'kundenportal_prices.json');
  if (fs.existsSync(KP_FILE)) {
    const kpRows = JSON.parse(fs.readFileSync(KP_FILE, 'utf8'));
    let kpCount = 0;
    for (const r of kpRows) {
      const { sparte, tabelle, ga, vVon, vBis, gebiet, zaehlerart } = r;
      insGa.run(sparte, ga);
      if (tabelle !== 'preise') continue;
      const produkte = SPARTE_PRODUKTE[sparte] ?? [];
      for (const pk of produkte) {
        const apB   = r[`${pk}_apB`]   ?? null;
        const gpB   = r[`${pk}_gpB`]   ?? null;
        const apN   = r[`${pk}_apN`]   ?? null;
        const gpN   = r[`${pk}_gpN`]   ?? null;
        const apNtB = r[`${pk}_apNtB`] ?? null;
        if (apB == null && gpB == null && apN == null) continue;
        // Nicht doppelt einfügen (gleiche ga + gebiet + pk aus data.js könnte schon da sein)
        const exists = db.prepare(
          'SELECT 1 FROM preise WHERE sparte=? AND ga=? AND (gebiet IS ? OR gebiet=?) AND produkt_key=? AND (zaehlerart IS ? OR zaehlerart=?) LIMIT 1'
        ).get(sparte, ga, gebiet ?? null, gebiet ?? null, pk, zaehlerart ?? null, zaehlerart ?? null);
        if (exists) continue;
        insPreis.run(sparte, ga, vVon ?? 0, vBis ?? 999999, gebiet ?? null, pk, zaehlerart ?? null,
          apB, gpB, apN, gpN, apNtB, r.bonus ?? 0);
        kpCount++;
      }
    }
    console.log(`Kundenportal-Preise ergänzt: ${kpCount} neue Zeilen aus ${kpRows.length} Kundenportal-Einträgen.`);
  } else {
    console.log('kundenportal_prices.json nicht gefunden – übersprungen.');
  }

  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

// Statistik
const stats = db.prepare('SELECT sparte, COUNT(DISTINCT ga) as ga_count, COUNT(*) as rows FROM preise GROUP BY sparte').all();
console.log('\nErgebnis in produkte.sqlite:');
for (const s of stats) {
  console.log(`  ${s.sparte}: ${s.ga_count} Gültigkeiten, ${s.rows} Preiszeilen`);
}
const gaCount = db.prepare('SELECT COUNT(*) as n FROM gueltigkeiten').get().n;
console.log(`  Gesamt Gültigkeiten: ${gaCount}`);

// Autoritativer Override der aktuellen Gültigkeiten aus current_prices.json
// (echte Brutto-Preise + Staffeln aus den TB-Import-Tabellen der Kundenportal.accdb)
console.log('\n→ Current-Override (current_prices.json)…');
require('./migrate-current.js');
