// Driver-Auswahl + Verbindungs-Konfiguration (pro logischer DB).
//
// Entscheidung (2026-06-21): 3 getrennte Datenbanken bleiben bestehen
// (produkte / besucher / einsatzplan), jede mit eigener Verbindung.
//
// Lokal:  file:-Modus auf api/db/<name>.sqlite  (kein Cloud-Zugriff nötig)
// Vercel/Turso:  je DB eine ENV-Variable mit libsql://…-URL + Auth-Token setzen.
//
// Nur der Connection-String wechselt — derselbe @libsql/client-Code läuft lokal wie remote.

const path = require('path');
const { pathToFileURL } = require('url');
const { makeDb } = require('./libsql');

// api/db/<name> → korrekt enkodierter file:-URL (Leerzeichen im Pfad "Claude Code" werden zu %20).
// backend/data/driver/ → backend/data/ → backend/ → project-root/ → api/db/
const DB_DIR = path.join(__dirname, '..', '..', '..', 'api', 'db');
// `name` ist NIE User-Input: ausschließlich drei hartcodierte Literale (s. CONFIG unten).
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
const fileUrl = (name) => pathToFileURL(path.join(DB_DIR, name)).href;

// Pro DB: ENV-URL/-Token gewinnen, sonst lokale Datei. (DB_DRIVER ist Reserve für künftige Treiber.)
const CONFIG = {
  produkte: {
    url: process.env.PRODUKTE_DB_URL || fileUrl('produkte.sqlite'),
    authToken: process.env.PRODUKTE_DB_AUTH_TOKEN,
  },
  besucher: {
    url: process.env.BESUCHER_DB_URL || fileUrl('besucher.sqlite'),
    authToken: process.env.BESUCHER_DB_AUTH_TOKEN,
  },
  einsatzplan: {
    url: process.env.EINSATZPLAN_DB_URL || fileUrl('einsatzplan.sqlite'),
    authToken: process.env.EINSATZPLAN_DB_AUTH_TOKEN,
  },
};

const cache = {};

// Liefert das (gecachte) Driver-Interface { all, get, run, exec, transaction } für eine DB.
function getDb(key) {
  const cfg = CONFIG[key];
  if (!cfg) throw new Error(`Unbekannte Datenbank: ${key}`);
  if (!cache[key]) cache[key] = makeDb(cfg.url, cfg.authToken);
  return cache[key];
}

module.exports = { getDb, CONFIG };
