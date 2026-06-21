// Route: Admin-Preispflege (Gültigkeiten). Enthält KEIN SQL mehr — Geschäftslogik über
// lib/preis-service, Datenzugriff über produkteRepo / registryRepo.

const produkteRepo = require('../data/repositories/produkteRepo');
const registryRepo = require('../data/repositories/registryRepo');
const { buildTemplate, saveGueltigkeit } = require('../lib/preis-service');

module.exports = async function adminPreiseRoutes(fastify) {
  // Liste aller Gültigkeiten einer Sparte (mit Zeilen-Zählern)
  fastify.get('/api/admin/gueltigkeiten', async (req) => {
    const sparte = String(req.query.sparte || '').trim();
    if (!sparte) return { ok: false, error: 'sparte fehlt' };
    const gas = await produkteRepo.listGueltigkeiten(sparte);
    const out = [];
    for (const g of gas) {
      out.push({
        ga: g.ga, quelle: g.quelle,
        n_preise: await produkteRepo.countPreise(sparte, g.ga),
        n_kond:   await produkteRepo.countKonditionen(sparte, g.ga),
      });
    }
    return { ok: true, sparte, gueltigkeiten: out };
  });

  // Vorlage / Detail zum Bearbeiten (ohne ga = jüngste als Klon-Vorlage)
  fastify.get('/api/admin/gueltigkeit', async (req) => {
    const sparte = String(req.query.sparte || '').trim();
    const ga = req.query.ga ? String(req.query.ga).trim() : null;
    if (!sparte) return { ok: false, error: 'sparte fehlt' };
    const tpl = await buildTemplate(sparte, ga);
    if (!tpl) return { ok: false, error: 'sparte unbekannt' };
    return { ok: true, ...tpl };
  });

  // Live-Auflösung beim Tippen
  fastify.get('/api/admin/aid-lookup', async (req) => {
    const sparte = String(req.query.sparte || '').trim();
    const ap = req.query.ap != null ? Number(req.query.ap) : null;
    const gp = req.query.gp != null ? Number(req.query.gp) : null;
    const apnt = req.query.apnt != null ? Number(req.query.apnt) : null;
    const aid = await registryRepo.resolveAid(sparte, ap, gp);
    const aidNt = apnt != null ? await registryRepo.resolveAidNt(sparte, apnt) : null;
    return { ok: true, aid, aidNt, neu: aid == null, neuNt: apnt != null && aidNt == null };
  });

  // Neu anlegen
  fastify.post('/api/admin/gueltigkeit', async (req, reply) => {
    const { sparte, ga, rows, kondGebietUniform } = req.body || {};
    if (!sparte || !ga || !Array.isArray(rows) || !rows.length) {
      reply.code(400); return { ok: false, error: 'sparte, ga und rows erforderlich' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ga)) { reply.code(400); return { ok: false, error: 'ga muss YYYY-MM-DD sein' }; }
    if (await produkteRepo.gueltigkeitExists(sparte, ga)) {
      reply.code(409); return { ok: false, error: `Gültigkeit ${ga} existiert bereits – nutze Bearbeiten (PUT)` };
    }
    try {
      await saveGueltigkeit(sparte, ga, rows, !!kondGebietUniform);
      return { ok: true, sparte, ga, n: rows.length };
    } catch (e) { reply.code(500); return { ok: false, error: String(e.message || e) }; }
  });

  // Bestehende ersetzen (auch Import-Stände korrigierbar → werden zu 'manuell')
  fastify.put('/api/admin/gueltigkeit', async (req, reply) => {
    const { sparte, ga, rows, kondGebietUniform } = req.body || {};
    if (!sparte || !ga || !Array.isArray(rows) || !rows.length) {
      reply.code(400); return { ok: false, error: 'sparte, ga und rows erforderlich' };
    }
    try {
      await saveGueltigkeit(sparte, ga, rows, !!kondGebietUniform);
      return { ok: true, sparte, ga, n: rows.length };
    } catch (e) { reply.code(500); return { ok: false, error: String(e.message || e) }; }
  });

  // Löschen (nur Gebiets-Ebene)
  fastify.delete('/api/admin/gueltigkeit', async (req, reply) => {
    const sparte = String(req.query.sparte || '').trim();
    const ga = String(req.query.ga || '').trim();
    if (!sparte || !ga) { reply.code(400); return { ok: false, error: 'sparte und ga erforderlich' }; }
    try {
      await produkteRepo.deleteGueltigkeit(sparte, ga);
      return { ok: true, sparte, ga };
    } catch (e) { reply.code(500); return { ok: false, error: String(e.message || e) }; }
  });
};
