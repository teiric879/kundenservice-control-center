/* ============================================================================
   Formulare · Kundenservice Control Center
   ----------------------------------------------------------------------------
   Zentrale Formular-Datenbank. Front-Office wählt ein Formular, füllt Felder,
   sieht eine druckreife Live-Vorschau (DIN-A4-Brief) und kann drucken bzw.
   per Druckdialog „Als PDF speichern".

   Erstes integriertes Formular: „Kostenaufstellung Trocknungsmaßnahme"
   (Stromkosten für Trocknung/Bauarbeiten) – inhaltlich & rechnerisch 1:1 zur
   Word-/Excel-Vorlage:
       Netto  = Verbrauch(kWh) × Arbeitspreis(Cent/kWh) ÷ 100
       MwSt   = Netto × (MwSt% ÷ 100)
       Brutto = Netto + MwSt

   Formulare stecken als Registry im Code; weitere Formulare lassen sich im
   Adminbereich anlegen (localStorage) – als technische Grundlage für später.
   ========================================================================== */

'use strict';

/* ── Hilfen: Zahlen/Datum deutsch ─────────────────────────────────────────── */
function num(v){ var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
function fmtEuro(n){ return num(n).toLocaleString('de-DE', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function fmtCent(n){ return num(n).toLocaleString('de-DE', { minimumFractionDigits:3, maximumFractionDigits:3 }); }
function fmtKwh(n){ return num(n).toLocaleString('de-DE', { maximumFractionDigits:2 }); }
function fmtPct(n){ return num(n).toLocaleString('de-DE', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function toISO(d){ var p = function(x){ return (x<10?'0':'')+x; }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function dateLong(iso){
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return '';
  return d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' });
}
function dateShort(iso){
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return '';
  var p = function(x){ return (x<10?'0':'')+x; };
  return p(d.getDate())+'.'+p(d.getMonth()+1)+'.'+d.getFullYear();
}
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}
function slug(s){
  return String(s).toLowerCase().replace(/[äöü]/g, function(c){ return {ä:'ae',ö:'oe',ü:'ue'}[c]; })
    .replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'formular';
}

/* ── Briefkopf-Fuß (e-regio, aus Vorlage) ─────────────────────────────────── */
var FOOTER_HTML =
  '<div class="df-col"><strong>e-regio GmbH &amp; Co. KG</strong>Rheinbacher Weg 10<br>53881 Euskirchen<br>Tel. 02251 708-0<br>Fax 02251 708-163<br>info@e-regio.de<br>www.e-regio.de</div>' +
  '<div class="df-col"><strong>Aufsichtsrat / Geschäftsführung</strong>Vorsitzender des Aufsichtsrates:<br>Dr. Uwe Friedl<br>Geschäftsführung: Dipl.-Ing. Markus Böhm, Dipl.-Kfm. Stefan Dott<br>USt-ID: DE231159806<br>Amtsgericht Bonn HRA 5884</div>' +
  '<div class="df-col"><strong>Pers. haftende Gesellschafterin</strong>e-regio Verwaltungs- und Beteiligungsgesellschaft mbH<br>Amtsgericht Bonn HRB 12691<br><br>Kreissparkasse Euskirchen<br>BIC WELADED1EUS<br>IBAN DE95 3825 0110 0001 0008 01</div>' +
  '<div class="df-col"><strong>Bankverbindungen</strong>Sparkasse Köln/Bonn<br>BIC COLSDE33 · IBAN DE26 3705 0198 0033 3000 47<br>Deutsche Bank AG<br>BIC DEUTDEDK · IBAN DE11 3707 0060 0770 3606 00<br>Postbank Köln<br>BIC PBNKDEFF370 · IBAN DE89 3701 0050 0008 0435 03</div>';

/* ── Formular-Registry ────────────────────────────────────────────────────── */
var FORMULARE = {
  'kostenaufstellung-trocknung': {
    name: 'Kostenaufstellung Trocknungsmaßnahme',
    kategorie: 'Strom',
    beschreibung: 'Ermittlung der Stromkosten für Trocknung und Bauarbeiten – mit automatischer Netto-/MwSt-/Brutto-Berechnung.',
    updated: '2026-06-26',
    builtin: true,
    icon: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>',

    // nur für die Thumbnail-Vorschau auf der Übersichtskachel
    sample: {
      datum:'2026-04-29', anrede:'Frau', name:'Julia Ahrnert', strasse:'Wiener Str. 18',
      plz:'53881', ort:'Euskirchen', kdnr:'828.383.509-1', zaehlernr:'9448762',
      vsadresse:'Wiener Str. 18, 53881 Euskirchen', angabenLt:'Kunde',
      verbrauch:'209', zeitVon:'2026-03-24', zeitBis:'2026-04-07', arbeitspreis:30.58, mwst:19
    },

    felder: [
      { g:'Empfänger', key:'datum',     label:'Briefdatum',           type:'date' },
      { g:'Empfänger', key:'anrede',    label:'Anrede',               type:'select', options:['Frau','Herr','Familie','Firma',''], def:'Frau' },
      { g:'Empfänger', key:'name',      label:'Vor- und Nachname',    type:'text', ph:'z. B. Julia Ahrnert' },
      { g:'Empfänger', key:'strasse',   label:'Straße und Hausnummer',type:'text', ph:'z. B. Wiener Str. 18' },
      { g:'Empfänger', key:'plz',       label:'PLZ',  type:'text', ph:'53881', half:'l' },
      { g:'Empfänger', key:'ort',       label:'Ort',  type:'text', ph:'Euskirchen', half:'r' },

      { g:'Verbrauchsstelle', key:'kdnr',      label:'Kd.-Nr.',     type:'text', ph:'z. B. 828.383.509-1' },
      { g:'Verbrauchsstelle', key:'zaehlernr', label:'Zähler-Nr.',  type:'text', ph:'z. B. 9448762' },
      { g:'Verbrauchsstelle', key:'vsadresse', label:'Adresse Verbrauchsstelle', type:'text', ph:'Straße, PLZ Ort' },

      { g:'Verbrauch', key:'angabenLt', label:'Verbrauchsangaben lt.', type:'select', options:['Kunde','Ablesung','Schätzung'], def:'Kunde' },
      { g:'Verbrauch', key:'verbrauch', label:'Trocknungsverbrauch',   type:'number', unit:'kWh', ph:'z. B. 209', step:'0.1' },
      { g:'Verbrauch', key:'zeitVon',   label:'Zeitraum von',          type:'date', half:'l' },
      { g:'Verbrauch', key:'zeitBis',   label:'Zeitraum bis',          type:'date', half:'r' },

      { g:'Preisberechnung', key:'arbeitspreis', label:'Arbeitspreis', type:'number', unit:'ct/kWh', def:30.58, step:'0.001' },
      { g:'Preisberechnung', key:'mwst',         label:'Mehrwertsteuer', type:'number', unit:'%', def:19, step:'0.1' }
    ],

    berechne: function(d){
      var verbrauch = num(d.verbrauch), ap = num(d.arbeitspreis), mw = num(d.mwst);
      var netto = verbrauch * ap / 100;
      var mwstBetrag = netto * mw / 100;
      return { verbrauch:verbrauch, ap:ap, mw:mw, netto:netto, mwstBetrag:mwstBetrag, brutto:netto + mwstBetrag };
    },

    renderDoc: function(d){
      var r = this.berechne(d);
      var adrLines = [d.anrede, d.name, d.strasse, ((d.plz||'') + ' ' + (d.ort||'')).trim()]
        .filter(function(x){ return x && String(x).trim(); })
        .map(esc).join('<br>');
      var zeitraum = (dateShort(d.zeitVon) || '–') + ' – ' + (dateShort(d.zeitBis) || '–');

      return '' +
      '<div class="doc-logo-row"><img class="doc-logo" src="../shared/eregio-logo-gruen.png" alt="e-regio"></div>' +
      '<div class="doc-info-row">' +
        '<div class="doc-top-left">' +
          '<div class="doc-sender-line">Rheinbacher Weg 10, 53881 Euskirchen</div>' +
          '<div class="doc-address">' + (adrLines || '&nbsp;') + '</div>' +
        '</div>' +
        '<div class="doc-contact">' +
          '<div class="dc-strong">Kundenservice</div>' +
          '<div class="dc-line">Tel. 02251 708-708</div>' +
          '<div class="dc-line">kundenservice@e-regio.de</div>' +
        '</div>' +
      '</div>' +
      '<div class="doc-date">' + esc(dateLong(d.datum)) + '</div>' +
      '<div class="doc-subject">Ermittlung der Stromkosten für Trocknung und Bauarbeiten</div>' +
      '<div class="doc-note">(Bei dieser Mitteilung handelt es sich nicht um eine zu zahlende Rechnung!)</div>' +
      '<div class="doc-meta"><table>' +
        '<tr><td class="dm-lbl">Verbrauchsstelle:</td><td>Kd.-Nr.: ' + esc(d.kdnr) + '</td></tr>' +
        '<tr><td></td><td>Zähler-Nr.: ' + esc(d.zaehlernr) + '</td></tr>' +
        (d.vsadresse ? '<tr><td></td><td>' + esc(d.vsadresse) + '</td></tr>' : '') +
        '<tr><td class="dm-lbl">Verbrauchsangaben lt.:</td><td>' + esc(d.angabenLt) + '</td></tr>' +
        '<tr><td class="dm-lbl">Trocknungsverbrauch:</td><td>' + fmtKwh(r.verbrauch) + ' kWh</td></tr>' +
        '<tr><td class="dm-lbl">Zeitraum:</td><td>' + esc(zeitraum) + '</td></tr>' +
      '</table></div>' +
      '<div class="doc-tabletitle">Stromkostenermittlung gemäß den für Sie im Trocknungs- und Bauzeitraum gültigen Verbrauchspreisen</div>' +
      '<table class="doc-cost-table"><tr>' +
        '<td class="dc-num">' + fmtKwh(r.verbrauch) + ' kWh</td>' +
        '<td class="dc-op">×</td>' +
        '<td class="dc-num">' + fmtCent(r.ap) + ' Cent</td>' +
        '<td class="dc-op">=</td>' +
        '<td class="dc-num">' + fmtEuro(r.netto) + ' EURO</td>' +
      '</tr></table>' +
      '<table class="doc-sum-table">' +
        '<tr><td class="ds-lbl">Nettobetrag</td><td class="ds-num">' + fmtEuro(r.netto) + '</td><td class="ds-unit">EURO</td></tr>' +
        '<tr><td class="ds-lbl">Mehrwertsteuer ' + fmtPct(r.mw) + ' %</td><td class="ds-num">' + fmtEuro(r.mwstBetrag) + '</td><td class="ds-unit">EURO</td></tr>' +
        '<tr class="ds-total"><td class="ds-lbl">Bruttobetrag</td><td class="ds-num">' + fmtEuro(r.brutto) + '</td><td class="ds-unit">EURO</td></tr>' +
      '</table>' +
      '<div class="doc-greeting">Freundliche Grüße<br>Ihr Kundenservice</div>' +
      '<div class="doc-footer">' + FOOTER_HTML + '</div>';
    }
  }
};

/* ── localStorage: Custom-Formulare + Entwürfe ────────────────────────────── */
var CUSTOM_KEY = 'formulare_custom_v1';
var DRAFT_PREFIX = 'formulare_draft_';

function loadCustom(){ try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch(e){ return []; } }
function saveCustom(arr){ try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(arr)); } catch(e){} }
function loadDraft(id){ try { return JSON.parse(localStorage.getItem(DRAFT_PREFIX + id)) || {}; } catch(e){ return {}; } }
function saveDraft(id, data){ try { localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(data)); } catch(e){} }
function clearDraft(id){ try { localStorage.removeItem(DRAFT_PREFIX + id); } catch(e){} }

/* Vereinheitlichte Formular-Liste (builtin + custom) */
function allForms(){
  var out = [];
  Object.keys(FORMULARE).forEach(function(id){
    var f = FORMULARE[id];
    out.push({ id:id, name:f.name, kategorie:f.kategorie, beschreibung:f.beschreibung,
               updated:f.updated, icon:f.icon, builtin:true, configured:true, active:true });
  });
  loadCustom().forEach(function(c){
    out.push({ id:c.id, name:c.name, kategorie:c.kategorie, beschreibung:c.beschreibung,
               updated:c.updated, icon:null, builtin:false, configured:false, active:c.active !== false });
  });
  return out;
}
function getForm(id){ return FORMULARE[id] || null; }

/* Standardwerte eines Formulars */
function defaults(form){
  var d = {};
  form.felder.forEach(function(f){ if (f.def !== undefined) d[f.key] = f.def; });
  if (!d.datum) {
    var hasDatum = form.felder.some(function(f){ return f.key === 'datum'; });
    if (hasDatum) d.datum = toISO(new Date());
  }
  return d;
}

/* ── DOM-Referenzen ───────────────────────────────────────────────────────── */
var $ = function(id){ return document.getElementById(id); };
var viewListe   = $('viewListe');
var editorPanel = $('editorPanel');
var viewEditor  = $('viewEditor');
var viewAdmin   = $('viewAdmin');
var formsGrid   = $('formsGrid');
var formFields  = $('formFields');
var docSheet    = $('docSheet');
var editorTitle = $('editorTitle');
var editorMeta  = $('editorMeta');

var current = { id:null, form:null, data:{}, printAfter:false };

/* ── View-Routing ─────────────────────────────────────────────────────────── */
function show(view){
  viewListe.style.display   = view === 'liste'  ? '' : 'none';
  editorPanel.style.display = view === 'editor' ? '' : 'none';
  viewEditor.style.display  = view === 'editor' ? '' : 'none';
  viewAdmin.style.display   = view === 'admin'  ? '' : 'none';
}

/* ── Übersicht / Formular-Datenbank ───────────────────────────────────────── */
function renderUebersicht(){
  var forms = allForms();
  formsGrid.innerHTML = forms.map(function(f){
    var icon = f.icon || '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>';
    var statusBadge = f.active ? '' : '<span class="fc-status">Archiviert</span>';
    var unconf = !f.configured
      ? '<span class="fc-status" style="color:var(--info);background:var(--info-bg)">In Vorbereitung</span>' : '';
    var disabled = f.configured && f.active ? '' : 'disabled';

    // Vorschau-Kachel: maßstäbliche Live-Vorschau des Briefs (sample) oder Platzhalter
    var form = getForm(f.id);
    var preview;
    if (form && form.renderDoc && form.sample){
      preview = '<div class="fc-preview"><div class="fc-preview-inner doc-sheet">' + form.renderDoc(form.sample) + '</div></div>';
    } else {
      preview = '<div class="fc-preview fc-preview-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
        '<span>Keine Vorschau</span></div>';
    }

    return '' +
    '<div class="form-card' + (f.active ? '' : ' archived') + '" data-id="' + esc(f.id) + '">' +
      '<div class="fc-top">' +
        '<div class="fc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg></div>' +
        '<div class="fc-head">' +
          '<div class="fc-name">' + esc(f.name) + '</div>' +
          '<span class="fc-cat">' + esc(f.kategorie || 'Allgemein') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="fc-desc">' + esc(f.beschreibung || '') + '</div>' +
      preview +
      '<div class="fc-meta">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
        'Letztes Update: ' + esc(dateShort(f.updated) || f.updated || '–') + statusBadge + unconf +
      '</div>' +
      '<div class="fc-actions">' +
        '<button class="fc-btn primary" data-act="open" ' + disabled + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>Öffnen</button>' +
        '<button class="fc-btn" data-act="download" ' + disabled + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Download</button>' +
      '</div>' +
    '</div>';
  }).join('');

  scaleThumbs();
}

/* Thumbnails maßstäblich auf Kachelbreite skalieren (210mm = 794px Basis).
   Synchron – die Übersicht wird vor renderUebersicht() sichtbar geschaltet, daher
   ist clientWidth hier bereits korrekt (Lesen erzwingt Reflow). */
function scaleThumbs(){
  formsGrid.querySelectorAll('.fc-preview-inner').forEach(function(inner){
    var w = inner.parentElement.clientWidth;
    if (!w) return;
    inner.style.transform = 'scale(' + (w / 794) + ')';
  });
}

formsGrid.addEventListener('click', function(e){
  var btn = e.target.closest('.fc-btn'); if (!btn || btn.disabled) return;
  var card = e.target.closest('.form-card'); if (!card) return;
  var id = card.getAttribute('data-id');
  var act = btn.getAttribute('data-act');
  if (act === 'open') openEditor(id, false);
  else if (act === 'download') openEditor(id, true);
});

/* ── Editor: Felder rendern ───────────────────────────────────────────────── */
function fieldHTML(f, val){
  var v = val == null ? '' : val;
  if (f.type === 'select'){
    var opts = f.options.map(function(o){
      return '<option value="' + esc(o) + '"' + (String(o) === String(v) ? ' selected' : '') + '>' + (o ? esc(o) : '—') + '</option>';
    }).join('');
    return '<select class="field-select" id="f_' + f.key + '" data-fkey="' + f.key + '">' + opts + '</select>';
  }
  var attrs = 'id="f_' + f.key + '" data-fkey="' + f.key + '" class="field-input" autocomplete="off"';
  if (f.ph) attrs += ' placeholder="' + esc(f.ph) + '"';
  if (f.type === 'number'){
    attrs += ' type="number" inputmode="decimal"';
    if (f.step) attrs += ' step="' + f.step + '"';
    var inp = '<input ' + attrs + ' value="' + esc(v) + '">';
    return f.unit ? '<div class="input-unit">' + inp + '<span class="unit-badge">' + esc(f.unit) + '</span></div>' : inp;
  }
  if (f.type === 'date') return '<input ' + attrs + ' type="date" value="' + esc(v) + '">';
  return '<input ' + attrs + ' type="text" value="' + esc(v) + '">';
}

function renderFields(form, data){
  var html = '';
  var lastGroup = null;
  var felder = form.felder;
  for (var i = 0; i < felder.length; i++){
    var f = felder[i];
    if (f.g !== lastGroup){ html += '<div class="fld-group-sep">' + esc(f.g) + '</div>'; lastGroup = f.g; }

    // Halbe Breite paaren (l + r)
    if (f.half === 'l' && felder[i+1] && felder[i+1].half === 'r'){
      var g = felder[i+1];
      html += '<div class="field-row">' +
        '<div class="form-group"><label class="field-label" for="f_' + f.key + '">' + esc(f.label) + '</label>' + fieldHTML(f, data[f.key]) + '</div>' +
        '<div class="form-group"><label class="field-label" for="f_' + g.key + '">' + esc(g.label) + '</label>' + fieldHTML(g, data[g.key]) + '</div>' +
      '</div>';
      i++; continue;
    }
    html += '<div class="form-group"><label class="field-label" for="f_' + f.key + '">' + esc(f.label) + '</label>' + fieldHTML(f, data[f.key]) + '</div>';
  }
  formFields.innerHTML = html;

  // Live-Bindung
  formFields.querySelectorAll('[data-fkey]').forEach(function(el){
    var ev = (el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(ev, function(){
      current.data[el.getAttribute('data-fkey')] = el.value;
      saveDraft(current.id, current.data);
      renderPreview();
    });
  });
}

function renderPreview(){
  docSheet.innerHTML = current.form.renderDoc(current.data);
  var r = current.form.berechne(current.data);
  editorMeta.innerHTML = 'Bruttobetrag <strong>' + fmtEuro(r.brutto) + ' €</strong>';
}

function openEditor(id, printAfter){
  var form = getForm(id);
  if (!form){ alert('Dieses Formular ist noch nicht konfiguriert.'); return; }
  current.id = id;
  current.form = form;
  var d = defaults(form);
  var draft = loadDraft(id);
  Object.keys(draft).forEach(function(k){ d[k] = draft[k]; });
  current.data = d;

  editorTitle.textContent = form.name;
  renderFields(form, current.data);
  renderPreview();
  show('editor');
  viewEditor.scrollTop = 0;

  if (printAfter) setTimeout(function(){ window.print(); }, 400);
}

function doPrint(){ window.print(); }

$('btnPrint').addEventListener('click', doPrint);
$('btnPdf').addEventListener('click', doPrint);
$('btnBackList').addEventListener('click', function(){ show('liste'); renderUebersicht(); });
$('btnBackDoc').addEventListener('click', function(){ show('liste'); renderUebersicht(); });
$('btnResetForm').addEventListener('click', function(){
  if (!current.form) return;
  clearDraft(current.id);
  current.data = defaults(current.form);
  renderFields(current.form, current.data);
  renderPreview();
});

/* ── Adminbereich ─────────────────────────────────────────────────────────── */
function showAdmin(){ renderAdminList(); clearAdminForm(); show('admin'); }

function renderAdminList(){
  var list = $('adminList');
  var forms = allForms();
  list.innerHTML = forms.map(function(f){
    var actions = f.builtin
      ? '<span class="ar-lock">Fest integriert</span>'
      : '<div class="ar-act">' +
          '<button title="Bearbeiten" data-aact="edit" data-id="' + esc(f.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' +
          '<button title="' + (f.active ? 'Archivieren' : 'Aktivieren') + '" data-aact="toggle" data-id="' + esc(f.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg></button>' +
          '<button class="danger" title="Löschen" data-aact="del" data-id="' + esc(f.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>' +
        '</div>';
    return '<div class="admin-row' + (f.active ? '' : ' archived') + '">' +
      '<div class="ar-main"><div class="ar-name">' + esc(f.name) + '</div>' +
      '<div class="ar-sub">' + esc(f.kategorie || 'Allgemein') + ' · Stand ' + esc(dateShort(f.updated) || f.updated || '–') + (f.active ? '' : ' · archiviert') + '</div></div>' +
      actions + '</div>';
  }).join('');
}

$('adminList').addEventListener('click', function(e){
  var btn = e.target.closest('button[data-aact]'); if (!btn) return;
  var id = btn.getAttribute('data-id');
  var act = btn.getAttribute('data-aact');
  var arr = loadCustom();
  var idx = arr.findIndex(function(c){ return c.id === id; });
  if (idx < 0) return;
  if (act === 'edit'){ fillAdminForm(arr[idx]); window.scrollTo(0,0); return; }
  if (act === 'toggle'){ arr[idx].active = arr[idx].active === false; saveCustom(arr); renderAdminList(); return; }
  if (act === 'del'){
    if (confirm('Formular „' + arr[idx].name + '" wirklich löschen?')){
      arr.splice(idx, 1); saveCustom(arr); renderAdminList();
    }
  }
});

function fillAdminForm(c){
  $('adminEditId').value = c.id;
  $('adminName').value = c.name;
  $('adminKat').value = c.kategorie || '';
  $('adminBeschr').value = c.beschreibung || '';
  $('adminFormTitle').textContent = 'Formular bearbeiten';
  $('adminHint').textContent = '';
}
function clearAdminForm(){
  $('adminEditId').value = '';
  $('adminName').value = '';
  $('adminKat').value = '';
  $('adminBeschr').value = '';
  $('adminFormTitle').textContent = 'Neues Formular anlegen';
  $('adminHint').textContent = '';
}

$('btnAdminSave').addEventListener('click', function(){
  var name = $('adminName').value.trim();
  if (!name){ $('adminHint').style.color = 'var(--neg)'; $('adminHint').textContent = 'Bitte einen Formularnamen eingeben.'; return; }
  var arr = loadCustom();
  var editId = $('adminEditId').value;
  var today = toISO(new Date());
  if (editId){
    var idx = arr.findIndex(function(c){ return c.id === editId; });
    if (idx >= 0){ arr[idx].name = name; arr[idx].kategorie = $('adminKat').value.trim(); arr[idx].beschreibung = $('adminBeschr').value.trim(); arr[idx].updated = today; }
  } else {
    var id = slug(name) + '-' + Date.now().toString(36);
    arr.push({ id:id, name:name, kategorie:$('adminKat').value.trim(), beschreibung:$('adminBeschr').value.trim(), updated:today, active:true });
  }
  saveCustom(arr);
  $('adminHint').style.color = 'var(--pos)';
  $('adminHint').textContent = 'Gespeichert.';
  renderAdminList();
  clearAdminForm();
});
$('btnAdminClear').addEventListener('click', clearAdminForm);
$('btnAdminOpen').addEventListener('click', showAdmin);
$('btnBackList2').addEventListener('click', function(){ show('liste'); renderUebersicht(); });

/* ── Sidebar-Klappgruppen ─────────────────────────────────────────────────── */
document.querySelectorAll('.mod-toggle[data-mg]').forEach(function(btn){
  btn.addEventListener('click', function(){
    var mg = btn.dataset.mg;
    var items = $('mi-' + mg); if (!items) return;
    var collapsed = items.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', collapsed);
  });
});

/* ── Init ─────────────────────────────────────────────────────────────────── */
show('liste');
renderUebersicht();
