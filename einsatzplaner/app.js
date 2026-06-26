/* ── Constants ──────────────────────────────────────────────────────────── */
const API = (location.hostname === '127.0.0.1' ? 'http://127.0.0.1:3001' : '') + '/api/einsatzplaner';

const LOCATIONS = [
  { id: 'kall', label: 'Kall', slots: ['B1','B2'] },
  { id: 'euskirchen', label: 'Euskirchen',
    slots: ['Z','B1','B2','B3'],
    extra: { slots: ['BO1','BO2','BO3','BO4','BO5'], defaultShow: 1 }
  },
  { id: 'homeoffice', label: 'HomeOffice',
    slots: ['H1','H2','H3'],
    extra: { slots: ['H4','H5','H6','H7','H8'], defaultShow: 0 }
  },
];
const SLOT_LABELS = {
  Z: 'Zentrale', B1: 'Berater 1', B2: 'Berater 2', B3: 'Berater 3',
  BO1: 'Backoffice', BO2: 'Backoffice', BO3: 'Backoffice', BO4: 'Backoffice', BO5: 'Backoffice',
  H1: 'HomeOffice', H2: 'HomeOffice', H3: 'HomeOffice', H4: 'HomeOffice',
  H5: 'HomeOffice', H6: 'HomeOffice', H7: 'HomeOffice', H8: 'HomeOffice',
};
const DAYS = ['Mo','Di','Mi','Do','Fr'];

/* Pflichtbesetzung: an jedem Werktag (Mo–Fr, kein Feiertag) müssen diese Slots
   mindestens je einen Berater haben, sonst gilt der Tag als unterbesetzt. */
const REQUIRED_SLOTS = [
  { loc: 'kall',       slot: 'B1' },
  { loc: 'kall',       slot: 'B2' },
  { loc: 'euskirchen', slot: 'Z'  },
  { loc: 'euskirchen', slot: 'B1' },
  { loc: 'euskirchen', slot: 'B2' },
];
const REQUIRED_SET = new Set(REQUIRED_SLOTS.map(r => `${r.loc}|${r.slot}`));
function isRequired(loc, slot) { return REQUIRED_SET.has(`${loc}|${slot}`); }

/* ── Einklappbare Zeilen (Backoffice/HomeOffice) ─────────────────────────── */
var S_EXPAND = new Set(); // loc-IDs die aufgeklappt sind
function toggleExpand(locId) {
  S_EXPAND.has(locId) ? S_EXPAND.delete(locId) : S_EXPAND.add(locId);
  renderGrid();
}
function visibleSlots(loc) {
  if (!loc.extra) return loc.slots;
  const extra = S_EXPAND.has(loc.id)
    ? loc.extra.slots
    : loc.extra.slots.slice(0, loc.extra.defaultShow);
  return [...loc.slots, ...extra];
}
function allSlots(loc) {
  return loc.extra ? [...loc.slots, ...loc.extra.slots] : loc.slots;
}

/* Zeit als Stunde ohne ":00" ("13"), sonst "13:30" – für kompakte Lücken-Labels. */
function hm(min) { const s = tStr(min); return s.endsWith(':00') ? s.slice(0, 2) : s; }
/* Unbesetzte Kernfenster-Lücken eines Platzes als Text, z. B. "13–16"
   (mehrere Lücken mit Komma getrennt). */
function gapLabel(list) {
  return coreGaps(list).map(([s, e]) => `${hm(s)}–${hm(e)}`).join(', ');
}

/* Liefert den Besetzungsstatus eines Tages anhand einer Assignment-Map
   (Wochenplan: S.assignments, Monatsplan: S.monthData). missing = Pflichtplätze
   ganz ohne Besetzung; partial = besetzt, aber mit Lücke im Kernfenster 08–16
   (inkl. der konkreten freien Zeitfenster). */
function dayStaffing(date, map) {
  if (isHoliday(date)) return { holiday: true, ok: true, missing: [], partial: [] };
  const missing = [], partial = [];
  for (const r of REQUIRED_SLOTS) {
    const list = map.get(assignKey(date, r.loc, r.slot)) ?? [];
    if (!list.length) missing.push(r);
    else if (hasCoreGap(list)) partial.push({ loc: r.loc, slot: r.slot, gap: gapLabel(list) });
  }
  return { holiday: false, ok: missing.length === 0 && partial.length === 0, missing, partial };
}
function locLabel(id) { return LOCATIONS.find(l => l.id === id)?.label ?? id; }
function missingLabel(missing) {
  return missing.map(r => `${locLabel(r.loc)} · ${SLOT_LABELS[r.slot] ?? r.slot}`).join(', ');
}
/* Teilbesetzte Pflichtplätze inkl. freier Zeitfenster, z. B.
   „Euskirchen · Zentrale: frei 13–16 Uhr". */
function partialLabel(partial) {
  return partial.map(p => `${locLabel(p.loc)} · ${SLOT_LABELS[p.slot] ?? p.slot}: frei ${p.gap} Uhr`).join(', ');
}
const WARN_ICON = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2 1.3 13.8h13.4L8 2.2Z"/><path d="M8 6.4v3"/><path d="M8 11.4h.01"/></svg>';

/* Standortfarben (= loc-pip), für Akzentschienen der Slot-Spalte */
const LOC_COLORS = { kall: '#E8A06A', euskirchen: '#7A8BF0', homeoffice: '#5FD6A0' };
const CHEV_DOWN = '<svg class="ex-chev" viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
const CHEV_UP   = '<svg class="ex-chev" viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5 6 4l3.5 3.5"/></svg>';
/* Feiertags-Marker (kleine Fahne) – Monats-Datumskopf */
const HOLIDAY_ICON = '<svg class="mg-hday-flag" viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1.5v9"/><path d="M3 2.2h6l-1.4 2 1.4 2H3"/></svg>';

/* ── Kern-Besetzungsfenster (08:00–16:00) ──────────────────────────────────
   Ein Platz gilt als voll besetzt, wenn 08:00–16:00 lückenlos abgedeckt ist.
   Zeiten nach 16:00 zählen für die Abdeckung nicht und werden in der
   Übersicht auf 16:00 gekappt. */
const CORE_FROM = '08:00';
const CORE_TO   = '16:00';
function tMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function tStr(min) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }
function clampTo16(t) { return t > CORE_TO ? CORE_TO : t; }   // Anzeige-/Editier-Kappung

/* Unbesetzte Lücken innerhalb 08:00–16:00 (als [startMin,endMin]-Paare). */
function coreGaps(list) {
  const F = tMin(CORE_FROM), T = tMin(CORE_TO);
  const ivs = (list ?? [])
    .map(a => [Math.max(F, tMin(a.time_from)), Math.min(T, tMin(a.time_to))])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const gaps = []; let cursor = F;
  for (const [s, e] of ivs) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < T) gaps.push([cursor, T]);
  return gaps;
}
function hasCoreGap(list) { return coreGaps(list).length > 0; }

/* ── State ──────────────────────────────────────────────────────────────── */
const S = {
  monday: null,
  agents: [],
  selectedAgent: null,
  assignments: new Map(), // "date|loc|slot" → [{id,agent_id,kuerzel,color,name,time_from,time_to}]
  notes: new Map(),       // "date|agent_id" → {id,text}
  ctxAssignmentId: null,
  ctxDate: null,
  ctxLoc: null,
  ctxSlot: null,
  timeEditId: null,
  timeAddTarget: null,
};

/* ── Helpers ────────────────────────────────────────────────────────────── */
function isoMonday(d = new Date()) {
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  return localIso(d.getFullYear(), d.getMonth(), d.getDate() - day + 1);
}
function addDays(iso, n) {
  const [y, m, da] = iso.split('-').map(Number);
  return localIso(y, m - 1, da + n);
}
function localIso(y, m, d) {
  const dt = new Date(y, m, d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function noteKind(text)  {
  if (/urlaub/i.test(text || '')) return 'is-urlaub';
  if (/krank/i.test(text  || '')) return 'is-krank';
  return 'is-thema';
}
function noteBadge(text) {
  if (/urlaub/i.test(text || '')) return 'Urlaub';
  if (/krank/i.test(text  || '')) return 'Krank';
  return 'Termin';
}

/* ── German / NRW Public Holidays ──────────────────────────────────────── */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, mo - 1, day);
}

const _holidays = {};
function getNRWHolidays(year) {
  if (_holidays[year]) return _holidays[year];
  const e = easterSunday(year);
  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const iso = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  _holidays[year] = {
    [iso(new Date(year, 0,  1))]: 'Neujahr',
    [iso(add(e, -2))]:            'Karfreitag',
    [iso(add(e,  1))]:            'Ostermontag',
    [iso(new Date(year, 4,  1))]: 'Tag der Arbeit',
    [iso(add(e, 39))]:            'Christi Himmelfahrt',
    [iso(add(e, 50))]:            'Pfingstmontag',
    [iso(add(e, 60))]:            'Fronleichnam',
    [iso(new Date(year, 9,  3))]: 'Tag der Dt. Einheit',
    [iso(new Date(year, 10, 1))]: 'Allerheiligen',
    [iso(new Date(year, 11,25))]: '1. Weihnachtstag',
    [iso(new Date(year, 11,26))]: '2. Weihnachtstag',
  };
  return _holidays[year];
}

function isHoliday(iso) {
  const year = Number(iso.slice(0, 4));
  return getNRWHolidays(year)[iso] ?? null;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${pad2(d)}.${pad2(m)}.`;
}
function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = ['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(y, m-1, d).getDay()];
  return `${wd}., ${pad2(d)}.${pad2(m)}.`;
}
async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return r.json();
}
function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (ok ? '' : 'err');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}
function assignKey(date, loc, slot) { return `${date}|${loc}|${slot}`; }
function esc(s) { return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;'); }
// Lässt nur sichere Farb-Tokens durch (#hex, rgb/rgba, hsl, benannte Farben).
// Verhindert CSS-Injection über aus der DB stammende Farbwerte.
function safeColor(c) {
  const v = String(c == null ? '' : c).trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^rg(b|ba)?\(\s*[\d.,\s%]+\)$/.test(v)) return v;
  if (/^hsl(a)?\(\s*[\d.,\s%]+\)$/.test(v)) return v;
  if (/^[a-zA-Z]{3,20}$/.test(v)) return v;            // benannte Farbe
  return '#888';                                        // Fallback
}

/* ── Init ───────────────────────────────────────────────────────────────── */
async function init() {
  S.monday = isoMonday();
  S.agents = await api('/agents');
  renderAgentPills();
  await loadWeek();

  const now = new Date();
  document.getElementById('dashYear').value  = now.getFullYear();
  document.getElementById('dashMonth').value = now.getMonth() + 1;
  document.getElementById('monatYear').value  = now.getFullYear();
  document.getElementById('monatMonth').value = now.getMonth() + 1;

  document.addEventListener('click', e => {
    if (!document.getElementById('ctxMenu').contains(e.target)) closeCtx();
  });

  syncLeisteHeight();
  window.addEventListener('resize', syncLeisteHeight);
}

/* Höhe der (umbruchfähigen) Berater-Leiste an den sticky Tageskopf weitergeben,
   damit dieser exakt darunter andockt – egal über wie viele Zeilen die Pills laufen. */
function syncLeisteHeight() {
  const el = document.getElementById('beraterLeiste');
  if (!el) return;
  const h = el.classList.contains('hidden') ? 0 : el.offsetHeight;
  document.documentElement.style.setProperty('--leiste-h', h + 'px');
}

/* ── Agent Pills ────────────────────────────────────────────────────────── */
function renderAgentPills() {
  const active = S.agents.filter(a => a.active);
  document.getElementById('agentPills').innerHTML = active.map(a => `
    <button class="agent-pill ${S.selectedAgent?.id === a.id ? 'sel' : ''}"
      style="--ac:${safeColor(a.color)}" onclick="selectAgent(${Number(a.id)})" title="${esc(a.name)}">
      <span class="pill-dot"></span>
      <span class="pill-kuerzel">${esc(a.kuerzel)}</span>
      <span class="pill-name">${esc(a.name)}</span>
    </button>
  `).join('');
  document.getElementById('pillClear').classList.toggle('hidden', !S.selectedAgent);
  syncLeisteHeight();
}

function selectAgent(id) {
  // Erneuter Klick auf den bereits gewählten Berater → Auswahl aufheben (Toggle).
  if (S.selectedAgent && S.selectedAgent.id === id) { clearSelection(); return; }
  S.selectedAgent = S.agents.find(a => a.id === id) ?? null;
  renderAgentPills();
  renderGrid();
  refreshMonthIfActive();
}
function clearSelection() {
  S.selectedAgent = null;
  renderAgentPills();
  renderGrid();
  refreshMonthIfActive();
}
function refreshMonthIfActive() {
  if (document.getElementById('tp-monat')?.classList.contains('active')) loadMonthView();
}

/* ── Week navigation ────────────────────────────────────────────────────── */
function prevWeek() { S.monday = addDays(S.monday, -7); loadWeek(); }
function nextWeek() { S.monday = addDays(S.monday,  7); loadWeek(); }
function goToday()  { S.monday = isoMonday(); loadWeek(); }

/* Datum anklicken → nativer Kalender → zu beliebiger Woche/Monat springen */
function openWeekPicker() {
  const i = document.getElementById('weekPicker');
  i.value = S.monday;
  if (typeof i.showPicker === 'function') { try { i.showPicker(); return; } catch (e) {} }
  i.focus(); i.click();
}
function jumpToWeek(v) {
  if (!v) return;
  const [y, m, d] = v.split('-').map(Number);
  S.monday = isoMonday(new Date(y, m - 1, d));
  loadWeek();
}

async function loadWeek() {
  updateWeekLabel();
  const [asgns, notes] = await Promise.all([
    api(`/assignments?monday=${S.monday}`),
    api(`/notes?monday=${S.monday}`),
  ]);

  S.assignments = new Map();
  for (const a of asgns) {
    const k = assignKey(a.date, a.location, a.slot);
    if (!S.assignments.has(k)) S.assignments.set(k, []);
    S.assignments.get(k).push(a);
  }

  S.notes = new Map();
  for (const n of notes) S.notes.set(`${n.date}|${n.agent_id}`, n);

  renderGrid();

  var dr = document.getElementById('notesDrawer');
  if (dr) {
    var savedOpen = localStorage.getItem('notesDrawerOpen') === '1';
    if (savedOpen) dr.classList.add('open');
    dr.querySelector('.notes-drawer-handle').setAttribute('aria-expanded', String(savedOpen));
    renderNotes();
    _notesDrawerRendered = true;
  }
}

function updateWeekLabel() {
  const fri = addDays(S.monday, 4);
  document.getElementById('weekRange').textContent = `${fmtDate(S.monday)} – ${fmtDate(fri)}`;
  document.getElementById('weekLabel').textContent = `Woche: ${fmtDateLong(S.monday)} – ${fmtDateLong(fri)}`;
}

/* ── Planer Grid ────────────────────────────────────────────────────────── */
function renderGrid() {
  const days = Array.from({ length: 5 }, (_, i) => addDays(S.monday, i));
  const hasSel = !!S.selectedAgent;

  const dayHolidays = days.map(d => isHoliday(d));
  const dayStatus   = days.map(d => dayStaffing(d, S.assignments));

  // Header row
  let html = `<div class="pg-header">
    <div class="pg-slot-col"></div>
    ${days.map((d, i) => {
      const h  = dayHolidays[i];
      const st = dayStatus[i];
      const badge = h ? '' : (
        st.missing.length
          ? `<span class="staff-badge under" title="Unterbesetzt – fehlt: ${esc(missingLabel(st.missing))}">${WARN_ICON} unterbesetzt</span>`
          : st.partial.length
          ? `<span class="staff-badge partial" title="Teilbesetzt – ${esc(partialLabel(st.partial))}">${WARN_ICON} teilbesetzt</span>`
          : `<span class="staff-badge ok" title="Pflichtbesetzung vollständig">besetzt</span>`);
      const hdState = st.missing.length ? ' understaffed' : (st.partial.length ? ' partialstaffed' : '');
      return `<div class="pg-day-hd${h ? ' holiday' : hdState}">
        <b>${DAYS[i]}</b>
        <span>${fmtDate(d)}</span>
        ${h ? `<span class="hday-name">${h}</span>` : badge}
      </div>`;
    }).join('')}
  </div>`;

  for (const loc of LOCATIONS) {
    const shown = visibleSlots(loc);
    const extraTotal = loc.extra?.slots.length ?? 0;
    const extraShown = S_EXPAND.has(loc.id) ? extraTotal : (loc.extra?.defaultShow ?? 0);
    const remaining  = extraTotal - extraShown;

    const lc = LOC_COLORS[loc.id] || 'var(--stroke-hi)';
    html += `<div class="pg-section" style="--loc:${lc}">
      <div class="pg-section-lbl">
        <span class="loc-pip ${loc.id}"></span>${loc.label}
      </div>
    </div>`;
    for (const slot of shown) {
      const reqCls = isRequired(loc.id, slot) ? ' req' : '';
      html += `<div class="pg-row${reqCls}" style="--loc:${lc}">
        <div class="pg-slot-label">${SLOT_LABELS[slot] ?? slot}</div>
        ${days.map((date, i) => {
          if (dayHolidays[i]) return `<div class="pg-cell holiday"><span class="hday-dash">Feiertag</span></div>`;
          const list = S.assignments.get(assignKey(date, loc.id, slot)) ?? [];
          return cellHtml(date, loc.id, slot, list);
        }).join('')}
      </div>`;
    }
    if (loc.extra) {
      if (!S_EXPAND.has(loc.id) && remaining > 0) {
        html += `<div class="pg-row expand-row" style="--loc:${lc}">
          <button class="expand-btn" onclick="toggleExpand('${loc.id}')">${CHEV_DOWN} ${remaining} weitere</button>
          <div style="grid-column:span 5"></div>
        </div>`;
      } else if (S_EXPAND.has(loc.id)) {
        html += `<div class="pg-row expand-row" style="--loc:${lc}">
          <button class="expand-btn" onclick="toggleExpand('${loc.id}')">${CHEV_UP} einklappen</button>
          <div style="grid-column:span 5"></div>
        </div>`;
      }
    }
  }

  const el = document.getElementById('planerGrid');
  el.innerHTML = html;
  el.classList.toggle('has-sel', hasSel);
}

function cellHtml(date, loc, slot, list) {
  const hasAgent = !!S.selectedAgent;
  const bands = list.map(a => `
    <div class="time-band" style="--ac:${safeColor(a.color)}"
      onclick="showCtx(event,${Number(a.id)},'${date}','${loc}','${slot}')">
      <span class="band-kz">${esc(a.kuerzel)}</span>
      <span class="band-name">${esc(a.name)}</span>
      <span class="band-t">${esc(a.time_from)}–${esc(clampTo16(a.time_to))}</span>
      <button class="band-remove" onclick="event.stopPropagation();removeAssignment(${Number(a.id)})" title="Zuweisung entfernen">×</button>
    </div>`).join('');

  // Zweiten Berater nur anbieten, wenn 08:00–16:00 noch nicht lückenlos besetzt ist
  const addBand = (hasAgent && list.length && loc !== 'homeoffice' && hasCoreGap(list))
    ? `<div class="time-band add-more" title="Frei ${esc(gapLabel(list))} Uhr – Zeit hinzufügen" onclick="event.stopPropagation();openTimePickerForAdd('${date}','${loc}','${slot}')">＋ hinzufügen</div>`
    : '';

  if (list.length) {
    return `<div class="pg-cell has-agent">${bands}${addBand}</div>`;
  }

  // Empty cell
  const req = isRequired(loc, slot);
  const clickAttr = hasAgent ? `onclick="assignDefault('${date}','${loc}','${slot}')"` : '';
  const inner = hasAgent
    ? `<span class="cell-plus">＋</span><span class="cell-hint">08:00–16:00</span>`
    : (req ? `<span class="cell-req-miss">${WARN_ICON} fehlt</span>` : `<span class="cell-plus">–</span>`);
  return `<div class="pg-cell empty${req ? ' req-missing' : ''}" ${clickAttr}${req ? ' title="Pflichtbesetzung fehlt"' : ''}>${inner}</div>`;
}

/* ── Assignment Actions ─────────────────────────────────────────────────── */
async function assignDefault(date, loc, slot) {
  if (!S.selectedAgent) return;
  await api('/assignments', {
    method: 'PUT',
    body: { date, location: loc, slot, agent_id: S.selectedAgent.id, time_from: '08:00', time_to: '16:00' },
  });
  await loadWeek();
  toast(`${S.selectedAgent.kuerzel} eingetragen`);
}

function openTimePickerForAdd(date, loc, slot) {
  if (!S.selectedAgent) return;
  S.timeEditId = null;
  S.timeAddTarget = { date, loc, slot };
  document.getElementById('timeModalTitle').textContent =
    `Zeit – ${S.selectedAgent.name} (${SLOT_LABELS[slot] ?? slot})`;

  // Nur die erste unbesetzte Lücke im Kernfenster 08:00–16:00 anbieten
  const existing = S.assignments.get(assignKey(date, loc, slot)) ?? [];
  const gaps = coreGaps(existing);
  const [g0, g1] = gaps[0] ?? [tMin(CORE_FROM), tMin(CORE_TO)];
  const gapFrom = tStr(g0), gapTo = tStr(g1);
  S.timeGap = { from: gapFrom, to: gapTo };

  // Auswahl auf die Lücke begrenzen (BIS nie über 16:00)
  constrainTimeSelect('tmFrom', gapFrom, gapTo, gapFrom);
  constrainTimeSelect('tmTo',   gapFrom, gapTo, gapTo);
  document.getElementById('timeModal').classList.remove('hidden');
}

async function saveTime() {
  const from = document.getElementById('tmFrom').value;
  const to   = document.getElementById('tmTo').value;
  // Capture state BEFORE closeTimeModal() clears it
  const editId    = S.timeEditId;
  const addTarget = S.timeAddTarget ? { ...S.timeAddTarget } : null;
  closeTimeModal();

  if (editId) {
    await api(`/assignments/${editId}`, { method: 'PATCH', body: { time_from: from, time_to: to } });
    toast('Zeit aktualisiert');
  } else if (addTarget) {
    const { date, loc, slot } = addTarget;
    // In die angebotene Lücke einpassen (kein Überschreiben besetzter Zeiten)
    let tf = from, tt = to;
    const g = S.timeGap;
    if (g) {
      if (tf < g.from) tf = g.from;
      if (tt > g.to)   tt = g.to;
      if (tf >= tt)    { tf = g.from; tt = g.to; }
    }
    await api('/assignments', {
      method: 'PUT',
      body: { date, location: loc, slot, agent_id: S.selectedAgent.id, time_from: tf, time_to: tt },
    });
    toast(`${S.selectedAgent.kuerzel} eingetragen`);
  }
  S.timeGap = null;
  await loadWeek();
}

function closeTimeModal() {
  document.getElementById('timeModal').classList.add('hidden');
  S.timeEditId = null;
  S.timeAddTarget = null;
}

/* ── Context Menu ───────────────────────────────────────────────────────── */
function showCtx(e, assignmentId, date, loc, slot) {
  e.stopPropagation();
  S.ctxAssignmentId = assignmentId;
  S.ctxDate = date; S.ctxLoc = loc; S.ctxSlot = slot;

  const list = S.assignments.get(assignKey(date, loc, slot)) ?? [];
  const asgn = list.find(a => a.id === assignmentId);
  if (!asgn) return;

  document.getElementById('ctxAgentName').textContent = `${asgn.kuerzel} · ${asgn.name}`;
  document.getElementById('ctxTime').textContent      = `${asgn.time_from} – ${asgn.time_to}`;

  const m = document.getElementById('ctxMenu');
  m.classList.remove('hidden');
  const x = Math.min(e.clientX, window.innerWidth  - 200);
  const y = Math.min(e.clientY, window.innerHeight - 200);
  m.style.left = x + 'px';
  m.style.top  = y + 'px';
}

function closeCtx() { document.getElementById('ctxMenu').classList.add('hidden'); }

async function removeAssignment(id) {
  try {
    await api(`/assignments/${id}`, { method: 'DELETE' });
    await loadWeek();
    toast('Zuweisung entfernt');
  } catch (e) {
    toast('Fehler beim Entfernen – bitte neu laden', false);
  }
}
async function ctxRemove() {
  closeCtx();
  await removeAssignment(S.ctxAssignmentId);
}

function ctxSwap() {
  closeCtx();
  if (!S.selectedAgent) { toast('Bitte zuerst einen Berater auswählen', false); return; }
  const list = S.assignments.get(assignKey(S.ctxDate, S.ctxLoc, S.ctxSlot)) ?? [];
  const asgn = list.find(a => a.id === S.ctxAssignmentId);
  if (!asgn) return;
  // Replace this specific assignment's agent
  api('/assignments', {
    method: 'PUT',
    body: { date: S.ctxDate, location: S.ctxLoc, slot: S.ctxSlot,
            agent_id: S.selectedAgent.id, time_from: asgn.time_from, time_to: asgn.time_to },
  }).then(() => { loadWeek(); toast(`${S.selectedAgent.kuerzel} eingetragen`); });
}

function ctxEditTime() {
  closeCtx();
  const list = S.assignments.get(assignKey(S.ctxDate, S.ctxLoc, S.ctxSlot)) ?? [];
  const asgn = list.find(a => a.id === S.ctxAssignmentId);
  if (!asgn) return;

  S.timeEditId = S.ctxAssignmentId;
  S.timeAddTarget = null;
  S.timeGap = null;
  document.getElementById('timeModalTitle').textContent =
    `Zeit – ${asgn.name} (${SLOT_LABELS[S.ctxSlot] ?? S.ctxSlot})`;
  // Volle Auswahl, BIS jedoch nie über 16:00 (bestehende 16:30-Einträge → 16:00)
  constrainTimeSelect('tmFrom', CORE_FROM, '15:00', clampTo16(asgn.time_from));
  constrainTimeSelect('tmTo',   '09:00',   CORE_TO, clampTo16(asgn.time_to));
  document.getElementById('timeModal').classList.remove('hidden');
}

/* Begrenzt ein Zeit-<select> auf das Fenster [minStr,maxStr], stellt die nötigen
   (auch krummen) Optionen sicher und setzt den Wert. Optionen außerhalb des
   Fensters werden ausgeblendet/deaktiviert. */
function constrainTimeSelect(id, minStr, maxStr, value) {
  const sel = document.getElementById(id);
  // Zuvor dynamisch ergänzte Zeiten (z. B. 13:30) entfernen
  [...sel.options].filter(o => o.dataset.custom).forEach(o => o.remove());
  // Grenz- und Zielwerte als Option sicherstellen (Halbstunden etc.)
  for (const v of [minStr, maxStr, value]) {
    if (v && ![...sel.options].some(o => o.value === v)) {
      const opt = new Option(v, v);
      opt.dataset.custom = '1';
      const before = [...sel.options].find(o => o.value > v);
      sel.add(opt, before ?? null);
    }
  }
  // Optionen außerhalb des erlaubten Fensters sperren
  for (const o of sel.options) {
    const out = o.value < minStr || o.value > maxStr;
    o.disabled = out;
    o.hidden   = out;
  }
  sel.value = value;
}

async function ctxNote() {
  closeCtx();
  const list = S.assignments.get(assignKey(S.ctxDate, S.ctxLoc, S.ctxSlot)) ?? [];
  const asgn = list.find(a => a.id === S.ctxAssignmentId);
  if (!asgn) return;
  openNoteModal(S.ctxDate, asgn.agent_id, asgn.name);
}

/* ── Notes ──────────────────────────────────────────────────────────────── */
function renderNotes() {
  const days = Array.from({ length: 5 }, (_, i) => addDays(S.monday, i));
  const agentIds = new Set();
  for (const list of S.assignments.values()) for (const a of list) agentIds.add(a.agent_id);
  for (const k of S.notes.keys()) agentIds.add(Number(k.split('|')[1]));

  if (!agentIds.size) {
    document.getElementById('notesGrid').innerHTML =
      '<div style="color:var(--muted);font-size:13px;padding:8px 0">Noch keine Berater diese Woche eingeteilt.</div>';
    return;
  }

  const agentMap = Object.fromEntries(S.agents.map(a => [a.id, a]));

  // Header row
  let html = `<div class="notes-hdr-row">
    <div class="notes-name-col"></div>
    ${days.map((d, i) => `<div class="notes-day-hd">${DAYS[i]}<br><small>${fmtDate(d)}</small></div>`).join('')}
  </div>`;

  for (const aid of [...agentIds].sort((a, b) => a - b)) {
    const ag = agentMap[aid];
    if (!ag) continue;
    html += `<div class="notes-row">
      <div class="notes-name" style="--ac:${safeColor(ag.color)}">
        <span class="nd"></span>${esc(ag.name)}
      </div>`;
    for (const date of days) {
      const n = S.notes.get(`${date}|${aid}`);
      const kind = n ? noteKind(n.text) : '';
      const badge = n ? noteBadge(n.text) : '';
      html += `<div class="note-cell ${n ? 'filled ' + kind : ''}" title="${n ? esc(n.text) : 'Notiz hinzufügen'}" onclick="openNoteModal('${date}',${aid},'${esc(ag.name)}')">
        ${n ? `<span class="note-txt"><span class="note-badge">${badge}</span>${esc(n.text)}</span>` : '<span class="note-add">+</span>'}
      </div>`;
    }
    html += '</div>';
  }
  document.getElementById('notesGrid').innerHTML = html;
}

let _noteTarget = null;
function openNoteModal(date, agentId, agentName) {
  _noteTarget = { agentId, agentName };
  const n = S.notes.get(`${date}|${agentId}`);
  document.getElementById('noteTitle').textContent = `Notiz – ${agentName}`;
  document.getElementById('noteFrom').value = date;
  document.getElementById('noteTo').value   = date;
  document.getElementById('noteText').value = n?.text ?? '';
  document.getElementById('noteDelBtn').classList.toggle('hidden', !n);
  document.getElementById('noteModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('noteText').focus(), 50);
}
function closeNote() { document.getElementById('noteModal').classList.add('hidden'); _noteTarget = null; }

// Bis nie vor Von
function syncNoteTo() {
  const from = document.getElementById('noteFrom').value;
  const toEl = document.getElementById('noteTo');
  if (from && (!toEl.value || toEl.value < from)) toEl.value = from;
}
function noteQuickFill(t) {
  const ta = document.getElementById('noteText');
  ta.value = t; ta.focus();
}
// ISO-Tage von..bis inklusive (max. ~1 Jahr Schutz)
function dateRangeDays(fromIso, toIso) {
  const out = []; let d = fromIso, guard = 0;
  while (d <= toIso && guard < 400) { out.push(d); d = addDays(d, 1); guard++; }
  return out;
}
async function writeNoteRange(text) {
  if (!_noteTarget) return;
  const agentId = _noteTarget.agentId;
  let from = document.getElementById('noteFrom').value;
  let to   = document.getElementById('noteTo').value;
  if (!from) { toast('Bitte Von-Datum wählen'); return; }
  if (!to || to < from) to = from;
  const days = dateRangeDays(from, to);
  closeNote();
  for (const day of days) await api('/notes', { method: 'PUT', body: { date: day, agent_id: agentId, text } });
  await loadWeek();
  return days.length;
}
async function saveNote() {
  const text = document.getElementById('noteText').value;
  const n = await writeNoteRange(text);
  if (n != null) toast(n > 1 ? `Notiz für ${n} Tage gespeichert` : 'Notiz gespeichert');
}
async function deleteNoteRange() {
  const n = await writeNoteRange('');   // leerer Text → Server löscht je Tag
  if (n != null) toast(n > 1 ? `Notiz für ${n} Tage gelöscht` : 'Notiz gelöscht');
}

/* ── Month View ─────────────────────────────────────────────────────────── */
function prevMonth() {
  const sel = document.getElementById('monatMonth');
  let m = Number(sel.value), y = Number(document.getElementById('monatYear').value);
  if (--m < 1) { m = 12; y--; }
  document.getElementById('monatYear').value = y;
  sel.value = m;
  loadMonthView();
}
function nextMonth() {
  const sel = document.getElementById('monatMonth');
  let m = Number(sel.value), y = Number(document.getElementById('monatYear').value);
  if (++m > 12) { m = 1; y++; }
  document.getElementById('monatYear').value = y;
  sel.value = m;
  loadMonthView();
}

async function loadMonthView() {
  const y = Number(document.getElementById('monatYear').value);
  const m = Number(document.getElementById('monatMonth').value);
  const pad = n => String(n).padStart(2, '0');
  const from = `${y}-${pad(m)}-01`;
  const to   = `${y}-${pad(m)}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;

  const asgns = await api(`/assignments?from=${from}&to=${to}`);

  // Volle Assignments je Zelle behalten (id/agent_id/Zeiten) – für direktes Befüllen wie im Wochenplan
  S.monthData = new Map();
  for (const a of asgns) {
    const k = assignKey(a.date, a.location, a.slot);
    if (!S.monthData.has(k)) S.monthData.set(k, []);
    S.monthData.get(k).push(a);
  }

  const workDays = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    if (d.getDay() >= 1 && d.getDay() <= 5)
      workDays.push(localIso(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setDate(d.getDate() + 1);
  }

  renderMonthGrid(workDays);
}

function renderMonthGrid(workDays) {
  const el = document.getElementById('monatGrid');
  if (!workDays.length) { el.innerHTML = ''; return; }
  const selId = S.selectedAgent?.id ?? null;

  // Single CSS Grid: label column + one column per working day
  const cols = `120px repeat(${workDays.length}, minmax(42px, 1fr))`;

  // Header: empty corner + day labels
  const hds = workDays.map(dt => {
    const [yr, mo, dy] = dt.split('-').map(Number);
    const wd = ['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(yr, mo-1, dy).getDay()];
    // Datumskopf bleibt bewusst neutral – die Besetzungsfarben tragen die Zellen
    // darunter. Nur Feiertage werden hier deutlich markiert (Tag + Name).
    const h = isHoliday(dt);
    return `<div class="mg-day-hd${h ? ' holiday' : ''}" title="${h ? esc(h) : ''}">${h ? HOLIDAY_ICON : ''}<b>${wd}</b><span>${dy}.</span></div>`;
  }).join('');

  let html = `<div class="mg-wrap${selId ? ' has-sel' : ''}" style="grid-template-columns:${cols}">
    <div class="mg-slot-col"></div>${hds}`;

  for (const loc of LOCATIONS) {
    const lc = LOC_COLORS[loc.id] || 'var(--stroke-hi)';
    // Section label spans all columns
    html += `<div class="mg-section" style="--loc:${lc}"><span class="loc-pip ${loc.id}"></span>${loc.label}</div>`;
    for (const slot of allSlots(loc)) {
      const lbl = SLOT_LABELS[slot] ?? slot;
      const reqCls = isRequired(loc.id, slot) ? ' req' : '';
      html += `<div class="mg-slot-lbl${reqCls}" style="--loc:${lc}">${lbl}</div>`;
      for (const date of workDays) {
        const h = isHoliday(date);
        if (h) {
          html += `<div class="mg-cell holiday" title="${h}"></div>`;
          continue;
        }
        const list = S.monthData.get(assignKey(date, loc.id, slot)) ?? [];
        // je Berater nur ein Badge (Mehrfach-Zeiten zusammenfassen)
        const seen = new Set(); const agents = [];
        for (const a of list) { if (!seen.has(a.agent_id)) { seen.add(a.agent_id); agents.push(a); } }
        const cls = agents.length === 0
          ? (isRequired(loc.id, slot) ? 'empty req-missing' : 'empty')
          : (hasCoreGap(list) ? 'full partial' : 'full');
        const mine = selId != null && agents.some(a => a.agent_id === selId);
        const inner = agents.length
          ? agents.map(a => `<span class="mg-kz${a.agent_id === selId ? ' mine' : ''}" style="--ac:${safeColor(a.color)}">${esc(a.kuerzel)}</span>`).join('')
          : (selId != null ? '<span class="mg-plus">＋</span>' : '');
        // Tooltip: Name + Besetzungszeit(en) je Berater (Mehrfach-Zeiten zusammengefasst)
        const timesByAgent = new Map();
        for (const a of list) {
          if (!a.time_from || !a.time_to) continue;
          if (!timesByAgent.has(a.agent_id)) timesByAgent.set(a.agent_id, []);
          timesByAgent.get(a.agent_id).push(`${a.time_from}–${clampTo16(a.time_to)}`);
        }
        const agentNames = agents.length > 0
          ? agents.map(a => {
              const t = timesByAgent.get(a.agent_id) ?? [];
              return t.length ? `${a.name} (${t.join(', ')})` : a.name;
            }).join(', ') + ' · '
          : '';
        const click = `onclick="monthCellClick('${date}','${loc.id}','${slot}')"`;
        html += `<div class="mg-cell ${cls}${mine ? ' mine' : ''}" ${click} title="${agentNames}${loc.label} · ${lbl} · ${fmtDate(date)}">${inner}</div>`;
      }
    }
  }
  html += '</div>';
  el.innerHTML = html;
}

/* Monatskachel anklicken: ausgewählten Berater zuweisen (oder entfernen, wenn schon drin) – wie Wochenplan */
function pickFreeFrom(list) {
  const used = new Set(list.map(a => a.time_from));
  for (const t of ['08:00','10:00','12:00','13:00','14:00','15:00']) if (!used.has(t)) return t;
  return '08:00';
}
async function monthCellClick(date, loc, slot) {
  if (!S.selectedAgent) { toast('Erst Berater auswählen'); return; }
  const list = S.monthData.get(assignKey(date, loc, slot)) ?? [];
  const mine = list.find(a => a.agent_id === S.selectedAgent.id);
  if (mine) {
    await api(`/assignments/${mine.id}`, { method: 'DELETE' });
    toast(`${S.selectedAgent.kuerzel} entfernt`);
  } else {
    await api('/assignments', {
      method: 'PUT',
      body: { date, location: loc, slot, agent_id: S.selectedAgent.id, time_from: pickFreeFrom(list), time_to: '16:00' },
    });
    toast(`${S.selectedAgent.kuerzel} eingetragen`);
  }
  await loadMonthView();
}

/* ── Dashboard ──────────────────────────────────────────────────────────── */
let dashAlltime = false;

function toggleAlltime() {
  dashAlltime = !dashAlltime;
  const btn = document.getElementById('btnAlltime');
  btn.classList.toggle('active', dashAlltime);
  document.getElementById('dashYear').disabled  = dashAlltime;
  document.getElementById('dashMonth').disabled = dashAlltime;
  loadStats();
}

let dashAgents = [];          // letzte Stats-Antwort (für Re-Render ohne Refetch)
let dashShowInactive = false; // "inaktiv" = keine Einsätze im Zeitraum (total === 0)

function setShowInactive(v) {
  dashShowInactive = v;
  renderStatsTable();
}

async function loadStats() {
  let qs;
  if (dashAlltime) {
    qs = '';
  } else {
    const y = document.getElementById('dashYear').value;
    const m = document.getElementById('dashMonth').value;
    qs = m ? `year=${y}&month=${m}` : `year=${y}`;
  }
  const { agents } = await api(`/stats?${qs}`);
  dashAgents = agents || [];
  renderStatsTable();
}

function renderStatsTable() {
  // "aktiv" in dieser Ansicht = nicht deaktiviert (Admin-Flag) UND Einsätze im Zeitraum
  const isActiveRow = a => a.active !== 0 && a.total > 0;
  const inactiveCount = dashAgents.filter(a => !isActiveRow(a)).length;
  const list = dashShowInactive ? dashAgents : dashAgents.filter(isActiveRow);

  const note = (!dashShowInactive && inactiveCount)
    ? `<div class="st-note">${inactiveCount} inaktive Berater ausgeblendet</div>`
    : '';

  document.getElementById('dashTable').innerHTML = list.length ? `
    <table class="st">
      <thead><tr>
        <th>Berater</th>
        <th style="text-align:right">Kall</th>
        <th style="text-align:right">Euskirchen</th>
        <th style="text-align:right">HO</th>
        <th style="text-align:right">Gesamt</th>
        <th>Standortverteilung</th>
      </tr></thead>
      <tbody>${list.map(a => {
        const tot = a.total || 0;
        const kQ = tot ? Math.round(a.kall        / tot * 100) : 0;
        const eQ = tot ? Math.round(a.euskirchen  / tot * 100) : 0;
        const hQ = tot ? (100 - kQ - eQ)                       : 0;
        const distCell = tot ? `
          <div class="dist-bar">
            ${kQ > 0 ? `<div class="db-seg" style="width:${kQ}%;background:#E8A06A"></div>` : ''}
            ${eQ > 0 ? `<div class="db-seg" style="width:${eQ}%;background:#7A8BF0"></div>` : ''}
            ${hQ > 0 ? `<div class="db-seg" style="width:${hQ}%;background:#5FD6A0"></div>` : ''}
          </div>
          <div class="dist-pct">
            <span style="color:#E8A06A">Kall</span>&thinsp;${kQ}%
            <span class="dist-sep">·</span>
            <span style="color:#7A8BF0">Euskirchen</span>&thinsp;${eQ}%
            <span class="dist-sep">·</span>
            <span style="color:#5FD6A0">Homeoffice</span>&thinsp;${hQ}%
          </div>` : '<span style="color:var(--muted-2);font-size:11px">–</span>';
        const inactiveTag = a.active === 0 ? ' <span class="st-inactive-tag">inaktiv</span>' : '';
        return `<tr${a.active === 0 ? ' class="st-row-inactive"' : ''}>
          <td><span class="adot" style="background:${safeColor(a.color)}"></span>${esc(a.name)}${inactiveTag}</td>
          <td class="num">${a.kall}</td>
          <td class="num">${a.euskirchen}</td>
          <td class="num">${a.homeoffice}</td>
          <td class="num">${a.total}</td>
          <td><div class="dist-wrap">${distCell}</div></td>
        </tr>`;
      }).join('')}</tbody>
    </table>${note}
  ` : `<div style="color:var(--muted);padding:16px 0;font-size:13px">Keine aktiven Berater im Zeitraum</div>${note}`;
}

/* ── Admin ──────────────────────────────────────────────────────────────── */
async function loadAdmin() {
  S.agents = await api('/agents');
  renderAgentPills();
  renderAdminList();
}

function renderAdminList() {
  document.getElementById('adminList').innerHTML = S.agents.map(a => `
    <div class="adm-row ${a.active ? '' : 'inactive'}">
      <span class="adm-dot" style="background:${safeColor(a.color)}"></span>
      <span class="adm-name">${esc(a.name)}</span>
      <span class="adm-kz">${esc(a.kuerzel)}</span>
      <button class="adm-btn ${a.active ? 'pos' : ''}" onclick="toggleAgent(${Number(a.id)},${a.active})">
        ${a.active ? 'Aktiv' : 'Inaktiv'}
      </button>
    </div>
  `).join('');
}

async function toggleAgent(id, active) {
  await api(`/agents/${id}`, { method: 'PATCH', body: { active: active ? 0 : 1 } });
  await loadAdmin();
  toast(active ? 'Berater deaktiviert' : 'Berater aktiviert');
}

async function createAgent() {
  const name    = document.getElementById('newName').value.trim();
  const kuerzel = document.getElementById('newKuerzel').value.trim();
  const color   = document.getElementById('newColor').value;
  if (!name || !kuerzel) { toast('Name und Kürzel sind erforderlich', false); return; }
  await api('/agents', { method: 'POST', body: { name, kuerzel, color } });
  document.getElementById('newName').value = '';
  document.getElementById('newKuerzel').value = '';
  await loadAdmin();
  toast(`${kuerzel} wurde angelegt`);
}

function syncColor(val) {
  document.getElementById('newColorPreview').style.background = val;
}

/* ── Tab switching ──────────────────────────────────────────────────────── */
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.mod-item').forEach(b => b.classList.remove('active'));
  document.getElementById('tp-' + name)?.classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${name}"]`)?.classList.add('active');
  document.querySelector(`.mod-item[data-tab-link="${name}"]`)?.classList.add('active');
  document.getElementById('weekNav').style.display = (name === 'plan') ? '' : 'none';
  document.getElementById('beraterLeiste')?.classList.toggle('hidden', name === 'dashboard');
  syncLeisteHeight();

  if (name === 'dashboard') loadStats();
  if (name === 'monat')     loadMonthView();
}

/* ── Notizen Drawer ─────────────────────────────────────────────────────── */
var _notesDrawerRendered = false;
function toggleNotesDrawer() {
  var dr = document.getElementById('notesDrawer');
  var isOpen = dr.classList.toggle('open');
  dr.querySelector('.notes-drawer-handle').setAttribute('aria-expanded', String(isOpen));
  localStorage.setItem('notesDrawerOpen', isOpen ? '1' : '0');
  if (isOpen && !_notesDrawerRendered) { renderNotes(); _notesDrawerRendered = true; }
}

/* ── Boot ───────────────────────────────────────────────────────────────── */
init();
