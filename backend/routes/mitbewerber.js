const { getMarktlage, getStatistiken, getAllSparten } = require('../data/repositories/mitbewerberRepo');

module.exports = async function (fastify) {
  // GET /api/mitbewerber/marktlage?sparte=strom&plz=10115
  // Aktuelle Mitbewerber-Preise für PLZ + Sparte.
  fastify.get('/marktlage', async (request, reply) => {
    const { sparte, plz } = request.query;

    if (!sparte || !plz) {
      return reply.status(400).send({ error: 'sparte und plz erforderlich' });
    }

    const plzGebiet = plz.substring(0, 3); // z.B. "101" aus "10115"
    const tarife = await getMarktlage(sparte, plzGebiet);

    return {
      sparte,
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
  // Alle verfügbaren Sparten mit Daten.
  fastify.get('/sparten', async (request, reply) => {
    const sparten = await getAllSparten();
    return { sparten };
  });
};
