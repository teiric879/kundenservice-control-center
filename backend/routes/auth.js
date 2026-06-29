// Route: Website-weiter Besuchs-Login (DB-User → signiertes Cookie).
//
// POST /api/auth/login   { username, password } → Set-Cookie site_auth + { ok:true } | 401 | 503
// POST /api/auth/logout                         → Cookie löschen + { ok:true }
// GET  /api/auth/me                             → { username, modules, isAdmin } aus Token

const {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  signSiteToken,
  verifySiteToken,
  isConfigured,
  verifyPassword,
} = require('../lib/site-auth');
const usersRepo = require('../data/repositories/usersRepo');

const secureAttr = process.env.VERCEL ? '; Secure' : '';

function cookieHeader(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; HttpOnly${secureAttr}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function getTokenFromRequest(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return null;
}

module.exports = async function authRoutes(fastify) {
  const LOGIN_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  fastify.post('/api/auth/login', LOGIN_LIMIT, async (req, reply) => {
    if (!isConfigured()) {
      req.log.error('SITE_AUTH_SECRET nicht gesetzt — Login gesperrt.');
      return reply.code(503).send({ ok: false, error: 'Login nicht konfiguriert' });
    }
    const { username = '', password = '' } = req.body || {};
    if (!username || !password) {
      return reply.code(401).send({ ok: false, error: 'Benutzername und Passwort erforderlich' });
    }

    const user = await usersRepo.findByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ ok: false, error: 'Ungültige Anmeldedaten' });
    }

    const modules = JSON.parse(user.modules || '[]');
    const token = signSiteToken(DEFAULT_TTL_SECONDS, {
      username: user.username,
      modules,
      isAdmin: user.is_admin === 1,
    });
    reply.header('Set-Cookie', cookieHeader(token, DEFAULT_TTL_SECONDS));
    return { ok: true, username: user.username, modules, isAdmin: user.is_admin === 1 };
  });

  fastify.post('/api/auth/logout', async (_req, reply) => {
    reply.header('Set-Cookie', cookieHeader('', 0));
    return { ok: true };
  });

  // Öffentliche Namensliste für das Login-Dropdown (nur Benutzernamen, nichts Sensibles).
  // Liegt unter /api/auth/ → von der Edge-Middleware durchgelassen (vor dem Login erreichbar).
  fastify.get('/api/auth/usernames', async () => {
    const users = await usersRepo.listAll();
    return { users: users.map((u) => u.username) };
  });

  fastify.get('/api/auth/me', async (req, reply) => {
    const token = getTokenFromRequest(req);
    const payload = token ? verifySiteToken(token) : null;
    // Alte Tokens (statisches Passwort-Login, ohne username) gelten als nicht eingeloggt
    // → erzwingt erneuten Login mit dem neuen User-System.
    if (!payload || !payload.username) return reply.code(401).send({ ok: false, error: 'Nicht eingeloggt' });
    return {
      ok: true,
      username: payload.username || null,
      modules: payload.modules || [],
      isAdmin: payload.isAdmin || false,
    };
  });
};
