const { getDb } = require('../driver');

// Eine DB-Zeile → {nb:{name,tel,url}, gv:{name,tel}}. Strom-GV hat keinen Kontakt (nur Name).
function shapeRow(r) {
  return {
    nb: { name: r.netzbetreiber || '', tel: r.nb_tel || '', url: r.nb_url || '' },
    gv: { name: r.grundversorger || '', tel: r.gv_tel || '' },
  };
}

// NB/GV für genau eine PLZ (Strom + Gas). Genutzt vom Produkt-ID-Tool.
async function lookup(plz) {
  const db = getDb('produkte');
  const rows = await db.all(`SELECT * FROM enet_betreiber WHERE plz = ? LIMIT 10`, [plz]);
  const out = { plz, ort: null, strom: null, gas: null, stand: null };
  for (const r of rows) {
    if (!out.ort) out.ort = r.ort;
    if (!out.stand) out.stand = r.stand;
    if (r.sparte === 'strom' && !out.strom) out.strom = shapeRow(r);
    if (r.sparte === 'gas' && !out.gas) out.gas = shapeRow(r);
  }
  return out;
}

// Bundesweite Suche per PLZ-Präfix (nur Ziffern) ODER Ort-Teilstring. Genutzt von der Marktlage.
async function search(q, limit = 50) {
  const db = getDb('produkte');
  q = String(q || '').trim();
  if (!q) return [];

  let rows;
  if (/^\d+$/.test(q)) {
    rows = await db.all(
      `SELECT * FROM enet_betreiber WHERE plz LIKE ? ORDER BY plz, ort, sparte LIMIT ?`,
      [q + '%', limit * 2]);
  } else {
    rows = await db.all(
      `SELECT * FROM enet_betreiber WHERE lower(ort) LIKE ? ORDER BY ort, plz, sparte LIMIT ?`,
      ['%' + q.toLowerCase() + '%', limit * 2]);
  }

  // Pro (plz, ort) Strom + Gas zusammenfassen.
  const map = new Map();
  for (const r of rows) {
    const key = r.plz + '|' + (r.ort || '');
    if (!map.has(key)) map.set(key, { plz: r.plz, ort: r.ort, strom: null, gas: null });
    const g = map.get(key);
    if (r.sparte === 'strom') g.strom = shapeRow(r);
    if (r.sparte === 'gas') g.gas = shapeRow(r);
  }
  return Array.from(map.values()).slice(0, limit);
}

module.exports = { lookup, search };
