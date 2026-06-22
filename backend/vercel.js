// Serverless-Entry für Vercel — wird von ncc zu api/dist/index.js gebündelt.
// Kein .listen(): Vercel ruft den Handler direkt auf.
const buildApp = require('./app');

let _app;

module.exports = async (req, res) => {
  if (!_app) {
    _app = await buildApp();
    await _app.ready();
  }
  _app.server.emit('request', req, res);
};
