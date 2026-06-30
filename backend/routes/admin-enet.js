const enetRepo = require('../data/repositories/enetRepo');
const { requireAdmin } = require('../lib/auth');

// Admin-Pflege der NB/GV-Daten (Override pro PLZ). Alle Routen erfordern Admin-Token.
module.exports = async function (fastify) {
  // GET /api/admin/enet/lookup?plz=53879 → Basiswerte + Override-Rohwerte (Strom & Gas).
  fastify.get('/lookup', { preHandler: requireAdmin }, async (request, reply) => {
    const { plz } = request.query;
    if (!plz || !/^\d{5}$/.test(String(plz))) {
      return reply.status(400).send({ error: 'plz (5-stellig) erforderlich' });
    }
    return enetRepo.getEditable(String(plz));
  });

  // PUT /api/admin/enet/override  { plz, strom:{nb,gv}, gas:{nb,gv} }
  fastify.put('/override', { preHandler: requireAdmin }, async (request, reply) => {
    const { plz, strom, gas } = request.body || {};
    if (!plz || !/^\d{5}$/.test(String(plz))) {
      return reply.status(400).send({ error: 'plz (5-stellig) erforderlich' });
    }
    await enetRepo.upsertOverride(String(plz), { strom, gas });
    return { ok: true };
  });

  // DELETE /api/admin/enet/override?plz=53879  → Override entfernen (zurück auf Basis).
  fastify.delete('/override', { preHandler: requireAdmin }, async (request, reply) => {
    const { plz } = request.query;
    if (!plz || !/^\d{5}$/.test(String(plz))) {
      return reply.status(400).send({ error: 'plz (5-stellig) erforderlich' });
    }
    const removed = await enetRepo.deleteOverride(String(plz));
    return { ok: true, removed };
  });
};
