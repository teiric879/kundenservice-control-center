// Route: Admin-Datenupload. Nimmt KOMPAKTES JSON entgegen (im Browser aus den
// Access-/Excel-Dateien geparst) und migriert inkrementell — nur neue Einträge.
// Die rohen Dateien werden NICHT hochgeladen (zu groß / kein Java auf Vercel);
// das Parsen passiert clientseitig im Admin (mdb-reader + xlsx).

const besucherRepo      = require('../data/repositories/besucherRepo');
const einsatzplanerRepo = require('../data/repositories/einsatzplanerRepo');
const importHistoryRepo = require('../data/repositories/importHistoryRepo');
const mitbewerberRepo   = require('../data/repositories/mitbewerberRepo');
const crypto            = require('crypto');

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

  // Mitbewerber-Preise-Import (halb-manuell aus ausgefüllter Excel-Vorlage).
  // body: { source_file, rows:[{anbieter,sparte,arbeitspreis,grundpreis,bonus,bonus_bedingung,
  //         plz_gebiet,heizstrom_typ,zaehlerart,ns_messung,steuve_modul,quelle}], clear_test }
  // Snapshot-Semantik: alte Zeilen der im Batch enthaltenen Quellen werden vorher ersetzt.
  fastify.post('/api/admin/import/mitbewerber', async (req, reply) => {
    const { rows, source_file, clear_test } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return reply.code(400).send({ error: 'rows[] erforderlich' });

    const quellen = [...new Set(rows.map(r => r.quelle || 'import'))];
    await mitbewerberRepo.deleteByQuellen(quellen);
    if (clear_test) await mitbewerberRepo.deleteByQuellen(['test']);

    const prepared = rows.map(r => ({
      ...r,
      quelle: r.quelle || 'import',
      gueltig_ab: new Date().toISOString().split('T')[0],
      gueltig_bis: null,
      hash_content: crypto.createHash('md5').update(
        [r.anbieter, r.sparte, r.plz_gebiet, r.heizstrom_typ, r.zaehlerart, r.ns_messung, r.steuve_modul, r.arbeitspreis, r.grundpreis, r.bonus].join('|')
      ).digest('hex'),
    }));
    const added = await mitbewerberRepo.upsertTarife(prepared);

    await importHistoryRepo.log({
      kind: 'mitbewerber', source_file, added, skipped: rows.length - added,
      detail: { quellen, received: rows.length },
    });
    return { ok: true, added, skipped: rows.length - added, total: rows.length };
  });

  // Aktualisierungs-Historie (jüngste zuerst).
  fastify.get('/api/admin/import-history', async (req) => {
    return { history: await importHistoryRepo.list(req.query?.limit) };
  });
};
