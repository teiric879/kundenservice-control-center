// Route: Website-weiter Besuchs-Login (statisches Passwort → signiertes Cookie).
//
// Dies ist der EINSTIEG hinter der Vercel-Edge-Middleware (middleware.js). Deshalb
// KEIN requireAdmin-preHandler hier. Der Schutz der übrigen Seiten/Routen passiert
// in der Middleware anhand des gesetzten `site_auth`-Cookies.
//
// POST /api/auth/login   { password } → Set-Cookie site_auth + { ok:true } | 401 | 503
// POST /api/auth/logout                → Cookie löschen + { ok:true }

const {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  expectedPassword,
  signSiteToken,
  isConfigured,
} = require('../lib/site-auth');
const { safeEqual } = require('../lib/auth');

// Secure nur in der Cloud (https). Lokal (http) würde Secure das Setzen verhindern.
const secureAttr = process.env.VERCEL ? '; Secure' : '';

function cookieHeader(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; HttpOnly${secureAttr}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

module.exports = async function authRoutes(fastify) {
  // Strenges Rate-Limit gegen Brute-Force (zusätzlich zum globalen 300/min).
  const LOGIN_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  fastify.post('/api/auth/login', LOGIN_LIMIT, async (req, reply) => {
    const expected = expectedPassword();
    if (!isConfigured() || expected == null) {
      req.log.error('SITE_PASSWORD/SITE_AUTH_SECRET nicht gesetzt — Website-Login gesperrt.');
      return reply.code(503).send({ ok: false, error: 'Login nicht konfiguriert' });
    }
    const password = (req.body && req.body.password) || '';
    if (!safeEqual(password, expected)) {
      return reply.code(401).send({ ok: false, error: 'Falsches Passwort' });
    }
    const token = signSiteToken(DEFAULT_TTL_SECONDS);
    reply.header('Set-Cookie', cookieHeader(token, DEFAULT_TTL_SECONDS));
    return { ok: true };
  });

  fastify.post('/api/auth/logout', async (_req, reply) => {
    reply.header('Set-Cookie', cookieHeader('', 0));
    return { ok: true };
  });
};
