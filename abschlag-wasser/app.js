/* ============================================================================
   Abschlag Wasser  ·  Kundenservice Control Center
   ----------------------------------------------------------------------------
   Bildet die Abschlagberechnung aus dem Tarifblatt „Teilbetrag Wasser
   berechnen" 1:1 nach (WES = Euskirchen-Swisttal, Alfter).

   Verbrauch aus Personen:  m³/Jahr = Personen × 3 × 12  (3 m³/Person/Monat)

   WES   · Frischwasser = m³ × AP + GP(Zählergröße) · Abwasser = m³ × AP
         · Abschlag = Jahressumme ÷ 6   (alle 2 Monate)
   Alfter· Frischwasser = m³ × AP + GP · Abwasser = m³ × AP
         · Oberflächenwasser = fix 84,00 €/Jahr
         · Abschlag = Jahressumme ÷ 12  (monatlich)

   Tarife brutto, Stand Tarifblatt. Keine Rundung (wie Excel).
   ========================================================================== */

'use strict';

var M3_PRO_PERSON_JAHR = 3 * 12;   // 3 m³/Person/Monat → 36 m³/Person/Jahr

var TARIFE = {
  WES: {
    label: 'WES',
    region: 'Euskirchen-Swisttal',
    frischAP: 1.59,          // €/m³
    abwasserAP: 3.04,        // €/m³  (kein Grundpreis)
    oberflJahr: 0,
    hatOberfl: false,
    hatZaehler: true,
    teiler: 6,
    zyklusLabel: 'alle 2 Monate',
    zyklusCaption: 'je 2 Monate',
    zaehler: [
      { id: 'QN2.5', label: 'QN 2,5', gp: 127.80 },
      { id: 'QN6',   label: 'QN 6',   gp: 189.50 },
      { id: 'QN10',  label: 'QN 10',  gp: 314.32 },
      { id: 'QN15',  label: 'QN 15',  gp: 417.68 },
      { id: 'QN40',  label: 'QN 40',  gp: 1299.15 },
      { id: 'QN60',  label: 'QN 60',  gp: 2136.06 }
    ]
  },
  ALFTER: {
    label: 'Alfter',
    region: 'Alfter',
    frischAP: 1.39,          // €/m³
    frischGP: 83.52,         // €/Jahr  (6,96 €/Monat)
    abwasserAP: 3.58,        // €/m³  (kein Grundpreis)
    oberflJahr: 84.00,       // €/Jahr  (7,00 €/Monat, fix)
    hatOberfl: true,
    hatZaehler: false,
    teiler: 12,
    zyklusLabel: 'monatlich',
    zyklusCaption: 'je Monat'
  }
};

/* ── Formatierung ─────────────────────────────────────────────────────────── */
function fmtEuro(n) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtM3(n) {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' m³';
}

/* ── Kernberechnung ───────────────────────────────────────────────────────── */
function berechne(gebiet, verbrauch, zaehlerId) {
  var t = TARIFE[gebiet];
  var frischGP;
  if (t.hatZaehler) {
    var z = t.zaehler.filter(function (x) { return x.id === zaehlerId; })[0] || t.zaehler[0];
    frischGP = z.gp;
  } else {
    frischGP = t.frischGP;
  }

  var frischJahr   = verbrauch * t.frischAP + frischGP;
  var abwasserJahr = verbrauch * t.abwasserAP;
  var oberflJahr   = t.oberflJahr;
  var summeJahr    = frischJahr + abwasserJahr + oberflJahr;

  return {
    frischGP: frischGP,
    frischJahr: frischJahr,
    abwasserJahr: abwasserJahr,
    oberflJahr: oberflJahr,
    summeJahr: summeJahr,
    teiler: t.teiler,
    zyklusLabel: t.zyklusLabel,
    zyklusCaption: t.zyklusCaption,
    abschlagZyklus: summeJahr / t.teiler,
    frischZyklus: frischJahr / t.teiler,
    abwasserZyklus: abwasserJahr / t.teiler,
    oberflZyklus: oberflJahr / t.teiler,
    monatlich: summeJahr / 12
  };
}

/* ── DOM ──────────────────────────────────────────────────────────────────── */
var gebietSel    = document.getElementById('gebietSel');
var zaehlerSel   = document.getElementById('zaehlerSel');
var grpZaehler   = document.getElementById('grpZaehler');
var personenInp  = document.getElementById('personenInput');
var m3Inp        = document.getElementById('m3Input');
var btnReset     = document.getElementById('btnReset');
var emptyState   = document.getElementById('emptyState');
var cardWrap     = document.getElementById('cardWrap');
var resultCard   = document.getElementById('resultCard');
var resultMeta   = document.getElementById('resultMeta');

var basis = null;   // 'personen' | 'm3'

/* Zählergrößen-Select je Gebiet füllen */
function fuelleZaehler() {
  var t = TARIFE[gebietSel.value];
  if (!t.hatZaehler) { grpZaehler.style.display = 'none'; return; }
  grpZaehler.style.display = '';
  if (zaehlerSel.options.length !== t.zaehler.length) {
    zaehlerSel.innerHTML = t.zaehler.map(function (z) {
      return '<option value="' + z.id + '">' + z.label + ' · ' + fmtEuro(z.gp) + '/Jahr</option>';
    }).join('');
    zaehlerSel.value = t.zaehler[0].id;   // Standard QN 2,5
  }
}

/* Verwendeten Verbrauch aus dem aktuellen Eingabe-Zustand ermitteln */
function ermittleVerbrauch() {
  if (basis === 'personen') {
    var p = parseFloat(personenInp.value);
    if (!isFinite(p) || p <= 0) return null;
    return { verbrauch: p * M3_PRO_PERSON_JAHR, personen: p };
  }
  if (basis === 'm3') {
    var m = parseFloat(m3Inp.value);
    if (!isFinite(m) || m < 0) return null;
    return { verbrauch: m, personen: null };
  }
  return null;
}

/* ── Render ───────────────────────────────────────────────────────────────── */
function render() {
  fuelleZaehler();
  var t = TARIFE[gebietSel.value];
  var input = ermittleVerbrauch();

  if (!input) {
    cardWrap.style.display = 'none';
    emptyState.style.display = '';
    resultMeta.textContent = '';
    return;
  }

  var r = berechne(gebietSel.value, input.verbrauch, zaehlerSel.value);
  var basisText = input.personen != null
    ? input.personen.toLocaleString('de-DE') + (input.personen === 1 ? ' Person' : ' Personen') + ' × ' + M3_PRO_PERSON_JAHR + ' m³'
    : 'Direkte m³-Eingabe';

  var rows = [];

  // Kontext
  rows.push(row('Versorgungsgebiet', t.region && t.region !== t.label ? t.label + ' · ' + t.region : t.label));
  if (t.hatZaehler) {
    var zLabel = (zaehlerSel.options[zaehlerSel.selectedIndex] || {}).text || '';
    rows.push(row('Zählergröße', zLabel.split(' · ')[0]));
  }
  rows.push(row('Verwendeter Verbrauch', fmtM3(input.verbrauch) + ' / Jahr'));
  rows.push(row('Berechnungsbasis', basisText));

  // Jahreskosten (Zwischensummen)
  rows.push(sep('Jahreskosten'));
  rows.push(row('Frischwasser', fmtEuro(r.frischJahr)));
  rows.push(row('Abwasser', fmtEuro(r.abwasserJahr)));
  if (t.hatOberfl) rows.push(row('Oberflächen-/Niederschlagswasser', fmtEuro(r.oberflJahr)));
  rows.push(row('Summe pro Jahr', fmtEuro(r.summeJahr), 'highlight'));

  // Abschlag-Aufschlüsselung pro Zyklus
  rows.push(sep('Abschlag ' + r.zyklusLabel));
  rows.push(row('davon Frischwasser', fmtAbschlag(r.frischZyklus)));
  rows.push(row('davon Abwasser', fmtAbschlag(r.abwasserZyklus)));
  if (t.hatOberfl) rows.push(row('davon Oberflächenwasser', fmtAbschlag(r.oberflZyklus)));

  resultCard.innerHTML =
    '<div class="card-hdr">' +
      '<div class="prod-name">Wasser-Abschlag · ' + esc(t.label) + '</div>' +
      '<div class="card-hero">' +
        '<div class="price-main"><span class="amount">' + esc(fmtAbschlagNoUnit(r.abschlagZyklus)) + '</span><span class="currency">€</span></div>' +
        '<div class="price-caption">' + esc(r.zyklusLabel) + ' · ' + esc(r.zyklusCaption) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="month-band">' +
      '<div class="mb-lbl">Monatlicher Vergleichswert</div>' +
      '<div class="mb-val">' + esc(fmtAbschlag(r.monatlich)) + '<small> / Monat</small></div>' +
    '</div>' +
    '<div class="card-body">' + rows.join('') + '</div>';

  resultMeta.innerHTML = 'Abrechnung <strong>' + esc(r.zyklusLabel) + '</strong>';
  emptyState.style.display = 'none';
  cardWrap.style.display = '';
}

function row(lbl, val, cls) {
  return '<div class="card-row' + (cls ? ' ' + cls : '') + '"><span class="lbl">' + esc(lbl) + '</span><span class="val">' + esc(val) + '</span></div>';
}
function sep(title) {
  return '<div class="card-row group-sep"><span class="lbl">' + esc(title) + '</span><span class="val"></span></div>';
}
function fmtNoUnit(n) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtAbschlag(n) {
  return Math.ceil(n).toLocaleString('de-DE') + ' €';
}
function fmtAbschlagNoUnit(n) {
  return Math.ceil(n).toLocaleString('de-DE');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ── Events ───────────────────────────────────────────────────────────────── */
gebietSel.addEventListener('change', render);
zaehlerSel.addEventListener('change', render);

personenInp.addEventListener('input', function () {
  basis = 'personen';
  var p = parseFloat(personenInp.value);
  // m³-Feld spiegeln, damit der Berater den abgeleiteten Verbrauch sieht
  m3Inp.value = (isFinite(p) && p > 0) ? String(p * M3_PRO_PERSON_JAHR) : '';
  render();
});

m3Inp.addEventListener('input', function () {
  basis = 'm3';
  // Personenfeld leeren – Basis ist jetzt der direkte Verbrauch
  personenInp.value = '';
  render();
});

btnReset.addEventListener('click', function () {
  basis = null;
  personenInp.value = '';
  m3Inp.value = '';
  gebietSel.value = 'WES';
  render();
  personenInp.focus();
});

/* ── Init ─────────────────────────────────────────────────────────────────── */
fuelleZaehler();
render();
