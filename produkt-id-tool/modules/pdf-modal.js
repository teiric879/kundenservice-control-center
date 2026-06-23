// PDF-Modal: öffnet ein Vertragsformular-PDF, füllt AP/GP/PLZ/Ort/Verbrauch
// automatisch ein und zeigt es in einem Vollbild-Popup an.

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const API_BASE = LOCAL_HOSTS.includes(location.hostname) ? `http://${location.hostname}:3001` : '';

let activeBlobUrl = null;

// ── Schrift: Carlito (metrisch Calibri-kompatibel) für alle Textfelder ────────
// Einmal geladen und gecacht. Pfad relativ zu diesem Modul, damit er lokal wie
// auf Vercel (statische Auslieferung aus dem Repo-Root) gleichermaßen aufgeht.
const FIELD_FONT_SIZE = 11;   // Standard
const FIELD_FONT_MIN  = 9;    // Fallback, wenn Inhalt nicht in die Feldbreite passt
let _fontBytesPromise = null;
function loadFieldFont() {
  if (!_fontBytesPromise) {
    const url = new URL('../fonts/Carlito-Regular.ttf', import.meta.url);
    _fontBytesPromise = fetch(url).then(r => {
      if (!r.ok) throw new Error(`Font HTTP ${r.status}`);
      return r.arrayBuffer();
    });
  }
  return _fontBytesPromise;
}

// Wählt 11 pt, sofern der Text in die Feldbreite passt, sonst 9 pt.
function fitFontSize(field, text, font) {
  let avail = Infinity;
  try {
    const rect = field.acroField.getWidgets()[0]?.getRectangle();
    if (rect) avail = rect.width - 4; // ~2 pt Innenabstand je Seite
  } catch { /* keine Geometrie ermittelbar → Standardgröße */ }
  const w = font.widthOfTextAtSize(text, FIELD_FONT_SIZE);
  return w <= avail ? FIELD_FONT_SIZE : FIELD_FONT_MIN;
}

function injectStyles() {
  if (document.getElementById('pdf-modal-css')) return;
  const style = document.createElement('style');
  style.id = 'pdf-modal-css';
  style.textContent = `
    #pdfModalOverlay {
      position: fixed; inset: 0; z-index: 10050;
      background: rgba(0,0,0,.7);
      display: flex; flex-direction: column;
      animation: pdfFadeIn .15s ease;
    }
    @keyframes pdfFadeIn { from { opacity:0 } to { opacity:1 } }
    #pdfModalBar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px;
      background: #1a1d23;
      border-bottom: 1px solid rgba(255,255,255,.1);
      flex-shrink: 0;
    }
    #pdfModalTitle {
      flex: 1; font-size: 13px; font-weight: 600;
      color: #e2e8f0; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    #pdfModalSelect {
      font-size: 12px; padding: 4px 8px;
      background: #2a2d36; color: #e2e8f0;
      border: 1px solid rgba(255,255,255,.15);
      border-radius: 6px; cursor: pointer;
      max-width: 220px;
    }
    .pdf-modal-btn {
      display: flex; align-items: center; gap: 5px;
      padding: 5px 12px; border-radius: 6px; border: none;
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: opacity .15s;
    }
    .pdf-modal-btn:hover { opacity: .85; }
    #pdfBtnPrint { background: #3b82f6; color: #fff; }
    #pdfBtnSave  { background: #22c55e; color: #fff; }
    #pdfBtnClose {
      background: rgba(255,255,255,.08); color: #e2e8f0;
      padding: 5px 10px;
    }
    #pdfModalFrame {
      flex: 1; border: none; background: #525659;
    }
    #pdfModalSpinner {
      flex: 1; display: flex; align-items: center; justify-content: center;
      color: #94a3b8; font-size: 14px; gap: 10px;
    }
    .pdf-select-menu {
      position: fixed; inset: 0; z-index: 10060;
      background: rgba(0,0,0,.6);
      display: flex; align-items: center; justify-content: center;
    }
    .pdf-select-box {
      background: #1e2128; border: 1px solid rgba(255,255,255,.15);
      border-radius: 12px; padding: 20px; min-width: 280px; max-width: 360px;
    }
    .pdf-select-box h3 {
      margin: 0 0 12px; font-size: 14px; color: #e2e8f0;
    }
    .pdf-select-item {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-radius: 8px; cursor: pointer;
      color: #cbd5e1; font-size: 13px;
      transition: background .1s;
    }
    .pdf-select-item:hover { background: rgba(255,255,255,.08); }
    .pdf-select-cancel {
      margin-top: 10px; width: 100%; padding: 8px;
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
      border-radius: 8px; color: #94a3b8; font-size: 12px; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'pdfModalOverlay';
  el.innerHTML = `
    <div id="pdfModalBar">
      <span id="pdfModalTitle">Vertragsformular</span>
      <button class="pdf-modal-btn" id="pdfBtnPrint">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Drucken
      </button>
      <button class="pdf-modal-btn" id="pdfBtnSave">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Speichern
      </button>
      <button class="pdf-modal-btn" id="pdfBtnClose">✕</button>
    </div>
    <div id="pdfModalSpinner">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="animation:spin 1s linear infinite">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      PDF wird geladen…
    </div>
    <iframe id="pdfModalFrame" style="display:none"></iframe>
  `;
  if (!document.getElementById('spin-kf')) {
    const kf = document.createElement('style');
    kf.id = 'spin-kf';
    kf.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(kf);
  }
  return el;
}

function closeModal() {
  const ov = document.getElementById('pdfModalOverlay');
  if (ov) ov.remove();
  if (activeBlobUrl) { URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null; }
}

// Deutsche Zahlformate
const fmtNum = v => Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = v => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 0 });

// Befüllt die AcroForm-Felder eines e-regio-Vertragsformulars.
// Drei Preis-Schemata, je nach Sparte genau eines aktiv:
//  • tiers   (Gas/Strom): GP_<von>-<bis>[_suffix] / VP_<von>-<bis>[_suffix] → nach Band sortiert.
//  • heiz    (Heizstrom): GP_<cfg> / VP_HT_<cfg> / VP_N_<cfg> mit cfg=Eintarif|Doppel[_getrennt|_gemeinsam].
//  • modules (SteuVE):    GP_..._M1/M2 / VP_..._M1/M2.
// Dazu: Checkboxen je nach Auswahl, "PLZ / Ort", "Jahresverbrauch".
function fillForm(form, fv, font) {
  const fields = form.getFields();
  // Setzt nur den Inhalt – das einheitliche Styling (Font/Größe/Ausrichtung)
  // übernimmt styleTextFields() am Ende für ALLE Textfelder gemeinsam.
  const set = (field, value) => { try { field.setText(String(value)); } catch { /* kein Textfeld */ } };
  const check = field => { try { field.check(); } catch { /* keine Checkbox */ } };
  const isCheckbox = f => typeof f.check === 'function' && typeof f.uncheck === 'function';

  // Angebotsgültigkeit: ab dem Tag des Ausfüllens 14 Tage gültig
  // (z. B. erstellt am 15.06. → gültig bis 29.06.). Gilt für alle Sparten.
  const _heute = new Date();
  const angebotGueltigBis = new Date(_heute.getFullYear(), _heute.getMonth(), _heute.getDate() + 14)
    .toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  // Tagesaktuelles Datum (TT.MM.JJJJ) – für die Datumsfelder bei Bankverbindung
  // (SEPA-Lastschriftmandat) und am Seitenende (Unterschrift). Gilt für alle Sparten.
  const heuteStr = _heute.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // ── Heizstrom: GP_<cfg> / VP_HT_<cfg> / VP_N_<cfg> ─────────────────────────
  if (fv.heiz) {
    for (const f of fields) {
      const n = f.getName();
      let m;
      if ((m = n.match(/^VP_HT_(.+)$/)) && fv.heiz[m[1]]) set(f, fmtNum(fv.heiz[m[1]].ap));
      else if ((m = n.match(/^VP_N_(.+)$/))  && fv.heiz[m[1]]) set(f, fmtNum(fv.heiz[m[1]].apNt ?? fv.heiz[m[1]].ap));
      else if ((m = n.match(/^GP_(.+)$/))    && fv.heiz[m[1]]) set(f, fmtNum(fv.heiz[m[1]].gp));
    }
  }

  // ── SteuVE: Felder mit _M1/_M2-Suffix ──────────────────────────────────────
  if (fv.modules) {
    for (const f of fields) {
      const n = f.getName();
      const mod = /(_M1)$/.test(n) ? 'M1' : /(_M2)$/.test(n) ? 'M2' : null;
      if (!mod || !fv.modules[mod] || isCheckbox(f)) continue;
      if (/^GP_/.test(n))      set(f, fmtNum(fv.modules[mod].gp));
      else if (/^VP_/.test(n)) set(f, fmtNum(fv.modules[mod].ap));
    }
  }

  // ── Gas/Strom: Staffel-Tabelle GP_x-y[_suffix] / VP_x-y[_suffix] ───────────
  if (fv.tiers && fv.tiers.length) {
    const tiers  = fv.tiers;
    const isTier = (n, p) => new RegExp(`^${p}_\\d+\\s*-\\s*\\d+(_[A-Za-z0-9]+)?$`).test(n);
    const lower  = n => { const m = n.match(/_(\d+)\s*-/); return m ? +m[1] : 0; };
    const gpF = fields.filter(f => isTier(f.getName(), 'GP')).sort((a, b) => lower(a.getName()) - lower(b.getName()));
    const vpF = fields.filter(f => isTier(f.getName(), 'VP')).sort((a, b) => lower(a.getName()) - lower(b.getName()));
    gpF.forEach((f, i) => { if (tiers[i]) set(f, fmtNum(tiers[i].gp)); });
    vpF.forEach((f, i) => { if (tiers[i]) set(f, fmtNum(tiers[i].ap)); });
  }

  // ── Checkboxen ─────────────────────────────────────────────────────────────
  if (Array.isArray(fv.checkboxes)) {
    for (const name of fv.checkboxes) {
      const f = fields.find(x => x.getName() === name && isCheckbox(x));
      if (f) check(f);
    }
  }
  if (fv.selectedModule) { // SteuVE: Checkbox mit passendem Modul-Suffix (Wärme/Ladestrom)
    const f = fields.find(x => isCheckbox(x) && new RegExp(fv.selectedModule + '$').test(x.getName()));
    if (f) check(f);
  }

  // ── Benannte Einzelfelder (alle Formulare) ─────────────────────────────────
  for (const f of fields) {
    const n = f.getName();
    if (isCheckbox(f)) continue;
    if (/PLZ\s*\/?\s*Ort/i.test(n))      set(f, `${fv.plz || ''} ${fv.ort || ''}`.trim());
    else if (/Jahresverbrauch/i.test(n)) { if (fv.verbrauch) set(f, fmtInt(fv.verbrauch)); }
    else if (/^plz$/i.test(n))           set(f, fv.plz || '');
    else if (/^ort$/i.test(n))           set(f, fv.ort || '');
    else if (/^verbrauch$/i.test(n))     { if (fv.verbrauch) set(f, fmtInt(fv.verbrauch)); }
    // SteuVE Modul 1: max. pauschale Netzentgeltreduzierung (§14a)
    // Formularfeld heißt teils "Nutzentgeltreduzierung" (Tippfehler im PDF) → beide Schreibweisen.
    else if (/(?:netz|nutz)entgelt/i.test(n)) { if (fv.netzentgeltRed) set(f, fv.netzentgeltRed); }
    // "Das Angebot ist gültig bis zum …" – Feld heißt in allen Formularen "Angebot".
    else if (/^angebot$/i.test(n) || /g(?:ü|ue)ltig.?bis/i.test(n)) set(f, angebotGueltigBis);
    // Datum bei Bankverbindung (SEPA-Lastschriftmandat) + am Seitenende (Unterschrift)
    // → tagesaktuelles Datum. Geburtsdatum/Lieferbeginn_Datum bleiben unberührt.
    else if (/^Lastschrift_Datum$/i.test(n) || /^Datum_2$/i.test(n)) set(f, heuteStr);
  }

  // ── Einheitliches Styling für ALLE Textfelder ──────────────────────────────
  // Gilt für von uns befüllte UND leere, vom Berater später ausgefüllte Felder:
  // Carlito, linksbündig, vertikal mittig, 11 pt (9 pt falls Inhalt nicht passt).
  // updateAppearances(font) schreibt zudem die Default-Appearance + registriert
  // Carlito in den AcroForm-Default-Resources → auch nachträgliche Eingaben im
  // Viewer erscheinen in Carlito. Checkboxen/Radios (kein setText) bleiben außen
  // vor, damit ihre Häkchen echte Häkchen bleiben und keine Textzeichen werden.
  if (font) styleTextFields(fields, font);
}

// Preisfelder = Grund-/Verbrauchspreis-Tabelle (GP_… / VP_… inkl. VP_HT_/VP_N_,
// Staffeln, _M1/_M2). Nur diese werden horizontal zentriert; alle übrigen Felder
// bleiben linksbündig. Vertikal mittig ist bei einzeiligen Feldern ohnehin Standard.
const isPriceField = name => /^(GP|VP)_/.test(name);

function styleTextFields(fields, font) {
  const { TextAlignment } = window.PDFLib;
  for (const f of fields) {
    if (typeof f.setText !== 'function') continue; // nur echte Textfelder
    try {
      const text = (f.getText && f.getText()) || '';
      f.setAlignment(isPriceField(f.getName()) ? TextAlignment.Center : TextAlignment.Left);
      f.setFontSize(fitFontSize(f, text, font));
      f.updateAppearances(font);
    } catch { /* Feld nicht stylebar → unverändert lassen */ }
  }
}

// Registriert den eingebetteten Font unter seinem Namen in den AcroForm-Default-
// Resources (/DR /Font). Ohne diesen Eintrag verweist zwar die Default-Appearance
// der Felder auf Carlito, der Viewer findet die Schrift aber nicht und fällt bei
// neuen Eingaben auf eine Standardschrift zurück.
function registerFontInDR(doc, form, font) {
  const { PDFName, PDFDict } = window.PDFLib;
  try {
    const acro = form.acroForm.dict;
    let dr = acro.lookup(PDFName.of('DR'), PDFDict);
    if (!dr) { dr = doc.context.obj({}); acro.set(PDFName.of('DR'), dr); }
    let drFont = dr.lookup(PDFName.of('Font'), PDFDict);
    if (!drFont) { drFont = doc.context.obj({}); dr.set(PDFName.of('Font'), drFont); }
    drFont.set(PDFName.of(font.name), font.ref);
  } catch (e) { console.warn('Font-DR-Registrierung übersprungen:', e); }
}

async function loadAndShow(entry, fieldValues) {
  const spinner = document.getElementById('pdfModalSpinner');
  const frame   = document.getElementById('pdfModalFrame');
  const title   = document.getElementById('pdfModalTitle');
  const btnSave = document.getElementById('pdfBtnSave');

  title.textContent = entry.name || 'Vertragsformular';

  // PDF bytes holen (immer via Backend-Proxy)
  let bytes;
  try {
    const res = await fetch(`${API_BASE}/api/vertragsformulare/${entry.id}/file`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = await res.arrayBuffer();
  } catch (e) {
    spinner.textContent = `Fehler beim Laden der PDF: ${e.message}`;
    return;
  }

  // Felder mit pdf-lib befüllen (nur wenn pdf-lib geladen + PDF hat AcroForm-Felder)
  try {
    const { PDFDocument } = window.PDFLib;
    const doc  = await PDFDocument.load(bytes, { ignoreEncryption: true });

    // Carlito einbetten (für alle Textfelder). Schlägt das fehl, wird ohne
    // Custom-Font weitergemacht (Standard-Helvetica), damit das Befüllen nie bricht.
    let font = null;
    try {
      const fontBytes = await loadFieldFont();
      doc.registerFontkit(window.fontkit);
      font = await doc.embedFont(fontBytes, { subset: false });
    } catch (e) { console.warn('Carlito nicht geladen – Standardschrift:', e); }

    const form = doc.getForm();
    // Carlito in die AcroForm-Default-Resources eintragen, damit der Viewer die
    // Schrift auch bei NACHTRÄGLICHEN Eingaben des Beraters auflösen kann (die
    // Default-Appearance der Felder verweist auf diesen Font-Namen).
    if (font) registerFontInDR(doc, form, font);
    fillForm(form, fieldValues, font);
    // Mit Custom-Font werden Textfeld-Appearances einzeln in fillForm erzeugt.
    // KEIN globales updateFieldAppearances mit Font – das würde Checkbox-Häkchen
    // (ZapfDingbats) in die Textschrift umschreiben und als Zeichen statt Haken
    // rendern. Ohne Custom-Font einmalig global (alte Default-Logik).
    if (!font) form.updateFieldAppearances?.();
    bytes = await doc.save();
  } catch (e) {
    // pdf-lib nicht verfügbar oder kein AcroForm → unbearbeitetes PDF anzeigen
    console.warn('PDF-Autofill übersprungen:', e);
  }

  if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
  activeBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

  const filename = `Vertrag_${fieldValues.sparte || ''}_${fieldValues.tarif || ''}.pdf`;
  btnSave.onclick = () => {
    const a = document.createElement('a');
    a.href = activeBlobUrl;
    a.download = filename;
    a.click();
  };

  frame.src = activeBlobUrl;
  frame.onload = () => {
    spinner.style.display = 'none';
    frame.style.display = 'block';
  };
}

export async function openPdfModal(btn) {
  injectStyles();

  const sparte   = btn.dataset.sparte  || '';
  const tarif    = btn.dataset.tarif   || '';
  const key      = `${sparte}-${tarif}`;
  const entries  = (window.VERTRAG_MAP || {})[key] || [];

  if (!entries.length) return;

  let fill = {};
  try { fill = JSON.parse(btn.dataset.fill || '{}'); } catch { /* kein/ungültiges JSON */ }

  const fieldValues = { sparte, tarif, ...fill };

  // Altes Modal entfernen, neues bauen
  closeModal();
  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  document.getElementById('pdfBtnClose').onclick = closeModal;
  document.getElementById('pdfBtnPrint').onclick = () => {
    const frame = document.getElementById('pdfModalFrame');
    if (frame && frame.contentWindow) frame.contentWindow.print();
  };

  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  overlay.tabIndex = -1;
  overlay.focus();

  if (entries.length === 1) {
    await loadAndShow(entries[0], fieldValues);
    return;
  }

  // Mehrere PDFs → Auswahlmenü
  const menu = document.createElement('div');
  menu.className = 'pdf-select-menu';
  menu.innerHTML = `
    <div class="pdf-select-box">
      <h3>Welches Formular öffnen?</h3>
      ${entries.map((e, i) => `
        <div class="pdf-select-item" data-idx="${i}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
          ${e.name || 'Formular ' + (i + 1)}
        </div>`).join('')}
      <button class="pdf-select-cancel">Abbrechen</button>
    </div>
  `;
  document.body.appendChild(menu);

  await new Promise(resolve => {
    menu.querySelectorAll('.pdf-select-item').forEach((item, i) => {
      item.onclick = () => { menu.remove(); resolve(i); };
    });
    menu.querySelector('.pdf-select-cancel').onclick = () => { menu.remove(); closeModal(); resolve(null); };
  }).then(async idx => {
    if (idx === null) return;
    await loadAndShow(entries[idx], fieldValues);
  });
}
