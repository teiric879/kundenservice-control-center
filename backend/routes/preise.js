// Route: Produktdaten (lesend). Enthält KEIN SQL mehr — Datenzugriff über produkteRepo.
// groupRows ist reine Transformation (SQLite-Zeilen → data.js-Format) und bleibt hier.

const produkteRepo = require('../data/repositories/produkteRepo');

// Kanonische Netzentgeltreduzierung §14a für SteuVE Modul 1 (WP-M1 / Wallbox-M1).
// Fester regulatorischer Pauschalwert – in der Quell-/Import-Pipeline nicht enthalten,
// daher hier (wie VERTRAGS_TERMS in calc.js) als Konstante gesetzt, falls die DB-Spalte
// leer ist. So überlebt der Wert jeden rebuild-/migrate-Zyklus.
const NETZENTGELT_M1 = '-134,85 €/a';
const NETZENTGELT_M1_KEYS = new Set(['WP-M1', 'Wallbox-M1']);

function groupRows(rows, produkte, isPreise) {
  // Group SQLite rows (one per product key) back into the original data.js format:
  // one object per (ga, v_von, v_bis, gebiet) with product keys as nested objects.
  const map = new Map();
  for (const r of rows) {
    const key = `${r.ga}|${r.v_von}|${r.v_bis}|${r.gebiet ?? ''}|${r.plz ?? ''}|${r.zaehlerart ?? ''}`;
    if (!map.has(key)) {
      const entry = { ga: r.ga, vVon: r.v_von, vBis: r.v_bis, gebiet: r.gebiet ?? undefined, bonus: r.bonus ?? 0 };
      if (r.plz) entry.plz = r.plz;
      if (r.ort) entry.ort = r.ort;
      if (r.zaehlerart) entry.zaehlerart = r.zaehlerart;
      map.set(key, entry);
    }
    const entry = map.get(key);
    if (isPreise) {
      const p = {};
      if (r.ap_b  !== null) p.apB  = r.ap_b;
      if (r.gp_b  !== null) p.gpB  = r.gp_b;
      if (r.ap_n  !== null) p.apN  = r.ap_n;
      if (r.gp_n  !== null) p.gpN  = r.gp_n;
      if (r.ap_nt_b !== null) p.apNtB = r.ap_nt_b;
      if (r.ap_nt_n !== null) p.apNtN = r.ap_nt_n;
      entry[r.produkt_key] = p;
    } else {
      const k = { pid: r.pid ?? 0, aid: r.aid ?? 0, vl: r.vl ?? 12, pg: r.pg ?? 12, bonus: r.bonus ?? 0 };
      if (r.pid_nt !== null) k.pidNt = r.pid_nt;
      if (r.aid_nt !== null) k.aidNt = r.aid_nt;
      if (r.alb) k.alb = r.alb;
      if (r.netzentgelt_red) k.netzentgeltRed = r.netzentgelt_red;
      else if (r.sparte === 'steuve' && NETZENTGELT_M1_KEYS.has(r.produkt_key)) k.netzentgeltRed = NETZENTGELT_M1;
      entry[r.produkt_key] = k;
    }
  }
  return Array.from(map.values());
}

module.exports = async function preiseRoutes(fastify) {
  fastify.get('/api/produktdaten', async (req, reply) => {
    // Preise/Gültigkeiten ändern sich selten (nur per Admin-Pflege) → am Edge cachen.
    // Folge-Aufrufe kommen sofort aus dem CDN statt Funktion+Turso zu treffen.
    reply.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    const [sparten, gueltig, preisRows, kondRows] = await Promise.all([
      produkteRepo.allSparten(),
      produkteRepo.allGueltigkeiten(),
      produkteRepo.gebietPreise(),       // nur plz IS NULL; per-PLZ via /api/plzpreise
      produkteRepo.gebietKonditionen(),
    ]);

    const result = {};
    for (const s of sparten) {
      const sk = s.sparte;
      const gas      = gueltig.filter((g) => g.sparte === sk).map((g) => g.ga);
      const sPR      = preisRows.filter((r) => r.sparte === sk);
      const sKR      = kondRows.filter((r) => r.sparte === sk);
      const produkte = JSON.parse(s.produkte);

      result[sk] = {
        label:       s.label,
        ust:         s.ust,
        nkbSchwelle: s.nkb_schwelle,
        gebiete:     s.gebiete ? JSON.parse(s.gebiete) : null,
        hasNt:       s.has_nt === 1,
        produkte,
        labels:      JSON.parse(s.labels),
        typen:       s.typen   ? JSON.parse(s.typen)   : undefined,
        module:      s.module  ? JSON.parse(s.module)  : undefined,
        gueltigkeiten: gas,
        preise:      groupRows(sPR, produkte, true),
        konditionen: groupRows(sKR, produkte, false),
      };
    }
    return result;
  });

  // Per-PLZ-Preise + Konditionen (volle Historie) für EINE PLZ – on-demand geladen.
  fastify.get('/api/plzpreise', async (req) => {
    const plz = String(req.query.plz || '').trim();
    if (!/^\d{5}$/.test(plz)) return { ok: false, error: 'plz muss 5-stellig sein' };

    const [pr, kr] = await Promise.all([
      produkteRepo.preiseByPlz(plz),
      produkteRepo.konditionenByPlz(plz),
    ]);

    const sparten = [...new Set([...pr, ...kr].map((r) => r.sparte))];
    const out = {};
    for (const sk of sparten) {
      const meta = await produkteRepo.getProdukteJson(sk);
      const produkte = JSON.parse(meta?.produkte || '[]');
      out[sk] = {
        preise:      groupRows(pr.filter((r) => r.sparte === sk), produkte, true),
        konditionen: groupRows(kr.filter((r) => r.sparte === sk), produkte, false),
      };
    }
    return { ok: true, plz, ort: (pr[0]?.ort ?? null), sparten: out };
  });
};
