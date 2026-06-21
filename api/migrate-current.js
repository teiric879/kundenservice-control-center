/**
 * Autoritativer Override für die AKTUELLEN Gültigkeiten.
 *
 * Quelle: current_prices.json (generiert von ExportCurrentPrices.java aus den
 * TB-Import-Tabellen der Kundenportal.accdb – korrekte Brutto-Preise + Staffeln).
 *
 * Warum: data.js / tb_history hatten falsche/veraltete Strom-Preise und künstliche
 * Verbrauchsbänder, die zu doppelten Preisen pro Datum führten. Dieser Schritt ersetzt
 * für die betroffenen (sparte, ga) die Preiszeilen vollständig durch die echten Werte.
 *
 * Logik:
 *  - GAS: pro (ga in current_prices) alle Preiszeilen löschen, durch echte Staffel-Zeilen
 *    ersetzen (Bänder 1-1000, 1001-4000, 4001-11999, 12000-50000, 50001+ identisch über
 *    Basis/Komfort/Klima+).
 *  - STROM: für alle Strom-GAs >= ERSTE_CURRENT_GA wird je Gebiet eine EINZIGE Zeile
 *    (Band 0-999999) gebaut, die Basis/Komfort (carry-forward aus current_prices) und –
 *    falls vorhanden – Direkt enthält. Damit liegen alle Produkte in einer Zeile (Anforderung
 *    der Web-App) und es gibt keine konkurrierenden Bänder mehr.
 *
 * Aufruf: node api/migrate-current.js   (nach migrate-history.js)
 */
const fs = require('fs');
const path = require('path');
const { getProdukte } = require('./db');

const CUR_FILE = path.join('C:\\Users\\marck\\Downloads\\accdb-tools', 'current_prices.json');
if (!fs.existsSync(CUR_FILE)) {
  console.error('current_prices.json nicht gefunden – ExportCurrentPrices.java zuerst ausführen.');
  process.exit(1);
}
const cur = JSON.parse(fs.readFileSync(CUR_FILE, 'utf8'));
const db = getProdukte();

const STROM_PRODUKTE = ['Basis', 'Komfort', 'Direkt'];
const GAS_PRODUKTE   = ['Basis', 'Komfort', 'Klima+'];
const GEBIETE        = ['übrige', 'BHM', 'WTB', 'EUS'];

const insPreis = db.prepare(`
  INSERT INTO preise (sparte, ga, v_von, v_bis, gebiet, produkt_key, zaehlerart, ap_b, gp_b, ap_n, gp_n, ap_nt_b, bonus)
  VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?)
`);

db.exec('BEGIN');
try {
  // ───────────────────────── GAS ─────────────────────────
  const gasRows = cur.filter(r => r.sparte === 'gas');
  const gasGAs  = [...new Set(gasRows.map(r => r.ga))];
  for (const ga of gasGAs) {
    db.prepare('DELETE FROM preise WHERE sparte=? AND ga=?').run('gas', ga);
    for (const r of gasRows.filter(x => x.ga === ga)) {
      for (const pk of GAS_PRODUKTE) {
        const ap = r[`${pk}_apB`], gp = r[`${pk}_gpB`];
        if (ap == null && gp == null) continue;
        insPreis.run('gas', ga, r.vVon, r.vBis, r.gebiet, pk, ap ?? null, gp ?? null, r.bonus ?? 0);
      }
    }
    console.log(`GAS ${ga}: Staffel-Preise neu gesetzt (${gasRows.filter(x => x.ga === ga).length} Zeilen).`);
  }

  // ───────────────────────── STROM ─────────────────────────
  // Ziel: jede Strom-GA bekommt je Gebiet EINE Zeile (Band 0-999999) mit allen Produkten.
  // Werte-Priorität: current_prices.json (autoritativ, TB-Import) > DB-Wert dieser GA
  //   (tb_history/all_prices, jetzt brutto) > Carry-forward aus letzter bekannter GA.
  // Klima+/Konstant sind im aktuellen Strom-Sortiment abgekündigt (keine echten TB-Daten) → nicht ausgeben
  const STROM_PROD = ['Basis', 'Komfort', 'Direkt'];
  const stromCur = cur.filter(r => r.sparte === 'strom');

  // current_prices → curMap[ga][gebiet][pk] = {apB,gpB}
  const curMap = {};
  for (const r of stromCur) {
    for (const pk of STROM_PROD) {
      if (r[`${pk}_apB`] == null) continue;
      (curMap[r.ga] ??= {});
      (curMap[r.ga][r.gebiet] ??= {});
      curMap[r.ga][r.gebiet][pk] = { apB: r[`${pk}_apB`], gpB: r[`${pk}_gpB`] };
    }
  }

  const stromGAs = db.prepare('SELECT DISTINCT ga FROM preise WHERE sparte=? ORDER BY ga')
                     .all('strom').map(r => r.ga);
  const last = {}; // last[gebiet][pk] = {apB,gpB} (carry-forward)

  for (const ga of stromGAs) {
    // DB-Werte dieser GA je (gebiet, pk) – beliebige Bandzeile genügt (Strom-AP/GP bandunabhängig)
    const dbVals = {};
    for (const row of db.prepare(
      'SELECT gebiet, produkt_key, ap_b, gp_b FROM preise WHERE sparte=? AND ga=? ORDER BY v_von'
    ).all('strom', ga)) {
      (dbVals[row.gebiet] ??= {});
      if (dbVals[row.gebiet][row.produkt_key] == null)
        dbVals[row.gebiet][row.produkt_key] = { apB: row.ap_b, gpB: row.gp_b };
    }

    db.prepare('DELETE FROM preise WHERE sparte=? AND ga=?').run('strom', ga);

    for (const geb of GEBIETE) {
      for (const pk of STROM_PROD) {
        const val = curMap[ga]?.[geb]?.[pk]
                 ?? dbVals[geb]?.[pk]
                 ?? last[geb]?.[pk];
        if (!val) continue;
        (last[geb] ??= {})[pk] = val; // carry-forward aktualisieren
        insPreis.run('strom', ga, 0, 999999, geb, pk, val.apB, val.gpB, 0);
      }
    }
    console.log(`STROM ${ga}: vereinheitlicht (Band 0-999999, ${GEBIETE.length} Gebiete).`);
  }

  // Produktlisten der Sparten aktualisieren
  db.prepare('UPDATE sparten SET produkte=? WHERE sparte=?').run(JSON.stringify(STROM_PRODUKTE), 'strom');
  db.prepare('UPDATE sparten SET produkte=? WHERE sparte=?').run(JSON.stringify(GAS_PRODUKTE), 'gas');
  // Labels für Strom-Direkt sicherstellen
  const stromMeta = db.prepare('SELECT labels FROM sparten WHERE sparte=?').get('strom');
  if (stromMeta) {
    const labels = JSON.parse(stromMeta.labels);
    labels['Direkt'] = labels['Direkt'] || 'Regionalstrom Direkt';
    db.prepare('UPDATE sparten SET labels=? WHERE sparte=?').run(JSON.stringify(labels), 'strom');
  }

  // Gebiete-Meta: alle Sparten mit per-Gebiet-Preisen führen die 4 e-regio-Gebiete
  for (const sp of ['strom', 'heizstrom', 'autostrom']) {
    db.prepare('UPDATE sparten SET gebiete=? WHERE sparte=?').run(JSON.stringify(GEBIETE), sp);
  }

  db.exec('COMMIT');
  console.log('\n✓ Current-Override abgeschlossen.');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

// per-PLZ-Preise (externes Gebiet) laden – alle ~367 e-regio-Angebots-PLZ
console.log('\n→ per-PLZ-Preise (plz_prices.json)…');
require('./migrate-plz.js');
