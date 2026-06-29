// Modul-basierter Zugriffs-Schutz für schreibende Endpunkte.
//
// Anders als requireAdmin (Bearer-Token) stützt sich das hier auf das site_auth-
// Cookie des eingeloggten Users: dessen Token trägt bereits { username, modules, isAdmin }.
// Wer das Modul nicht in seiner Liste hat (und kein Admin ist), wird mit 403 geblockt.
//
// Hinweis zur Umgebung: Der Site-Login-Gate (Edge-Middleware) läuft NUR auf Vercel.
// Lokal gibt es kein site_auth-Cookie → dort würde jede Prüfung scheitern und die
// Entwicklung blockieren. Deshalb greift requireModule nur in der Cloud-Produktion,
// konsistent mit dem übrigen Auth-Modell (Login-Gate ist ebenfalls Vercel-only).

const { COOKIE_NAME, verifySiteToken } = require('./site-auth');

function inCloudProd() {
  return Boolean(process.env.VERCEL) && process.env.VERCEL_ENV !== 'development';
}

// site_auth-Cookie aus dem Request lesen.
function getSiteToken(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return null;
}

// Fastify preHandler-Factory: nur User mit dem Modul (oder Admins) dürfen durch.
function requireModule(moduleId) {
  return async function (req, reply) {
    if (!inCloudProd()) return; // lokal/Dev: keine Sperre (kein Login-Gate vorhanden)

    const token = getSiteToken(req);
    const payload = token ? verifySiteToken(token) : null;
    if (!payload || !payload.username) {
      return reply.code(401).send({ ok: false, error: 'Nicht eingeloggt' });
    }
    const mods = Array.isArray(payload.modules) ? payload.modules : [];
    if (payload.isAdmin || mods.includes(moduleId)) return; // erlaubt
    return reply.code(403).send({ ok: false, error: 'Keine Berechtigung für dieses Modul' });
  };
}

module.exports = { requireModule, getSiteToken };
