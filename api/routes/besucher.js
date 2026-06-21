// Route: Besucher (lesend + erfassen). Enthält KEIN SQL mehr — Datenzugriff über besucherRepo.

const besucherRepo = require('../data/repositories/besucherRepo');

module.exports = async function besucherRoutes(fastify) {
  fastify.get('/api/besucher', async (req) => {
    const { von, bis } = req.query;
    return besucherRepo.listBesuche({ von, bis });
  });

  // Konfiguration für die globale Erfass-Leiste: Standorte + Top-N-Themen (nach Häufigkeit)
  fastify.get('/api/besucher/erfass-config', async (req) => {
    const n = Math.min(Math.max(Number(req.query.n) || 6, 1), 12);
    const [standorte, kats] = await Promise.all([
      besucherRepo.topStandorte(),
      besucherRepo.topKategorien(n),
    ]);
    const kategorien = kats.map((r) => ({
      kategorie: r.kategorie,
      label: String(r.kategorie).replace(/^\d+\s+/, ''), // numerisches Präfix entfernen
      count: r.c,
    }));
    return { ok: true, standorte, kategorien };
  });

  fastify.post('/api/besucher', async (req, reply) => {
    const { datum, standort, kategorie, stunde } = req.body;
    if (!datum || !standort) {
      return reply.code(400).send({ error: 'datum und standort erforderlich' });
    }
    const id = await besucherRepo.insertBesuch({ datum, standort, kategorie, stunde });
    return { id };
  });
};
