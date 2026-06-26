// Geteilte Logik für PDF-Quellen (Upload aus DB · URL proxyen · legacy local).
// Genutzt von routes/vertragsformulare.js und routes/standaloneFormulare.js,
// damit der SSRF-Schutz an genau einer Stelle lebt.

const fs   = require('node:fs');
const path = require('node:path');
const dns  = require('node:dns').promises;
const net  = require('node:net');

// Basis-Verzeichnis für legacy 'local'-PDF-Quellen. Nur Dateien hierunter werden
// ausgeliefert (Schutz gegen Path-Traversal / Symlink-Ausbruch).
const LOCAL_PDF_BASE = (() => {
  const base = process.env.LOCAL_PDF_DIR || path.resolve(__dirname, '..', '..', 'pdf-vorlagen');
  try { return fs.realpathSync(base); } catch { return path.resolve(base); }
})();

const FETCH_TIMEOUT_MS = 8000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

// Prüft, ob ein Hostname auf eine private/loopback/link-local-Adresse zeigt.
function isBlockedAddress(addr) {
  if (net.isIP(addr) === 0) return false;
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    if (a === 127) return true;                          // loopback
    if (a === 10) return true;                           // private
    if (a === 192 && b === 168) return true;             // private
    if (a === 172 && b >= 16 && b <= 31) return true;    // private
    if (a === 169 && b === 254) return true;             // link-local / metadata
    if (a === 0) return true;
    return false;
  }
  // IPv6
  const lc = addr.toLowerCase();
  if (lc === '::1' || lc === '::') return true;          // loopback / unspecified
  if (lc.startsWith('fe80')) return true;                // link-local
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true; // unique local
  if (lc.startsWith('::ffff:')) return isBlockedAddress(lc.replace('::ffff:', '')); // IPv4-mapped
  return false;
}

// Validiert eine Proxy-URL gegen SSRF: nur http/https, kein Zugriff auf interne IPs.
// Wirft bei Verstoß. Gibt die geprüfte URL zurück.
async function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Ungültige URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Nur http/https erlaubt');
  }
  if (net.isIP(u.hostname) && isBlockedAddress(u.hostname)) {
    throw new Error('Interne Adresse blockiert');
  }
  // Hostname auflösen und jede Antwort-Adresse prüfen (DNS-Rebinding-Schutz).
  const records = await dns.lookup(u.hostname, { all: true });
  for (const r of records) {
    if (isBlockedAddress(r.address)) throw new Error('Interne Adresse blockiert');
  }
  return u.toString();
}

// Liefert ein PDF aus einem DB-Row (Spalten source_type/source_value/file_data/name)
// als Fastify-Reply aus. Deckt 'upload' (Base64), 'local' (legacy Datei) und
// 'url' (geproxyt mit SSRF-Schutz) ab.
async function sendPdfFromRow(row, reply, req) {
  const setPdfHeaders = () => {
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(row.name || 'formular')}.pdf"`);
  };

  if (row.source_type === 'upload') {
    if (!row.file_data) return reply.code(404).send({ error: 'Keine Datei gespeichert' });
    setPdfHeaders();
    return reply.send(Buffer.from(row.file_data, 'base64'));
  }

  if (row.source_type === 'local') {
    const candidate = path.resolve(LOCAL_PDF_BASE, row.source_value);
    let realPath;
    try {
      realPath = fs.realpathSync(candidate);            // löst Symlinks auf
    } catch {
      return reply.code(404).send({ error: 'Lokale Datei nicht gefunden' });
    }
    const rel = path.relative(LOCAL_PDF_BASE, realPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return reply.code(403).send({ error: 'Pfad außerhalb des erlaubten Verzeichnisses' });
    }
    setPdfHeaders();
    return reply.send(fs.createReadStream(realPath));
  }

  // URL-Quelle: über Backend proxyen (vermeidet CORS im Browser).
  let safeUrl;
  try {
    safeUrl = await assertSafeUrl(row.source_value);
  } catch (e) {
    if (req) req.log.warn({ err: e, id: row.id }, 'PDF-URL abgelehnt (SSRF-Schutz)');
    return reply.code(400).send({ error: 'PDF-URL nicht erlaubt' });
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(safeUrl, { redirect: 'error', signal: ac.signal }); // nosemgrep: eregio-ssrf-fetch — URL via assertSafeUrl() geprüft (Schema/IP/DNS), Redirects aus
    if (!res.ok) {
      return reply.code(502).send({ error: `PDF-URL nicht erreichbar: ${res.status}` });
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_PDF_BYTES) {
      return reply.code(502).send({ error: 'PDF zu groß' });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) {
      return reply.code(502).send({ error: 'PDF zu groß' });
    }
    setPdfHeaders();
    return reply.send(buf);
  } catch (e) {
    if (req) req.log.warn({ err: e, id: row.id }, 'PDF-Proxy fehlgeschlagen');
    return reply.code(502).send({ error: 'PDF konnte nicht geladen werden' });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { assertSafeUrl, isBlockedAddress, sendPdfFromRow, LOCAL_PDF_BASE };
