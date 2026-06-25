const fs   = require('node:fs');
const path = require('node:path');
const dns  = require('node:dns').promises;
const net  = require('node:net');
const repo = require('../data/repositories/vertragsformulareRepo');
const { requireAdmin } = require('../lib/auth');

// Upload-Body kann groß sein (Base64-PDF). 20 MB Limit für POST/PUT.
// Schreibrouten zusätzlich hinter dem Admin-Token-Gate.
const BIG_BODY = { bodyLimit: 20 * 1024 * 1024, preHandler: requireAdmin };

// Basis-Verzeichnis für legacy 'local'-PDF-Quellen. Nur Dateien hierunter werden
// ausgeliefert (Schutz gegen Path-Traversal / Symlink-Ausbruch). Existiert der
// Ordner nicht (z. B. serverless), bleibt der resolved-Pfad als Schranke stehen.
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
  // Direkt als IP angegeben?
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

module.exports = async function vertragsformulareRoutes(fastify) {
  // ── Liste aller Einträge (ohne file_data) ─────────────────────────────────
  fastify.get('/api/vertragsformulare', async () => {
    const items = await repo.listAll();
    return { ok: true, items };
  });

  // ── Neuen Eintrag anlegen ─────────────────────────────────────────────────
  fastify.post('/api/vertragsformulare', BIG_BODY, async (req, reply) => {
    const { sparte, produkt_key, name, source_type, source_value, file_base64, sort_order } = req.body || {};
    if (!sparte || !produkt_key) {
      return reply.code(400).send({ error: 'sparte und produkt_key sind erforderlich' });
    }
    const type = source_type || 'upload';
    if (type === 'url' && !source_value) {
      return reply.code(400).send({ error: 'source_value (URL) ist erforderlich' });
    }
    if (type === 'upload' && !file_base64) {
      return reply.code(400).send({ error: 'file_base64 (Datei) ist erforderlich' });
    }
    const id = await repo.insert({
      sparte,
      produkt_key,
      name: name || 'Standardvertrag',
      source_type: type,
      source_value: source_value || '',
      file_data: type === 'upload' ? file_base64 : null,
      sort_order: sort_order ?? 0,
    });
    return { ok: true, id };
  });

  // ── Eintrag aktualisieren ─────────────────────────────────────────────────
  fastify.put('/api/vertragsformulare/:id', BIG_BODY, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const { name, source_type, source_value, file_base64, sort_order } = req.body || {};
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    const type = source_type || row.source_type;
    await repo.update(id, {
      name: name || row.name,
      source_type: type,
      source_value: source_value ?? row.source_value,
      // Nur überschreiben, wenn eine neue Datei kommt; bei URL file_data leeren.
      file_data: type === 'url' ? '' : (file_base64 || undefined),
      sort_order: sort_order ?? row.sort_order,
    });
    return { ok: true };
  });

  // ── Eintrag löschen ───────────────────────────────────────────────────────
  fastify.delete('/api/vertragsformulare/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    await repo.deleteById(id);
    return { ok: true };
  });

  // ── PDF ausliefern (upload aus DB · url proxyen · local legacy) ────────────
  fastify.get('/api/vertragsformulare/:id/file', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const row = await repo.getById(id);
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });

    // PDF-Header erst kurz vor dem Senden setzen — sonst kollidieren Fehler-JSONs
    // mit Content-Type: application/pdf.
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
      // Legacy: lokaler Pfad — nur innerhalb LOCAL_PDF_BASE zulässig (Path-Traversal-Schutz).
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
    // SSRF-Schutz: nur http/https, keine internen Adressen, Timeout + Größenlimit.
    let safeUrl;
    try {
      safeUrl = await assertSafeUrl(row.source_value);
    } catch (e) {
      req.log.warn({ err: e, id }, 'PDF-URL abgelehnt (SSRF-Schutz)');
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
      req.log.warn({ err: e, id }, 'PDF-Proxy fehlgeschlagen');
      return reply.code(502).send({ error: 'PDF konnte nicht geladen werden' });
    } finally {
      clearTimeout(timer);
    }
  });
};
