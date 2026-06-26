// Route: Besucher (lesend + erfassen). Enthält KEIN SQL mehr — Datenzugriff über besucherRepo.

const besucherRepo = require('../data/repositories/besucherRepo');

module.exports = async function besucherRoutes(fastify) {
  fastify.get('/api/besucher', async (req, reply) => {
    const { von, bis } = req.query;
    // Vollständige Historie (ohne Filter) ändert sich kaum → am Vercel-Edge cachen, damit
    // Folge-Aufrufe sofort aus Frankfurt kommen statt jedes Mal Funktion+Turso (~1,5s) zu
    // treffen. Gefilterte Abfragen (Live-Refresh „?von=heute") bleiben immer frisch.
    if (!von && !bis) {
      reply.header('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=86400');
    } else {
      reply.header('Cache-Control', 'no-store');
    }
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
    const { datum, standort, kategorie, stunde } = req.body || {};
    if (!datum || !standort) {
      return reply.code(400).send({ error: 'datum und standort erforderlich' });
    }
    // Datum auf YYYYMMDD normalisieren – das ist das in der besuche-Tabelle und im Dashboard
    // durchgaengig genutzte Format (die Erfass-Leiste sendet bereits YYYYMMDD). Ein evtl. mit
    // Bindestrichen geliefertes 2026-06-26 wird akzeptiert und entstrichen, damit beide Quellen
    // funktionieren. (Frueher verlangte die Validierung YYYY-MM-DD und brach so das Erfassen.)
    const datum8 = String(datum).replace(/-/g, '');
    if (!/^\d{8}$/.test(datum8)) {
      return reply.code(400).send({ error: 'datum muss YYYYMMDD oder YYYY-MM-DD sein' });
    }
    if (String(standort).length > 120 || (kategorie != null && String(kategorie).length > 200)) {
      return reply.code(400).send({ error: 'standort/kategorie zu lang' });
    }
    const h = stunde == null || stunde === '' ? null : Number(stunde);
    if (h != null && (!Number.isInteger(h) || h < 0 || h > 23)) {
      return reply.code(400).send({ error: 'stunde muss 0–23 sein' });
    }
    const id = await besucherRepo.insertBesuch({ datum: datum8, standort, kategorie, stunde: h });
    return { id };
  });
};
