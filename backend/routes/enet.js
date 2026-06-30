const enetRepo = require('../data/repositories/enetRepo');

// Netzbetreiber & Grundversorger je PLZ (Quelle: enet-NNE, wöchentlich via GitHub Actions).
module.exports = async function (fastify) {
  // GET /api/enet/lookup?plz=53879 → { plz, ort, strom:{nb,gv}, gas:{nb,gv}, stand }
  fastify.get('/lookup', async (request, reply) => {
    const { plz } = request.query;
    if (!plz || !/^\d{5}$/.test(String(plz))) {
      return reply.status(400).send({ error: 'plz (5-stellig) erforderlich' });
    }
    return enetRepo.lookup(String(plz));
  });

  // GET /api/enet/search?q=… → bundesweit per PLZ-Präfix ODER Ort-Teilstring
  fastify.get('/search', async (request, reply) => {
    const q = String(request.query.q || '').trim();
    if (q.length < 2) {
      return reply.status(400).send({ error: 'q (mind. 2 Zeichen) erforderlich' });
    }
    const treffer = await enetRepo.search(q, 50);
    return { q, anzahl: treffer.length, treffer };
  });
};
