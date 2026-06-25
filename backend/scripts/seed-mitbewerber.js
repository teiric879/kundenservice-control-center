// Test-Daten für Mitbewerber-Preise in die DB einfügen.
// Usage: node backend/scripts/seed-mitbewerber.js

const { getDb } = require('../data/driver');
const { ensureProdukte } = require('../data/schema');

const SAMPLE_DATA = [
  // Strom
  { anbieter: 'EON', sparte: 'strom', plz_gebiet: '101', arbeitspreis: 0.45, grundpreis: 180, bonus: 100, bonus_bedingung: 'Neukunde' },
  { anbieter: 'Vattenfall', sparte: 'strom', plz_gebiet: '101', arbeitspreis: 0.42, grundpreis: 185, bonus: 80, bonus_bedingung: 'Neukunde' },
  { anbieter: 'STROM.io', sparte: 'strom', plz_gebiet: '101', arbeitspreis: 0.38, grundpreis: 120, bonus: 50, bonus_bedingung: null },
  { anbieter: 'Stadtwerke Berlin', sparte: 'strom', plz_gebiet: '101', arbeitspreis: 0.47, grundpreis: 165, bonus: 0, bonus_bedingung: null },
  { anbieter: 'Check24 Top Angebote', sparte: 'strom', plz_gebiet: '101', arbeitspreis: 0.40, grundpreis: 150, bonus: 150, bonus_bedingung: 'Wechselbonus' },

  // Gas
  { anbieter: 'EON', sparte: 'gas', plz_gebiet: '101', arbeitspreis: 0.08, grundpreis: 120, bonus: 80, bonus_bedingung: 'Neukunde' },
  { anbieter: 'Vattenfall', sparte: 'gas', plz_gebiet: '101', arbeitspreis: 0.075, grundpreis: 125, bonus: 60, bonus_bedingung: null },
  { anbieter: 'STROM.io', sparte: 'gas', plz_gebiet: '101', arbeitspreis: 0.07, grundpreis: 100, bonus: 40, bonus_bedingung: null },
  { anbieter: 'Stadtwerke Berlin', sparte: 'gas', plz_gebiet: '101', arbeitspreis: 0.085, grundpreis: 110, bonus: 0, bonus_bedingung: null },

  // Heizstrom
  { anbieter: 'EON', sparte: 'heizstrom', plz_gebiet: '101', arbeitspreis: 0.35, grundpreis: 150, bonus: 120, bonus_bedingung: 'Neukunde' },
  { anbieter: 'Vattenfall', sparte: 'heizstrom', plz_gebiet: '101', arbeitspreis: 0.33, grundpreis: 160, bonus: 100, bonus_bedingung: null },
  { anbieter: 'STROM.io', sparte: 'heizstrom', plz_gebiet: '101', arbeitspreis: 0.30, grundpreis: 130, bonus: 50, bonus_bedingung: null },
];

async function seedData() {
  try {
    await ensureProdukte();
    const db = getDb('produkte');
    console.log('Inserting sample Mitbewerber-Preise...');

    for (const item of SAMPLE_DATA) {
      const crypto = require('crypto');
      const hash = crypto.createHash('md5').update(`${item.anbieter}|${item.sparte}|${item.arbeitspreis}|${item.grundpreis}`).digest('hex');

      await db.run(
        `INSERT OR IGNORE INTO mitbewerber_preise
         (id, anbieter, sparte, plz_gebiet, arbeitspreis, grundpreis, bonus, bonus_bedingung, gueltig_ab, quelle, aktualisiert_am, hash_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `test|${hash}`,
          item.anbieter,
          item.sparte,
          item.plz_gebiet,
          item.arbeitspreis,
          item.grundpreis,
          item.bonus,
          item.bonus_bedingung,
          new Date().toISOString().split('T')[0],
          'test',
          new Date().toISOString(),
          hash,
        ]
      );
    }

    console.log(`✓ ${SAMPLE_DATA.length} Test-Datensätze eingefügt`);
    process.exit(0);
  } catch (err) {
    console.error('Fehler:', err);
    process.exit(1);
  }
}

seedData();
