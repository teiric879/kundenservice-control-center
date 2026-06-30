const enetRepo = require('../data/repositories/enetRepo');

// Netzbetreiber & Grundversorger je PLZ (Quelle: enet-NNE, wöchentlich via GitHub Actions).
module.exports = async function (fastify) {
  // NB/GV-Daten ändern sich nur wöchentlich (enet-Import) → am Edge cachen. Die Default-PLZ wird
  // bei JEDEM Tool-Aufruf abgefragt; Folge-Treffer kommen aus dem CDN statt Funktion+Turso.
  // 5 min frisch + lange stale-while-revalidate (Admin-Korrekturen schlagen spätestens nach 5 min durch).
  const ENET_CACHE = 'public, s-maxage=300, stale-while-revalidate=604800';

  // GET /api/enet/lookup?plz=53879 → { plz, ort, strom:{nb,gv}, gas:{nb,gv}, stand }
  fastify.get('/lookup', async (request, reply) => {
    const { plz } = request.query;
    if (!plz || !/^\d{5}$/.test(String(plz))) {
      return reply.status(400).send({ error: 'plz (5-stellig) erforderlich' });
    }
    reply.header('Cache-Control', ENET_CACHE);
    return enetRepo.lookup(String(plz));
  });

  // GET /api/enet/search?q=… → bundesweit per PLZ-Präfix ODER Ort-Teilstring
  fastify.get('/search', async (request, reply) => {
    const q = String(request.query.q || '').trim();
    if (q.length < 2) {
      return reply.status(400).send({ error: 'q (mind. 2 Zeichen) erforderlich' });
    }
    const treffer = await enetRepo.search(q, 50);
    reply.header('Cache-Control', ENET_CACHE);
    return { q, anzahl: treffer.length, treffer };
  });
};
