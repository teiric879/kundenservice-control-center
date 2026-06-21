// Repository für die Produkt-/Preis-Datenbank (produkte). Kapselt ALLES SQL rund um
// sparten / gueltigkeiten / preise / konditionen. Routes und Services rufen nur diese Methoden.

const { getDb } = require('../driver');
const db = () => getDb('produkte');

module.exports = {
  // ── Stammdaten ───────────────────────────────────────────────────────────
  allSparten() {
    return db().all('SELECT * FROM sparten');
  },
  getSparte(sparte) {
    return db().get('SELECT * FROM sparten WHERE sparte=?', [sparte]);
  },
  // nur die produkte-Spalte (JSON-String) einer Sparte
  getProdukteJson(sparte) {
    return db().get('SELECT produkte FROM sparten WHERE sparte=?', [sparte]);
  },

  // ── Gültigkeiten ─────────────────────────────────────────────────────────
  allGueltigkeiten() {
    return db().all('SELECT * FROM gueltigkeiten');
  },
  listGueltigkeiten(sparte) {
    return db().all(
      "SELECT ga, COALESCE(quelle,'import') AS quelle FROM gueltigkeiten WHERE sparte=? ORDER BY ga DESC",
      [sparte]
    );
  },
  latestGa(sparte) {
    return db().get('SELECT ga FROM gueltigkeiten WHERE sparte=? ORDER BY ga DESC LIMIT 1', [sparte]);
  },
  gueltigkeitExists(sparte, ga) {
    return db().get('SELECT 1 AS x FROM gueltigkeiten WHERE sparte=? AND ga=?', [sparte, ga]);
  },
  async countPreise(sparte, ga) {
    const r = await db().get('SELECT COUNT(*) AS c FROM preise WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
    return r.c;
  },
  async countKonditionen(sparte, ga) {
    const r = await db().get('SELECT COUNT(*) AS c FROM konditionen WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
    return r.c;
  },

  // ── Preise / Konditionen: Lesen ────────────────────────────────────────────
  // Gebiets-Preise (plz IS NULL) – die kleine, immer mitgelieferte Menge.
  gebietPreise() {
    return db().all('SELECT * FROM preise WHERE plz IS NULL');
  },
  gebietKonditionen() {
    return db().all('SELECT * FROM konditionen WHERE plz IS NULL');
  },
  // per-PLZ (on-demand)
  preiseByPlz(plz) {
    return db().all('SELECT * FROM preise WHERE plz=?', [plz]);
  },
  konditionenByPlz(plz) {
    return db().all('SELECT * FROM konditionen WHERE plz=?', [plz]);
  },
  // Gebiets-Zeilen einer konkreten Gültigkeit (für Admin-Vorlage)
  gebietPreiseByGa(sparte, ga) {
    return db().all('SELECT * FROM preise WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
  },
  gebietKonditionenByGa(sparte, ga) {
    return db().all('SELECT * FROM konditionen WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
  },

  // ── Preise / Konditionen: Schreiben ────────────────────────────────────────
  // Schreibt eine komplette Gültigkeit auf Gebiets-Ebene (quelle='manuell') atomar.
  // Ersetzt vorhandene Gebiets-Zeilen (plz IS NULL); per-PLZ-Zeilen bleiben unangetastet.
  // `preisRows`/`kondRows` sind bereits angereicherte, schreibfertige Zeilen.
  writeGueltigkeit(sparte, ga, preisRows, kondRows) {
    return db().transaction(async (tx) => {
      await tx.run('DELETE FROM preise      WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
      await tx.run('DELETE FROM konditionen WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
      await tx.run("INSERT OR REPLACE INTO gueltigkeiten (sparte, ga, quelle) VALUES (?,?,'manuell')", [sparte, ga]);

      for (const r of preisRows) {
        await tx.run(
          `INSERT INTO preise
             (sparte, ga, v_von, v_bis, gebiet, produkt_key, zaehlerart, ap_b, gp_b, ap_n, gp_n, ap_nt_b, bonus, quelle)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'manuell')`,
          [sparte, ga, r.v_von, r.v_bis, r.gebiet, r.produkt_key, r.zaehlerart,
            r.apB, r.gpB, r.ap_n, r.gp_n, r.apNtB, r.bonus ?? 0]
        );
      }
      for (const r of kondRows) {
        await tx.run(
          `INSERT INTO konditionen
             (sparte, ga, v_von, v_bis, gebiet, produkt_key, zaehlerart, pid, aid, pid_nt, aid_nt, vl, pg, alb, bonus, quelle)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'manuell')`,
          [sparte, ga, r.v_von, r.v_bis, r.gebiet, r.produkt_key, r.zaehlerart,
            r.pid, r.aid, r.pid_nt, r.aid_nt, r.vl, r.pg, r.alb, r.bonus ?? 0]
        );
      }
      return { n: preisRows.length };
    });
  },

  // Löscht eine Gültigkeit auf Gebiets-Ebene; entfernt den gueltigkeiten-Eintrag nur,
  // wenn keine per-PLZ-Zeilen mehr daran hängen. Atomar.
  deleteGueltigkeit(sparte, ga) {
    return db().transaction(async (tx) => {
      await tx.run('DELETE FROM preise      WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
      await tx.run('DELETE FROM konditionen WHERE sparte=? AND ga=? AND plz IS NULL', [sparte, ga]);
      const rest = await tx.get('SELECT COUNT(*) AS c FROM preise WHERE sparte=? AND ga=?', [sparte, ga]);
      if (rest.c === 0) await tx.run('DELETE FROM gueltigkeiten WHERE sparte=? AND ga=?', [sparte, ga]);
      return { ok: true };
    });
  },
};
