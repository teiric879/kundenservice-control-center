// Vercel Routing/Edge-Middleware — der website-weite Besuchs-Gate.
//
// Läuft auf JEDEM Request (statische Seiten + /api), den der `matcher` nicht ausnimmt.
// Das ist die einzige Stelle, die auch die von Vercels CDN ausgelieferten HTML-Seiten
// sieht (das Fastify-Backend bekommt nur /api/* zu sehen).
//
// Logik: signiertes `site_auth`-Cookie (vom Backend, POST /api/auth/login) prüfen.
//   gültig   → durchlassen (next())
//   ungültig → 302 auf /login.html?next=<Zielpfad>
//
// Token-Format identisch zu backend/lib/site-auth.js:
//   <b64url(JSON{v,exp})>.<b64url(HMAC_SHA256(SITE_AUTH_SECRET, msg))>
// Verifikation hier mit Web-Crypto (Edge-Runtime), Secret aus SITE_AUTH_SECRET.

import { next } from '@vercel/functions';

// Offene Pfade (kein Login nötig): Login-Seite, Login-/Logout-API, Health-Check,
// gemeinsame Assets (Logo + Fonts für die Login-Seite), favicon/robots.
export const config = {
  matcher: ['/((?!login.html|api/auth/|api/health|shared/|favicon.ico|robots.txt).*)'],
};

const COOKIE_NAME = 'site_auth';

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

async function verify(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const msg = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), enc.encode(msg));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(msg)));
    if (!payload || payload.v !== 1 || typeof payload.exp !== 'number') return false;
    return Math.floor(Date.now() / 1000) < payload.exp;
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const secret = process.env.SITE_AUTH_SECRET;

  // Secret vorhanden + gültiges Cookie → durchlassen. Fehlt das Secret (Prod-
  // Fehlkonfiguration), wird NICHT durchgelassen → fail-closed.
  if (secret) {
    const token = getCookie(request, COOKIE_NAME);
    if (token && (await verify(token, secret))) return next();
  }

  const url = new URL(request.url);
  const loginUrl = new URL('/login.html', request.url);
  const nextPath = url.pathname + url.search;
  if (nextPath && nextPath !== '/') loginUrl.searchParams.set('next', nextPath);
  return Response.redirect(loginUrl, 302);
}
