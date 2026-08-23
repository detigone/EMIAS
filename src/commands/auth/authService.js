'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../../database/connection');

/**
 * Сервис аутентификации: регистрация, вход, выход.
 * Пароли хэшируются bcrypt; сессии хранятся в таблице sessions.
 */

const SALT_ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

/** Генерация уникального токена сессии. */
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Регистрация нового сотрудника.
 * @returns {object} { ok, user?, reason? }
 */
function registerUser({ username, password, fullName, specialty = null, discordId = null }) {
  const db = getDb();

  const exists = db.prepare('SELECT user_id FROM users WHERE username = ?').get(username);
  if (exists) {
    return { ok: false, reason: 'Указанный логин уже зарегистрирован в системе ЕМИАС.' };
  }

  const passwordHash = hashPassword(password);

  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, passwordHash, fullName, specialty, discordId, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(username, passwordHash, fullName, specialty, discordId, 'Врач');
    const user = db
      .prepare('SELECT user_id AS userId, username, fullName, specialty, role, isActive FROM users WHERE user_id = ?')
      .get(Number(info.lastInsertRowid));
    return { ok: true, user };
  } catch (err) {
    return { ok: false, reason: `Ошибка базы данных: ${err.message}` };
  }
}

/**
 * Вход в систему: поиск по логину и проверка пароля.
 * @returns {object} { ok, user?, session?, reason? }
 */
function loginUser({ username, password, discordId }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!row || !verifyPassword(password, row.passwordHash)) {
    return { ok: false, reason: 'Неверный логин или пароль.' };
  }
  if (!row.isActive) {
    return { ok: false, reason: 'Учётная запись деактивирована. Обратитесь к администратору.' };
  }

  const token = generateToken();
  db.prepare('INSERT INTO sessions (userId, discordId, token) VALUES (?, ?, ?)')
    .run(row.user_id, discordId, token);

  const user = { userId: row.user_id, username: row.username, fullName: row.fullName, specialty: row.specialty, role: row.role };
  return { ok: true, user, session: { token } };
}

/**
 * Выход из системы: удаление активной сессии.
 * @returns {object} { ok, reason? }
 */
function logoutUser({ discordId }) {
  const db = getDb();
  const info = db.prepare('DELETE FROM sessions WHERE discordId = ?').run(discordId);
  return { ok: info.changes > 0, reason: info.changes ? null : 'Активная сессия не найдена.' };
}

/**
 * Проверка наличия активной сессии у пользователя Discord.
 * @returns {object|null}
 */
function getSessionByDiscordId(discordId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.token, u.user_id AS userId, u.username, u.fullName, u.role, u.specialty
       FROM sessions s
       JOIN users u ON u.user_id = s.userId
       WHERE s.discordId = ?`,
    )
    .get(discordId) || null;
}

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getSessionByDiscordId,
  verifyPassword,
};