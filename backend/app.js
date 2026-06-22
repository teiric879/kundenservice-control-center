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

  fastify.get('/api/health', async () => ({ ok: true }));

  // Schema-Setup NUR lokal. Auf Vercel (process.env.VERCEL gesetzt) sind die Turso-
  // Tabellen bereits provisioniert — das Setup würde pro Cold-Start sonst mehrere
  // Turso-Round-Trips kosten (u.a. 17 sequenzielle Agent-Seeds) und nur Latenz bringen.
  if (!process.env.VERCEL) await ensureSchemas();
  return fastify;
}

module.exports = buildApp;
