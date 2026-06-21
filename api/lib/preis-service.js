// Service-Schicht für die Admin-Preispflege.
//
// Orchestriert Geschäftslogik (Klon-Vorlage bauen, Netto→Brutto, aid/pid auflösen, Schreibzeilen
// vorbereiten) zwischen reiner Rechenlogik (lib/preis-logik.js) und den Repositories. Enthält KEIN
// rohes SQL — Datenzugriff ausschließlich über produkteRepo / registryRepo.

const { r2, ableitenBrutto } = require('./preis-logik');
const produkteRepo = require('../data/repositories/produkteRepo');
const registryRepo = require('../data/repositories/registryRepo');

// Repräsentative Gebiete (für Sparten mit uniformen Konditionen, z.B. Gas → aid aus Rep-PLZ 53879/EUS)
const REP_GEBIET = ['EUS', 'übrige', 'BHM', 'WTB'];
// Fallback-ALB je Sparte, falls die Vorlage keine liefert
const ALB_DEFAULT = { gas: '20260101', strom: 'ALB Strom', heizstrom: 'ALB Heizstrom', autostrom: 'ALB AutoStrom', steuve: '20260101' };

// Netto aus gespeicherten Werten oder rückgerechnet aus Brutto (Vorbefüllung; Admin korrigiert exakt)
const nettoAp   = (r) => (r.ap_n != null ? r.ap_n : (r.ap_b != null ? r2(r.ap_b / 1.19) : null));
const nettoGp   = (r) => (r.gp_n != null ? r.gp_n : (r.gp_b != null ? r2(r.gp_b * 12 / 1.19) : null));
const nettoApNt = (r) => (r.ap_nt_n != null ? r.ap_nt_n : (r.ap_nt_b != null ? r2(r.ap_nt_b / 1.19) : null));

const kondKey = (produktKey, gebiet, vVon, vBis, za) =>
  `${produktKey}|${gebiet ?? ''}|${vVon}|${vBis}|${za ?? ''}`;

// Brutto ableiten + pid/aid auflösen (Registry → sonst mitgeführt). Mutiert row, gibt row zurück.
async function enrich(sparte, row) {
  const b = ableitenBrutto(row.ap_n, row.gp_n, row.ap_nt_n);
  row.apB = b.apB; row.gpB = b.gpB; row.apNtB = b.apNtB ?? null;

  const pm = await registryRepo.resolvePid(sparte, row.produkt_key, row.zaehlerart);
  row.pid = pm?.pid ?? row._pid ?? 0;
  row.pid_nt = pm?.pidNt ?? row._pid_nt ?? null;
  row.vl = pm?.vl ?? row._vl ?? 12;
  row.pg = pm?.pg ?? row._pg ?? 12;

  const aidReg = await registryRepo.resolveAid(sparte, row.ap_n, row.gp_n);
  row.aid = aidReg ?? row.aid_override ?? row._aid ?? 0;
  row.aid_neu = aidReg == null && row.ap_n != null; // Registry kennt diese Kombination nicht

  if (row.pid_nt) {
    const ntReg = await registryRepo.resolveAidNt(sparte, row.ap_n);
    row.aid_nt = ntReg ?? row.aid_nt_override ?? row._aid_nt ?? null;
    row.aid_nt_neu = ntReg == null && row.ap_n != null;
  } else {
    row.aid_nt = null; row.aid_nt_neu = false;
  }
  row.alb = row._alb ?? ALB_DEFAULT[sparte] ?? null;
  return row;
}

// Vorlage (Gebiets-Ebene) für eine Sparte + ga (ohne ga = jüngste). Liefert editierbare Zeilen
// inkl. rückgerechnetem Netto und mitgeführten Konditionsfeldern (pid/aid/vl/pg/alb).
async function buildTemplate(sparte, gaIn) {
  const meta = await produkteRepo.getSparte(sparte);
  if (!meta) return null;
  const produkte = JSON.parse(meta.produkte);
  const gebiete = meta.gebiete ? JSON.parse(meta.gebiete) : null;

  let ga = gaIn;
  if (!ga) {
    const row = await produkteRepo.latestGa(sparte);
    ga = row ? row.ga : null;
  }

  const priceRows = ga ? await produkteRepo.gebietPreiseByGa(sparte, ga) : [];
  const kondRows  = ga ? await produkteRepo.gebietKonditionenByGa(sparte, ga) : [];

  // Konditionen für Carry-forward indizieren (exakt + gebiet-unabhängig als Fallback)
  const kondExact = new Map(), kondLoose = new Map();
  for (const k of kondRows) {
    kondExact.set(kondKey(k.produkt_key, k.gebiet, k.v_von, k.v_bis, k.zaehlerart), k);
    kondLoose.set(`${k.produkt_key}|${k.zaehlerart ?? ''}`, k);
  }
  const carried = (pk, gebiet, vVon, vBis, za) =>
    kondExact.get(kondKey(pk, gebiet, vVon, vBis, za)) || kondLoose.get(`${pk}|${za ?? ''}`) || {};

  const kondGebietUniform = kondRows.length > 0 && !kondRows.some((k) => k.gebiet != null);

  let rows;
  if (priceRows.length > 0) {
    rows = priceRows.map((p) => {
      const c = carried(p.produkt_key, p.gebiet, p.v_von, p.v_bis, p.zaehlerart);
      return {
        produkt_key: p.produkt_key, gebiet: p.gebiet, v_von: p.v_von, v_bis: p.v_bis,
        zaehlerart: p.zaehlerart, bonus: p.bonus ?? 0,
        ap_n: nettoAp(p), gp_n: nettoGp(p), ap_nt_n: nettoApNt(p),
        _pid: c.pid ?? null, _aid: c.aid ?? null, _pid_nt: c.pid_nt ?? null,
        _aid_nt: c.aid_nt ?? null, _vl: c.vl ?? 12, _pg: c.pg ?? 12, _alb: c.alb ?? null,
      };
    });
  } else {
    // Keine Gebiets-Preiszeilen (z.B. autostrom) → Skelett aus produkte × gebiete, Band 0-999999
    const gs = gebiete && gebiete.length ? gebiete : [null];
    rows = [];
    for (const pk of produkte) for (const g of gs) {
      const c = carried(pk, g, 0, 999999, null);
      rows.push({
        produkt_key: pk, gebiet: g, v_von: 0, v_bis: 999999, zaehlerart: null, bonus: 0,
        ap_n: null, gp_n: null, ap_nt_n: null,
        _pid: c.pid ?? null, _aid: c.aid ?? null, _pid_nt: c.pid_nt ?? null,
        _aid_nt: c.aid_nt ?? null, _vl: c.vl ?? 12, _pg: c.pg ?? 12, _alb: c.alb ?? null,
      });
    }
  }

  // Live-Vorschau für jede Zeile anreichern (Brutto + aufgelöste aid aus Registry)
  for (const row of rows) await enrich(sparte, row);

  return { sparte, ga, label: meta.label, produkte, gebiete, hasNt: meta.has_nt === 1, kondGebietUniform, rows };
}

// Reichert die Eingabezeilen an und teilt sie in schreibfertige Preis-/Konditions-Zeilen.
// Bei uniformen Sparten werden die Konditionen je (produkt,band,zaehlerart) auf eine Rep-Gebiet-Zeile
// kollabiert (gebiet=NULL). Delegiert das eigentliche Schreiben atomar an das Repository.
async function saveGueltigkeit(sparte, ga, rows, kondGebietUniform) {
  const enriched = [];
  for (const r of rows) enriched.push(await enrich(sparte, { ...r }));

  // Preiszeilen: eine je Eingabezeile.
  const preisRows = enriched.map((r) => ({
    v_von: r.v_von, v_bis: r.v_bis, gebiet: r.gebiet, produkt_key: r.produkt_key,
    zaehlerart: r.zaehlerart, apB: r.apB, gpB: r.gpB, ap_n: r.ap_n, gp_n: r.gp_n,
    apNtB: r.apNtB, bonus: r.bonus ?? 0,
  }));

  // Konditionszeilen: per Gebiet – oder bei uniformen Sparten kollabiert (gebiet NULL, Rep-Gebiet für aid).
  let kondRows;
  if (kondGebietUniform) {
    const groups = new Map();
    for (const r of enriched) {
      const key = `${r.produkt_key}|${r.v_von}|${r.v_bis}|${r.zaehlerart ?? ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    kondRows = [];
    for (const grp of groups.values()) {
      const rep = REP_GEBIET.map((g) => grp.find((x) => x.gebiet === g)).find(Boolean) || grp[0];
      kondRows.push({
        v_von: rep.v_von, v_bis: rep.v_bis, gebiet: null, produkt_key: rep.produkt_key,
        zaehlerart: rep.zaehlerart, pid: rep.pid, aid: rep.aid, pid_nt: rep.pid_nt,
        aid_nt: rep.aid_nt, vl: rep.vl, pg: rep.pg, alb: rep.alb, bonus: rep.bonus ?? 0,
      });
    }
  } else {
    kondRows = enriched.map((r) => ({
      v_von: r.v_von, v_bis: r.v_bis, gebiet: r.gebiet, produkt_key: r.produkt_key,
      zaehlerart: r.zaehlerart, pid: r.pid, aid: r.aid, pid_nt: r.pid_nt, aid_nt: r.aid_nt,
      vl: r.vl, pg: r.pg, alb: r.alb, bonus: r.bonus ?? 0,
    }));
  }

  return produkteRepo.writeGueltigkeit(sparte, ga, preisRows, kondRows);
}

module.exports = { buildTemplate, saveGueltigkeit, enrich };
