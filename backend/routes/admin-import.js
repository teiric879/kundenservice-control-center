// Route: Admin-Datenupload. Nimmt KOMPAKTES JSON entgegen (im Browser aus den
// Access-/Excel-Dateien geparst) und migriert inkrementell — nur neue Einträge.
// Die rohen Dateien werden NICHT hochgeladen (zu groß / kein Java auf Vercel);
// das Parsen passiert clientseitig im Admin (mdb-reader + xlsx).

const besucherRepo      = require('../data/repositories/besucherRepo');
const einsatzplanerRepo = require('../data/repositories/einsatzplanerRepo');
const importHistoryRepo = require('../data/repositories/importHistoryRepo');

module.exports = async function adminImportRoutes(fastify) {
  // Cutoff für die clientseitige Vorschau (welche Besuche gelten als neu?).
  fastify.get('/api/admin/import/besucher/cutoff', async () => {
    return { cutoff: await besucherRepo.maxDatum() };
  });

  // Besucher-Import. body: { source_file, rows:[{datum,standort,kategorie,stunde,ts}] }
  fastify.post('/api/admin/import/besucher', async (req, reply) => {
    const { rows, source_file } = req.body || {};
    if (!Array.isArray(rows)) return reply.code(400).send({ error: 'rows[] erforderlich' });
    const res = await besucherRepo.bulkInsertVisits(rows);
    await importHistoryRepo.log({
      kind: 'besucher', source_file, added: res.added, skipped: res.skipped,
      detail: { cutoff: res.cutoff, range: res.range, received: rows.length },
    });
    return { ok: true, ...res };
  });

  // Einsatzplan-Import. body: { source_file, rows:[{date,location,slot,kuerzel,time_from,time_to}] }
  fastify.post('/api/admin/import/einsatzplan', async (req, reply) => {
    const { rows, source_file } = req.body || {};
    if (!Array.isArray(rows)) return reply.code(400).send({ error: 'rows[] erforderlich' });
    const res = await einsatzplanerRepo.bulkInsertAssignments(rows);
    await importHistoryRepo.log({
      kind: 'einsatzplan', source_file, added: res.added, skipped: res.skipped,
      detail: { existing: res.existing, unknownCount: res.unknownCount, unknownKuerzel: res.unknownKuerzel, received: rows.length },
    });
    return { ok: true, ...res };
  });

  // Aktualisierungs-Historie (jüngste zuerst).
  fastify.get('/api/admin/import-history', async (req) => {
    return { history: await importHistoryRepo.list(req.query?.limit) };
  });
};
