const cheerio = require('cheerio');
const { retryWithBackoff, validatePrice, validateBasicPrice, validateProvider, hashContent, fetchWithUA } = require('../lib/scraper-utils');

// Check24 Tarif-Elemente scrapen.
// WICHTIG: Selektoren sind Platzhalter und müssen manuell gegen aktuelle Check24 Seite getestet werden.
// Varianten: heizstromTyp='wp'|'ns', zaehlerart='einzeltarif'|'doppeltarif', nsMessung='getrennt'|'gemeinsam', steuveMod='modul1'|'modul2'
async function scrapeCheck24(plz, sparte, { heizstromTyp, zaehlerart, nsMessung, steuveMod } = {}) {
  const spartePath = sparte === 'strom' ? 'strom' : sparte === 'gas' ? 'gas' : sparte === 'heizstrom' ? 'heizstrom' : 'strom';
  const url = `https://www.check24.de/${spartePath}/vergleich?plz=${plz}`;

  const html = await retryWithBackoff(() => fetchWithUA(url), 3);
  const $ = cheerio.load(html);

  const results = [];

  // Tarif-Elemente: .result-row oder .tariff-box (Platzhalter — muss validiert werden!)
  const rows = $('[data-provider-name]'); // Versuch 1: data-Attribut
  if (rows.length === 0) {
    console.warn(`Check24: Keine Tarife gefunden für PLZ ${plz}/${sparte} — HTML-Selektoren veraltet?`);
    return results;
  }

  rows.each((_, row) => {
    const $row = $(row);
    const anbieter = $row.attr('data-provider-name')?.trim();
    if (!anbieter || !validateProvider(anbieter)) return;

    // Arbeits- und Grundpreis: Text-Nodes mit €-Symbolen
    // CSS: .price-info > * oder .cost-row etc.
    const priceTexts = $row.find('.price, .cost').map((_, el) => $(el).text()).get();

    let ap = null, gp = null;
    for (const text of priceTexts) {
      if (text.includes('/kWh')) {
        ap = validatePrice(text) ?? ap;
      } else if (text.includes('/Jahr') || text.includes('/a')) {
        gp = validateBasicPrice(text) ?? gp;
      }
    }

    // Bonus: .bonus-badge oder ähnlich
    const bonusText = $row.find('[class*="bonus"]').text();
    const bonus = validateBasicPrice(bonusText);

    // Nur speichern wenn Mindest-Daten vorhanden
    if (anbieter && ap) {
      const hash = hashContent(anbieter, sparte, ap, gp, heizstromTyp, zaehlerart, nsMessung, steuveMod);
      results.push({
        anbieter,
        sparte,
        heizstrom_typ: heizstromTyp || null,
        zaehlerart: zaehlerart || null,
        ns_messung: nsMessung || null,
        steuve_modul: steuveMod || null,
        plz_gebiet: plz.substring(0, 3),
        arbeitspreis: ap,
        grundpreis: gp,
        bonus: bonus || 0,
        bonus_bedingung: bonus ? 'Check24-Bonus' : null,
        gueltig_ab: new Date().toISOString().split('T')[0],
        gueltig_bis: null,
        quelle: 'check24',
        hash_content: hash,
      });
    }
  });

  console.log(`Check24 ${sparte} PLZ ${plz}: ${results.length} Tarife gescraped`);
  return results;
}

module.exports = { scrapeCheck24 };
