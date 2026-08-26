const crypto = require('node:crypto');

const COOKIE_NAME = 'emias_citizen';
const SESSION_TTL_HOURS = 12;

const store = new Map(); // token -> { accountId, discordId, username, avatar, patientId, patient, expires }

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

function createSession(account, patient, isSecure) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  store.set(token, {
    accountId: account.id,
    discordId: account.discordId,
    username: account.username,
    avatar: account.avatar,
    patientId: patient ? patient.id : null,
    patient,
    expires,
  });
  return { token, expires, cookie: serializeCookie(token, expires, isSecure) };
}

function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const entry = store.get(token);
  if (!entry || entry.expires < new Date()) {
    store.delete(token);
    return null;
  }
  return {
    token,
    account: {
      id: entry.accountId,
      discordId: entry.discordId,
      username: entry.username,
      avatar: entry.avatar,
    },
    patient: entry.patient,
  };
}

function setPatient(token, patient) {
  const entry = store.get(token);
  if (!entry) return;
  entry.patientId = patient ? patient.id : null;
  entry.patient = patient;
}

function destroy(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  store.delete(token);
}

function clearCookie(isSecure) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = { createSession, getSession, setPatient, destroy, clearCookie, COOKIE_NAME };
