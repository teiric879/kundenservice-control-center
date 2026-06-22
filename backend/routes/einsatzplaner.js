// Route: Einsatzplaner (Agents/Assignments/Notes/Stats). Enthält KEIN SQL mehr —
// Datenzugriff inkl. Upsert-Logik über einsatzplanerRepo.

const repo = require('../data/repositories/einsatzplanerRepo');

module.exports = async function einsatzplanerRoutes(fastify) {
  // ── Agents ───────────────────────────────────────────────────────────────
  fastify.get('/api/einsatzplaner/agents', async () => repo.listAgents());

  fastify.post('/api/einsatzplaner/agents', async (req, reply) => {
    const { name, kuerzel, color } = req.body ?? {};
    if (!name || !kuerzel) return reply.code(400).send({ error: 'name und kuerzel erforderlich' });
    const id = await repo.insertAgent({ name, kuerzel, color });
    return { id };
  });

  fastify.patch('/api/einsatzplaner/agents/:id', async (req) => {
    await repo.updateAgent(req.params.id, req.body ?? {});
    return { ok: true };
  });

  fastify.delete('/api/einsatzplaner/agents/:id', async (req) => {
    await repo.deleteAgent(req.params.id);
    return { ok: true };
  });

  // ── Assignments ──────────────────────────────────────────────────────────
  fastify.get('/api/einsatzplaner/assignments', async (req) => {
    const { monday, from, to } = req.query;
    return repo.listAssignments({ monday, from, to });
  });

  fastify.put('/api/einsatzplaner/assignments', async (req) => {
    const { date, location, slot } = req.body ?? {};
    if (!date || !location || !slot) return { error: 'date, location, slot required' };
    return repo.putAssignment(req.body);
  });

  fastify.patch('/api/einsatzplaner/assignments/:id', async (req) => {
    const { time_from, time_to } = req.body ?? {};
    await repo.patchAssignment(req.params.id, time_from, time_to);
    return { ok: true };
  });

  fastify.delete('/api/einsatzplaner/assignments/:id', async (req) => {
    await repo.deleteAssignment(req.params.id);
    return { ok: true };
  });

  // ── Notes ────────────────────────────────────────────────────────────────
  fastify.get('/api/einsatzplaner/notes', async (req) => {
    const { monday, from, to } = req.query;
    return repo.listNotes({ monday, from, to });
  });

  fastify.put('/api/einsatzplaner/notes', async (req) => {
    return repo.putNote(req.body ?? {});
  });

  // ── Stats ────────────────────────────────────────────────────────────────
  fastify.get('/api/einsatzplaner/stats', async (req) => {
    const { year, month } = req.query;
    return { agents: await repo.stats({ year, month }) };
  });
};
