const { getDb } = require('../driver');

// Alle Mitbewerber-Preise für Sparte + PLZ + Varianten laden.
async function getMarktlage(sparte, plzGebiet, heizstromTyp, zaehlerart, nsMessung, steuveMod) {
  const db = getDb('produkte');
  let query = `SELECT * FROM mitbewerber_preise WHERE sparte = ? AND plz_gebiet = ?`;
  const params = [sparte, plzGebiet];

  if (sparte === 'heizstrom') {
    if (heizstromTyp) {
      query += ` AND heizstrom_typ = ?`;
      params.push(heizstromTyp);
      if (zaehlerart) {
        query += ` AND zaehlerart = ?`;
        params.push(zaehlerart);
      }
      if (heizstromTyp === 'ns' && nsMessung) {
        query += ` AND ns_messung = ?`;
        params.push(nsMessung);
      }
    }
  } else if (sparte === 'steuve' && steuveMod) {
    query += ` AND steuve_modul = ?`;
    params.push(steuveMod);
  }

  query += ` ORDER BY arbeitspreis ASC`;

  const rows = await db.all(query, params);
  return rows || [];
}

// Statistiken für Sparte + optional Varianten (Heizstrom: heizstromTyp+zaehlerart+nsMessung, SteuVE: steuveMod).
async function getStatistiken(sparte, heizstromTyp, zaehlerart, nsMessung, steuveMod) {
  const db = getDb('produkte');
  let query = `SELECT
       COUNT(*) as anzahl_anbieter,
       AVG(arbeitspreis) as avg_arbeitspreis,
       AVG(grundpreis) as avg_grundpreis,
       MIN(arbeitspreis) as min_arbeitspreis,
       MAX(arbeitspreis) as max_arbeitspreis,
       MIN(bonus) as min_bonus,
       MAX(bonus) as max_bonus,
       AVG(CASE WHEN bonus > 0 THEN bonus ELSE NULL END) as avg_bonus_nonnull
     FROM mitbewerber_preise
     WHERE sparte = ?`;
  const params = [sparte];

  if (sparte === 'heizstrom') {
    if (heizstromTyp) {
      query += ` AND heizstrom_typ = ?`;
      params.push(heizstromTyp);
      if (zaehlerart) {
        query += ` AND zaehlerart = ?`;
        params.push(zaehlerart);
      }
      if (heizstromTyp === 'ns' && nsMessung) {
        query += ` AND ns_messung = ?`;
        params.push(nsMessung);
      }
    }
  } else if (sparte === 'steuve' && steuveMod) {
    query += ` AND steuve_modul = ?`;
    params.push(steuveMod);
  }

  query += ` AND arbeitspreis IS NOT NULL`;

  const stats = await db.get(query, params);

  // Details für günstigster + teuerster (mit gleichen Varianten-Filtern wie Stats)
  let cheapQuery = `SELECT * FROM mitbewerber_preise WHERE sparte = ? AND arbeitspreis IS NOT NULL`;
  let cheapParams = [sparte];

  if (sparte === 'heizstrom' && heizstromTyp) {
    cheapQuery += ` AND heizstrom_typ = ?`;
    cheapParams.push(heizstromTyp);
    if (zaehlerart) {
      cheapQuery += ` AND zaehlerart = ?`;
      cheapParams.push(zaehlerart);
    }
    if (heizstromTyp === 'ns' && nsMessung) {
      cheapQuery += ` AND ns_messung = ?`;
      cheapParams.push(nsMessung);
    }
  } else if (sparte === 'steuve' && steuveMod) {
    cheapQuery += ` AND steuve_modul = ?`;
    cheapParams.push(steuveMod);
  }

  cheapQuery += ` ORDER BY arbeitspreis ASC LIMIT 1`;
  const cheapest = await db.get(cheapQuery, cheapParams);
  const most_expensive = await db.get(cheapQuery.replace('ASC', 'DESC'), cheapParams);

  // Bonus-Verteilung (optional: auch mit Varianten filtern, aber für MVP einfach halten)
  const bonusDistribution = await db.all(
    `SELECT
       CASE WHEN bonus IS NULL OR bonus = 0 THEN 'ohne' ELSE 'mit_bedingung' END as kategorie,
       COUNT(*) as anzahl
     FROM mitbewerber_preise
     WHERE sparte = ?
     GROUP BY kategorie`,
    [sparte]
  );

  return {
    anzahl_anbieter: stats?.anzahl_anbieter || 0,
    guentigster: cheapest || null,
    teuerster: most_expensive || null,
    avg_arbeitspreis: stats?.avg_arbeitspreis || 0,
    avg_grundpreis: stats?.avg_grundpreis || 0,
    avg_bonus: stats?.avg_bonus_nonnull || 0,
    bonus_verteilung: bonusDistribution || [],
  };
}

// Neue/aktualisierte Tarife speichern (INSERT OR IGNORE bei Duplikat).
async function upsertTarife(tarife) {
  const db = getDb('produkte');
  let added = 0;

  for (const tarif of tarife) {
    try {
      const result = await db.run(
        `INSERT OR IGNORE INTO mitbewerber_preise
         (id, anbieter, sparte, heizstrom_typ, zaehlerart, ns_messung, steuve_modul, plz_gebiet, arbeitspreis, grundpreis, bonus, bonus_bedingung, gueltig_ab, gueltig_bis, quelle, aktualisiert_am, hash_content, logo_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${tarif.quelle}|${tarif.hash_content}`,
          tarif.anbieter,
          tarif.sparte,
          tarif.heizstrom_typ || null,
          tarif.zaehlerart || null,
          tarif.ns_messung || null,
          tarif.steuve_modul || null,
          tarif.plz_gebiet,
          tarif.arbeitspreis,
          tarif.grundpreis,
          tarif.bonus,
          tarif.bonus_bedingung,
          tarif.gueltig_ab,
          tarif.gueltig_bis,
          tarif.quelle,
          new Date().toISOString(),
          tarif.hash_content,
          tarif.logo_url || null,
        ]
      );
      if (result.changes) added++;
    } catch (err) {
      console.error(`Fehler beim Einfügen von ${tarif.anbieter}/${tarif.sparte}:`, err.message);
    }
  }

  return added;
}

// Alle Einträge einer oder mehrerer Quellen löschen (für Snapshot-Re-Import).
async function deleteByQuellen(quellen) {
  if (!quellen || !quellen.length) return 0;
  const db = getDb('produkte');
  const ph = quellen.map(() => '?').join(',');
  const res = await db.run(`DELETE FROM mitbewerber_preise WHERE quelle IN (${ph})`, quellen);
  return res?.changes || 0;
}

// Alte Einträge löschen (älter als 72h).
async function deleteOldEntries(ageHours = 72) {
  const db = getDb('produkte');
  const cutoffTime = new Date(Date.now() - ageHours * 3600 * 1000).toISOString();

  const result = await db.run(
    `DELETE FROM mitbewerber_preise
     WHERE aktualisiert_am < ?`,
    [cutoffTime]
  );

  return result?.changes || 0;
}

// Alle Sparten für die Statistik abrufen.
async function getAllSparten() {
  const db = getDb('produkte');
  const rows = await db.all(
    `SELECT DISTINCT sparte FROM mitbewerber_preise ORDER BY sparte`
  );
  return rows?.map(r => r.sparte) || [];
}

module.exports = {
  getMarktlage,
  getStatistiken,
  upsertTarife,
  deleteByQuellen,
  deleteOldEntries,
  getAllSparten,
};
