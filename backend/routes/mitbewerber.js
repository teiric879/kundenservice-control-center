const { getMarktlage, getStatistiken, getAllSparten, upsertTarife } = require('../data/repositories/mitbewerberRepo');
const { hashContent } = require('../lib/scraper-utils');

// Test-Tarife zum Validieren der UI-Kette. plz_gebiet '100' deckt PLZ 10000 ab.
const SAMPLE_TARIFE = [
  // Strom
  { anbieter: 'E.ON',              sparte: 'strom',     arbeitspreis: 0.45, grundpreis: 180, bonus: 100, bonus_bedingung: 'Neukundenbonus' },
  { anbieter: 'Vattenfall',        sparte: 'strom',     arbeitspreis: 0.42, grundpreis: 185, bonus: 80,  bonus_bedingung: 'Neukundenbonus' },
  { anbieter: 'STROM.io',          sparte: 'strom',     arbeitspreis: 0.38, grundpreis: 120, bonus: 50,  bonus_bedingung: null },
  // Gas
  { anbieter: 'E.ON',              sparte: 'gas',       arbeitspreis: 0.08, grundpreis: 120, bonus: 80,  bonus_bedingung: 'Neukundenbonus' },
  { anbieter: 'Vattenfall',        sparte: 'gas',       arbeitspreis: 0.075,grundpreis: 125, bonus: 60,  bonus_bedingung: null },
  { anbieter: 'STROM.io',          sparte: 'gas',       arbeitspreis: 0.07, grundpreis: 100, bonus: 40,  bonus_bedingung: null },
  // Heizstrom – Wärmepumpe + Getrennte Messung
  { anbieter: 'E.ON',              sparte: 'heizstrom', heizstrom_typ: 'wp', wp_messung: 'getrennt', arbeitspreis: 0.28, grundpreis: 100, bonus: 100, bonus_bedingung: 'Neukundenbonus' },
  { anbieter: 'Vattenfall',        sparte: 'heizstrom', heizstrom_typ: 'wp', wp_messung: 'getrennt', arbeitspreis: 0.26, grundpreis: 110, bonus: 80,  bonus_bedingung: null },
  { anbieter: 'STROM.io',          sparte: 'heizstrom', heizstrom_typ: 'wp', wp_messung: 'getrennt', arbeitspreis: 0.24, grundpreis: 90,  bonus: 40,  bonus_bedingung: null },
  // Heizstrom – Wärmepumpe + Gemeinsame Messung
  { anbieter: 'E.ON',              sparte: 'heizstrom', heizstrom_typ: 'wp', wp_messung: 'gemeinsam', arbeitspreis: 0.30, grundpreis: 80,  bonus: 120, bonus_bedingung: 'Neukundenbonus' },
  { anbieter: 'Vattenfall',        sparte: 'heizstrom', heizstrom_typ: 'wp', wp_messung: 'gemeinsam', arbeitspreis: 0.28, grundpreis: 95,  bonus: 90,  bonus_bedingung: null },
  { anbieter: 'STROM.io',          sparte: 'heizstrom', heizstrom_typ: 'wp', wp_messung: 'gemeinsam', arbeitspreis: 0.26, grundpreis: 75,  bonus: 50,  bonus_bedingung: null },
  // Heizstrom – Nachtspeicher + Einzeltarifzähler
  { anbieter: 'E.ON',              sparte: 'heizstrom', heizstrom_typ: 'ns', ns_zaehlerart: 'einzeltarif', arbeitspreis: 0.35, grundpreis: 150, bonus: 120, bonus_bedingung: 'Neukundenbonus' },
  { anbieter: 'Vattenfall',        sparte: 'heizstrom', heizstrom_typ: 'ns', ns_zaehlerart: 'einzeltarif', arbeitspreis: 0.33, grundpreis: 160, bonus: 100, bonus_bedingung: null },
  // Heizstrom – Nachtspeicher + Doppeltarifzähler
  { anbieter: 'E.ON',              sparte: 'heizstrom', heizstrom_typ: 'ns', ns_zaehlerart: 'doppeltarif', arbeitspreis: 0.32, grundpreis: 140, bonus: 110, bonus_bedingung: 'Neukundenbonus' },
  { anbieter: 'Vattenfall',        sparte: 'heizstrom', heizstrom_typ: 'ns', ns_zaehlerart: 'doppeltarif', arbeitspreis: 0.30, grundpreis: 150, bonus: 90,  bonus_bedingung: null },
  { anbieter: 'STROM.io',          sparte: 'heizstrom', heizstrom_typ: 'ns', ns_zaehlerart: 'doppeltarif', arbeitspreis: 0.28, grundpreis: 120, bonus: 60,  bonus_bedingung: null },
  // SteuVE §14a – Modul 1
  { anbieter: 'E.ON',              sparte: 'steuve',    steuve_modul: 'modul1', arbeitspreis: 0.22, grundpreis: 70,  bonus: 50, bonus_bedingung: null },
  { anbieter: 'Vattenfall',        sparte: 'steuve',    steuve_modul: 'modul1', arbeitspreis: 0.20, grundpreis: 75,  bonus: 40, bonus_bedingung: null },
  { anbieter: 'STROM.io',          sparte: 'steuve',    steuve_modul: 'modul1', arbeitspreis: 0.19, grundpreis: 60,  bonus: 30, bonus_bedingung: null },
  // SteuVE §14a – Modul 2
  { anbieter: 'E.ON',              sparte: 'steuve',    steuve_modul: 'modul2', arbeitspreis: 0.24, grundpreis: 65,  bonus: 60, bonus_bedingung: null },
  { anbieter: 'Vattenfall',        sparte: 'steuve',    steuve_modul: 'modul2', arbeitspreis: 0.22, grundpreis: 70,  bonus: 50, bonus_bedingung: null },
  { anbieter: 'STROM.io',          sparte: 'steuve',    steuve_modul: 'modul2', arbeitspreis: 0.21, grundpreis: 55,  bonus: 40, bonus_bedingung: null },
];

module.exports = async function (fastify) {
  // GET /api/mitbewerber/marktlage?sparte=heizstrom&heizstrom_typ=wp&wp_messung=getrennt&plz=10115
  // Aktuelle Mitbewerber-Preise für PLZ + Sparte + optional Varianten.
  fastify.get('/marktlage', async (request, reply) => {
    const { sparte, plz, heizstrom_typ, wp_messung, ns_zaehlerart, steuve_modul } = request.query;

    if (!sparte || !plz) {
      return reply.status(400).send({ error: 'sparte und plz erforderlich' });
    }

    const plzGebiet = plz.substring(0, 3); // z.B. "101" aus "10115"
    const tarife = await getMarktlage(sparte, plzGebiet, heizstrom_typ, wp_messung, ns_zaehlerart, steuve_modul);

    return {
      sparte,
      heizstrom_typ: heizstrom_typ || null,
      wp_messung: wp_messung || null,
      ns_zaehlerart: ns_zaehlerart || null,
      steuve_modul: steuve_modul || null,
      plz_gebiet: plzGebiet,
      anzahl: tarife.length,
      anbieter: tarife.map(t => ({
        anbieter: t.anbieter,
        arbeitspreis: t.arbeitspreis,
        grundpreis: t.grundpreis,
        bonus: t.bonus,
        bonus_bedingung: t.bonus_bedingung,
        quelle: t.quelle,
      })),
      aktualisiert_am: tarife[0]?.aktualisiert_am || null,
    };
  });

  // GET /api/mitbewerber/statistik?sparte=strom
  // Dashboard-Statistiken für Sparte.
  fastify.get('/statistik', async (request, reply) => {
    const { sparte } = request.query;

    if (!sparte) {
      return reply.status(400).send({ error: 'sparte erforderlich' });
    }

    const stats = await getStatistiken(sparte);

    return {
      sparte,
      anzahl_anbieter: stats.anzahl_anbieter,
      guentigster: stats.guentigster ? {
        anbieter: stats.guentigster.anbieter,
        arbeitspreis: stats.guentigster.arbeitspreis,
        grundpreis: stats.guentigster.grundpreis,
        bonus: stats.guentigster.bonus,
      } : null,
      teuerster: stats.teuerster ? {
        anbieter: stats.teuerster.anbieter,
        arbeitspreis: stats.teuerster.arbeitspreis,
        grundpreis: stats.teuerster.grundpreis,
        bonus: stats.teuerster.bonus,
      } : null,
      durchschnitt_arbeitspreis: stats.durchschnitt_arbeitspreis,
      durchschnitt_bonus: stats.durchschnitt_bonus,
      bonus_verteilung: stats.bonus_verteilung,
    };
  });

  // GET /api/mitbewerber/sparten
  // Alle verfügbaren Sparten mit Daten + vordefinierte Sparten.
  fastify.get('/sparten', async (request, reply) => {
    const fromDb = await getAllSparten();
    // Kombiniere DB-Sparten mit vordefinierten; verhindert leere Liste nach frischem Deploy
    const allSparten = [...new Set(['strom', 'gas', 'heizstrom', 'steuve', ...fromDb])].sort();
    return { sparten: allSparten };
  });

  // GET /api/mitbewerber/seed-test
  // TEMPORÄR: füllt Test-Tarife in die DB (gegen dieselbe Verbindung wie die App).
  // Dient nur zur Validierung der UI-Kette, solange echte Scraper-Selektoren fehlen.
  fastify.get('/seed-test', async (request, reply) => {
    const tarife = SAMPLE_TARIFE.map(t => ({
      ...t,
      plz_gebiet: '100',
      gueltig_ab: new Date().toISOString().split('T')[0],
      gueltig_bis: null,
      quelle: 'test',
      hash_content: hashContent(t.anbieter, t.sparte, t.arbeitspreis, t.grundpreis),
    }));
    const added = await upsertTarife(tarife);
    return { ok: true, eingefuegt: added, gesamt: tarife.length };
  });
};
