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

  // Spätestes bereits gespeichertes Datum (YYYYMMDD-Text). Cutoff für den Inkrement-Import.
  async maxDatum() {
    const r = await db().get('SELECT MAX(datum) AS m FROM besuche');
    return r?.m ?? null;
  },

  // Inkrementeller Besucher-Import aus dem Access-Upload. Fügt NUR Besuche mit
  // datum > cutoff (= bisher spätestes Datum) hinzu — bestehende (auch per App
  // erfasste) Zeilen bleiben unangetastet, nichts wird doppelt gezählt.
  // rows: [{ datum:'YYYYMMDD', standort, kategorie, stunde, ts }]
  async bulkInsertVisits(rows) {
    const cutoff = await this.maxDatum();
    const neu = (rows || []).filter((r) => r && r.datum && (cutoff == null || String(r.datum) > String(cutoff)));
    let added = 0;
    const dates = [];
    if (neu.length) {
      await db().transaction(async (tx) => {
        for (const r of neu) {
          await tx.run(
            'INSERT INTO besuche (datum, standort, kategorie, stunde, ts) VALUES (?,?,?,?,?)',
            [String(r.datum), r.standort || '(ohne Angabe)', r.kategorie ?? null, r.stunde ?? -1, r.ts ?? null],
          );
          added++;
          dates.push(String(r.datum));
        }
      });
    }
    const range = dates.length ? { min: dates.reduce((a, b) => a < b ? a : b), max: dates.reduce((a, b) => a > b ? a : b) } : null;
    return { added, skipped: (rows?.length || 0) - added, cutoff, range };
  },
};
