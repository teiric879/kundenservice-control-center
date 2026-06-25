// Täglicher Sync-Job für Mitbewerber-Preise (2–3 Uhr nachts).
// Wird über Vercel Crons oder lokale Scheduler aufgerufen.

const { scrapeCheck24 } = require('../scrapers/check24-scraper');
const { scrapeVerivox } = require('../scrapers/verivox-scraper');
const { upsertTarife, deleteOldEntries } = require('../data/repositories/mitbewerberRepo');
const { getDb } = require('../data/driver');
const { createRateLimiter, sleep } = require('../lib/scraper-utils');

async function syncMitbewerberPreise() {
  console.log('[Sync] Starte Mitbewerber-Sync um', new Date().toISOString());

  try {
    // Schritt 1: PLZ-Liste aus Produkt-ID Tool laden (konditionen.plz).
    const db = getDb('produkte');
    const plzRows = await db.all(
      `SELECT DISTINCT plz FROM konditionen WHERE plz IS NOT NULL ORDER BY plz`
    );
    const plzList = plzRows?.map(r => r.plz) || [];

    if (!plzList.length) {
      console.warn('[Sync] Keine PLZ in konditionen gefunden');
      return { success: false, error: 'Keine PLZ im System' };
    }

    console.log(`[Sync] Scrape für ${plzList.length} PLZ × 2 Quellen (Check24, Verivox)`);

    // Rate-Limiter: 1.5s zwischen Requests
    const rateLimiter = createRateLimiter(1500);

    // Schritt 2: Alle Kombinationen scrapen (PLZ × Sparte × Quelle).
    const allTarife = [];
    const sparten = ['strom', 'gas', 'heizstrom'];

    for (const plz of plzList) {
      for (const sparte of sparten) {
        // Check24
        try {
          const check24Tarife = await rateLimiter(async () => {
            return await scrapeCheck24(plz, sparte);
          });
          allTarife.push(...check24Tarife);
          await sleep(500); // Extra Pause nach Check24
        } catch (err) {
          console.error(`[Sync] Check24 Fehler für ${plz}/${sparte}:`, err.message);
        }

        // Verivox
        try {
          const verivoxTarife = await rateLimiter(async () => {
            return await scrapeVerivox(plz, sparte);
          });
          allTarife.push(...verivoxTarife);
          await sleep(500);
        } catch (err) {
          console.error(`[Sync] Verivox Fehler für ${plz}/${sparte}:`, err.message);
        }
      }
    }

    console.log(`[Sync] Insgesamt ${allTarife.length} Tarife gescraped`);

    // Schritt 3: In DB speichern (Duplikate ignored).
    const added = await upsertTarife(allTarife);
    console.log(`[Sync] ${added} neue Tarife eingefügt`);

    // Schritt 4: Alte Einträge (>72h) löschen.
    const deleted = await deleteOldEntries(72);
    console.log(`[Sync] ${deleted} alte Einträge gelöscht`);

    console.log('[Sync] ✓ Fertig um', new Date().toISOString());

    return {
      success: true,
      plz_count: plzList.length,
      tarife_gescraped: allTarife.length,
      tarife_eingefuegt: added,
      alte_eintraege_geloescht: deleted,
    };
  } catch (err) {
    console.error('[Sync] ✗ Fehler:', err);
    // TODO: Slack/Email Alert bei Fehler
    return { success: false, error: err.message };
  }
}

module.exports = { syncMitbewerberPreise };
