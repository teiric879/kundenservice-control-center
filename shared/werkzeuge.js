/* Persönliche Werkzeugleiste – modulübergreifend (Notizzettel · Zwischenablage · Rechner).
   Selbstständig: injiziert eigenes DOM, kapselt alle Logik, keine Modul-Abhängigkeit.
   Rein clientseitig – kein Server, keine DB. Alles pro Browser im localStorage (pro Mitarbeiter). */
(function () {
  'use strict';

  var LS_NOTES   = 'wz-notes';
  var LS_CLIP    = 'wz-clipboard';
  var LS_CALC    = 'wz-calc-history';
  var LS_OPEN    = 'wz-open';
  var CLIP_MAX   = 20;
  var CALC_MAX   = 10;

  /* ── kleine Helfer (eigenständig, kein Import) ───────────────────────── */
  function el(tag, cls, html){ var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function debounce(fn, ms){ var t; return function(){ var a = arguments, c = this; clearTimeout(t); t = setTimeout(function(){ fn.apply(c, a); }, ms); }; }
  function lsGet(k, fb){ try { var v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } }
  function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsGetRaw(k, fb){ try { var v = localStorage.getItem(k); return v == null ? fb : v; } catch (e) { return fb; } }
  function lsSetRaw(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }

  /* ── Icons (Inline-SVG, CD-konform) ──────────────────────────────────── */
  var I = {
    note:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 12h6M8 16h4"/></svg>',
    clip:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h4"/></svg>',
    calc:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-11"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M12 11v6M9 14h6"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  /* ── Toast ───────────────────────────────────────────────────────────── */
  var toastEl, toastT;
  function toast(msg){
    if (!toastEl){ toastEl = el('div','wz-toast'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    requestAnimationFrame(function(){ toastEl.classList.add('show'); });
    clearTimeout(toastT);
    toastT = setTimeout(function(){ toastEl.classList.remove('show'); }, 1700);
  }

  /* ── Echte Zwischenablage beschreiben (mit Fallback) ─────────────────── */
  var _origWrite = null;
  function writeClipboard(text){
    var w = _origWrite || (navigator.clipboard && navigator.clipboard.writeText);
    if (w){
      try { return w.call(navigator.clipboard, String(text)); } catch (e) {}
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = String(text); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) {}
    return Promise.resolve();
  }

  /* ── Zwischenablage-Verlauf ──────────────────────────────────────────── */
  var clipData = lsGet(LS_CLIP, []);
  var lastSeenClip = clipData.length ? clipData[0].text : '';   // gegen Doppel-Erfassung (Hook vs. System-Read)
  var extReadOK = false;                                        // true, sobald clipboard-read erlaubt ist
  function pushClip(text){
    text = String(text == null ? '' : text);
    if (!text.trim()) return;
    if (text.length > 5000) text = text.slice(0, 5000);
    lastSeenClip = text;
    if (clipData.length && clipData[0].text === text) return; // direkte Duplikate ignorieren
    clipData.unshift({ text: text, ts: Date.now() });
    if (clipData.length > CLIP_MAX) clipData.length = CLIP_MAX;
    lsSet(LS_CLIP, clipData);
    if (clipBody) renderClip();
  }

  /* Globale Erfassung: App-Kopier-Buttons (navigator.clipboard.writeText) + manuelle Auswahl (Ctrl+C). */
  function installClipboardCapture(){
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
      _origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
      try {
        navigator.clipboard.writeText = function(text){
          try { pushClip(text); } catch (e) {}
          return _origWrite(text);
        };
      } catch (e) { /* read-only in manchen Browsern → copy-Event greift weiter */ }
    }
    document.addEventListener('copy', function(){
      try {
        var sel = window.getSelection ? String(window.getSelection()) : '';
        if (sel && sel.trim()) pushClip(sel);
      } catch (e) {}
    });
  }

  /* System-Zwischenablage lesen (auch außerhalb der App kopierte Inhalte).
     Liefert ehrlich 'added' | 'empty' (leer/Duplikat) | 'error' (Zugriff blockiert/nicht möglich),
     statt jeden Fehler als „leer" zu verschleiern. */
  function readSystemClip(viaGesture){
    if (!navigator.clipboard || !navigator.clipboard.readText) return Promise.resolve('error');
    return navigator.clipboard.readText().then(function(t){
      extReadOK = true;
      if (t && t.trim() && t !== lastSeenClip){ pushClip(t); return 'added'; }
      lastSeenClip = t || lastSeenClip;
      return 'empty';
    }).catch(function(){ return 'error'; });
  }

  function isEditableTarget(el){
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
  }

  /* Externe Kopien erfassen – browserübergreifend.
     PRIMÄR: paste-Event / Strg+V – funktioniert in JEDEM Browser ohne Berechtigung
     (die Strg+V-Geste ist die Zustimmung). BONUS (Chrome/Edge): stilles Auto-Lesen
     beim Zurückkehren, sobald clipboard-read erlaubt ist (in Firefox wirkungslos). */
  function installExternalCapture(){
    // 1) Natives paste-Event (Strg+V in ein Eingabefeld): Text direkt aus dem Event, ohne Dialog.
    document.addEventListener('paste', function(e){
      try {
        var dt = e.clipboardData || window.clipboardData;
        var t = dt ? dt.getData('text') : '';
        if (t && t.trim()) pushClip(t);
      } catch (err) {}
    }, true);

    // 2) Strg+V auch ohne fokussiertes Eingabefeld: dann feuert das paste-Event (v.a. in Firefox)
    //    nicht → Fallback über readText() (die Strg+V-Geste erlaubt den Read).
    document.addEventListener('keydown', function(e){
      var key = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'v' && !isEditableTarget(e.target)){
        readSystemClip(true);
      }
    }, true);

    // 3) Chromium-Bonus: still mitlesen NUR wenn clipboard-read bereits erlaubt ist (lautlos,
    //    kein „Einfügen"-Popup). Bewusst KEIN Lesen bei jedem Klick/pointerdown – das löste in
    //    Chrome/Edge bei jedem Linksklick die schwebende Einfügen-Blase aus.
    function onFocus(){
      if (document.hidden || !navigator.permissions || !navigator.permissions.query) return;
      navigator.permissions.query({ name: 'clipboard-read' }).then(function(p){
        if (p.state === 'granted'){ extReadOK = true; readSystemClip(false); }
      }).catch(function(){});
    }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    if (document.hasFocus && document.hasFocus()) setTimeout(onFocus, 300);
  }

  function relTime(ts){
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'gerade eben';
    if (s < 90) return 'vor 1 Min.';
    var m = Math.floor(s / 60);
    if (m < 60) return 'vor ' + m + ' Min.';
    var h = Math.floor(m / 60);
    if (h < 24) return 'vor ' + h + ' Std.';
    var d = Math.floor(h / 24);
    return 'vor ' + d + ' Tg.';
  }

  /* ── Rechner: sichere Auswertung (kein eval) ─────────────────────────── */
  // Tokenizer + Shunting-Yard → RPN-Auswertung. Unterstützt + - * / % . und Klammern.
  function calcEval(expr){
    var s = String(expr).replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/,/g,'.').replace(/\s+/g,'');
    if (!s) return null;
    var tokens = [], i = 0, prev = null;
    while (i < s.length){
      var c = s[i];
      if (c >= '0' && c <= '9' || c === '.'){
        var num = '';
        while (i < s.length && (s[i] >= '0' && s[i] <= '9' || s[i] === '.')){ num += s[i++]; }
        if ((num.match(/\./g) || []).length > 1) return null;
        tokens.push({ t:'n', v:parseFloat(num) }); prev = 'n'; continue;
      }
      if (c === '%'){
        // Postfix-Prozent: bindet an die vorhergehende Zahl/Klammer → ×0.01
        if (prev !== 'n') return null;          // führendes/isoliertes % ungültig
        tokens.push({ t:'op', v:'*' }); tokens.push({ t:'n', v:0.01 }); prev = 'n'; i++; continue;
      }
      if (c === '+' || c === '-' || c === '*' || c === '/'){
        // führendes unäres Minus / Plus
        if ((c === '-' || c === '+') && (prev === null || prev === 'op' || prev === '(')){
          tokens.push({ t:'n', v:0 });
        }
        tokens.push({ t:'op', v:c }); prev = 'op'; i++; continue;
      }
      if (c === '('){ tokens.push({ t:'(' }); prev = '('; i++; continue; }
      if (c === ')'){ tokens.push({ t:')' }); prev = 'n'; i++; continue; }
      return null; // unbekanntes Zeichen
    }
    var prec = { '+':1, '-':1, '*':2, '/':2 };
    var out = [], ops = [];
    for (var k = 0; k < tokens.length; k++){
      var tk = tokens[k];
      if (tk.t === 'n') out.push(tk.v);
      else if (tk.t === 'op'){
        while (ops.length && ops[ops.length-1].t === 'op' && prec[ops[ops.length-1].v] >= prec[tk.v]) out.push(ops.pop());
        ops.push(tk);
      } else if (tk.t === '(') ops.push(tk);
      else if (tk.t === ')'){
        while (ops.length && ops[ops.length-1].t !== '(') out.push(ops.pop());
        if (!ops.length) return null;
        ops.pop();
      }
    }
    while (ops.length){ var o = ops.pop(); if (o.t === '(') return null; out.push(o); }
    var st = [];
    for (var j = 0; j < out.length; j++){
      var x = out[j];
      if (typeof x === 'number'){ st.push(x); continue; }
      var b = st.pop(), a = st.pop();
      if (a == null || b == null) return null;
      var r;
      if (x.v === '+') r = a + b;
      else if (x.v === '-') r = a - b;
      else if (x.v === '*') r = a * b;
      else if (x.v === '/'){ if (b === 0) return null; r = a / b; }
      st.push(r);
    }
    if (st.length !== 1 || !isFinite(st[0])) return null;
    return st[0];
  }
  function fmtNum(n){
    if (n == null) return '';
    var r = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
    return String(r);
  }

  /* ── State / DOM-Referenzen ──────────────────────────────────────────── */
  var root, flyout, flyHead, flyBodyWrap, current = null, shownT = null;
  var railBtns = {};
  var notesBody, clipBody, clipHolder, calcBody;   // gebaute Tool-Panels (einmalig, bleiben erhalten)
  var calcState = { val:'0', expr:'', justEvaled:false };

  var TOOLS = {
    notes: { icon:I.note, label:'Notizzettel', build:buildNotes },
    clip:  { icon:I.clip, label:'Zwischenablage', build:buildClip },
    calc:  { icon:I.calc, label:'Rechner', build:buildCalc }
  };

  /* ── Öffnen / Schließen (immer nur eines offen) ──────────────────────── */
  function openTool(key){
    if (current === key){ closeTool(); return; }
    current = key;
    Object.keys(railBtns).forEach(function(k){
      var on = k === key;
      railBtns[k].classList.toggle('active', on);
      railBtns[k].setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    root.classList.add('wz-has-open');

    var t = TOOLS[key];
    flyHead.querySelector('.wz-hi').innerHTML = t.icon;
    flyHead.querySelector('.wz-title').textContent = t.label;

    // Body einsetzen (gecachte Instanz → Inhalte bleiben erhalten)
    flyBodyWrap.innerHTML = '';
    var body = key === 'notes' ? notesBody : key === 'clip' ? clipHolder : calcBody;
    flyBodyWrap.appendChild(body);

    flyout.classList.add('open');
    positionFlyout();
    clearTimeout(shownT);
    requestAnimationFrame(function(){ flyout.classList.add('shown'); positionFlyout(); });
    lsSetRaw(LS_OPEN, key);

    if (key === 'notes') setTimeout(function(){ var ta = notesBody.querySelector('.wz-notes'); if (ta) ta.focus(); }, 60);
    if (key === 'clip') renderClip();
  }
  function closeTool(){
    if (!current) return;
    var k = current; current = null;
    railBtns[k] && railBtns[k].classList.remove('active');
    railBtns[k] && railBtns[k].setAttribute('aria-expanded', 'false');
    root.classList.remove('wz-has-open');
    flyout.classList.remove('shown');
    clearTimeout(shownT);
    shownT = setTimeout(function(){ if (!current) flyout.classList.remove('open'); }, 240);
    lsSetRaw(LS_OPEN, '');
  }

  function positionFlyout(){
    // vertikal an der Rail ausrichten, aber innerhalb des Viewports klemmen (nie abgeschnitten)
    var railRect = root.getBoundingClientRect();
    var vh = window.innerHeight, margin = 12;
    flyout.style.maxHeight = Math.min(vh - margin * 2, 640) + 'px';
    var h = flyout.offsetHeight || 360;
    var top = railRect.top + railRect.height / 2 - h / 2;
    top = Math.max(margin, Math.min(top, vh - h - margin));
    flyout.style.top = top + 'px';
  }

  /* ── 1 · Notizzettel ─────────────────────────────────────────────────── */
  function buildNotes(){
    var body = el('div', 'wz-body');
    var ta = el('textarea', 'wz-notes');
    ta.setAttribute('placeholder', 'Persönliche Notizen … (nur auf diesem Gerät, automatisch gespeichert)');
    ta.setAttribute('spellcheck', 'false');
    ta.value = lsGetRaw(LS_NOTES, '');
    body.appendChild(ta);

    var save = debounce(function(){
      lsSetRaw(LS_NOTES, ta.value);
      saved.classList.add('show');
      clearTimeout(savedT); savedT = setTimeout(function(){ saved.classList.remove('show'); }, 1400);
      updateCount();
    }, 300);
    var savedT;
    ta.addEventListener('input', save);

    var foot = el('div', 'wz-foot');
    var saved = el('span', 'wz-saved', I.check + '<span>Automatisch gespeichert</span>');
    var count = el('span', null, '');
    var clear = el('button', 'wz-btn danger', I.trash + '<span>Leeren</span>');
    var confirming = false, confT;
    clear.onclick = function(){
      if (!confirming){
        confirming = true; clear.querySelector('span').textContent = 'Wirklich?';
        confT = setTimeout(function(){ confirming = false; clear.querySelector('span').textContent = 'Leeren'; }, 2500);
        return;
      }
      clearTimeout(confT); confirming = false; clear.querySelector('span').textContent = 'Leeren';
      ta.value = ''; lsSetRaw(LS_NOTES, ''); updateCount(); ta.focus();
    };
    function updateCount(){ count.textContent = ta.value.length + ' Zeichen'; }
    updateCount();

    var left = el('div', null); left.style.cssText = 'display:flex;align-items:center;gap:10px';
    left.appendChild(saved); left.appendChild(count);
    foot.appendChild(left); foot.appendChild(clear);

    var holder = el('div', null);
    holder.style.cssText = 'display:flex;flex-direction:column;flex:1 1 auto;min-height:0';
    holder.appendChild(body); holder.appendChild(foot);
    return holder;
  }

  /* ── 2 · Zwischenablage ──────────────────────────────────────────────── */
  function buildClip(){
    var holder = el('div', null);
    holder.style.cssText = 'display:flex;flex-direction:column;flex:1 1 auto;min-height:0';
    clipBody = el('div', 'wz-body');
    var foot = el('div', 'wz-foot');
    var paste = el('button', 'wz-btn', I.paste + '<span>Einfügen</span>');
    paste.title = 'Aktuellen Inhalt der System-Zwischenablage erfassen (auch außerhalb der App kopiert)';
    paste.onclick = function(){
      readSystemClip(true).then(function(res){
        if (res === 'added') toast('Aus Zwischenablage übernommen');
        else if (res === 'empty') toast('Zwischenablage leer oder schon erfasst');
        else toast('Browser hat den Zugriff blockiert – Tipp: einfach Strg+V drücken');
      });
    };
    var clear = el('button', 'wz-btn danger', I.trash + '<span>Leeren</span>');
    clear.onclick = function(){ clipData = []; lsSet(LS_CLIP, clipData); renderClip(); };
    foot.appendChild(paste); foot.appendChild(clear);
    holder.appendChild(clipBody); holder.appendChild(foot);
    renderClip();
    return holder;
  }
  function renderClip(){
    if (!clipBody) return;
    clipBody.innerHTML = '';
    if (!clipData.length){
      clipBody.appendChild(el('div', 'wz-clip-empty', 'Noch nichts kopiert.<br>In der App kopierte Werte erscheinen automatisch.<br><br><b>Tipp:</b> Außerhalb kopiert? Einfach hier <b>Strg+V</b> drücken.'));
      return;
    }
    var list = el('div', 'wz-clip-list');
    clipData.forEach(function(entry, idx){
      var item = el('div', 'wz-clip-item');
      var main = el('div', 'wz-clip-main');
      var txt = el('div', 'wz-clip-text', esc(entry.text)); txt.title = entry.text;
      var ts = el('div', 'wz-clip-ts', relTime(entry.ts));
      main.appendChild(txt); main.appendChild(ts);
      var copy = el('button', 'wz-icobtn', I.copy);
      copy.title = 'Kopieren'; copy.setAttribute('aria-label', 'Kopieren');
      copy.onclick = function(){
        writeClipboard(entry.text);
        copy.classList.add('copied'); copy.innerHTML = I.check;
        toast('In Zwischenablage kopiert');
        setTimeout(function(){ copy.classList.remove('copied'); copy.innerHTML = I.copy; }, 1300);
      };
      var del = el('button', 'wz-icobtn del', I.trash);
      del.title = 'Löschen'; del.setAttribute('aria-label', 'Eintrag löschen');
      del.onclick = function(){ clipData.splice(idx, 1); lsSet(LS_CLIP, clipData); renderClip(); };
      item.appendChild(main); item.appendChild(copy); item.appendChild(del);
      list.appendChild(item);
    });
    clipBody.appendChild(list);
  }

  /* ── 3 · Rechner ─────────────────────────────────────────────────────── */
  var calcHist = lsGet(LS_CALC, []);
  var calcDispVal, calcDispExpr, calcHistWrap;
  function buildCalc(){
    var holder = el('div', null);
    holder.style.cssText = 'display:flex;flex-direction:column;flex:1 1 auto;min-height:0';
    var body = el('div', 'wz-body');

    var disp = el('div', 'wz-calc-disp');
    calcDispExpr = el('div', 'wz-calc-expr', '');
    calcDispVal = el('div', 'wz-calc-val', '0');
    disp.appendChild(calcDispExpr); disp.appendChild(calcDispVal);
    body.appendChild(disp);

    var grid = el('div', 'wz-calc-grid');
    var keys = [
      ['C','fn'], ['(','op'], [')','op'], ['÷','op'],
      ['7',''], ['8',''], ['9',''], ['×','op'],
      ['4',''], ['5',''], ['6',''], ['−','op'],
      ['1',''], ['2',''], ['3',''], ['+','op'],
      ['%','fn'], ['0',''], ['.',''], ['=','eq']
    ];
    keys.forEach(function(k){
      var b = el('button', 'wz-key' + (k[1] ? ' ' + k[1] : ''), k[0]);
      b.type = 'button';
      b.onclick = function(){ pressKey(k[0]); };
      grid.appendChild(b);
    });
    body.appendChild(grid);

    body.appendChild(el('div', 'wz-calc-cap', 'Letzte Berechnungen'));
    calcHistWrap = el('div', 'wz-calc-hist');
    body.appendChild(calcHistWrap);

    holder.appendChild(body);
    renderCalc(); renderCalcHist();
    return holder;
  }
  function renderCalc(){
    if (calcDispVal){ calcDispVal.textContent = calcState.val; calcDispExpr.textContent = calcState.expr; }
  }
  function renderCalcHist(){
    if (!calcHistWrap) return;
    calcHistWrap.innerHTML = '';
    if (!calcHist.length){
      var e = el('div', 'wz-hist-expr', 'Noch keine Berechnungen.'); calcHistWrap.appendChild(e); return;
    }
    calcHist.forEach(function(h){
      var it = el('div', 'wz-hist-item');
      it.appendChild(el('div', 'wz-hist-expr', esc(h.expr + ' =')));
      it.appendChild(el('div', 'wz-hist-res', esc(h.res)));
      it.title = 'In den Rechner übernehmen';
      it.onclick = function(){ calcState = { val:String(h.res), expr:'', justEvaled:true }; renderCalc(); };
      calcHistWrap.appendChild(it);
    });
  }
  function pressKey(k){
    if (k === 'C'){ calcState = { val:'0', expr:'', justEvaled:false }; renderCalc(); return; }
    if (k === '='){ doEval(); return; }
    var isOp = (k === '+' || k === '−' || k === '×' || k === '÷' || k === '%' || k === '(' || k === ')');
    if (calcState.justEvaled){
      // nach Ergebnis: Ziffer → neuer Ausdruck, Operator → weiterrechnen
      if (isOp && k !== '('){ calcState.expr = calcState.val; }
      else { calcState.expr = ''; }
      calcState.justEvaled = false;
      calcState.val = '';
    }
    if (calcState.val === '0' && !isOp && k !== '.') calcState.val = '';
    calcState.expr = (calcState.expr || '') + k;
    calcState.val = calcState.expr;
    // Live-Vorschau: gültiges Zwischenergebnis zeigen, sonst den Ausdruck
    var live = calcEval(calcState.expr);
    calcDispExpr.textContent = calcState.expr;
    calcDispVal.textContent = (live != null) ? fmtNum(live) : (calcState.expr || '0');
  }
  function doEval(){
    var expr = calcState.expr || calcState.val;
    if (!expr || expr === '0') return;
    var res = calcEval(expr);
    if (res == null){ calcDispVal.textContent = 'Fehler'; return; }
    var resStr = fmtNum(res);
    calcHist.unshift({ expr: expr.replace(/\s+/g,''), res: resStr });
    if (calcHist.length > CALC_MAX) calcHist.length = CALC_MAX;
    lsSet(LS_CALC, calcHist);
    calcState = { val: resStr, expr: expr + ' =', justEvaled: true };
    renderCalc(); renderCalcHist();
  }

  /* Tastaturbedienung, wenn Rechner offen */
  function onKey(e){
    if (current !== 'calc') return;
    var k = e.key;
    if (k >= '0' && k <= '9'){ pressKey(k); e.preventDefault(); return; }
    if (k === '.' || k === ','){ pressKey('.'); e.preventDefault(); return; }
    if (k === '+'){ pressKey('+'); e.preventDefault(); return; }
    if (k === '-'){ pressKey('−'); e.preventDefault(); return; }
    if (k === '*'){ pressKey('×'); e.preventDefault(); return; }
    if (k === '/'){ pressKey('÷'); e.preventDefault(); return; }
    if (k === '%'){ pressKey('%'); e.preventDefault(); return; }
    if (k === '(' || k === ')'){ pressKey(k); e.preventDefault(); return; }
    if (k === 'Enter' || k === '='){ doEval(); e.preventDefault(); return; }
    if (k === 'Backspace'){
      var s = calcState.expr || '';
      calcState.justEvaled = false;
      calcState.expr = s.slice(0, -1);
      calcState.val = calcState.expr || '0';
      var live = calcEval(calcState.expr);
      calcDispExpr.textContent = calcState.expr;
      calcDispVal.textContent = (live != null ? fmtNum(live) : (calcState.expr || '0'));
      e.preventDefault(); return;
    }
    if (k === 'Escape'){ pressKey('C'); e.preventDefault(); return; }
  }

  /* ── Aufbau der Leiste ───────────────────────────────────────────────── */
  function render(){
    if (document.querySelector('.wz-root')) return;
    root = el('div', 'wz-root');

    var rail = el('div', 'wz-rail');
    Object.keys(TOOLS).forEach(function(key){
      var t = TOOLS[key];
      var b = el('button', 'wz-railbtn', t.icon + '<span class="wz-tip">' + esc(t.label) + '</span>');
      b.type = 'button';
      b.setAttribute('aria-label', t.label);
      b.setAttribute('aria-expanded', 'false');
      b.onclick = function(){ openTool(key); };
      railBtns[key] = b;
      rail.appendChild(b);
    });

    flyout = el('div', 'wz-flyout');
    flyout.setAttribute('role', 'dialog');
    flyHead = el('div', 'wz-head', '<span class="wz-hi"></span><span class="wz-title"></span>');
    var x = el('button', 'wz-x', I.x); x.type = 'button'; x.setAttribute('aria-label', 'Schließen');
    x.onclick = closeTool;
    flyHead.appendChild(x);
    flyBodyWrap = el('div', null);
    flyBodyWrap.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
    flyout.appendChild(flyHead);
    flyout.appendChild(flyBodyWrap);

    root.appendChild(rail);
    document.body.appendChild(root);
    // Flyout MUSS direkt am <body> hängen: .wz-root hat transform:translateY(-50%),
    // ein transformierter Vorfahre wäre sonst der Bezugsrahmen für position:fixed → top/right verschoben.
    document.body.appendChild(flyout);

    // Tool-Bodies einmalig bauen (Inhalte/State bleiben über Auf-/Zuklappen erhalten)
    notesBody  = buildNotes();
    clipHolder = buildClip();   // setzt intern clipBody (inneres .wz-body) für renderClip()
    calcBody   = buildCalc();

    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', function(){ if (current) positionFlyout(); });

    // zuletzt offenes Tool wiederherstellen
    var last = lsGetRaw(LS_OPEN, '');
    if (last && TOOLS[last]) openTool(last);
  }

  function init(){
    installClipboardCapture();
    installExternalCapture();
    render();
  }
  // öffentlich: andere Module könnten Werte aktiv in den Verlauf legen
  window.wzClipPush = pushClip;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
