// Repository für die SAP-/Access-Registry (aid/pid) in der produkte-DB.
// Vormals DB-Funktionen in lib/preis-logik.js — dort blieb nur die reine Mathematik.

const { getDb } = require('../driver');
const { r2 } = require('../../lib/preis-logik');
const db = () => getDb('produkte');

module.exports = {
  // Produkt-ID + VL/PG (fest je Produkt). zaehlerart '' = nicht anwendbar (alle außer Heizstrom).
  async resolvePid(sparte, produktKey, zaehlerart) {
    const za = zaehlerart || '';
    const row = await db().get(
      'SELECT pid, pid_nt AS pidNt, vl, pg FROM pid_map WHERE sparte=? AND produkt_key=? AND zaehlerart=?',
      [sparte, produktKey, za]
    );
    return row || null;
  },

  // Angebots-ID HT über (AP_netto, GP_Jahr_netto). null = keine Registry-Kombination gefunden.
  async resolveAid(sparte, apN, gpN) {
    if (apN == null || gpN == null) return null;
    const row = await db().get(
      'SELECT aid FROM aid_registry WHERE sparte=? AND ap_n=? AND gp_n=?',
      [sparte, r2(apN), r2(gpN)]
    );
    return row ? row.aid : null;
  },

  // Angebots-ID NT über AP_netto. null = keine Registry-Kombination gefunden.
  async resolveAidNt(sparte, apN) {
    if (apN == null) return null;
    const row = await db().get(
      'SELECT aid_nt FROM aid_registry_nt WHERE sparte=? AND ap_n=?',
      [sparte, r2(apN)]
    );
    return row ? row.aid_nt : null;
  },
};
