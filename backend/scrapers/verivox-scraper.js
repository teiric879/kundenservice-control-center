const cheerio = require('cheerio');
const { retryWithBackoff, validatePrice, validateBasicPrice, validateProvider, hashContent, fetchWithUA } = require('../lib/scraper-utils');

// Verivox Tarif-Elemente scrapen.
// WICHTIG: Selektoren sind Platzhalter und müssen manuell gegen aktuelle Verivox Seite getestet werden.
// Siehe: https://www.verivox.de/strom/vergleich/?postleitzahl=XXXXX
async function scrapeVerivox(plz, sparte) {
  const spartePath = sparte === 'strom' ? 'strom' : sparte === 'gas' ? 'gas' : 'heizstrom';
  const url = `https://www.verivox.de/${spartePath}/vergleich/?postleitzahl=${plz}`;

  const html = await retryWithBackoff(() => fetchWithUA(url), 3);
  const $ = cheerio.load(html);

  const results = [];

  // Tarif-Elemente: .productListItem oder .tariff-item (Platzhalter — muss validiert werden!)
  const rows = $('[data-supplier]'); // Versuch 1: data-supplier Attribut
  if (rows.length === 0) {
    console.warn(`Verivox: Keine Tarife gefunden für PLZ ${plz}/${sparte} — HTML-Selektoren veraltet?`);
    return results;
  }

  rows.each((_, row) => {
    const $row = $(row);
    const anbieter = $row.attr('data-supplier')?.trim() || $row.find('[class*="supplier"], [class*="provider"]').text().trim();
    if (!anbieter || !validateProvider(anbieter)) return;

    // Arbeits- und Grundpreis: Text-Nodes mit €-Symbolen
    // CSS: .priceValue, .tariffPrice, .cost etc.
    const priceNodes = $row.find('[class*="price"]').toArray();
    let ap = null, gp = null;

    for (const node of priceNodes) {
      const text = $(node).text();
      if (text.includes('/kWh') || text.includes('Ct/kWh')) {
        ap = validatePrice(text) ?? ap;
      } else if (text.includes('/Jahr') || text.includes('/a')) {
        gp = validateBasicPrice(text) ?? gp;
      }
    }

    // Bonus: .bonus, [class*="bonus"], .savings etc.
    const bonusText = $row.find('[class*="bonus"], [class*="saving"]').text();
    const bonus = validateBasicPrice(bonusText);

    // Nur speichern wenn Mindest-Daten vorhanden
    if (anbieter && ap) {
      const hash = hashContent(anbieter, sparte, ap, gp);
      results.push({
        anbieter,
        sparte,
        plz_gebiet: plz.substring(0, 3), // z.B. "101" aus "10115"
        arbeitspreis: ap,
        grundpreis: gp,
        bonus: bonus || 0,
        bonus_bedingung: bonus ? 'Verivox-Bonus' : null,
        gueltig_ab: new Date().toISOString().split('T')[0],
        gueltig_bis: null,
        quelle: 'verivox',
        hash_content: hash,
      });
    }
  });

  console.log(`Verivox ${sparte} PLZ ${plz}: ${results.length} Tarife gescraped`);
  return results;
}

module.exports = { scrapeVerivox };
