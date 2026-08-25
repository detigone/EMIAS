'use strict';

const crypto = require('node:crypto');
const { getDb } = require('../db/connection');

/**
 * Серверные сессии: в cookie — только непрозрачный токен,
 * состояние хранится в таблице sessions (возможен отзыв).
 */

const COOKIE_NAME = 'emias_session';
const SESSION_TTL_DAYS = 7;

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

function createSession(userId, isSecure) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(`INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)`).run(
    userId,
    token,
    expires.toISOString()
  );
  return { token, expires, cookie: serializeCookie(token, expires, isSecure) };
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

function clearCookie(isSecure) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

/** Возвращает пользователя активной сессии или null. */
function getSessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.discord_id, u.discord_username, u.discord_avatar,
              u.full_name, u.specialty, u.role, u.status
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
          AND s.expires_at > ?
          AND u.is_active = 1`
    )
    .get(token, new Date().toISOString());
  return row || null;
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

module.exports = { createSession, getSessionUser, destroySession, clearCookie, COOKIE_NAME };
