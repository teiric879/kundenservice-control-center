// Shared-Secret Auth-Gate für mutierende / administrative Endpunkte.
//
// Schützt schreibende Admin-Operationen mit einem Bearer-Token. Lese-Endpunkte
// (GET) bleiben bewusst offen. Das Token kommt aus der Env-Var ADMIN_API_TOKEN.
//
// Frontend (admin/index.html) sendet das beim Login eingegebene Passwort als
//   Authorization: Bearer <passwort>
// → ADMIN_API_TOKEN muss auf denselben Wert gesetzt sein. So liegt das Secret
//   nie hardcoded im ausgelieferten JS, sondern wird vom Nutzer eingegeben.

const crypto = require('node:crypto');

// Lokaler Dev-Fallback: erlaubt Arbeiten ohne gesetzte Env-Var. In Produktion
// (Vercel) MUSS ADMIN_API_TOKEN gesetzt sein, sonst gilt der Fallback und es
// wird laut gewarnt.
const DEV_FALLBACK_TOKEN = 'eregio2026#';

function expectedToken() {
  const t = process.env.ADMIN_API_TOKEN;
  if (t && t.length > 0) return t;
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'development') {
    // Produktion/Preview ohne Token → fail closed (kein Fallback in der Cloud).
    return null;
  }
  return DEV_FALLBACK_TOKEN;
}

// Konstante-Zeit-Vergleich, robust gegen unterschiedliche Längen.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) {
    // trotzdem einen Vergleich fahren, damit Timing nicht die Länge verrät
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function extractBearer(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'];
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

// Fastify preHandler: 401 wenn Token fehlt/falsch, sonst durchlassen.
async function requireAdmin(req, reply) {
  const expected = expectedToken();
  if (!expected) {
    req.log.error('ADMIN_API_TOKEN ist in dieser Umgebung nicht gesetzt — Admin-Routen gesperrt.');
    return reply.code(503).send({ ok: false, error: 'Server nicht konfiguriert' });
  }
  if (process.env.ADMIN_API_TOKEN == null && (!process.env.VERCEL || process.env.VERCEL_ENV === 'development')) {
    req.log.warn('ADMIN_API_TOKEN nicht gesetzt — verwende lokalen Dev-Fallback. NICHT für Produktion.');
  }
  const got = extractBearer(req);
  if (!got || !safeEqual(got, expected)) {
    return reply.code(401).send({ ok: false, error: 'Nicht autorisiert' });
  }
}

module.exports = { requireAdmin };
