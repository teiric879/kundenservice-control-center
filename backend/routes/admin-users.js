// Admin-Routes: User-Verwaltung (Multi-User-Login-System).
// Alle Endpunkte require Admin-Bearer-Token.

const { requireAdmin } = require('../lib/auth');
const usersRepo = require('../data/repositories/usersRepo');
const { hashPassword } = require('../lib/site-auth');

const ALL_MODULES = [
  'besucher-dashboard',
  'produkt-id-tool',
  'einsatzplaner',
  'abschlag-wasser',
  'formulare',
  'admin',
];

module.exports = async function adminUsersRoutes(fastify) {
  fastify.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    const users = await usersRepo.listAll();
    return users.map((u) => ({
      ...u,
      modules: JSON.parse(u.modules || '[]'),
      is_admin: u.is_admin === 1,
    }));
  });

  fastify.post('/api/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const { username, password, modules = [], isAdmin = false } = req.body || {};
    if (!username || !password) {
      return reply.code(400).send({ ok: false, error: 'username und password erforderlich' });
    }
    const validModules = modules.filter((m) => ALL_MODULES.includes(m));
    try {
      const id = await usersRepo.create({
        username: username.trim(),
        passwordHash: hashPassword(password),
        modules: validModules,
        isAdmin,
      });
      return { ok: true, id };
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        return reply.code(409).send({ ok: false, error: 'Benutzername bereits vergeben' });
      }
      throw e;
    }
  });

  fastify.put('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const { password, modules, isAdmin } = req.body || {};
    const patch = {};
    if (password) patch.passwordHash = hashPassword(password);
    if (modules !== undefined) patch.modules = modules.filter((m) => ALL_MODULES.includes(m));
    if (isAdmin !== undefined) patch.isAdmin = Boolean(isAdmin);
    await usersRepo.update(id, patch);
    return { ok: true };
  });

  fastify.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const total = await usersRepo.count();
    if (total <= 1) {
      return reply.code(409).send({ ok: false, error: 'Letzten User nicht löschbar' });
    }
    await usersRepo.remove(id);
    return { ok: true };
  });

  fastify.get('/api/admin/users/modules', { preHandler: requireAdmin }, async () => {
    return ALL_MODULES;
  });
};
