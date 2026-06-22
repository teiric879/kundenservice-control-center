// Repository für die Besucher-Datenbank (besucher). Kapselt alles SQL rund um `besuche`.

const { getDb } = require('../driver');
const db = () => getDb('besucher');

module.exports = {
  // Besuche optional nach Datumsbereich (von/bis, YYYYMMDD bzw. ISO – wie gespeichert).
  listBesuche({ von, bis } = {}) {
    let sql = 'SELECT * FROM besuche';
    const params = [];
    const conds = [];
    if (von) { conds.push('datum >= ?'); params.push(von); }
    if (bis) { conds.push('datum <= ?'); params.push(bis); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY datum ASC';
    return db().all(sql, params);
  },

  // Standorte nach Häufigkeit (für die Erfass-Leiste).
  async topStandorte() {
    const rows = await db().all(
      "SELECT standort FROM besuche WHERE standort IS NOT NULL AND standort <> '(ohne Angabe)' GROUP BY standort ORDER BY COUNT(*) DESC"
    );
    return rows.map((r) => r.standort);
  },

  // Top-N-Kategorien nach Häufigkeit (für die Erfass-Leiste).
  topKategorien(n) {
    return db().all(
      "SELECT kategorie, COUNT(*) c FROM besuche WHERE kategorie IS NOT NULL AND kategorie <> '' AND kategorie <> '(ohne)' GROUP BY kategorie ORDER BY c DESC LIMIT ?",
      [n]
    );
  },

  async insertBesuch({ datum, standort, kategorie, stunde }) {
    const r = await db().run(
      'INSERT INTO besuche (datum, standort, kategorie, stunde) VALUES (?, ?, ?, ?)',
      [datum, standort, kategorie ?? null, stunde ?? -1]
    );
    return r.lastInsertRowid;
  },
};
