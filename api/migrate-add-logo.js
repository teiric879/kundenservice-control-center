// Einmalige Migration: logo_url Spalte in mitbewerber_preise hinzufügen.
// Ausführung: node api/migrate-add-logo.js
// .env manuell laden falls dotenv nicht installiert
const fs = require('fs'), path = require('path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
  });
}
const { createClient } = require('@libsql/client');

async function migrate() {
  if (!process.env.PRODUKTE_DB_URL) {
    console.error('PRODUKTE_DB_URL nicht gesetzt');
    process.exit(1);
  }
  const client = createClient({
    url: process.env.PRODUKTE_DB_URL,
    authToken: process.env.PRODUKTE_DB_AUTH_TOKEN,
  });
  try {
    await client.execute('ALTER TABLE mitbewerber_preise ADD COLUMN logo_url TEXT');
    console.log('logo_url Spalte hinzugefuegt');
  } catch (e) {
    if (e.message && (e.message.includes('duplicate column') || e.message.includes('already exists'))) {
      console.log('Spalte existiert bereits — OK');
    } else {
      console.error('Fehler:', e.message);
      process.exit(1);
    }
  }
}

migrate();
