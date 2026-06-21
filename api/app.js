// Fastify-App-Factory — ohne .listen(). Wird von BEIDEN Entry-Points genutzt:
//   api/server.js   → lokale Entwicklung (dauerhaft lauschend)
//   api/vercel.js   → Vercel serverless (kein listen())

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

  fastify.get('/api/health', async () => ({ ok: true }));

  await ensureSchemas();
  return fastify;
}

module.exports = buildApp;
