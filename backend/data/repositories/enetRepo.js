const { getDb } = require('../driver');

// Wert wählen: nicht-leerer Override gewinnt, sonst Basiswert (sonst '').
function pick(ov, base) {
  const o = (ov == null ? '' : String(ov)).trim();
  if (o) return o;
  return base == null ? '' : String(base);
}

// Basiszeile (enet_betreiber) + Override-Zeile (enet_override) → {nb:{…}, gv:{…}}.
function shapeMerged(base, ov) {
  base = base || {};
  ov = ov || {};
  return {
    nb: {
      name:  pick(ov.nb_name,  base.netzbetreiber),
      tel:   pick(ov.nb_tel,   base.nb_tel),
      url:   pick(ov.nb_url,   base.nb_url),
      email: pick(ov.nb_email, base.nb_email),
    },
    gv: {
      name:  pick(ov.gv_name,  base.grundversorger),
      tel:   pick(ov.gv_tel,   base.gv_tel),
      url:   pick(ov.gv_url,   ''),   // gv-url/-email nur via Override
      email: pick(ov.gv_email, ''),
    },
  };
}

async function overridesForPlz(db, plz) {
  const rows = await db.all(`SELECT * FROM enet_override WHERE plz = ?`, [plz]);
  const map = {};
  for (const r of rows) map[r.sparte] = r;
  return map;
}

// NB/GV für genau eine PLZ (Strom + Gas), inkl. Override. Genutzt vom Produkt-ID-Tool.
async function lookup(plz) {
  const db = getDb('produkte');
  const rows = await db.all(`SELECT * FROM enet_betreiber WHERE plz = ? LIMIT 10`, [plz]);
  const ov = await overridesForPlz(db, plz);
  const baseBySparte = {};
  const out = { plz, ort: null, strom: null, gas: null, stand: null };
  for (const r of rows) {
    if (!out.ort) out.ort = r.ort;
    if (!out.stand) out.stand = r.stand;
    if (!baseBySparte[r.sparte]) baseBySparte[r.sparte] = r;
  }
  // Sparten auch dann liefern, wenn nur ein Override (ohne Basiszeile) existiert.
  for (const sparte of ['strom', 'gas']) {
    if (baseBySparte[sparte] || ov[sparte]) out[sparte] = shapeMerged(baseBySparte[sparte], ov[sparte]);
  }
  return out;
}

// Bundesweite Suche per PLZ-Präfix (nur Ziffern) ODER Ort-Teilstring. Genutzt von der NB/GV-Suche.
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

  // Overrides für die getroffenen PLZ nachladen.
  const plzList = [...new Set(rows.map(r => r.plz))];
  const ovMap = {};
  if (plzList.length) {
    const ph = plzList.map(() => '?').join(',');
    const ovRows = await db.all(`SELECT * FROM enet_override WHERE plz IN (${ph})`, plzList);
    for (const r of ovRows) ovMap[r.plz + '|' + r.sparte] = r;
  }

  const map = new Map();
  for (const r of rows) {
    const key = r.plz + '|' + (r.ort || '');
    if (!map.has(key)) map.set(key, { plz: r.plz, ort: r.ort, strom: null, gas: null });
    const g = map.get(key);
    g[r.sparte] = shapeMerged(r, ovMap[r.plz + '|' + r.sparte]);
  }
  return Array.from(map.values()).slice(0, limit);
}

// ── Admin-Editor ────────────────────────────────────────────────────────────
// Basiswerte (als Platzhalter) + aktuelle Override-Rohwerte je Sparte für eine PLZ.
async function getEditable(plz) {
  const db = getDb('produkte');
  const rows = await db.all(`SELECT * FROM enet_betreiber WHERE plz = ? LIMIT 10`, [plz]);
  const ov = await overridesForPlz(db, plz);
  const baseBySparte = {};
  let ort = null;
  for (const r of rows) { if (!baseBySparte[r.sparte]) baseBySparte[r.sparte] = r; if (!ort) ort = r.ort; }

  const sparteOut = (sparte) => {
    const b = baseBySparte[sparte] || {};
    const o = ov[sparte] || {};
    return {
      base: {
        nb: { name: b.netzbetreiber || '', tel: b.nb_tel || '', url: b.nb_url || '', email: b.nb_email || '' },
        gv: { name: b.grundversorger || '', tel: b.gv_tel || '', url: '', email: '' },
      },
      override: {
        nb: { name: o.nb_name || '', tel: o.nb_tel || '', url: o.nb_url || '', email: o.nb_email || '' },
        gv: { name: o.gv_name || '', tel: o.gv_tel || '', url: o.gv_url || '', email: o.gv_email || '' },
      },
    };
  };
  return { plz, ort, strom: sparteOut('strom'), gas: sparteOut('gas') };
}

// data = { strom:{nb:{name,tel,url,email}, gv:{…}}, gas:{…} }. Leere Felder = kein Override.
async function upsertOverride(plz, data) {
  const db = getDb('produkte');
  const now = new Date().toISOString();
  const s = (x) => (x == null ? '' : String(x).trim());
  // URL absolut machen, sonst rendert das Frontend einen relativen Link (→ 404).
  const sUrl = (x) => { const u = s(x); return (!u || /^https?:\/\//i.test(u)) ? u : 'https://' + u; };
  for (const sparte of ['strom', 'gas']) {
    const d = data[sparte];
    if (!d) continue;
    const nb = d.nb || {}, gv = d.gv || {};
    await db.run(
      `INSERT OR REPLACE INTO enet_override
        (plz, sparte, nb_name, nb_tel, nb_url, nb_email, gv_name, gv_tel, gv_url, gv_email, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [plz, sparte, s(nb.name), s(nb.tel), sUrl(nb.url), s(nb.email),
       s(gv.name), s(gv.tel), sUrl(gv.url), s(gv.email), now]);
  }
  return true;
}

async function deleteOverride(plz) {
  const db = getDb('produkte');
  const r = await db.run(`DELETE FROM enet_override WHERE plz = ?`, [plz]);
  return r.changes || 0;
}

module.exports = { lookup, search, getEditable, upsertOverride, deleteOverride };
