// Website-weiter Besuchs-Login: statisches Passwort → signiertes, zustandsloses Token.
//
// Das Token wird im Backend (node:crypto) signiert und in der Vercel-Edge-Middleware
// (Web-Crypto) verifiziert — identisches Format, damit BEIDE Runtimes es prüfen können.
//
// Format (URL-safe):  <b64url(JSON{v,exp})>.<b64url(HMAC_SHA256(SITE_AUTH_SECRET, msg))>
//   exp = Unix-Sekunden, ab denen das Token ungültig ist.
//
// Konfig über Env:
//   SITE_PASSWORD     – das Login-Passwort
//   SITE_AUTH_SECRET  – HMAC-Schlüssel zum Signieren/Verifizieren
// Beide analog zu ADMIN_API_TOKEN: Env zuerst, lokaler Dev-Fallback, in Prod fail-closed.

const crypto = require('node:crypto');
const { safeEqual } = require('./auth');

const COOKIE_NAME = 'site_auth';
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 Tage

// Lokale Dev-Fallbacks: erlauben Arbeiten ohne gesetzte Env-Vars. In Produktion
// (Vercel, nicht development) gilt KEIN Fallback → fail-closed.
const DEV_FALLBACK_PASSWORD = 'eregio2026#';
const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-change-me';

function inCloudProd() {
  return Boolean(process.env.VERCEL) && process.env.VERCEL_ENV !== 'development';
}

// null  → in Prod nicht konfiguriert (Aufrufer soll 503 liefern)
function expectedPassword() {
  const p = process.env.SITE_PASSWORD;
  if (p && p.length > 0) return p;
  if (inCloudProd()) return null;
  return DEV_FALLBACK_PASSWORD;
}

function authSecret() {
  const s = process.env.SITE_AUTH_SECRET;
  if (s && s.length > 0) return s;
  if (inCloudProd()) return null;
  return DEV_FALLBACK_SECRET;
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hmac(secret, msg) {
  return crypto.createHmac('sha256', secret).update(msg).digest(); // Buffer
}

// Passwort-Hashing mit Node built-in crypto (kein extra npm-Paket).
// Format: "<salt_hex>:<hash_hex>"
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  const idx = stored.indexOf(':');
  if (idx < 0) return false;
  const salt = stored.slice(0, idx);
  const expected = stored.slice(idx + 1);
  const got = crypto.pbkdf2Sync(plain, salt, 100000, 64, 'sha512').toString('hex');
  return safeEqual(got, expected);
}

// Signiert ein neues Token mit optionalem User-Kontext.
// payload: { username, modules: [...], isAdmin }
function signSiteToken(ttlSeconds = DEFAULT_TTL_SECONDS, userPayload = {}) {
  const secret = authSecret();
  if (!secret) throw new Error('SITE_AUTH_SECRET not configured');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const msg = b64urlEncode(JSON.stringify({ v: 1, exp, ...userPayload }));
  const sig = b64urlEncode(hmac(secret, msg));
  return `${msg}.${sig}`;
}

// Verifiziert ein Token (Signatur + Ablauf). Gibt Payload-Objekt zurück oder null.
function verifySiteToken(token) {
  const secret = authSecret();
  if (!secret || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const msg = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = b64urlEncode(hmac(secret, msg));
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(msg, 'base64url').toString('utf8'));
    if (!payload || payload.v !== 1 || typeof payload.exp !== 'number') return null;
    if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// true, wenn das Auth-Secret vorhanden ist (Login ist DB-basiert, kein SITE_PASSWORD mehr nötig).
function isConfigured() {
  return authSecret() != null;
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  expectedPassword,
  hashPassword,
  verifyPassword,
  signSiteToken,
  verifySiteToken,
  isConfigured,
};
