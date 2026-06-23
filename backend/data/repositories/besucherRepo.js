// Repository für die Besucher-Datenbank (besucher). Kapselt alles SQL rund um `besuche`.

const { getDb } = require('../driver');
const db = () => getDb('besucher');

module.exports = {
  // Besuche optional nach Datumsbereich (von/bis, YYYYMMDD bzw. ISO – wie gespeichert).
  listBesuche({ von, bis } = {}) {
    // Nur die vom Dashboard genutzten Spalten (kein id/ts) → kleinere Turso-Antwort + Payload.
    let sql = 'SELECT datum, standort, kategorie, stunde FROM besuche';
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

  // Inkrementeller Besucher-Import aus dem Access-Upload.
  //  • Zeilen NACH dem bisher spätesten Datum (datum > cutoff) sind garantiert neu → werden eingefügt.
  //  • Zeilen AUF dem Grenztag (datum == cutoff, i.d.R. heute) werden per natürlichem Schlüssel
  //    (Datum+Standort+Kategorie+Stunde+Zeitstempel) gegen den Bestand dedupliziert. So kommt
  //    „heute" mit rein, ohne dass ein zweiter Import desselben Tages doppelt zählt. Es wird
  //    nichts gelöscht; per App erfasste Besuche (ts = NULL) bleiben unangetastet.
  //  • Ältere Zeilen (datum < cutoff) gelten als bereits vorhanden und werden übersprungen.
  // rows: [{ datum:'YYYYMMDD', standort, kategorie, stunde, ts }]
  async bulkInsertVisits(rows) {
    const cutoff = await this.maxDatum();
    const norm = (r) => [
      String(r.datum),
      r.standort || '(ohne Angabe)',
      r.kategorie ?? '',
      r.stunde ?? -1,
      r.ts ?? '',
    ].join('|');

    const newer = [];
    const boundary = [];
    for (const r of (rows || [])) {
      if (!r || !r.datum) continue;
      const d = String(r.datum);
      if (cutoff == null || d > String(cutoff)) newer.push(r);
      else if (d === String(cutoff)) boundary.push(r);
    }

    // Bestehende Zeilen des Grenztags laden → Dedup-Schlüssel.
    const seen = new Set();
    if (boundary.length) {
      const have = await db().all(
        'SELECT datum, standort, kategorie, stunde, ts FROM besuche WHERE datum = ?',
        [String(cutoff)],
      );
      have.forEach((r) => seen.add(norm(r)));
    }

    const toInsert = newer.slice();
    for (const r of boundary) {
      const k = norm(r);
      if (!seen.has(k)) { seen.add(k); toInsert.push(r); }
    }

    let added = 0;
    const dates = [];
    if (toInsert.length) {
      // Chunked Multi-Row-INSERT in EINEM batch()-Round-Trip (transaktional) – sonst drohen
      // bei großen (Erst-)Importen ~N HTTP-Requests gegen Turso → 504 auf Vercel.
      const CHUNK = 100;
      const stmts = [];
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK);
        const sql = 'INSERT INTO besuche (datum, standort, kategorie, stunde, ts) VALUES '
          + slice.map(() => '(?,?,?,?,?)').join(',');
        const args = [];
        slice.forEach((r) => {
          args.push(String(r.datum), r.standort || '(ohne Angabe)', r.kategorie ?? null, r.stunde ?? -1, r.ts ?? null);
          dates.push(String(r.datum));
        });
        stmts.push({ sql, args });
      }
      const results = await db().batch(stmts);
      added = results.reduce((s, r) => s + (r.changes || 0), 0);
    }
    const range = dates.length ? { min: dates.reduce((a, b) => a < b ? a : b), max: dates.reduce((a, b) => a > b ? a : b) } : null;
    return { added, skipped: (rows?.length || 0) - added, cutoff, range };
  },
};
