'use strict';

const crypto = require('node:crypto');
const { getDb } = require('../db/connection');

/**
 * Сессии граждан (персонажей). Отдельная от персонала кука emias_citizen.
 * Сессия ссылается на citizen_accounts (Discord) и выбранный персонаж
 * (patients.id). patient_id = NULL значит «Discord подтверждён, персонаж
 * ещё не выбран» — экран выбора профиля при каждом входе.
 */

const COOKIE_NAME = 'emias_citizen';
const SESSION_TTL_HOURS = 12;

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

function serialize(token, expires, isSecure) {
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

/** Создать сессию для Discord-аккаунта гражданина. */
function createSession(accountId, patientId, isSecure) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO citizen_sessions (token, account_id, patient_id, expires_at) VALUES (?, ?, ?, ?)`
  ).run(token, accountId, patientId || null, expires.toISOString());
  return { token, expires, cookie: serialize(token, expires, isSecure) };
}

function clearCookie(isSecure) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Активная сессия гражданина или null.
 * Возвращает { session, account, patient }.
 */
function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cs.token AS session_token, cs.patient_id,
              ca.id AS account_id, ca.discord_id, ca.discord_username, ca.discord_avatar
         FROM citizen_sessions cs
         JOIN citizen_accounts ca ON ca.id = cs.account_id
        WHERE cs.token = ? AND cs.expires_at > ?`
    )
    .get(token, new Date().toISOString());
  if (!row) return null;
  let patient = null;
  if (row.patient_id) {
    patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(row.patient_id) || null;
  }
  return {
    token: row.session_token,
    account: {
      id: row.account_id,
      discordId: row.discord_id,
      username: row.discord_username,
      avatar: row.discord_avatar,
    },
    patient,
  };
}

/** Привязать выбранного персонажа к сессии. */
function setPatient(token, patientId) {
  getDb()
    .prepare(`UPDATE citizen_sessions SET patient_id = ? WHERE token = ?`)
    .run(patientId, token);
}

function destroy(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return;
  getDb().prepare(`DELETE FROM citizen_sessions WHERE token = ?`).run(token);
}

module.exports = { createSession, getSession, setPatient, destroy, clearCookie, COOKIE_NAME };
