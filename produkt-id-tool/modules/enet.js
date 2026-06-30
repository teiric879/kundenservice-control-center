// NB/GV-Lookup je PLZ über die bundesweite API (Quelle: enet, Tabelle enet_betreiber).
// Wird erst bei PLZ-Eingabe aufgerufen (kein top-level-await), mit kleinem In-Memory-Cache.

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const API_BASE = LOCAL_HOSTS.includes(location.hostname) ? `http://${location.hostname}:3001` : '';

const cache = {};

export async function lookupEnet(plz) {
  if (!/^\d{5}$/.test(plz)) return null;
  if (cache[plz] !== undefined) return cache[plz];
  try {
    const r = await fetch(`${API_BASE}/api/enet/lookup?plz=${plz}`);
    if (!r.ok) { cache[plz] = null; return null; }
    const j = await r.json();
    cache[plz] = j;
    return j;
  } catch {
    cache[plz] = null;
    return null;
  }
}
