import { S } from './modules/state.js';
import { plzToGebiet, plzToStadt } from './modules/plz.js';
import { debounce, dateFmt, copyVal } from './modules/helpers.js';
import { getData, findPreisRow, findKondRow, calcTarif, calcVergleich } from './modules/calc.js?v=20260624c';
import { buildCard } from './modules/render.js?v=20260630a';
import { openPdfModal } from './modules/pdf-modal.js?v=20260630a';
import { lookupEnet } from './modules/enet.js?v=20260630a';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const API_BASE = LOCAL_HOSTS.includes(location.hostname) ? `http://${location.hostname}:3001` : '';

// Produktdaten aus API laden. Der statische data.js-Fallback wird NUR nachgeladen, wenn
// die API nicht erreichbar ist → spart die ~16 KB auf dem Normalpfad (online).
try {
  const resp = await fetch(`${API_BASE}/api/produktdaten`);
  if (resp.ok) window.PRODUKTDATEN = await resp.json();
} catch { /* API nicht erreichbar */ }
if (!window.PRODUKTDATEN) {
  // data.js setzt window.PRODUKTDATEN als Seiteneffekt; erst jetzt (offline-Fallback) laden.
  await new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'data.js'; s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
}

// Vertragsformulare laden → window.VERTRAG_MAP['sparte-ProduktKey'] = [{id, name, ...}]
window.VERTRAG_MAP = {};
try {
  const resp = await fetch(`${API_BASE}/api/vertragsformulare`);
  if (resp.ok) {
    const j = await resp.json();
    for (const item of (j.items || [])) {
      const key = `${item.sparte}-${item.produkt_key}`;
      if (!window.VERTRAG_MAP[key]) window.VERTRAG_MAP[key] = [];
      window.VERTRAG_MAP[key].push(item);
    }
  }
} catch { /* offline – kein Formular-Popup */ }

// Per-PLZ-Preise (volle Historie) werden on-demand je PLZ geladen und gecacht.
window.PLZ_CACHE = window.PLZ_CACHE || {};
async function loadPlzData(plz) {
  if (!/^\d{5}$/.test(plz) || window.PLZ_CACHE[plz]) return;
  try {
    const r = await fetch(`${API_BASE}/api/plzpreise?plz=${plz}`);
    if (r.ok) { const j = await r.json(); if (j.ok) window.PLZ_CACHE[plz] = j.sparten; }
  } catch { /* offline – Gebiets-Fallback greift */ }
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const gueltigkeitSel      = $('gueltigkeitSel');
const verbrauchInput      = $('verbrauchInput');
const verbrauchNTInput    = $('verbrauchNTInput');
const plzInput            = $('plzInput');
const plzStadt            = $('plzStadt');
const vertragsbeginnInput = $('vertragsbeginnInput');
// zaehlerSel entfernt – Messungsart jetzt über Pill-Buttons
const radioNetto          = $('radioNetto');
const radioBrutto         = $('radioBrutto');
const chkNKB              = $('chkNKB');
const chkAB               = $('chkAB');
const grpAktionsbonusWert = $('grpAktionsbonusWert');
const aktionsbonusWert    = $('aktionsbonusWert');
const personenInput       = $('personenInput');
const flaecheInput        = $('flaecheInput');
const chkDLE              = $('chkDLE');
const vergleichAP         = $('vergleichAP');
const vergleichAPNT       = $('vergleichAPNT');
const vergleichGP         = $('vergleichGP');
const vergleichBonus      = $('vergleichBonus');
const emptyState          = $('emptyState');
const warnBox             = $('warnBox');
const cardsWrap           = $('cardsWrap');
const cardsGrid           = $('cardsGrid');
const resultMeta          = $('resultMeta');
const panelTitle          = $('panelTitle');
const tabStrip            = $('tabStrip');
const mainContent         = $('mainContent');
const marketBar           = $('marketBar');
const enetPlzEl           = $('enetPlz');

cardsGrid.addEventListener('click', e => {
  const copyBtn = e.target.closest('.copy-btn');
  if (copyBtn) {
    copyVal(copyBtn.dataset.copy);
    copyBtn.classList.add('copied');
    setTimeout(() => copyBtn.classList.remove('copied'), 1400);
    return;
  }
  const vertragBtn = e.target.closest('.btn-vertrag:not([disabled])');
  if (vertragBtn) openPdfModal(vertragBtn);
});

// ── Tab ───────────────────────────────────────────────────────────────────────
function applyTab() {
  mainContent.classList.toggle('tab-sach', S.tab === 'sach');
  tabStrip.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === S.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

// ── PLZ / Gebiet ──────────────────────────────────────────────────────────────
function updateGebietBadge() {
  const d = getData();
  if (S.plz.length === 5) {
    const raw   = plzToGebiet(S.plz);
    const stadt = plzToStadt(S.plz);
    S.gebiet    = (d.gebiete && d.gebiete.includes(raw)) ? raw : 'übrige';
    plzStadt.textContent    = stadt || '';
    plzStadt.style.display  = stadt ? '' : 'none';
  } else {
    S.gebiet = 'übrige';
    plzStadt.textContent   = '';
    plzStadt.style.display = 'none';
  }
}

// ── Netzbetreiber / Grundversorger (untere Leiste) ──────────────────────────
const ICON_TEL  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const ICON_WEB  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>';

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

// op = {name, tel?, url?, email?}. Zeigt nur tatsächlich vorhandene Kontaktinfos (kein Ort).
function fmtOp(op) {
  if (!op || !op.name) return '<span class="enet-empty">–</span>';
  let meta = '';
  if (op.tel) {
    meta += `<a class="enet-link" href="tel:${escHtml(op.tel.replace(/\s/g, ''))}">${ICON_TEL}${escHtml(op.tel)}</a>`;
  }
  if (op.url) {
    const raw   = String(op.url).trim();
    const href  = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;     // sonst wäre der Link relativ → 404
    const label = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');  // www.xxx.xx (Domain ohne Protokoll/Pfad)
    meta += `<a class="enet-link" href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${ICON_WEB}${escHtml(label)}</a>`;
  }
  if (op.email) {
    meta += `<a class="enet-link" href="mailto:${escHtml(op.email)}">${ICON_MAIL}${escHtml(op.email)}</a>`;
  }
  return `<span class="enet-name">${escHtml(op.name)}</span>${meta ? `<span class="enet-meta">${meta}</span>` : ''}`;
}

let _enetReqId = 0;
async function updateEnetBar(plz) {
  const setVals = (d) => {
    $('enetStromNb').innerHTML = fmtOp(d?.strom?.nb);
    $('enetStromGv').innerHTML = fmtOp(d?.strom?.gv);
    $('enetGasNb').innerHTML   = fmtOp(d?.gas?.nb);
    $('enetGasGv').innerHTML   = fmtOp(d?.gas?.gv);
  };
  if (!/^\d{5}$/.test(plz)) { enetPlzEl.textContent = ''; setVals(null); return; }
  const reqId = ++_enetReqId;
  const data = await lookupEnet(plz);
  if (reqId !== _enetReqId) return;            // veraltete Antwort verwerfen
  const ort = (data && data.ort) || plzToStadt(plz) || '';
  enetPlzEl.textContent = ort ? `${plz} · ${ort}` : plz;   // Format: Zahlen + Stadt, ohne „PLZ"
  setVals(data);
}

// ── UI population ─────────────────────────────────────────────────────────────
function populateGueltigkeiten() {
  const d = getData();
  const sorted = [...d.gueltigkeiten].sort((a, b) => b.localeCompare(a));
  gueltigkeitSel.innerHTML = '';
  for (const ga of sorted) {
    const opt = document.createElement('option');
    opt.value       = ga;
    opt.textContent = dateFmt(ga);
    gueltigkeitSel.appendChild(opt);
  }
  S.gueltigAb          = sorted[0];
  gueltigkeitSel.value = S.gueltigAb;
}

function updatePanelForProduct() {
  const d    = getData();
  panelTitle.textContent = d.label;

  const isHz = S.produkt === 'heizstrom';
  const isSV = S.produkt === 'steuve';
  const isNS = isHz && S.hzTyp === 'NS';
  const isWP = isHz && S.hzTyp === 'WP';
  // DT: WP mit Doppeltarifzähler, gemeinsame Messung (immer DT) oder NS getrennt mit DT-Zähler
  const isDT = (isWP && S.zaehlerart === 'Doppeltarif') || (isNS && (S.messung === 'gemeinschaft' || S.zaehlerart === 'Doppeltarif'));

  $('grpHzTyp').style.display       = isHz ? '' : 'none';
  $('grpMessung').style.display     = isNS ? '' : 'none';
  // Zählerart-Wahl für WP (ET/DT-Zähler) und für Nachtspeicher + Getrennte Messung
  $('grpZaehlerart').style.display  = (isWP || (isNS && S.messung === 'getrennt')) ? '' : 'none';
  $('grpVerbrauchNT').style.display = isDT ? '' : 'none';
  // NT-Arbeitspreis des Vergleichstarifs nur bei HT/NT-Tarifen (Doppeltarif) anbieten
  $('grpVergleichNT').style.display = isDT ? '' : 'none';
  $('grpSteuveTyp').style.display    = isSV ? '' : 'none';
  $('grpSteuveModul').style.display  = isSV ? '' : 'none';

  // Verbrauchsvorschlag: nur Strom (Personen) und Erdgas (Wohnfläche)
  const isStrom = S.produkt === 'strom';
  const isGas   = S.produkt === 'gas';
  $('grpVerbrauchHelfer').style.display   = (isStrom || isGas) ? '' : 'none';
  $('grpVerbrauchPersonen').style.display = isStrom ? '' : 'none';
  $('grpVerbrauchFlaeche').style.display  = isGas   ? '' : 'none';
  // Veraltete Vorschlag-Eingaben beim Spartenwechsel leeren
  if (!isStrom) personenInput.value = '';
  if (!isGas)   flaecheInput.value  = '';

  const defaultV = { gas:20000, strom:2500, heizstrom:8000, autostrom:2000, steuve:5000 };
  const dv = defaultV[S.produkt] || 5000;
  verbrauchInput.placeholder = String(dv);
  verbrauchInput.value       = String(dv);
  S.verbrauch = dv;

  updateGebietBadge();
}

// ── Calculate & render ────────────────────────────────────────────────────────
function showEmpty() {
  emptyState.style.display = '';
  warnBox.style.display    = 'none';
  cardsWrap.style.display  = 'none';
  marketBar.style.display  = 'none';
}

function showWarn(msg) {
  warnBox.textContent      = msg;
  warnBox.style.display    = 'block';
  emptyState.style.display = 'none';
  cardsWrap.style.display  = 'none';
  marketBar.style.display  = 'flex';
}

function calculate() {
  const d      = getData();
  const ga     = S.gueltigAb;
  const v      = S.verbrauch;
  const vNT    = S.verbrauchNT || 0;
  const gebiet = S.gebiet;

  if (!v || v <= 0) { showEmpty(); return; }

  // Vollständige PLZ außerhalb des e-regio-Belieferungsgebiets (∉ PLZ_DATA): keine Tarife,
  // aber die untere Leiste (NB/GV) bleibt sichtbar.
  if (S.plz && S.plz.length === 5 && plzToStadt(S.plz) === null) {
    showWarn('PLZ nicht im Belieferungsgebiet.');
    return;
  }

  const preisRow = findPreisRow(ga, v, gebiet);
  const kondRow  = findKondRow(ga, v, gebiet);

  if (!preisRow) {
    showWarn(`Keine Preisdaten für ${dateFmt(ga)}, ${v.toLocaleString('de-DE')} kWh/a, Gebiet „${gebiet}".`);
    return;
  }

  warnBox.style.display = 'none';
  emptyState.style.display = 'none';
  cardsWrap.style.display = 'flex';
  cardsWrap.style.flexDirection = 'column';
  marketBar.style.display = 'flex';

  const ustText    = S.ustModus === 'brutto' ? `${d.ust}% MwSt. inkl.` : `${d.ust}% MwSt. exkl.`;
  const gebietInfo = S.plz ? ` · PLZ ${S.plz} → ${gebiet}` : ` · ${gebiet}`;
  resultMeta.innerHTML =
    `Gültig ab <strong>${dateFmt(ga)}</strong>` +
    ` · <strong>${v.toLocaleString('de-DE')} kWh/a</strong>` +
    (vNT > 0 ? ` HT + <strong>${vNT.toLocaleString('de-DE')} kWh/a NT</strong>` : '') +
    `${gebietInfo} · ${ustText}`;

  const _vis = JSON.parse(localStorage.getItem('admin-produkt-vis') || '{}');
  const isVisible = (sparte, pk) => _vis[sparte + '-' + pk] !== false;

  // SteuVE: Produkt-Keys folgen nicht 1:1 der Modul-Nummerierung (WP Modul 2 → 'WP-M3')
  const STEUVE_KEY = {
    'WP-1': 'WP-M1', 'WP-2': 'WP-M3',
    'Wallbox-1': 'Wallbox-M1', 'Wallbox-2': 'Wallbox-M2',
  };
  let produkte;
  if (S.produkt === 'steuve') {
    produkte = [STEUVE_KEY[`${S.steuveTyp}-${S.steuveModul}`] ?? `${S.steuveTyp}-M${S.steuveModul}`];
  } else if (S.produkt === 'heizstrom') {
    // WP-Typ → WP; Nachtspeicher: gemeinschaft → NS-Gem, getrennt → NS-Get
    const hzPk = S.hzTyp !== 'NS'              ? 'WP'
               : S.messung === 'gemeinschaft'   ? 'NS-Gem'
               :                                  'NS-Get';
    produkte = [hzPk].filter(pk => isVisible('heizstrom', pk));
  } else {
    produkte = [...d.produkte].filter(pk => isVisible(S.produkt, pk));
  }

  // Vergleichstarif vorab berechnen → jede e-regio-Karte zeigt die Ersparnis dagegen.
  const vgl = calcVergleich(v, vNT);

  let html = '';
  let delay = 0;
  for (const pk of produkte) {
    const result = calcTarif(preisRow, kondRow, pk, v, vNT);
    if (!result) continue;
    html += buildCard(pk, d.labels[pk] || pk, result, false, delay * 0.06, vgl);
    delay++;
  }

  if (vgl) {
    html += buildCard('__vgl__', 'Vergleichstarif', {
      ...vgl, pgLabel:'Vergleichspreis', vl:null, pid:null, aid:null,
    }, true, delay * 0.06);
  }

  cardsGrid.innerHTML = html;
  applyTab();
}

function switchProduct(p) {
  S.produkt = p;
  document.querySelectorAll('.prod-pills .pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.p === p);
  });
  if (p === 'heizstrom') {
    S.hzTyp      = 'WP';
    S.messung    = 'getrennt';
    S.zaehlerart = 'Einzeltarif';
    $('hzTypPills').querySelectorAll('.pill-sm').forEach(b =>
      b.classList.toggle('active', b.dataset.hztyp === 'WP'));
    $('messungPills').querySelectorAll('.pill-sm').forEach(b =>
      b.classList.toggle('active', b.dataset.messung === 'getrennt'));
    $('zaehlerartPills').querySelectorAll('.pill-sm').forEach(b =>
      b.classList.toggle('active', b.dataset.za === 'Einzeltarif'));
  }
  populateGueltigkeiten();
  updatePanelForProduct();
  calculate();
}

// ── Event listeners ──────────────────────────────────────────────────────────
$('prodPills').addEventListener('click', e => {
  const btn = e.target.closest('.pill');
  if (btn) switchProduct(btn.dataset.p);
});

plzInput.addEventListener('input', debounce(async () => {
  S.plz = plzInput.value.replace(/\D/g, '').slice(0, 5);
  plzInput.value = S.plz;
  updateGebietBadge();
  updateEnetBar(S.plz);
  await loadPlzData(S.plz);
  calculate();
}, 250));

verbrauchInput.addEventListener('input', debounce(() => {
  S.verbrauch = parseFloat(verbrauchInput.value) || 0;
  calculate();
}, 400));
// Manuelle kWh-Eingabe = bewusst „Jahresverbrauch": das Personen-Helferfeld leeren, damit NIE
// beide Felder gleichzeitig zählen (sonst rechnete der Durchlauferhitzer pro Person statt einmalig).
// Focus-Handler greift schon beim Klick ins Feld, input-Handler beim Tippen,
// pageshow löscht bfcache-restaurierte Stale-Werte (Browser Back/Forward-Cache).
verbrauchInput.addEventListener('focus', () => { if (personenInput) personenInput.value = ''; });
verbrauchInput.addEventListener('input', () => { if (personenInput) personenInput.value = ''; });
window.addEventListener('pageshow', () => { if (personenInput) personenInput.value = ''; });

verbrauchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { S.verbrauch = parseFloat(verbrauchInput.value) || 0; calculate(); }
});

// ── Verbrauchsvorschlag (Strom: Personen · Erdgas: Wohnfläche) ───────────────
// Befüllt nur das zentrale kWh-Feld. Prinzip „letzte bewusste Eingabe gewinnt":
// jede Eingabe (kWh, Personen, Fläche, Durchlauferhitzer) setzt S.verbrauch direkt.

// Strom: 1 Pers=1500, +1000 je weitere Person; Durchlauferhitzer +300 kWh PRO PERSON (Personen-Schätzung)
function vorschlagStrom(personen, dle) {
  if (!personen || personen < 1) return 0;
  const basis = 1000 * personen + 500;          // 1→1500, 2→2500, … 6→6500
  return basis + (dle ? 300 * personen : 0);
}

// Erdgas: stückweise lineare Interpolation über die Richtwert-Anker.
// Rechnerische Zwischen-/Extrapolationswerte werden immer auf die nächste
// volle 1000 aufgerundet (z. B. 90 m² → 10.600 → 11.000). Die vorgegebenen
// Anker sind bereits glatte 1000er und bleiben dadurch exakt erhalten.
const GAS_ANKER = [[50,5000],[100,12000],[150,18000],[180,20000],[200,24000],[250,30000]];
const auf1000 = v => Math.ceil(v / 1000) * 1000;
function vorschlagGas(qm) {
  if (!qm || qm <= 0) return 0;
  const a = GAS_ANKER;
  if (qm <= a[0][0]) return auf1000(qm * (a[0][1] / a[0][0]));   // ≤50: 100 kWh/m²
  for (let i = 1; i < a.length; i++) {
    if (qm <= a[i][0]) {
      const [x0, y0] = a[i - 1], [x1, y1] = a[i];
      return auf1000(y0 + (y1 - y0) * (qm - x0) / (x1 - x0));
    }
  }
  const [x0, y0] = a[a.length - 2], [x1, y1] = a[a.length - 1];   // >250 extrapolieren
  return auf1000(y1 + (y1 - y0) * (qm - x1) / (x1 - x0));
}

function applyVerbrauchVorschlag(v) {
  if (!v || v <= 0) return;                 // leere Eingabe überschreibt nichts
  verbrauchInput.value = String(v);         // ins zentrale Feld schreiben
  S.verbrauch = v;
  calculate();                              // bestehende Berechnung, unverändert
}

personenInput.addEventListener('input', () => {
  const p = parseInt(personenInput.value, 10);
  applyVerbrauchVorschlag(vorschlagStrom(p, S.durchlauferhitzer));
});
flaecheInput.addEventListener('input', () => {
  applyVerbrauchVorschlag(vorschlagGas(parseFloat(flaecheInput.value)));
});
// Durchlauferhitzer – ZUSTANDSLOS anhand des Personen-Felds entscheiden:
//   • Personen-Feld gefüllt (Verbrauch über Personenanzahl ermittelt) → +300 kWh PRO PERSON
//   • Personen-Feld leer (nur manueller Jahresverbrauch)            → EINMALIG +300 kWh
// Da eine manuelle kWh-Eingabe das Personen-Feld leert, zählen nie beide gleichzeitig.
bindCheckbox(chkDLE, 'durchlauferhitzer', v => {
  S.durchlauferhitzer = v;
  const p = parseInt(personenInput.value, 10);
  if (p >= 1) {
    applyVerbrauchVorschlag(vorschlagStrom(p, v));                              // +300 pro Person
  } else {
    const cur = parseFloat(verbrauchInput.value) || 0;
    if (cur > 0) applyVerbrauchVorschlag(Math.max(0, cur + (v ? 300 : -300)));  // einmalig +300
  }
});

verbrauchNTInput.addEventListener('input', debounce(() => {
  S.verbrauchNT = parseFloat(verbrauchNTInput.value) || 0;
  calculate();
}, 400));

gueltigkeitSel.addEventListener('change', () => {
  S.gueltigAb = gueltigkeitSel.value;
  calculate();
});

$('hzTypPills').addEventListener('click', e => {
  const btn = e.target.closest('.pill-sm[data-hztyp]');
  if (!btn) return;
  S.hzTyp = btn.dataset.hztyp;
  $('hzTypPills').querySelectorAll('.pill-sm').forEach(b =>
    b.classList.toggle('active', b.dataset.hztyp === S.hzTyp));
  // Zählerart zurücksetzen; bei NS zusätzlich Messung zurücksetzen
  S.zaehlerart = 'Einzeltarif';
  $('zaehlerartPills').querySelectorAll('.pill-sm').forEach(b =>
    b.classList.toggle('active', b.dataset.za === 'Einzeltarif'));
  if (S.hzTyp === 'NS') {
    S.messung = 'getrennt';
    $('messungPills').querySelectorAll('.pill-sm').forEach(b =>
      b.classList.toggle('active', b.dataset.messung === 'getrennt'));
  }
  updatePanelForProduct();
  calculate();
});

$('messungPills').addEventListener('click', e => {
  const btn = e.target.closest('.pill-sm[data-messung]');
  if (!btn) return;
  S.messung = btn.dataset.messung;
  $('messungPills').querySelectorAll('.pill-sm').forEach(b =>
    b.classList.toggle('active', b.dataset.messung === S.messung));
  // Gemeinsame Messung ist immer Doppeltarif
  if (S.messung === 'gemeinschaft') S.zaehlerart = 'Doppeltarif';
  updatePanelForProduct();
  calculate();
});

$('zaehlerartPills').addEventListener('click', e => {
  const btn = e.target.closest('.pill-sm[data-za]');
  if (!btn) return;
  S.zaehlerart = btn.dataset.za;
  $('zaehlerartPills').querySelectorAll('.pill-sm').forEach(b =>
    b.classList.toggle('active', b.dataset.za === S.zaehlerart));
  updatePanelForProduct();
  calculate();
});

// Vergleichstarif-Labels an die aktuelle Steuerbasis anpassen
function updateVergleichLabels() {
  const t = S.ustModus; // 'brutto' | 'netto'
  $('lblVglAP').textContent   = `AP (ct/kWh ${t})`;
  $('lblVglGP').textContent   = `GP (€/Monat ${t})`;
  $('lblVglAPNT').textContent = `AP NT (ct/kWh ${t})`;
}

// Steuerbasis wechseln. Rechnet die Vergleichstarif-Eingaben (AP, GP, AP NT) in die
// neue Basis um, damit sie weiter zur jeweils gewählten Steuer passen. Der Bonus
// (€ einmalig) bleibt als Pauschalbetrag unverändert. Der Guard verhindert doppelte
// Umrechnung, wenn Label-Klick UND Radio-„change" denselben Wechsel auslösen.
function switchUstMode(mode) {
  if (mode === S.ustModus) return;
  const factor = 1 + getData().ust / 100;
  const conv = v => mode === 'brutto'
    ? Math.round(v * factor * 100) / 100
    : Math.round(v / factor * 100) / 100;
  for (const el of [vergleichAP, vergleichGP, vergleichAPNT]) {
    const raw = parseFloat(el.value);
    if (!isNaN(raw) && raw !== 0) el.value = String(conv(raw));
  }
  S.vergleichFrei = {
    ap:    parseFloat(vergleichAP.value)    || null,
    apNt:  parseFloat(vergleichAPNT.value)  || null,
    gp:    parseFloat(vergleichGP.value)    || null,
    bonus: parseFloat(vergleichBonus.value) || 0,
  };
  S.ustModus = mode;
  document.querySelector(`input[name="ust"][value="${mode}"]`).checked = true;
  radioNetto.classList.toggle('sel', mode === 'netto');
  radioBrutto.classList.toggle('sel', mode === 'brutto');
  updateVergleichLabels();
  calculate();
}

document.querySelectorAll('input[name="ust"]').forEach(radio => {
  radio.addEventListener('change', () => switchUstMode(radio.value));
});
radioNetto.addEventListener('click', () => switchUstMode('netto'));
radioBrutto.addEventListener('click', () => switchUstMode('brutto'));

function bindCheckbox(labelEl, inputId, onToggle) {
  const input = $(inputId);
  // change-Event statt click auf Label: der Browser toggled input.checked nativ (Nested-Input),
  // change feuert genau einmal mit dem finalen Wert — kein double-fire durch Bubbling.
  input.addEventListener('change', () => {
    labelEl.classList.toggle('sel', input.checked);
    onToggle(input.checked);
  });
}
bindCheckbox(chkNKB, 'neukundenbonus', v => { S.neukundenbonus = v; calculate(); });
bindCheckbox(chkAB,  'aktionsbonus',   v => {
  S.aktionsbonus = v;
  grpAktionsbonusWert.style.display = v ? '' : 'none';
  calculate();
});
aktionsbonusWert.addEventListener('input', debounce(() => {
  S.aktionsbonusWert = parseFloat(aktionsbonusWert.value) || 0;
  calculate();
}, 300));

$('steuveTypPills').addEventListener('click', e => {
  const btn = e.target.closest('.pill-sm[data-typ]');
  if (!btn) return;
  S.steuveTyp = btn.dataset.typ;
  $('steuveTypPills').querySelectorAll('.pill-sm').forEach(b =>
    b.classList.toggle('active', b.dataset.typ === S.steuveTyp));
  calculate();
});

$('steuveModulPills').addEventListener('click', e => {
  const btn = e.target.closest('.pill-sm[data-modul]');
  if (!btn) return;
  S.steuveModul = parseInt(btn.dataset.modul, 10);
  $('steuveModulPills').querySelectorAll('.pill-sm').forEach(b =>
    b.classList.toggle('active', b.dataset.modul === String(S.steuveModul)));
  calculate();
});

[vergleichAP, vergleichAPNT, vergleichGP, vergleichBonus].forEach(el => {
  el.addEventListener('input', debounce(() => {
    S.vergleichFrei = {
      ap:    parseFloat(vergleichAP.value)    || null,
      apNt:  parseFloat(vergleichAPNT.value)  || null,
      gp:    parseFloat(vergleichGP.value)    || null,
      bonus: parseFloat(vergleichBonus.value) || 0,
    };
    calculate();
  }, 400));
});

// ── GP-Komfort: Jahresgrundpreis automatisch in Monatswert umrechnen ─────────
// Beim Verlassen des Feldes (change) gilt: Werte ab 60 € werden als Jahresbetrag
// gedeutet und durch 12 geteilt; ein dezenter Toast bestätigt die Umrechnung.
// switchUstMode() setzt el.value programmatisch (kein change-Event) → kein Konflikt.
let gpHintT;
function showGpHint(monthly) {
  const el = $('vglGpHint');
  const fmt = monthly.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  el.innerHTML =
    `<svg class="gp-hint-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8.5 12.2 11 14.6 15.6 9.4"/></svg>` +
    `<span>Jahresgrundpreis erkannt – automatisch in <strong>${fmt} €/Monat</strong> umgerechnet.</span>`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(gpHintT);
  gpHintT = setTimeout(() => el.classList.remove('show'), 2000);
}
vergleichGP.addEventListener('change', () => {
  const raw = parseFloat(vergleichGP.value);
  if (isNaN(raw) || raw < 60) return;            // < 60 → unverändert (Monatswert)
  const monthly = Math.round(raw / 12 * 100) / 100;
  vergleichGP.value = String(monthly);           // Monatswert zurückschreiben
  S.vergleichFrei.gp = monthly;
  calculate();                                   // bestehende Neuberechnung
  showGpHint(monthly);
});

tabStrip.addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (btn) { S.tab = btn.dataset.tab; applyTab(); }
});

vertragsbeginnInput.addEventListener('change', () => {
  S.vertragsbeginn = vertragsbeginnInput.value;
  calculate();
});

// ── Number-Stepper ──────────────────────────────────────────────────────────
// Ersetzt die nativen, billig wirkenden Browser-Spinner durch eigene Hoch/Runter-
// Tasten. Klick triggert ein 'input'-Event, damit die Live-Berechnung greift.
const CHEVRON_UP   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>`;
const CHEVRON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
function enhanceNumberInputs() {
  document.querySelectorAll('input[type=number].field-input').forEach(inp => {
    if (inp.dataset.stepped) return;
    if (inp.closest('.market-bar')) return;   // Vergleichstarif: nur Zahleneingabe, keine Stepper-Pfeile
    inp.dataset.stepped = '1';

    // Positionierungs-Kontext sicherstellen: vorhandene .input-unit nutzen,
    // bare Inputs in einen .num-field-Wrapper packen.
    let host = inp.closest('.input-unit');
    if (host) host.classList.add('has-stepper');
    else {
      host = document.createElement('div');
      host.className = 'num-field';
      inp.parentNode.insertBefore(host, inp);
      host.appendChild(inp);
    }

    const stepper = document.createElement('div');
    stepper.className = 'num-stepper';
    stepper.innerHTML =
      `<button type="button" class="num-step up" tabindex="-1" aria-label="Wert erhöhen">${CHEVRON_UP}</button>` +
      `<button type="button" class="num-step down" tabindex="-1" aria-label="Wert verringern">${CHEVRON_DOWN}</button>`;
    host.appendChild(stepper);

    const fire = fn => () => {
      try { inp[fn](); } catch { /* min/max o. Ä. */ }
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    stepper.querySelector('.up').addEventListener('click', fire('stepUp'));
    stepper.querySelector('.down').addEventListener('click', fire('stepDown'));
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  enhanceNumberInputs();
  const today = new Date().toISOString().slice(0, 10);
  vertragsbeginnInput.value = today;
  S.vertragsbeginn = today;
  verbrauchInput.value = '20000';
  S.verbrauch = 20000;
  S.plz = '53879';
  plzInput.value = '53879';
  updateEnetBar(S.plz);               // NB/GV-Leiste sofort für die Default-PLZ füllen
  const urlP = new URLSearchParams(location.search).get('p');
  const valid = ['gas','strom','heizstrom','autostrom','steuve'];
  switchProduct(valid.includes(urlP) ? urlP : 'gas');
}

init();
// Default-PLZ-Daten laden und neu berechnen, sobald verfügbar
loadPlzData(S.plz).then(() => calculate());
