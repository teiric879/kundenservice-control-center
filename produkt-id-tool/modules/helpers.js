export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function addMonthsLastDay(dateStr, months) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d;
}

// Preisgarantie-Ende. Zwei Fälle, abhängig vom gewählten Vertragsbeginn-Tag:
//  • Beginn = 1. ODER letzter Tag des Monats → Laufzeitende minus 1 Tag (364 Tage, wie bisher).
//  • Beginn = irgendein anderer Tag         → bis zum letzten Tag des End-Monats (Beginn + months).
export function addMonthsPriceGuarantee(dateStr, months) {
  if (!dateStr) return null;
  const start = new Date(dateStr);
  const y = start.getFullYear(), m = start.getMonth(), day = start.getDate();
  const lastDayOfStartMonth = new Date(y, m + 1, 0).getDate();

  if (day === 1 || day === lastDayOfStartMonth) {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + months);
    d.setDate(d.getDate() - 1);
    return d;
  }
  // Tag 0 des Folgemonats = letzter Tag des End-Monats (Jahres-Überlauf wird automatisch behandelt)
  return new Date(y, m + months + 1, 0);
}

export function fmtDate(d) {
  if (!d) return '–';
  return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
}

export function copyVal(val) {
  navigator.clipboard.writeText(String(val)).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = String(val); document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
}

export function myRound(v, d = 2) {
  const f = Math.pow(10, d);
  return Math.ceil(v * f) / f;
}

export function eur(v) {
  return v.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' €';
}

export function ct(v) {
  return v.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ct/kWh';
}

export function dateFmt(s) {
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

export function escape(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export const CARD_COLORS = {
  'Basis':       ['#002e28','#004B43'],
  'Komfort':     ['#003d50','#005a72'],
  'Klima+':      ['#1a3d28','#2d5c3a'],
  'Dynamik':     ['#1a2838','#28405a'],
  'WP':          ['#1a0028','#2d0040'],
  'NS-Gem':      ['#280018','#3d0025'],
  'NS-Get':      ['#28100a','#3d180f'],
  'Mobil':       ['#001e3d','#003070'],
  'MobilPlus':   ['#00153d','#002268'],
  '__default__': ['#003431','#004B43'],
};

export function cardColors(key) {
  if (/^(WP|Wallbox|Sonstiges)-M\d$/.test(key)) return ['#001428','#00203d'];
  return CARD_COLORS[key] || CARD_COLORS['__default__'];
}
