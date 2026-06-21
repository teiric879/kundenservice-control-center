/* Globale „Besuch erfassen"-Leiste – modulübergreifend.
   Holt Standorte + Top-Themen aus /api/besucher/erfass-config und schreibt Besuche per POST /api/besucher (SQLite).
   Selbstständig: injiziert eigenes DOM, keine Abhängigkeit zum Modul-CSS/JS. */
(function () {
  'use strict';
  var _base = location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3001' : '';
  var API = _base + '/api/besucher';
  var LS_COLLAPSED = 'erfass-bar-collapsed';   // '1' = eingeklappt (Default), '0' = offen
  var LS_STANDORT  = 'erfass-bar-standort';
  var cfg = null, standort = null;

  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function ymdToday(){ var d = new Date(); return '' + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()); }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
  function el(tag, cls, html){ var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  var ICON_PIN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.6"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';

  var toastEl, toastT;
  function toastMsg(msg, type){
    if (!toastEl){ toastEl = el('div','eb-toast'); document.body.appendChild(toastEl); }
    toastEl.className = 'eb-toast' + (type === 'err' ? ' err' : '');
    toastEl.textContent = msg;
    requestAnimationFrame(function(){ toastEl.classList.add('show'); });
    clearTimeout(toastT);
    toastT = setTimeout(function(){ toastEl.classList.remove('show'); }, 2000);
  }

  function render(){
    if (document.querySelector('.eb-root')) return;
    var collapsed = localStorage.getItem(LS_COLLAPSED) !== '0'; // Default eingeklappt
    var root = el('div', 'eb-root' + (collapsed ? ' collapsed' : ''));

    var toggle = el('button', 'eb-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Besuch erfassen – Leiste ein-/ausklappen');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.innerHTML = '<span class="eb-plus">' + ICON_PLUS + '</span><span>Besuch erfassen</span><span class="eb-chev">' + ICON_CHEV + '</span>';
    toggle.onclick = function(){
      var nowCollapsed = root.classList.toggle('collapsed');
      localStorage.setItem(LS_COLLAPSED, nowCollapsed ? '1' : '0');
      toggle.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
    };

    var panel = el('div', 'eb-panel');
    panel.appendChild(el('div', 'eb-caption', 'Standort'));

    var loc = el('div', 'eb-loc');
    cfg.standorte.forEach(function(s){
      var b = el('button', 'eb-locbtn' + (s === standort ? ' active' : ''), ICON_PIN + '<span>' + esc(s) + '</span>');
      b.type = 'button';
      b.setAttribute('aria-pressed', s === standort ? 'true' : 'false');
      b.onclick = function(){
        standort = s; localStorage.setItem(LS_STANDORT, s);
        loc.querySelectorAll('.eb-locbtn').forEach(function(x){
          var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      };
      loc.appendChild(b);
    });
    panel.appendChild(loc);

    panel.appendChild(el('div', 'eb-caption', 'Thema erfassen'));
    var cats = el('div', 'eb-cats');
    cfg.kategorien.forEach(function(k){
      var b = el('button', 'eb-cat', esc(k.label));
      b.type = 'button';
      b.title = '„' + k.label + '" am ausgewählten Standort erfassen';
      b.onclick = function(){ record(k, b); };
      cats.appendChild(b);
    });
    panel.appendChild(cats);

    root.appendChild(toggle);
    root.appendChild(panel);
    document.body.appendChild(root);
  }

  // Einheitliche Erfassung (SQLite) – auch von anderen Modulen nutzbar (Dashboard-Schnellerfassung).
  // standort + kategorie wie in der besuche-Tabelle ('Kall'/'Euskirchen', kategorie z.B. '01 Umzug').
  function postVisit(standortVal, kategorieVal){
    return fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datum: ymdToday(), standort: standortVal, kategorie: kategorieVal, stunde: new Date().getHours() }),
    }).then(function(r){ return r.json(); }).then(function(j){
      // Andere Module (v.a. Besucher-Dashboard) über die neue Erfassung informieren → Live-Refresh.
      try { window.dispatchEvent(new CustomEvent('eregio:besuch-erfasst', { detail: { id: j && j.id, standort: standortVal, kategorie: kategorieVal } })); } catch (e) {}
      return j;
    });
  }
  window.erfassBesuch = postVisit; // gemeinsame Erfassung für alle Module

  async function record(k, btn){
    btn.classList.add('bump');
    setTimeout(function(){ btn.classList.remove('bump'); }, 420);
    try {
      var j = await postVisit(standort, k.kategorie);
      if (j && j.id) toastMsg('✓ ' + k.label + ' · ' + standort + ' erfasst');
      else toastMsg('Fehler beim Erfassen', 'err');
    } catch (e) {
      toastMsg('API nicht erreichbar', 'err');
    }
  }

  async function init(){
    try {
      var r = await fetch(API + '/erfass-config?n=6');
      cfg = await r.json();
    } catch (e) { return; } // API offline → keine Leiste anzeigen
    if (!cfg || !cfg.ok || !cfg.standorte || !cfg.standorte.length || !cfg.kategorien || !cfg.kategorien.length) return;
    standort = localStorage.getItem(LS_STANDORT);
    if (!standort || cfg.standorte.indexOf(standort) < 0) standort = cfg.standorte[0];
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
