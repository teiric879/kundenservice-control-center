import { S } from './state.js';
import { myRound, addMonthsLastDay, addMonthsPriceGuarantee } from './helpers.js';

// Verbindliche Vertragskonditionen je Produktlinie (vl = Vertragslaufzeit, pg = Preisgarantie, in Monaten).
// Gilt spartenübergreifend für die jeweilige Produktlinie und hat Vorrang vor evtl. abweichenden DB-Werten.
const VERTRAGS_TERMS = {
  Komfort: { vl: 24, pg: 24 },
  Direkt:  { vl: 12, pg: 18 },
};

export function getData() {
  return window.PRODUKTDATEN[S.produkt];
}

export function findRow(rows, ga, verbrauch, gebiet, zaehlerart, plz) {
  const match = r =>
    r.ga === ga && r.vVon <= verbrauch && r.vBis >= verbrauch &&
    (!r.zaehlerart || !zaehlerart || r.zaehlerart === zaehlerart);
  // 1) Exakte PLZ (per-PLZ-Preis externes Gebiet) hat Vorrang
  if (plz) {
    const byPlz = rows.find(r => match(r) && r.plz === plz);
    if (byPlz) return byPlz;
  }
  // 2) Gebiets-Preis (nur Zeilen ohne plz, damit keine fremde PLZ greift)
  const exact = rows.find(r => match(r) && !r.plz && (!r.gebiet || r.gebiet === gebiet));
  if (exact) return exact;
  return rows.find(r => match(r) && !r.plz && r.gebiet === 'übrige') ||
         rows.find(r => match(r) && !r.plz && !r.gebiet) || null;
}

// On-demand geladene per-PLZ-Daten (window.PLZ_CACHE[plz][sparte] = {preise, konditionen})
function plzRows(kind) {
  const c = (typeof window !== 'undefined' && window.PLZ_CACHE) ? window.PLZ_CACHE[S.plz] : null;
  return c && c[S.produkt] ? c[S.produkt][kind] : null;
}

export function findPreisRow(ga, verbrauch, gebiet) {
  const pp = plzRows('preise');
  if (pp) { const hit = findRow(pp, ga, verbrauch, gebiet, S.zaehlerart, S.plz); if (hit) return hit; }
  return findRow(getData().preise, ga, verbrauch, gebiet, S.zaehlerart, null);
}

export function findKondRow(ga, verbrauch, gebiet) {
  const za = S.zaehlerart; // für Heizstrom: WP-ET vs WP-DT haben eigene PID/AID
  const matchZa = r => !r.zaehlerart || !za || r.zaehlerart === za;
  // 1) per-PLZ-Konditionen (exakt, sonst nächstältere)
  const pk = plzRows('konditionen');
  if (pk) {
    const exact = findRow(pk, ga, verbrauch, gebiet, za, S.plz);
    if (exact) return exact;
    const prior = pk
      .filter(r => r.ga <= ga && r.vVon <= verbrauch && r.vBis >= verbrauch && r.plz === S.plz && matchZa(r))
      .sort((a, b) => b.ga.localeCompare(a.ga));
    if (prior[0]) return prior[0];
  }
  // 2) Gebiets-Konditionen
  const rows = getData().konditionen;
  const exact = findRow(rows, ga, verbrauch, gebiet, za, null);
  if (exact) return exact;
  const prior = rows
    .filter(r => r.ga <= ga && r.vVon <= verbrauch && r.vBis >= verbrauch && !r.plz && matchZa(r) &&
                 (!r.gebiet || r.gebiet === gebiet || r.gebiet === 'übrige'))
    .sort((a, b) => b.ga.localeCompare(a.ga));
  return prior[0] ?? null;
}

// Preis-Block {apB,gpB,apNtB,...} → {gp, ap, apNt} im aktuellen ust-Modus.
function ustVal(p, d) {
  const isBrutto = S.ustModus === 'brutto';
  const ap = isBrutto ? p.apB : (p.apN !== undefined ? p.apN : myRound(p.apB / (1 + d.ust / 100), 4));
  const gp = isBrutto ? p.gpB : (p.gpN !== undefined ? p.gpN : myRound(p.gpB / (1 + d.ust / 100), 4));
  const apNt = p.apNtB != null
    ? (isBrutto ? p.apNtB : (p.apNtN !== undefined ? p.apNtN : myRound(p.apNtB / (1 + d.ust / 100), 4)))
    : null;
  return { gp, ap, apNt };
}

// Alle Preis-Staffeln (Verbrauchsbänder) für einen Tarif zu einer Gültigkeit/Gebiet.
// Liefert nach vVon sortiert: [{vVon, vBis, ap, gp}] im aktuellen ust-Modus.
// Für das Vertragsformular, das die komplette Staffel-Tabelle (GP_/VP_ je Band) abbildet.
export function preisTiers(productKey, ga, gebiet) {
  const d = getData();
  const pp = plzRows('preise');
  const source = [...(pp || []), ...d.preise];
  // beste Zeile je Band: exakte PLZ > Gebiet > übrige
  const rank = r => (r.plz && r.plz === S.plz) ? 3 : (r.gebiet === gebiet ? 2 : 1);
  const byBand = {};
  for (const r of source) {
    if (r.ga !== ga || !r[productKey]) continue;
    const okPlz    = r.plz ? r.plz === S.plz : true;
    const okGebiet = r.plz ? true : (!r.gebiet || r.gebiet === gebiet || r.gebiet === 'übrige');
    if (!okPlz || !okGebiet) continue;
    if (r.zaehlerart && S.zaehlerart && r.zaehlerart !== S.zaehlerart) continue;
    const key = r.vVon + '-' + r.vBis;
    if (!byBand[key] || rank(r) > rank(byBand[key])) byBand[key] = r;
  }
  return Object.values(byBand)
    .sort((a, b) => a.vVon - b.vVon)
    .map(r => {
      const { gp, ap } = ustVal(r[productKey], d);
      return { vVon: r.vVon, vBis: r.vBis, ap, gp };
    });
}

// Einzelpreis für einen konkreten Tarif/Zählerart (Heizstrom/SteuVE: eine Staffel).
// zaehlerart optional — wenn gesetzt, muss die Zeile exakt passen. Liefert {gp,ap,apNt} oder null.
export function lookupPrice(productKey, ga, gebiet, zaehlerart) {
  const d = getData();
  const pp = plzRows('preise');
  const source = [...(pp || []), ...d.preise];
  const rank = r => (r.plz && r.plz === S.plz) ? 3 : (r.gebiet === gebiet ? 2 : 1);
  let best = null, bestRank = -1;
  for (const r of source) {
    if (r.ga !== ga || !r[productKey]) continue;
    if (zaehlerart) { if (r.zaehlerart !== zaehlerart) continue; }
    const okPlz    = r.plz ? r.plz === S.plz : true;
    const okGebiet = r.plz ? true : (!r.gebiet || r.gebiet === gebiet || r.gebiet === 'übrige');
    if (!okPlz || !okGebiet) continue;
    const rk = rank(r);
    if (rk > bestRank) { best = r; bestRank = rk; }
  }
  return best ? ustVal(best[productKey], d) : null;
}

// Konditions-Objekt (pid/aid/netzentgeltRed/…) für einen konkreten Tarif zu Gültigkeit/Gebiet.
// Wie lookupPrice, aber über die Konditionen-Tabelle. Liefert das rohe Kond-Objekt oder null.
export function lookupKond(productKey, ga, gebiet) {
  const d = getData();
  const pk = plzRows('konditionen');
  const source = [...(pk || []), ...d.konditionen];
  const rank = r => (r.plz && r.plz === S.plz) ? 3 : (r.gebiet === gebiet ? 2 : 1);
  let best = null, bestRank = -1;
  for (const r of source) {
    if (r.ga !== ga || !r[productKey]) continue;
    const okPlz    = r.plz ? r.plz === S.plz : true;
    const okGebiet = r.plz ? true : (!r.gebiet || r.gebiet === gebiet || r.gebiet === 'übrige');
    if (!okPlz || !okGebiet) continue;
    const rk = rank(r);
    if (rk > bestRank) { best = r; bestRank = rk; }
  }
  return best ? best[productKey] : null;
}

export function calcTarif(preis, kond, productKey, verbrauch, verbrauchNT) {
  const d = getData();
  const p = preis[productKey];
  const k = kond ? kond[productKey] : null;
  if (!p) return null;

  const isBrutto = S.ustModus === 'brutto';
  let ap, gp, apNt = null;

  if (isBrutto) {
    ap   = p.apB;
    gp   = p.gpB;
    apNt = p.apNtB != null ? p.apNtB : null;
  } else {
    ap   = p.apN !== undefined ? p.apN : myRound(p.apB / (1 + d.ust / 100), 4);
    gp   = p.gpN !== undefined ? p.gpN : myRound(p.gpB / (1 + d.ust / 100), 4);
    apNt = p.apNtB != null
      ? (p.apNtN !== undefined ? p.apNtN : myRound(p.apNtB / (1 + d.ust / 100), 4))
      : null;
  }

  let bonus = k ? (k.bonus || 0) : 0;
  if (S.neukundenbonus) {
    const nkbOk = d.nkbSchwelle === 0 || verbrauch > d.nkbSchwelle;
    if (nkbOk) bonus += (preis.bonus || 0);
  }
  if (S.aktionsbonus) bonus += S.aktionsbonusWert;

  let energyEur;
  if (apNt != null && verbrauchNT > 0) {
    energyEur = myRound(ap * verbrauch / 100, 2) + myRound(apNt * verbrauchNT / 100, 2);
  } else {
    energyEur = myRound(ap * verbrauch / 100, 2);
  }

  const jahrespreis = myRound(energyEur + gp * 12 - bonus, 2);
  const monatspreis = myRound(jahrespreis / 12, 2);
  // Kanonische Vertragskonditionen je Produktlinie – maßgeblich, überschreibt abweichende DB-Werte.
  // (Komfort: 24 Mon. Laufzeit + 24 Mon. Preisgarantie; Direkt: 12 Mon. Laufzeit + 18 Mon. Preisgarantie.)
  const term        = VERTRAGS_TERMS[productKey] || null;
  const pg          = term ? term.pg : (k ? (k.pg || 0) : 0);
  const pgLabel     = pg > 0 ? `Preisgarantie ${pg} Monate` : 'eingeschränkte Preisgarantie';
  const vl          = term ? term.vl : (k ? (k.vl || null) : null);

  const vb = S.vertragsbeginn;
  return {
    ap, gp, apNt, bonus, jahrespreis, monatspreis, pg, pgLabel, vl,
    pid:             k ? k.pid             : null,
    aid:             k ? k.aid             : null,
    pidNt:           k ? k.pidNt           : null,
    aidNt:           k ? k.aidNt           : null,
    netzentgeltRed:  k ? k.netzentgeltRed  : null,
    alb:             k ? k.alb             : null,
    vertragsende:    vb && vl ? addMonthsLastDay(vb, vl) : null,
    pgEnde:          vb && pg > 0 ? addMonthsPriceGuarantee(vb, pg) : null,
  };
}

export function calcVergleich(verbrauch) {
  const apB      = S.vergleichFrei.ap;
  const gpB      = S.vergleichFrei.gp;
  const bonusAmt = S.vergleichFrei.bonus || 0;
  if (!apB && !gpB) return null;

  const d        = getData();
  const isBrutto = S.ustModus === 'brutto';
  const ap       = isBrutto ? (apB || 0) : myRound((apB || 0) / (1 + d.ust / 100), 4);
  const gp       = isBrutto ? (gpB || 0) : myRound((gpB || 0) / (1 + d.ust / 100), 4);
  const energyEur   = myRound(ap * verbrauch / 100, 2);
  const jahrespreis = myRound(energyEur + gp * 12 - bonusAmt, 2);
  const monatspreis = myRound(jahrespreis / 12, 2);

  return { name:'Vergleichstarif', ap, gp, bonus:bonusAmt, jahrespreis, monatspreis };
}
