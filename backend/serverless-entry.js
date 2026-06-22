// esbuild-Entry → wird zu api/index.js gebündelt (self-contained, committet).
// Kein .listen(): Vercel ruft den Handler direkt auf. NICHT direkt deployen.
const buildApp = require('./app');

let _app;

module.exports = async (req, res) => {
  if (!_app) {
    _app = await buildApp();
    await _app.ready();
  }
  _app.server.emit('request', req, res);
};
