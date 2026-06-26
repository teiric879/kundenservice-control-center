// Seedet die eigenständigen Download-Formulare (Tab „Formulare" / öffentliche
// Formularseite) mit den e-regio-Standard-PDFs.
//
// Idempotent: vorhandene Einträge (gleicher name) werden übersprungen.
// Liest die PDFs aus einem Quellverzeichnis (Default: Downloads des Nutzers,
// override per SEED_PDF_DIR) und legt sie als Base64 in standalone_formulare ab.
//
// Lokal (Default):  node backend/scripts/seed-standalone-formulare.js
// Gegen Turso:      node backend/scripts/seed-standalone-formulare.js --turso
//                   (liest PRODUKTE_DB_URL/-AUTH_TOKEN aus .env im Projekt-Root)

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

// .env minimal einlesen (kein dotenv) – nur bei --turso, damit der Default lokal bleibt.
// WICHTIG: vor dem Repo-Require, da der DB-Driver process.env beim Laden auswertet.
const USE_TURSO = process.argv.includes('--turso');
if (USE_TURSO) {
  const p = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(p)) { console.error('FEHLER: .env nicht gefunden unter ' + p); process.exit(1); }
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (!process.env.PRODUKTE_DB_URL) { console.error('FEHLER: PRODUKTE_DB_URL fehlt in .env'); process.exit(1); }
}

const repo = require('../data/repositories/standaloneFormulareRepo');

console.log('Ziel-DB: ' + (USE_TURSO ? 'Turso (' + process.env.PRODUKTE_DB_URL + ')' : 'lokale SQLite (api/db/produkte.sqlite)'));
const SRC_DIR = process.env.SEED_PDF_DIR || path.join(os.homedir(), 'Downloads');
const TODAY = new Date().toISOString().slice(0, 10);

// Reihenfolge = sort_order (10er-Schritte lassen Platz für spätere Einschübe).
const FORMS = [
  { file: 'ALB Strom.pdf',                       name: 'Allgemeine Lieferbedingungen Strom', kategorie: 'Strom',
    beschreibung: 'Allgemeine Liefer- und Versorgungsbedingungen für die Stromlieferung (ALB).' },
  { file: 'ALB Gas.pdf',                          name: 'Allgemeine Lieferbedingungen Gas',   kategorie: 'Gas',
    beschreibung: 'Allgemeine Liefer- und Versorgungsbedingungen für die Gaslieferung (ALB).' },
  { file: 'Widerrufsbelehrung.pdf',               name: 'Widerrufsbelehrung',                 kategorie: 'Allgemein',
    beschreibung: 'Widerrufsbelehrung zum Energieliefervertrag inkl. Muster-Widerrufsformular.' },
  { file: 'Datenschutz-Information Vertrieb.pdf', name: 'Datenschutz-Information Vertrieb',    kategorie: 'Allgemein',
    beschreibung: 'Informationen zur Verarbeitung personenbezogener Daten im Vertrieb gemäß Art. 13 DSGVO.' },
  { file: 'SEPA e-regio.pdf',                      name: 'SEPA-Lastschriftmandat (e-regio)',   kategorie: 'Allgemein',
    beschreibung: 'SEPA-Lastschriftmandat zur Teilnahme am Lastschriftverfahren der e-regio.' },
  { file: 'SEPA WES.pdf',                          name: 'SEPA-Lastschriftmandat (WES)',       kategorie: 'Allgemein',
    beschreibung: 'SEPA-Lastschriftmandat (Variante WES) zur Teilnahme am Lastschriftverfahren.' },
];

async function seed() {
  const existing = await repo.listAll();
  const haveNames = new Set(existing.map(e => e.name));

  let added = 0, skipped = 0, missing = 0;
  for (let i = 0; i < FORMS.length; i++) {
    const f = FORMS[i];
    if (haveNames.has(f.name)) { console.log(`· übersprungen (existiert): ${f.name}`); skipped++; continue; }

    const src = path.join(SRC_DIR, f.file);
    if (!fs.existsSync(src)) { console.warn(`! PDF nicht gefunden: ${src}`); missing++; continue; }

    const file_data = fs.readFileSync(src).toString('base64');
    await repo.insert({
      name: f.name,
      kategorie: f.kategorie,
      beschreibung: f.beschreibung,
      source_type: 'upload',
      source_value: f.file,
      file_data,
      active: 1,
      sort_order: (i + 1) * 10,
      updated: TODAY,
    });
    console.log(`✓ angelegt: ${f.name} (${f.kategorie})`);
    added++;
  }

  console.log(`\nFertig. Angelegt: ${added} · übersprungen: ${skipped} · fehlend: ${missing}`);
  process.exit(missing ? 2 : 0);
}

seed().catch(err => { console.error('Fehler:', err); process.exit(1); });
