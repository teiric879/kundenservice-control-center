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

/* ── Briefkopf-Fuß (WES – Wasserversorgungsverband, aus Vorlage) ──────────── */
var WES_FOOTER_HTML =
  '<div class="df-col"><strong>WES</strong>Körperschaft des öffentlichen Rechts<br>Rheinbacher Weg 10<br>53881 Euskirchen</div>' +
  '<div class="df-col"><strong>Kontakt</strong>Telefon 0 22 51 / 708-0<br>Telefax 0 22 51 / 708-163<br>info@wasser-eu-sw.de<br>www.wasser-eu-sw.de</div>' +
  '<div class="df-col"><strong>Verbandsvorsteher</strong>Bürgermeister Sacha Reichelt</div>' +
  '<div class="df-col"><strong>Bankverbindungen</strong>Kreissparkasse Euskirchen<br>BIC WELADED1EUS · IBAN DE27 3825 0110 0001 0357 81<br>Postbank Köln<br>BIC PBNKDEFF · IBAN DE86 3701 0050 0059 3745 02</div>';

/* Freitext → HTML: Leerzeile trennt Absätze, einfacher Umbruch wird zu <br>. */
function paraHtml(s){
  return String(s == null ? '' : s).split(/\n{2,}/).map(function(p){
    return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

/* ── Formular-Registry ────────────────────────────────────────────────────── */
var FORMULARE = {
  'kostenaufstellung-trocknung': {
    name: 'Kostenaufstellung Trocknungsmaßnahme',
    kategorie: 'Strom',
    beschreibung: 'Für Trocknungs- und Baumaßnahmen – mit Netto-/MwSt-/Brutto-Berechnung.',
    updated: '2026-06-26',
    builtin: true,
    icon: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>',

    // nur für die Thumbnail-Vorschau auf der Übersichtskachel
    sample: {
      datum:'2026-04-29', anrede:'', name:'Max Mustermann', strasse:'Musterstraße 1',
      plz:'00000', ort:'Musterstadt', kdnr:'000.000.000-0', zaehlernr:'0000000',
      vsadresse:'Musterstraße 1, 00000 Musterstadt', angabenLt:'Kunde',
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
          '<div class="doc-sender-line">e-regio GmbH &amp; Co. KG · Rheinbacher Weg 10 · 53881 Euskirchen</div>' +
          '<div class="doc-address">' + (adrLines || '&nbsp;') + '</div>' +
        '</div>' +
        '<div class="doc-contact">' +
          '<div class="dc-strong">Kundenservice</div>' +
          '<div class="dc-line">Tel. 02251 708-708</div>' +
          '<div class="dc-line">kundenservice@e-regio.de</div>' +
        '</div>' +
      '</div>' +
      '<div class="doc-date"><span class="doc-date-val">' + esc(dateLong(d.datum)) + '</span></div>' +
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
      '<table class="doc-calc">' +
        '<tr class="dcc-formula">' +
          '<td class="dcc-desc">' + fmtKwh(r.verbrauch) + ' kWh &times; ' + fmtCent(r.ap) + ' Cent/kWh</td>' +
          '<td class="dcc-amt">' + fmtEuro(r.netto) + '</td>' +
          '<td class="dcc-unit">EURO</td>' +
        '</tr>' +
        '<tr><td class="dcc-desc dcc-strong">Nettobetrag</td><td class="dcc-amt">' + fmtEuro(r.netto) + '</td><td class="dcc-unit">EURO</td></tr>' +
        '<tr><td class="dcc-desc dcc-strong">Mehrwertsteuer ' + fmtPct(r.mw) + ' %</td><td class="dcc-amt">' + fmtEuro(r.mwstBetrag) + '</td><td class="dcc-unit">EURO</td></tr>' +
        '<tr class="dcc-total"><td class="dcc-desc dcc-strong">Bruttobetrag</td><td class="dcc-amt">' + fmtEuro(r.brutto) + '</td><td class="dcc-unit">EURO</td></tr>' +
      '</table>' +
      '<div class="doc-greeting">Freundliche Grüße<br>Ihr Kundenservice</div>' +
      '<div class="doc-footer">' + FOOTER_HTML + '</div>';
    }
  },

  /* ── Freitextbrief e-regio (CA-Briefvorlage) ──────────────────────────────── */
  'brief-eregio': {
    name: 'Freitextbrief (e-regio)',
    kategorie: 'Brief',
    beschreibung: 'Geschäftsbrief e-regio',
    updated: '2026-06-27',
    builtin: true,
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',

    sample: {
      firma:'Musterfirma GmbH', name:'Max Mustermann', strasse:'Musterstraße 1', plz:'00000', ort:'Musterstadt',
      abteilung:'Kundenservice', sbname:'Max Mustermann', telefon:'02251 708-708', email:'kundenservice@e-regio.de', kundennummer:'123.456.789',
      datum:'2026-06-27', betreff:'Ihr Anliegen',
      anrede:'Guten Tag Herr Mustermann,',
      text:'vielen Dank für Ihre Nachricht.\n\nGerne bestätigen wir Ihnen den Eingang Ihres Anliegens. Wir kümmern uns umgehend darum und melden uns bei Ihnen, sobald uns weitere Informationen vorliegen.\n\nBei Rückfragen erreichen Sie uns jederzeit unter den oben genannten Kontaktdaten.',
      grussformel:'Mit freundlichen Grüßen', unterschrift:'Ihr Kundenservice\ne-regio GmbH & Co. KG'
    },

    felder: [
      { g:'Empfänger', key:'firma',   label:'Firma',                type:'text', ph:'optional' },
      { g:'Empfänger', key:'name',    label:'Vor- und Nachname',    type:'text', ph:'z. B. Max Mustermann' },
      { g:'Empfänger', key:'strasse', label:'Straße und Hausnummer',type:'text', ph:'Musterstraße 1' },
      { g:'Empfänger', key:'plz',     label:'PLZ', type:'text', ph:'00000', half:'l' },
      { g:'Empfänger', key:'ort',     label:'Ort', type:'text', ph:'Musterstadt', half:'r' },

      { g:'Sachbearbeiter', key:'abteilung',    label:'Abteilung',    type:'text', ph:'z. B. Kundenservice' },
      { g:'Sachbearbeiter', key:'sbname',       label:'Name Sachbearbeiter/in', type:'text' },
      { g:'Sachbearbeiter', key:'telefon',      label:'Telefon',      type:'text', ph:'02251 708-…', half:'l' },
      { g:'Sachbearbeiter', key:'email',        label:'E-Mail',       type:'text', ph:'…@e-regio.de', half:'r' },
      { g:'Sachbearbeiter', key:'kundennummer', label:'Kundennummer', type:'text', ph:'z. B. 123.456.789' },

      { g:'Brief', key:'datum',       label:'Briefdatum',  type:'date' },
      { g:'Brief', key:'betreff',     label:'Betreff',     type:'text', ph:'Betreffzeile' },
      { g:'Brief', key:'anrede',      label:'Anrede',      type:'text', ph:'Guten Tag …,' },
      { g:'Brief', key:'text',        label:'Brieftext',   type:'textarea', rows:11, ph:'Freier Brieftext – Leerzeile trennt Absätze.' },
      { g:'Brief', key:'grussformel', label:'Grußformel',  type:'text', ph:'Mit freundlichen Grüßen', def:'Mit freundlichen Grüßen' },
      { g:'Brief', key:'unterschrift',label:'Unterschrift / Absender', type:'textarea', rows:2, ph:'Name, Abteilung' }
    ],

    summary: function(d){ return 'Brief · ' + (esc(d.betreff) || '<em>ohne Betreff</em>'); },

    renderDoc: function(d){
      var adrLines = [d.firma, d.name, d.strasse, ((d.plz||'') + ' ' + (d.ort||'')).trim()]
        .filter(function(x){ return x && String(x).trim(); }).map(esc).join('<br>');

      return '' +
      '<div class="doc-logo-row"><img class="doc-logo" src="../shared/eregio-logo-gruen.png" alt="e-regio"></div>' +
      '<div class="doc-info-row letter">' +
        '<div class="doc-top-left">' +
          '<div class="doc-sender-line">e-regio GmbH &amp; Co. KG · Rheinbacher Weg 10 · 53881 Euskirchen</div>' +
          '<div class="doc-address">' + (adrLines || '&nbsp;') + '</div>' +
          '<div class="doc-date-left">' + esc(dateShort(d.datum)) + '</div>' +
        '</div>' +
        '<div class="doc-contact">' +
          (d.abteilung ? '<div class="dc-strong">' + esc(d.abteilung) + '</div>' : '') +
          (d.sbname ? '<div class="dc-line">' + esc(d.sbname) + '</div>' : '') +
          (d.telefon ? '<div class="dc-line">Tel. ' + esc(d.telefon) + '</div>' : '') +
          (d.email ? '<div class="dc-line">' + esc(d.email) + '</div>' : '') +
          (d.kundennummer ? '<div class="dc-line dc-kdnr">' + esc(d.kundennummer) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="doc-subject">' + esc(d.betreff) + '</div>' +
      '<div class="doc-anrede">' + esc(d.anrede) + '</div>' +
      '<div class="doc-body">' + paraHtml(d.text) + '</div>' +
      '<div class="doc-greeting">' + esc(d.grussformel) + '<br><br>' + esc(d.unterschrift).replace(/\n/g, '<br>') + '</div>' +
      '<div class="doc-footer">' + FOOTER_HTML + '</div>';
    }
  },

  /* ── Freitextbrief WES (Wasserversorgungsverband) ─────────────────────────── */
  'brief-wes': {
    name: 'Freitextbrief (WES)',
    kategorie: 'Wasser',
    beschreibung: 'Geschäftsbrief WES',
    updated: '2026-06-27',
    builtin: true,
    icon: '<path d="M12 2.5C12 2.5 5 10 5 14.5a7 7 0 0 0 14 0C19 10 12 2.5 12 2.5Z"/>',

    sample: {
      firma:'Musterfirma GmbH', anrede:'Herr', name:'Max Mustermann', strasse:'Musterstraße 1', plz:'00000', ort:'Musterstadt',
      abteilung:'Abteilung', sbname:'Sachbearbeiter/in', telefon:'0 22 51 / 708-xxx', telefax:'0 22 51 / 708-xxx', email:'Vorname.Name@e-regio.de', kundennummer:'123.456.789',
      datum:'2026-06-27', betreff:'Ihr Anliegen',
      briefanrede:'Sehr geehrter Herr Mustermann,',
      text:'vielen Dank für Ihr Schreiben.\n\nGerne bestätigen wir Ihnen den Eingang Ihres Anliegens. Wir prüfen den Vorgang und melden uns zeitnah bei Ihnen.\n\nFür Rückfragen stehen wir Ihnen unter den oben genannten Kontaktdaten gerne zur Verfügung.',
      grussformel:'Freundliche Grüße', unterschrift:'WES Wasserversorgungsverband\nEuskirchen-Swisttal'
    },

    felder: [
      { g:'Empfänger', key:'firma',   label:'Firma',                type:'text', ph:'optional' },
      { g:'Empfänger', key:'anrede',  label:'Anrede',               type:'select', options:['Herr','Frau','Familie','Firma',''], def:'Herr' },
      { g:'Empfänger', key:'name',    label:'Vor- und Nachname',    type:'text', ph:'z. B. Max Mustermann' },
      { g:'Empfänger', key:'strasse', label:'Straße und Hausnummer',type:'text', ph:'Musterstraße 1' },
      { g:'Empfänger', key:'plz',     label:'PLZ', type:'text', ph:'00000', half:'l' },
      { g:'Empfänger', key:'ort',     label:'Ort', type:'text', ph:'Musterstadt', half:'r' },

      { g:'Sachbearbeiter', key:'abteilung', label:'Abteilung',        type:'text', ph:'z. B. Abrechnung' },
      { g:'Sachbearbeiter', key:'sbname',    label:'Name Sachbearbeiter/in', type:'text' },
      { g:'Sachbearbeiter', key:'telefon',   label:'Telefon',          type:'text', ph:'0 22 51 / 708-…', half:'l' },
      { g:'Sachbearbeiter', key:'telefax',   label:'Telefax',          type:'text', ph:'0 22 51 / 708-…', half:'r' },
      { g:'Sachbearbeiter', key:'email',     label:'E-Mail',           type:'text', ph:'…@e-regio.de' },
      { g:'Sachbearbeiter', key:'kundennummer', label:'Kundennummer',  type:'text', ph:'z. B. 123.456.789' },

      { g:'Brief', key:'datum',       label:'Briefdatum',  type:'date' },
      { g:'Brief', key:'betreff',     label:'Betreff',     type:'text', ph:'Betreffzeile' },
      { g:'Brief', key:'briefanrede', label:'Anrede',      type:'text', ph:'Sehr geehrte/r …,' },
      { g:'Brief', key:'text',        label:'Brieftext',   type:'textarea', rows:11, ph:'Freier Brieftext – Leerzeile trennt Absätze.' },
      { g:'Brief', key:'grussformel', label:'Grußformel',  type:'text', ph:'Freundliche Grüße', def:'Freundliche Grüße' },
      { g:'Brief', key:'unterschrift',label:'Unterschrift / Absender', type:'textarea', rows:2, ph:'Name, Abteilung' }
    ],

    summary: function(d){ return 'Brief · ' + (esc(d.betreff) || '<em>ohne Betreff</em>'); },

    renderDoc: function(d){
      var adrLines = [d.firma, d.anrede, d.name, d.strasse, ((d.plz||'') + ' ' + (d.ort||'')).trim()]
        .filter(function(x){ return x && String(x).trim(); }).map(esc).join('<br>');

      return '' +
      '<div class="doc-logo-row"><img class="doc-logo" src="../shared/wes-logo.png" alt="WES" style="width:40mm"></div>' +
      '<div class="doc-info-row letter">' +
        '<div class="doc-top-left">' +
          '<div class="doc-sender-line">Wasserversorgungsverband Euskirchen-Swisttal · Rheinbacher Weg 10 · 53881 Euskirchen</div>' +
          '<div class="doc-address">' + (adrLines || '&nbsp;') + '</div>' +
          '<div class="doc-date-left">' + esc(dateLong(d.datum)) + '</div>' +
        '</div>' +
        '<div class="doc-contact">' +
          (d.abteilung ? '<div class="dc-strong">' + esc(d.abteilung) + '</div>' : '') +
          (d.sbname ? '<div class="dc-line">' + esc(d.sbname) + '</div>' : '') +
          (d.telefon ? '<div class="dc-line">Telefon ' + esc(d.telefon) + '</div>' : '') +
          (d.telefax ? '<div class="dc-line">Telefax ' + esc(d.telefax) + '</div>' : '') +
          (d.email ? '<div class="dc-line">' + esc(d.email) + '</div>' : '') +
          (d.kundennummer ? '<div class="dc-line dc-kdnr">' + esc(d.kundennummer) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="doc-subject">' + esc(d.betreff) + '</div>' +
      '<div class="doc-anrede">' + esc(d.briefanrede) + '</div>' +
      '<div class="doc-body">' + paraHtml(d.text) + '</div>' +
      '<div class="doc-greeting">' + esc(d.grussformel) + '<br><br>' + esc(d.unterschrift).replace(/\n/g, '<br>') + '</div>' +
      '<div class="doc-footer">' + WES_FOOTER_HTML + '</div>';
    }
  }
};

/* ── localStorage: Custom-Formulare + Entwürfe ────────────────────────────── */
var CUSTOM_KEY = 'formulare_custom_v1';
var DRAFT_PREFIX = 'formulare_draft_';

/* Backend-API für eigenständige Download-Formulare (Pflege im zentralen Admin). */
var SF_API = (['127.0.0.1','localhost'].indexOf(location.hostname) >= 0 ? 'http://' + location.hostname + ':3001' : '') + '/api/standalone-formulare';

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
var weitereGrid = $('weitereGrid');
var weitereEmpty = $('weitereEmpty');
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
function cardHTML(f, downloadOnly){
  var icon = f.icon || '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>';
  var statusBadge = f.active ? '' : '<span class="fc-status">Archiviert</span>';
  var unconf = !f.configured
    ? '<span class="fc-status" style="color:var(--info);background:var(--info-bg)">In Vorbereitung</span>' : '';
  var disabled = f.configured && f.active ? '' : 'disabled';

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
      (!downloadOnly ? '<button class="fc-btn primary" data-act="open" ' + disabled + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>Öffnen</button>' : '') +
      '<button class="fc-btn' + (downloadOnly ? ' primary' : '') + '" data-act="download" ' + disabled + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Download</button>' +
    '</div>' +
  '</div>';
}

/* Reine Download-Kachel für eigenständige Formulare (PDF aus dem Admin).
   Kein Editor, keine Live-Vorschau – nur ein Download-Link auf das PDF. */
function downloadCardHTML(f){
  var href = SF_API + '/' + encodeURIComponent(f.id) + '/file';
  return '' +
  '<div class="form-card" data-id="sf-' + esc(f.id) + '">' +
    '<div class="fc-top">' +
      '<div class="fc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg></div>' +
      '<div class="fc-head">' +
        '<div class="fc-name">' + esc(f.name) + '</div>' +
        '<span class="fc-cat">' + esc(f.kategorie || 'Allgemein') + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="fc-desc">' + esc(f.beschreibung || '') + '</div>' +
    '<div class="fc-preview fc-preview-pdf">' +
      '<canvas class="fc-pdf-canvas" data-pdf-id="' + esc(f.id) + '"></canvas>' +
      '<div class="fc-pdf-fallback">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
        '<span>PDF-Dokument</span></div>' +
    '</div>' +
    '<div class="fc-meta">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
      'Letztes Update: ' + esc(dateShort(f.updated) || f.updated || '–') +
    '</div>' +
    '<div class="fc-actions">' +
      '<a class="fc-btn primary" href="' + href + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Download</a>' +
    '</div>' +
  '</div>';
}

/* PDF.js-Worker einmalig konfigurieren (lokal vendored, kein CDN). */
var PDFJS_READY = (function(){
  if (typeof pdfjsLib === 'undefined') return false;
  pdfjsLib.GlobalWorkerOptions.workerSrc = '../shared/vendor/pdfjs/pdf.worker.min.js?v=1';
  return true;
})();

/* Rendert die erste Seite jedes Download-PDFs maßstäblich in seine Kachel.
   Bei Fehler/ohne PDF.js bleibt der Datei-Platzhalter (.fc-pdf-fallback) sichtbar.
   PDF.js rendert in einem versteckten Tab nicht fertig (Browser drosselt) – deshalb
   bei Sichtbarwerden noch offene Kacheln nachrendern. */
function renderPdfThumbs(){
  if (!PDFJS_READY) return;
  if (document.hidden){
    document.addEventListener('visibilitychange', function onVis(){
      if (!document.hidden){ document.removeEventListener('visibilitychange', onVis); renderPdfThumbs(); }
    });
    return;
  }
  weitereGrid.querySelectorAll('.fc-preview-pdf:not(.has-thumb) .fc-pdf-canvas').forEach(function(canvas){
    var id = canvas.getAttribute('data-pdf-id');
    var url = SF_API + '/' + encodeURIComponent(id) + '/file';
    pdfjsLib.getDocument({ url: url }).promise
      .then(function(pdf){ return pdf.getPage(1); })
      .then(function(page){
        var box = canvas.parentElement;
        var cssW = box.clientWidth || 300;
        var base = page.getViewport({ scale: 1 });
        var dpr = window.devicePixelRatio || 1;
        var scale = cssW / base.width;
        var vp = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        canvas.style.width = cssW + 'px';
        canvas.style.height = Math.round(vp.height / dpr) + 'px';
        var ctx = canvas.getContext('2d');
        return page.render({ canvasContext: ctx, viewport: vp }).promise;
      })
      .then(function(){ canvas.parentElement.classList.add('has-thumb'); })
      .catch(function(){ /* Fallback-Platzhalter bleibt sichtbar */ });
  });
}

function renderUebersicht(){
  // Built-in-Formulare (ausfüllbar) – aus der Code-Registry
  var builtin = allForms().filter(function(f){ return f.builtin; });
  formsGrid.innerHTML = builtin.map(function(f){ return cardHTML(f, false); }).join('');
  scaleThumbs();

  // Weitere Formulare (reine Downloads) – aus dem Admin-Backend
  renderWeitereFormulare();
}

/* Lädt die eigenständigen Download-Formulare aus dem Backend (nur aktive). */
function renderWeitereFormulare(){
  fetch(SF_API + '?active=1')
    .then(function(r){ return r.ok ? r.json() : { items: [] }; })
    .then(function(j){
      var items = (j && j.items) || [];
      if (items.length){
        weitereGrid.innerHTML = items.map(downloadCardHTML).join('');
        weitereGrid.style.display = '';
        weitereEmpty.style.display = 'none';
        renderPdfThumbs();
      } else {
        weitereGrid.innerHTML = '';
        weitereGrid.style.display = 'none';
        weitereEmpty.style.display = '';
      }
    })
    .catch(function(){
      weitereGrid.innerHTML = '';
      weitereGrid.style.display = 'none';
      weitereEmpty.style.display = '';
    });
}

/* Thumbnails maßstäblich auf Kachelbreite skalieren (210mm = 794px Basis).
   Synchron – die Übersicht wird vor renderUebersicht() sichtbar geschaltet, daher
   ist clientWidth hier bereits korrekt (Lesen erzwingt Reflow). */
function scaleThumbs(){
  document.querySelectorAll('.fc-preview-inner').forEach(function(inner){
    var w = inner.parentElement.clientWidth;
    if (!w) return;
    inner.style.transform = 'scale(' + (w / 794) + ')';
  });
}

function onCardClick(e){
  var btn = e.target.closest('.fc-btn'); if (!btn || btn.disabled) return;
  var card = e.target.closest('.form-card'); if (!card) return;
  var id = card.getAttribute('data-id');
  var act = btn.getAttribute('data-act');
  if (act === 'open') openEditor(id, false);
  else if (act === 'download') openEditor(id, true);
}
formsGrid.addEventListener('click', onCardClick);
weitereGrid.addEventListener('click', onCardClick);

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
  if (f.type === 'textarea') return '<textarea ' + attrs + ' rows="' + (f.rows || 9) + '" style="resize:vertical">' + esc(v) + '</textarea>';
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
  // Berechnungsformulare zeigen den Bruttobetrag; Briefe eine eigene Zusammenfassung.
  if (current.form.summary){
    editorMeta.innerHTML = current.form.summary(current.data);
  } else if (current.form.berechne){
    var r = current.form.berechne(current.data);
    editorMeta.innerHTML = 'Bruttobetrag <strong>' + fmtEuro(r.brutto) + ' €</strong>';
  } else {
    editorMeta.innerHTML = '';
  }
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
/* Adminbereich per URL-Hash erreichbar: formulare/#admin */
if (window.location.hash === '#admin') showAdmin();
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
