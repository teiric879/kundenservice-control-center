/* access-guard.js — geteilter Zugriffs-Schutz für alle Modul-Seiten.
 *
 * Aufgaben:
 *  1. /api/auth/me prüfen (wer ist eingeloggt, welche Module).
 *  2. Seiten-Zugriff erzwingen: wer das Modul nicht hat → zurück zur Landing.
 *  3. Sidebar filtern: nicht erlaubte Modul-Einträge ausblenden.
 *  4. „Eingeloggt als <name>" + Abmelden-Button in die Sidebar einfügen.
 *
 * Pro Seite vor dem Einbinden setzen:  window.CC_MODULE = 'produkt-id-tool';
 * (admin → 'admin'). Auf der Landing (index.html) nicht nötig.
 *
 * Hinweis: rein clientseitig — wie schon die Kachel-Filterung in index.html.
 * Die GET-Daten-Endpunkte sind öffentlich lesbar, Admin-Schreibzugriffe
 * bleiben token-geschützt.
 */
(function () {
  var isLocal = ['127.0.0.1', 'localhost'].includes(location.hostname);
  var apiBase = isLocal ? 'http://' + location.hostname + ':3001' : '';
  var CUR = window.CC_MODULE || null;

  // Site-Logout (eigener Name, kollidiert nicht mit Admin-Panel-logout()).
  window.ccLogout = async function () {
    try {
      await fetch(apiBase + '/api/auth/logout', {
        method: 'POST',
        credentials: isLocal ? 'include' : 'same-origin',
      });
    } catch (_) { /* egal — wir leiten ohnehin zum Login */ }
    location.replace('/login.html');
  };

  // Sidebar-Eintrag (mod-group / Link) ausblenden.
  function hide(el) { if (el) el.style.display = 'none'; }

  function applySidebar(modules, isAdmin) {
    function allowed(mod) { return isAdmin || modules.includes(mod); }

    // Einfache 1:1-Gruppen.
    [
      ['#mg-dashboard', 'besucher-dashboard'],
      ['#mg-marktlage', 'besucher-dashboard'],
      ['#mg-produkt', 'produkt-id-tool'],
      ['#mg-einsatzplaner', 'einsatzplaner'],
    ].forEach(function (pair) {
      if (!allowed(pair[1])) hide(document.querySelector(pair[0]));
    });

    // „Sonstiges" enthält zwei Module → einzeln prüfen, Gruppe weg wenn beide weg.
    var sonst = document.querySelector('#mg-sonstiges');
    if (sonst) {
      var aw = sonst.querySelector('a[href*="abschlag-wasser"]');
      var fm = sonst.querySelector('a[href*="formulare"]');
      if (aw && !allowed('abschlag-wasser')) hide(aw);
      if (fm && !allowed('formulare')) hide(fm);
      var anyVisible = (aw && allowed('abschlag-wasser')) || (fm && allowed('formulare'));
      if (!anyVisible) hide(sonst);
    }

    // Administration nur für Admins.
    if (!isAdmin) {
      var adminLink = document.querySelector('aside.sidebar a.mod-toggle[href*="admin/"]');
      hide(adminLink);
    }
  }

  function injectFooter(username, isAdmin) {
    var foot = document.querySelector('.side-foot');
    if (!foot) return;

    // Styles einmalig mitliefern (CD-konform, nutzt vorhandene Tokens).
    if (!document.getElementById('cc-guard-style')) {
      var st = document.createElement('style');
      st.id = 'cc-guard-style';
      st.textContent =
        '.cc-user{margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke,#e6e1d2);' +
        'font-size:10.5px;line-height:1.4;color:var(--muted-2,#8aa6a0)}' +
        '.cc-user strong{display:block;font-size:12.5px;color:var(--ink,#063b37);font-weight:600;margin-top:1px}' +
        '.cc-user .cc-role{display:inline-block;margin-top:3px;font-size:9.5px;font-weight:600;letter-spacing:.03em;' +
        'text-transform:uppercase;color:var(--acc-ink,#8a6a00)}' +
        '.cc-logout{display:flex;align-items:center;gap:7px;width:100%;justify-content:center;' +
        'padding:9px 10px;border-radius:10px;margin-top:10px;background:var(--ci,#004442);' +
        'border:1px solid var(--ci,#004442);color:#fff;font-size:12px;font-weight:600;cursor:pointer;' +
        'font-family:inherit;transition:filter .15s ease,transform .1s ease}' +
        '.cc-logout:hover{filter:brightness(1.1)}.cc-logout:active{transform:translateY(1px)}' +
        '.cc-logout svg{width:14px;height:14px;opacity:.9}';
      document.head.appendChild(st);
    }

    // User-Anzeige (idempotent).
    if (!foot.querySelector('.cc-user')) {
      var u = document.createElement('div');
      u.className = 'cc-user';
      u.innerHTML = 'Eingeloggt als<strong></strong>' +
        (isAdmin ? '<span class="cc-role">Administrator</span>' : '');
      u.querySelector('strong').textContent = username || 'Unbekannt';
      foot.appendChild(u);
    }

    // Abmelden-Button: vorhandenen wiederverwenden, sonst neuen anlegen.
    var existing = foot.querySelector('.logout-btn');
    if (existing) {
      existing.setAttribute('onclick', '');
      existing.onclick = window.ccLogout;
    } else if (!foot.querySelector('.cc-logout')) {
      var b = document.createElement('button');
      b.className = 'cc-logout';
      b.type = 'button';
      b.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Abmelden';
      b.onclick = window.ccLogout;
      foot.appendChild(b);
    }
  }

  (async function run() {
    var data = null;
    try {
      var res = await fetch(apiBase + '/api/auth/me', {
        credentials: isLocal ? 'include' : 'same-origin',
      });
      if (res.ok) data = await res.json();
      else if (!isLocal) {
        // Nicht eingeloggt (oder alter Token) → zur Login-Seite.
        location.replace('/login.html?next=' + encodeURIComponent(location.pathname));
        return;
      }
    } catch (_) {
      // API nicht erreichbar (z.B. lokal ohne Backend) → Dev-Modus, nichts sperren.
      return;
    }
    if (!data) return; // lokal ohne Login → alles sichtbar (Dev)

    var modules = data.modules || [];
    var isAdmin = !!data.isAdmin;

    // Seiten-Zugriff erzwingen.
    if (CUR) {
      var ok = CUR === 'admin' ? isAdmin : (isAdmin || modules.includes(CUR));
      if (!ok) { location.replace('/'); return; }
    }

    applySidebar(modules, isAdmin);
    injectFooter(data.username, isAdmin);
  })();
})();
