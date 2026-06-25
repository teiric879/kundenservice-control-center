// Fastify-App-Factory — ohne .listen(). Wird von BEIDEN Entry-Points genutzt:
//   backend/server.js          → lokale Entwicklung (dauerhaft lauschend)
//   backend/serverless-entry.js → Vercel serverless (gebündelt zu api/index.js)

const { ensureSchemas } = require('./data/schema');

async function buildApp() {
  const fastify = require('fastify')({ logger: true });

  fastify.register(require('@fastify/cors'), {
    origin: (origin, cb) => cb(null, true),
  });

  fastify.register(require('./routes/preise'));
  fastify.register(require('./routes/admin-preise'));
  fastify.register(require('./routes/besucher'));
  fastify.register(require('./routes/einsatzplaner'));
  fastify.register(require('./routes/vertragsformulare'));
  fastify.register(require('./routes/admin-import'));
  fastify.register(require('./routes/mitbewerber'), { prefix: '/api/mitbewerber' });

  fastify.get('/api/health', async () => ({ ok: true }));

  // Schema-Setup lokal + bei vercel dev (VERCEL_ENV=development).
  // In Production/Preview sind Turso-Tabellen bereits provisioniert → überspringen (Latenz).
  if (!process.env.VERCEL || process.env.VERCEL_ENV === 'development') await ensureSchemas();
  return fastify;
}

module.exports = buildApp;
