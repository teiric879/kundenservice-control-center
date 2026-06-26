// Fastify-App-Factory — ohne .listen(). Wird von BEIDEN Entry-Points genutzt:
//   backend/server.js          → lokale Entwicklung (dauerhaft lauschend)
//   backend/serverless-entry.js → Vercel serverless (gebündelt zu api/index.js)

const { ensureSchemas } = require('./data/schema');

// Erlaubte Origins für CORS. Eigene Domain(s) + lokale Entwicklung.
// Erweiterbar über ENV CORS_EXTRA_ORIGINS (komma-separiert).
const ALLOWED_ORIGINS = new Set([
  'https://kundenservice-control-center.vercel.app',
  ...String(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
]);
function isAllowedOrigin(origin) {
  if (!origin) return true;                       // same-origin / curl / serverseitig
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // localhost / 127.0.0.1 auf beliebigem Port (lokale Dev)
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

async function buildApp() {
  const fastify = require('fastify')({ logger: true });

  // Security-Header (CSP-Defaults von helmet; die HTML-Seiten liefert Vercel
  // statisch aus, daher bricht das das Frontend nicht).
  await fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false, // API liefert JSON/PDF, keine eigene HTML-UI
  });

  // Antworten komprimieren (gzip/br). Greift v.a. lokal/self-hosted – auf Vercel komprimiert
  // bereits der Edge. threshold:1024 → winzige JSON-Antworten bleiben unkomprimiert (kein Overhead).
  await fastify.register(require('@fastify/compress'), { global: true, threshold: 1024 });

  // Rate-Limit global; Bulk-Import-Routen zusätzlich strenger (siehe Routen).
  await fastify.register(require('@fastify/rate-limit'), {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  fastify.register(require('@fastify/cors'), {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  });

  fastify.register(require('./routes/preise'));
  fastify.register(require('./routes/admin-preise'));
  fastify.register(require('./routes/besucher'));
  fastify.register(require('./routes/einsatzplaner'));
  fastify.register(require('./routes/vertragsformulare'));
  fastify.register(require('./routes/standaloneFormulare'));
  fastify.register(require('./routes/admin-import'));
  fastify.register(require('./routes/mitbewerber'), { prefix: '/api/mitbewerber' });

  fastify.get('/api/health', async () => ({ ok: true }));

  // Schema-Setup lokal + bei vercel dev (VERCEL_ENV=development).
  // In Production/Preview sind Turso-Tabellen bereits provisioniert → überspringen (Latenz).
  if (!process.env.VERCEL || process.env.VERCEL_ENV === 'development') await ensureSchemas();
  return fastify;
}

module.exports = buildApp;
