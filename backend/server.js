// Lokaler Dev-Entry. Nutzt dieselbe App-Factory wie der Vercel-Serverless-Entry.
const buildApp = require('./app');

buildApp().then((app) => {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  app.listen({ port, host }).then(() => {
    console.log(`API-Server läuft auf http://${host}:${port}`);
  });
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
