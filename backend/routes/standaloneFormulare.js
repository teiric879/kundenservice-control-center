const repo = require('../data/repositories/standaloneFormulareRepo');
const { requireAdmin } = require('../lib/auth');
const { sendPdfFromRow } = require('../lib/pdf-source');

// Upload-Body kann groß sein (Base64-PDF). 20 MB Limit für POST/PUT.
// Schreibrouten zusätzlich hinter dem Admin-Token-Gate.
const BIG_BODY = { bodyLimit: 20 * 1024 * 1024, preHandler: requireAdmin };

const todayISO = () => new Date().toISOString().slice(0, 10);

module.exports = async function standaloneFormulareRoutes(fastify) {
  // ── Liste (ohne file_data) ────────────────────────────────────────────────
  // ?active=1 → nur aktive (öffentliche Formularseite). Ohne Param: alle (Admin).
  fastify.get('/api/standalone-formulare', async (req) => {
    const onlyActive = req.query && (req.query.active === '1' || req.query.active === 'true');
    const items = await repo.listAll({ onlyActive });
    return { ok: true, items };
  });

  // ── Neuen Eintrag anlegen ─────────────────────────────────────────────────
  fastify.post('/api/standalone-formulare', BIG_BODY, async (req, reply) => {
    const { name, kategorie, beschreibung, source_type, source_value, file_base64, active, sort_order } = req.body || {};
    if (!name || !String(name).trim()) {
      return reply.code(400).send({ error: 'name ist erforderlich' });
    }
    const type = source_type || 'upload';
    if (type === 'url' && !source_value) {
      return reply.code(400).send({ error: 'source_value (URL) ist erforderlich' });
    }
    if (type === 'upload' && !file_base64) {
      return reply.code(400).send({ error: 'file_base64 (Datei) ist erforderlich' });
    }
    const id = await repo.insert({
      name: String(name).trim(),
      kategorie: (kategorie && String(kategorie).trim()) || 'Allgemein',
      beschreibung: beschreibung || '',
      source_type: type,
      source_value: source_value || '',
      file_data: type === 'upload' ? file_base64 : null,
      active: active === undefined ? 1 : (active ? 1 : 0),
      sort_order: sort_order ?? 0,
      updated: todayISO(),
    });
    return { ok: true, id };
  });

  // ── Eintrag aktualisieren ─────────────────────────────────────────────────
  fastify.put('/api/standalone-formulare/:id', BIG_BODY, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { name, kategorie, beschreibung, source_type, source_value, file_base64, active, sort_order } = req.body || {};
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    const type = source_type || row.source_type;
    await repo.update(id, {
      name: (name && String(name).trim()) || row.name,
      kategorie: kategorie !== undefined ? (String(kategorie).trim() || 'Allgemein') : row.kategorie,
      beschreibung: beschreibung !== undefined ? beschreibung : row.beschreibung,
      source_type: type,
      source_value: source_value ?? row.source_value,
      // Nur überschreiben, wenn eine neue Datei kommt; bei URL file_data leeren.
      file_data: type === 'url' ? '' : (file_base64 || undefined),
      active: active === undefined ? row.active : (active ? 1 : 0),
      sort_order: sort_order ?? row.sort_order,
      updated: todayISO(),
    });
    return { ok: true };
  });

  // ── Eintrag löschen ───────────────────────────────────────────────────────
  fastify.delete('/api/standalone-formulare/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    await repo.deleteById(id);
    return { ok: true };
  });

  // ── PDF ausliefern (upload aus DB · url proxyen) ──────────────────────────
  fastify.get('/api/standalone-formulare/:id/file', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    return sendPdfFromRow(row, reply, req);
  });
};
