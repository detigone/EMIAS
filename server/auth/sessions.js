const crypto = require('node:crypto');

const COOKIE_NAME = 'emias_session';
const SESSION_TTL_DAYS = 7;

const store = new Map(); // token -> { user, expires }

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function serializeCookie(token, expires, isSecure) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

function createSession(user, isSecure) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  store.set(token, { user, expires });
  return { token, expires, cookie: serializeCookie(token, expires, isSecure) };
}

function getSessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const entry = store.get(token);
  if (!entry || entry.expires < new Date()) {
    store.delete(token);
    return null;
  }
  if (!entry.user.is_active) {
    store.delete(token);
    return null;
  }
  return entry.user;
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  store.delete(token);
}

function clearCookie(isSecure) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = { createSession, getSessionUser, destroySession, clearCookie, COOKIE_NAME };
