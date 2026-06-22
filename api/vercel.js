// Serverless-Entry für Vercel. Kein .listen() — Vercel ruft den Handler direkt auf.
// Die Fastify-Instanz wird beim ersten Request gebaut und dann gecacht (warm re-use).

const buildApp = require('../backend/app');

let _app;

module.exports = async (req, res) => {
  if (!_app) {
    _app = await buildApp();
    await _app.ready();
  }
  _app.server.emit('request', req, res);
};
