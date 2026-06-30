// Fastify-App-Factory — ohne .listen(). Wird von BEIDEN Entry-Points genutzt:
//   backend/server.js          → lokale Entwicklung (dauerhaft lauschend)
//   backend/serverless-entry.js → Vercel serverless (gebündelt zu api/index.js)

const { ensureSchemas } = require('./data/schema');
const usersRepo = require('./data/repositories/usersRepo');
const { hashPassword } = require('./lib/site-auth');

const ALL_MODULES = ['besucher-dashboard','produkt-id-tool','einsatzplaner','abschlag-wasser','formulare','admin'];
const DEV_ADMIN_PW = 'eregio2026#';

async function seedAdminUser() {
  try {
    const n = await usersRepo.count();
    if (n > 0) return;
    const pw = process.env.ADMIN_API_TOKEN || DEV_ADMIN_PW;
    await usersRepo.create({
      username: 'admin',
      passwordHash: hashPassword(pw),
      modules: ALL_MODULES,
      isAdmin: true,
    });
  } catch (e) {
    // Seed ist Best-Effort — Startfehler nicht riskieren.
    console.error('[seed] Admin-Seed fehlgeschlagen:', e.message);
  }
}

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

  fastify.register(require('./routes/auth'));
  fastify.register(require('./routes/admin-users'));
  fastify.register(require('./routes/preise'));
  fastify.register(require('./routes/admin-preise'));
  fastify.register(require('./routes/besucher'));
  fastify.register(require('./routes/einsatzplaner'));
  fastify.register(require('./routes/vertragsformulare'));
  fastify.register(require('./routes/standaloneFormulare'));
  fastify.register(require('./routes/admin-import'));
  fastify.register(require('./routes/mitbewerber'), { prefix: '/api/mitbewerber' });
  fastify.register(require('./routes/enet'), { prefix: '/api/enet' });
  fastify.register(require('./routes/admin-enet'), { prefix: '/api/admin/enet' });

  fastify.get('/api/health', async () => ({ ok: true }));

  // Schema-Setup: immer ausführen (alle Statements nutzen IF NOT EXISTS → idempotent).
  // Neu hinzugekommene Tabellen (z.B. users) werden so auch in Turso/Production angelegt.
  await ensureSchemas();

  // Seed-Admin: wenn noch kein User existiert, Default-Admin anlegen.
  await seedAdminUser();

  return fastify;
}

module.exports = buildApp;
