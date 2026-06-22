const fs   = require('node:fs');
const path = require('node:path');
const repo = require('../data/repositories/vertragsformulareRepo');

// Upload-Body kann groß sein (Base64-PDF). 20 MB Limit für POST/PUT.
const BIG_BODY = { bodyLimit: 20 * 1024 * 1024 };

module.exports = async function vertragsformulareRoutes(fastify) {
  // ── Liste aller Einträge (ohne file_data) ─────────────────────────────────
  fastify.get('/api/vertragsformulare', async () => {
    const items = await repo.listAll();
    return { ok: true, items };
  });

  // ── Neuen Eintrag anlegen ─────────────────────────────────────────────────
  fastify.post('/api/vertragsformulare', BIG_BODY, async (req, reply) => {
    const { sparte, produkt_key, name, source_type, source_value, file_base64, sort_order } = req.body || {};
    if (!sparte || !produkt_key) {
      return reply.code(400).send({ error: 'sparte und produkt_key sind erforderlich' });
    }
    const type = source_type || 'upload';
    if (type === 'url' && !source_value) {
      return reply.code(400).send({ error: 'source_value (URL) ist erforderlich' });
    }
    if (type === 'upload' && !file_base64) {
      return reply.code(400).send({ error: 'file_base64 (Datei) ist erforderlich' });
    }
    const id = await repo.insert({
      sparte,
      produkt_key,
      name: name || 'Standardvertrag',
      source_type: type,
      source_value: source_value || '',
      file_data: type === 'upload' ? file_base64 : null,
      sort_order: sort_order ?? 0,
    });
    return { ok: true, id };
  });

  // ── Eintrag aktualisieren ─────────────────────────────────────────────────
  fastify.put('/api/vertragsformulare/:id', BIG_BODY, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { name, source_type, source_value, file_base64, sort_order } = req.body || {};
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    const type = source_type || row.source_type;
    await repo.update(id, {
      name: name || row.name,
      source_type: type,
      source_value: source_value ?? row.source_value,
      // Nur überschreiben, wenn eine neue Datei kommt; bei URL file_data leeren.
      file_data: type === 'url' ? '' : (file_base64 || undefined),
      sort_order: sort_order ?? row.sort_order,
    });
    return { ok: true };
  });

  // ── Eintrag löschen ───────────────────────────────────────────────────────
  fastify.delete('/api/vertragsformulare/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    await repo.deleteById(id);
    return { ok: true };
  });

  // ── PDF ausliefern (upload aus DB · url proxyen · local legacy) ────────────
  fastify.get('/api/vertragsformulare/:id/file', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(row.name || 'formular')}.pdf"`);

    if (row.source_type === 'upload') {
      if (!row.file_data) return reply.code(404).send({ error: 'Keine Datei gespeichert' });
      return reply.send(Buffer.from(row.file_data, 'base64'));
    }

    if (row.source_type === 'local') {
      // Legacy: lokaler Pfad (nur bei lokalem Backend nutzbar)
      const filePath = path.resolve(row.source_value);
      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({ error: 'Lokale Datei nicht gefunden' });
      }
      return reply.send(fs.createReadStream(filePath));
    }

    // URL-Quelle: über Backend proxyen (vermeidet CORS im Browser)
    const res = await fetch(row.source_value);
    if (!res.ok) {
      return reply.code(502).send({ error: `PDF-URL nicht erreichbar: ${res.status}` });
    }
    const buf = await res.arrayBuffer();
    return reply.send(Buffer.from(buf));
  });
};
