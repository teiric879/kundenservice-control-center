const { getDb } = require('../driver');

// Alle Mitbewerber-Preise für Sparte + PLZ laden.
async function getMarktlage(sparte, plzGebiet) {
  const db = getDb('produkte');
  const rows = await db.all(
    `SELECT * FROM mitbewerber_preise
     WHERE sparte = ? AND plz_gebiet = ?
     ORDER BY arbeitspreis ASC`,
    [sparte, plzGebiet]
  );
  return rows || [];
}

// Statistiken für Sparte (günstigster, teuerster, Durchschnitt, Anzahl).
async function getStatistiken(sparte) {
  const db = getDb('produkte');
  const stats = await db.get(
    `SELECT
       COUNT(*) as anzahl_anbieter,
       MIN(arbeitspreis) as min_arbeitspreis,
       MAX(arbeitspreis) as max_arbeitspreis,
       AVG(arbeitspreis) as avg_arbeitspreis,
       MIN(bonus) as min_bonus,
       MAX(bonus) as max_bonus,
       AVG(CASE WHEN bonus > 0 THEN bonus ELSE NULL END) as avg_bonus_nonnull
     FROM mitbewerber_preise
     WHERE sparte = ? AND arbeitspreis IS NOT NULL`,
    [sparte]
  );

  // Details für günstigster + teuerster
  const cheapest = await db.get(
    `SELECT * FROM mitbewerber_preise
     WHERE sparte = ? AND arbeitspreis IS NOT NULL
     ORDER BY arbeitspreis ASC LIMIT 1`,
    [sparte]
  );
  const most_expensive = await db.get(
    `SELECT * FROM mitbewerber_preise
     WHERE sparte = ? AND arbeitspreis IS NOT NULL
     ORDER BY arbeitspreis DESC LIMIT 1`,
    [sparte]
  );

  // Bonus-Verteilung
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
    durchschnitt_arbeitspreis: stats?.avg_arbeitspreis || 0,
    durchschnitt_bonus: stats?.avg_bonus_nonnull || 0,
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
         (id, anbieter, sparte, plz_gebiet, arbeitspreis, grundpreis, bonus, bonus_bedingung, gueltig_ab, gueltig_bis, quelle, aktualisiert_am, hash_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${tarif.quelle}|${tarif.hash_content}`,
          tarif.anbieter,
          tarif.sparte,
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
        ]
      );
      if (result.changes) added++;
    } catch (err) {
      console.error(`Fehler beim Einfügen von ${tarif.anbieter}/${tarif.sparte}:`, err.message);
    }
  }

  return added;
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
  deleteOldEntries,
  getAllSparten,
};
