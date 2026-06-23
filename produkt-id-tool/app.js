import { S } from './modules/state.js';
import { plzToGebiet, plzToStadt } from './modules/plz.js';
import { debounce, dateFmt, copyVal } from './modules/helpers.js';
import { getData, findPreisRow, findKondRow, calcTarif, calcVergleich } from './modules/calc.js?v=20260622i';
import { buildCard } from './modules/render.js?v=20260623d';
import { openPdfModal } from './modules/pdf-modal.js?v=20260623e';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const API_BASE = LOCAL_HOSTS.includes(location.hostname) ? `http://${location.hostname}:3001` : '';

// Produktdaten aus API laden (überschreibt data.js wenn API erreichbar)
try {
  const resp = await fetch(`${API_BASE}/api/produktdaten`);
  if (resp.ok) window.PRODUKTDATEN = await resp.json();
} catch { /* API nicht erreichbar – nutze data.js Fallback */ }

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
const vergleichAP         = $('vergleichAP');
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
  $('grpSteuveTyp').style.display    = isSV ? '' : 'none';
  $('grpSteuveModul').style.display  = isSV ? '' : 'none';

  const defaultV = { gas:20000, strom:3500, heizstrom:8000, autostrom:2000, steuve:5000 };
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
}

function showWarn(msg) {
  warnBox.textContent      = msg;
  warnBox.style.display    = 'block';
  emptyState.style.display = 'none';
  cardsWrap.style.display  = 'none';
}

function calculate() {
  const d      = getData();
  const ga     = S.gueltigAb;
  const v      = S.verbrauch;
  const vNT    = S.verbrauchNT || 0;
  const gebiet = S.gebiet;

  if (!v || v <= 0) { showEmpty(); return; }

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
  const vgl = calcVergleich(v);

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
      ...vgl, pgLabel:'Vergleichspreis', vl:null, pid:null, aid:null, apNt:null,
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
  await loadPlzData(S.plz);
  calculate();
}, 250));

verbrauchInput.addEventListener('input', debounce(() => {
  S.verbrauch = parseFloat(verbrauchInput.value) || 0;
  calculate();
}, 400));

verbrauchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { S.verbrauch = parseFloat(verbrauchInput.value) || 0; calculate(); }
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

$('btnCalc').addEventListener('click', () => {
  S.verbrauch   = parseFloat(verbrauchInput.value)   || 0;
  S.verbrauchNT = parseFloat(verbrauchNTInput.value) || 0;
  calculate();
});

document.querySelectorAll('input[name="ust"]').forEach(radio => {
  radio.addEventListener('change', () => {
    S.ustModus = radio.value;
    radioNetto.classList.toggle('sel', S.ustModus === 'netto');
    radioBrutto.classList.toggle('sel', S.ustModus === 'brutto');
    calculate();
  });
});
radioNetto.addEventListener('click', () => {
  document.querySelector('input[name="ust"][value="netto"]').checked = true;
  S.ustModus = 'netto';
  radioNetto.classList.add('sel'); radioBrutto.classList.remove('sel');
  calculate();
});
radioBrutto.addEventListener('click', () => {
  document.querySelector('input[name="ust"][value="brutto"]').checked = true;
  S.ustModus = 'brutto';
  radioBrutto.classList.add('sel'); radioNetto.classList.remove('sel');
  calculate();
});

function bindCheckbox(labelEl, inputId, onToggle) {
  const input = $(inputId);
  labelEl.addEventListener('click', () => {
    input.checked = !input.checked;
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

[vergleichAP, vergleichGP, vergleichBonus].forEach(el => {
  el.addEventListener('input', debounce(() => {
    S.vergleichFrei = {
      ap:    parseFloat(vergleichAP.value)    || null,
      gp:    parseFloat(vergleichGP.value)    || null,
      bonus: parseFloat(vergleichBonus.value) || 0,
    };
    calculate();
  }, 400));
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
  const urlP = new URLSearchParams(location.search).get('p');
  const valid = ['gas','strom','heizstrom','autostrom','steuve'];
  switchProduct(valid.includes(urlP) ? urlP : 'gas');
}

init();
// Default-PLZ-Daten laden und neu berechnen, sobald verfügbar
loadPlzData(S.plz).then(() => calculate());
