// Standalone naechtlicher Scraper — laeuft via GitHub Actions direkt gegen Turso.
// Keine Abhaengigkeit vom Vercel-Backend.
// Ausfuehrung: node index.js (mit PRODUKTE_DB_URL + PRODUKTE_DB_AUTH_TOKEN als Env-Vars)

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const puppeteer = require('puppeteer');
const { createClient } = require('@libsql/client');
const crypto = require('crypto');

// ---- Selektor-Konfiguration (hier anpassen wenn Seite sich aendert) ----
// Selektoren sind als Arrays angegeben; der erste der matched wird verwendet.
const CHECK24_CFG = {
  urls: {
    strom: 'https://www.check24.de/strom/vergleich/?postleitzahl={PLZ}',
    gas:   'https://www.check24.de/gas/vergleich/?postleitzahl={PLZ}',
  },
  // Selektoren werden per querySelectorAll gesucht — erster Treffer gewinnt
  WAIT_FOR:    '[data-testid="result-list"], .result-list, [class*="TariffList"], [class*="tariff-list"]',
  ROW:         '[data-testid*="tariff-card"], [class*="tariff-card"], [class*="TariffCard"], [class*="tariff-row"], [class*="TariffRow"]',
  NAME:        '[data-testid*="provider-name"], [class*="provider-name"], [class*="ProviderName"], [class*="brand-name"]',
  LOGO:        'img[class*="provider-logo"], img[class*="ProviderLogo"], img[class*="brand-logo"], img[alt][src*="logo"]',
  AP:          '[data-testid*="working-price"], [class*="working-price"], [class*="WorkingPrice"], [class*="energy-price"]',
  GP:          '[data-testid*="base-price"], [class*="base-price"], [class*="BasePrice"], [class*="basic-fee"]',
  BONUS:       '[class*="bonus-amount"], [class*="BonusAmount"], [data-testid*="bonus"]',
};

const VERIVOX_CFG = {
  urls: {
    strom: 'https://www.verivox.de/strom/tarife/?plz={PLZ}',
    gas:   'https://www.verivox.de/gas/tarife/?plz={PLZ}',
  },
  WAIT_FOR:    '[class*="result-list"], [class*="ResultList"], [class*="product-list"], [data-cy="result-list"]',
  ROW:         '[class*="result-item"], [class*="ResultItem"], [class*="product-card"], [class*="ProductCard"]',
  NAME:        '[class*="supplier-name"], [class*="SupplierName"], [class*="provider-name"], [class*="ProviderName"]',
  LOGO:        'img[class*="supplier-logo"], img[class*="SupplierLogo"], img[class*="provider-logo"], [class*="logo"] img',
  AP:          '[class*="working-price"], [class*="WorkingPrice"], [class*="energy-price"], [class*="EnergyPrice"]',
  GP:          '[class*="base-price"], [class*="BasePrice"], [class*="base-fee"], [class*="BaseFee"]',
  BONUS:       '[class*="bonus"], [class*="Bonus"], [class*="saving"], [class*="Saving"]',
};
// --------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hash(anbieter, sparte, ap, gp) {
  return crypto.createHash('md5').update(`${anbieter}|${sparte}|${ap}|${gp}`).digest('hex');
}

function parseNum(txt) {
  if (!txt) return null;
  // "32,45 ct/kWh" → 0.3245; "120,00 €/Jahr" → 120.0
  const clean = txt.replace(/[^\d,\.]/g, '').replace(',', '.');
  const v = parseFloat(clean);
  if (isNaN(v) || v <= 0 || v > 99999) return null;
  return v;
}

// Seite scrapen und Tarif-Objekte zurückgeben
async function scrapePage(page, url, cfg, sparte, plz, variant, quelle) {
  const results = [];
  try {
    console.log(`  -> ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3500); // JS-Rendering abwarten

    // Auf Ergebnis-Container warten (nicht fatal wenn Timeout)
    await page.waitForSelector(cfg.WAIT_FOR, { timeout: 10000 }).catch(() => null);
    await sleep(1000);

    // Daten aus dem DOM extrahieren
    const raw = await page.evaluate((rowSel, nameSel, logoSel, apSel, gpSel, bonusSel) => {
      const rows = Array.from(document.querySelectorAll(rowSel)).slice(0, 30);
      return rows.map(row => {
        const nameEl = row.querySelector(nameSel);
        const logoEl = row.querySelector(logoSel);
        const apEl   = row.querySelector(apSel);
        const gpEl   = row.querySelector(gpSel);
        const bonEl  = row.querySelector(bonusSel);
        return {
          anbieter:      nameEl ? nameEl.textContent.trim() : null,
          logo_url:      logoEl ? (logoEl.src || logoEl.getAttribute('src')) : null,
          ap_txt:        apEl   ? apEl.textContent.trim() : null,
          gp_txt:        gpEl   ? gpEl.textContent.trim() : null,
          bonus_txt:     bonEl  ? bonEl.textContent.trim() : null,
        };
      });
    }, cfg.ROW, cfg.NAME, cfg.LOGO, cfg.AP, cfg.GP, cfg.BONUS);

    if (!raw.length) {
      console.warn(`    Keine Zeilen gefunden (${quelle} ${sparte} PLZ ${plz}) — Selektoren veraltet?`);
      return results;
    }

    for (const t of raw) {
      if (!t.anbieter || t.anbieter.length < 2 || t.anbieter.length > 60) continue;
      const ap = parseNum(t.ap_txt);
      if (!ap) continue;
      const gp    = parseNum(t.gp_txt);
      const bonus = parseNum(t.bonus_txt);
      const h     = hash(t.anbieter, sparte, ap, gp);
      results.push({
        anbieter:       t.anbieter,
        logo_url:       t.logo_url || null,
        sparte,
        heizstrom_typ:  variant.heizstromTyp || null,
        zaehlerart:     variant.zaehlerart   || null,
        ns_messung:     variant.nsMessung    || null,
        steuve_modul:   variant.steuveMod    || null,
        plz_gebiet:     plz.substring(0, 3),
        arbeitspreis:   ap,
        grundpreis:     gp,
        bonus:          bonus || 0,
        bonus_bedingung: bonus ? `${quelle}-Bonus` : null,
        gueltig_ab:     new Date().toISOString().split('T')[0],
        gueltig_bis:    null,
        quelle,
        hash_content:   h,
      });
    }
    console.log(`    ${results.length} Tarife gescraped`);
  } catch (err) {
    console.error(`    Fehler: ${err.message}`);
  }
  return results;
}

async function upsert(client, tarife) {
  let inserted = 0;
  for (const t of tarife) {
    const id = `${t.quelle}|${t.hash_content}`;
    const res = await client.execute({
      sql: `INSERT INTO mitbewerber_preise
              (id, anbieter, sparte, heizstrom_typ, zaehlerart, ns_messung, steuve_modul,
               plz_gebiet, arbeitspreis, grundpreis, bonus, bonus_bedingung,
               gueltig_ab, gueltig_bis, quelle, aktualisiert_am, hash_content, logo_url)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              aktualisiert_am = excluded.aktualisiert_am,
              logo_url        = COALESCE(excluded.logo_url, logo_url)`,
      args: [
        id, t.anbieter, t.sparte,
        t.heizstrom_typ, t.zaehlerart, t.ns_messung, t.steuve_modul,
        t.plz_gebiet, t.arbeitspreis, t.grundpreis,
        t.bonus, t.bonus_bedingung,
        t.gueltig_ab, t.gueltig_bis,
        t.quelle, new Date().toISOString(), t.hash_content, t.logo_url,
      ],
    });
    inserted += res.rowsAffected || 0;
  }
  return inserted;
}

async function main() {
  if (!process.env.PRODUKTE_DB_URL) {
    console.error('PRODUKTE_DB_URL fehlt — Env-Variable setzen');
    process.exit(1);
  }

  const client = createClient({
    url:       process.env.PRODUKTE_DB_URL,
    authToken: process.env.PRODUKTE_DB_AUTH_TOKEN,
  });

  // PLZ-Liste aus der Produkte-DB (konditionen.plz)
  const plzRes  = await client.execute('SELECT DISTINCT plz FROM konditionen WHERE plz IS NOT NULL ORDER BY plz');
  const plzList = plzRes.rows.map(r => r.plz).filter(Boolean);

  if (!plzList.length) {
    console.warn('Keine PLZ in konditionen gefunden — Abbruch');
    process.exit(0);
  }
  console.log(`[Sync] ${plzList.length} PLZ gefunden:`, plzList.join(', '));

  // Varianten: Strom + Gas (Heizstrom/SteuVE brauchen spezielle URL-Parameter die seitenspezifisch sind)
  const VARIANTEN = [
    { sparte: 'strom' },
    { sparte: 'gas'   },
  ];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let totalInserted = 0;
  let totalErrors   = 0;

  try {
    for (const plz of plzList) {
      console.log(`\n[PLZ ${plz}]`);

      for (const v of VARIANTEN) {
        const page = await browser.newPage();
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );
        await page.setViewport({ width: 1440, height: 900 });
        // Bilder/Fonts blockieren → schneller laden, Logos trotzdem via src-Attribut
        await page.setRequestInterception(true);
        page.on('request', req => {
          if (['font', 'media'].includes(req.resourceType())) req.abort();
          else req.continue();
        });

        try {
          // Check24
          const c24url = CHECK24_CFG.urls[v.sparte].replace('{PLZ}', plz);
          const c24    = await scrapePage(page, c24url, CHECK24_CFG, v.sparte, plz, v, 'check24');
          totalInserted += await upsert(client, c24);

          await sleep(2000);

          // Verivox
          const vxurl = VERIVOX_CFG.urls[v.sparte].replace('{PLZ}', plz);
          const vx    = await scrapePage(page, vxurl, VERIVOX_CFG, v.sparte, plz, v, 'verivox');
          totalInserted += await upsert(client, vx);
        } catch (err) {
          console.error(`  Variante ${v.sparte} fehlgeschlagen:`, err.message);
          totalErrors++;
        } finally {
          await page.close();
        }

        await sleep(2500); // Rate-Limiting zwischen Varianten
      }
    }

    // Alte Eintraege (aelter als 72h) aufraeumen
    const cutoff  = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const cleaned = await client.execute({ sql: 'DELETE FROM mitbewerber_preise WHERE aktualisiert_am < ?', args: [cutoff] });

    console.log(`\n[Sync] Abgeschlossen: ${totalInserted} Tarife aktualisiert, ${cleaned.rowsAffected} alte geloescht, ${totalErrors} Fehler`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[Sync] Kritischer Fehler:', err);
  process.exit(1);
});
