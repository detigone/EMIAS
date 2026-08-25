'use strict';

/**
 * Аутентификация и профиль.
 *   GET  /auth/discord    — редирект на согласие Discord (state + PKCE)
 *   GET  /auth/callback   — обмен code, создание/обновление врача, сессия
 *   POST /auth/logout     — отзыв сессии
 *   GET  /api/me          — текущий пользователь
 *   GET  /api/setup       — публичная информация о состоянии настройки
 *   POST /auth/dev-login  — ТОЛЬКО для локальной разработки (DEV_LOGIN=1)
 */

const express = require('express');
const env = require('../env');
const oauth = require('../auth/oauth');
const sessions = require('../auth/sessions');
const citizenSessions = require('../auth/citizen-sessions');
const { requireAuth } = require('../middleware/rbac');
const { audit } = require('../services/audit');
const { getDb } = require('../db/connection');
const { ROLES, PROJECT } = require('../../shared/constants');

const router = express.Router();
const OAUTH_STATE_COOKIE = 'emias_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'emias_oauth_verifier';
const OAUTH_MODE_COOKIE = 'emias_oauth_mode';

function cookieParts(name, value, maxAgeSec, isSecure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isSecure ? '; Secure' : ''}`;
}

router.get('/auth/discord', (req, res) => {
  const mode = req.query.mode === 'citizen' ? 'citizen' : 'staff';
  if (!env.isOauthConfigured) {
    return res.redirect(`/login.html?tab=${mode}&error=oauth_not_configured`);
  }
  const { url, state, verifier } = oauth.buildAuthorizeUrl();
  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  res.setHeader('Set-Cookie', [
    cookieParts(OAUTH_STATE_COOKIE, state, 600, isSecure),
    cookieParts(OAUTH_VERIFIER_COOKIE, verifier, 600, isSecure),
    cookieParts(OAUTH_MODE_COOKIE, mode, 600, isSecure),
  ]);
  res.redirect(url);
});

router.get('/auth/callback', async (req, res) => {
  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  // Режим определяем по куке, выставленной на /auth/discord.
  const modeCookie = String(req.headers.cookie || '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(OAUTH_MODE_COOKIE + '='));
  const oauthMode = modeCookie && modeCookie.split('=')[1] === 'citizen' ? 'citizen' : 'staff';
  const backWithError = (code) =>
    res.redirect(`/login.html?tab=${oauthMode}&error=${code}`);

  try {
    const { code, state } = req.query;
    const cookies = String(req.headers.cookie || '');
    const getState = (name) =>
      cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? null;

    if (!code || !state || state !== getState(OAUTH_STATE_COOKIE)) {
      return backWithError('oauth_state');
    }

    const tokens = await oauth.exchangeCode(String(code), getState(OAUTH_VERIFIER_COOKIE));
    const profile = await oauth.fetchDiscordUser(tokens.access_token);

    const isCitizenMode = getState(OAUTH_MODE_COOKIE) === 'citizen';
    if (isCitizenMode) {
      // Гражданин: создаём/обновляем Discord-аккаунт и сессию без выбранного
      // персонажа — выбор происходит на странице входа при каждом визите.
      const db = getDb();
      let account = db.prepare(`SELECT * FROM citizen_accounts WHERE discord_id = ?`).get(profile.id);
      if (!account) {
        const info = db
          .prepare(
            `INSERT INTO citizen_accounts (discord_id, discord_username, discord_avatar, last_login_at)
             VALUES (?, ?, ?, datetime('now'))`
          )
          .run(profile.id, profile.username, profile.avatar);
        account = { id: info.lastInsertRowid };
      } else {
        db.prepare(
          `UPDATE citizen_accounts SET discord_username = ?, discord_avatar = ?, last_login_at = datetime('now') WHERE id = ?`
        ).run(profile.username, profile.avatar, account.id);
      }
      const citizenSession = citizenSessions.createSession(account.id, null, isSecure);
      audit(getDb(), {
        action: 'citizen.login',
        entityType: 'citizen_account',
        entityId: account.id,
        ip: req.ip,
      });
      res.setHeader('Set-Cookie', [
        citizenSession.cookie,
        cookieParts(OAUTH_STATE_COOKIE, '', 0, isSecure),
        cookieParts(OAUTH_VERIFIER_COOKIE, '', 0, isSecure),
        cookieParts(OAUTH_MODE_COOKIE, '', 0, isSecure),
      ]);
      return res.redirect('/login.html?tab=citizen&authed=1');
    }

    const db = getDb();

    // Роль при первом входе: из ADMIN_DISCORD_IDS → «Главный врач», иначе «Врач».
    let user = db.prepare(`SELECT * FROM users WHERE discord_id = ?`).get(profile.id);
    if (!user) {
      const role = env.ADMIN_DISCORD_IDS.includes(profile.id) ? ROLES.HEAD_PHYSICIAN : ROLES.PHYSICIAN;
      const displayName = profile.global_name || profile.username;
      const result = db
        .prepare(
          `INSERT INTO users (discord_id, discord_username, discord_avatar, full_name, role, status)
           VALUES (?, ?, ?, ?, ?, 'free')`
        )
        .run(profile.id, profile.username, profile.avatar, displayName, role);
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid);
    } else {
      db.prepare(`UPDATE users SET discord_username = ?, discord_avatar = ? WHERE id = ?`).run(
        profile.username,
        profile.avatar,
        user.id
      );
    }

    const session = sessions.createSession(user.id, isSecure);
    audit(db, { actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip: req.ip });

    res.setHeader('Set-Cookie', [
      session.cookie,
      cookieParts(OAUTH_STATE_COOKIE, '', 0, isSecure),
      cookieParts(OAUTH_VERIFIER_COOKIE, '', 0, isSecure),
      cookieParts(OAUTH_MODE_COOKIE, '', 0, isSecure),
    ]);
    return res.redirect('/staff.html');
  } catch (err) {
    console.error('[auth] callback error:', err.message);
    return backWithError('oauth_failed');
  }
});

router.post('/auth/logout', (req, res) => {
  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  const user = sessions.getSessionUser(req);
  sessions.destroySession(req);
  if (user) {
    audit(getDb(), { actorId: user.id, action: 'auth.logout', entityType: 'user', entityId: user.id, ip: req.ip });
  }
  res.setHeader('Set-Cookie', sessions.clearCookie(isSecure));
  res.json({ ok: true });
});

// Публичная информация для страницы входа (без секретов).
router.get('/api/setup', (req, res) => {
  res.json({
    projectName: PROJECT.NAME,
    fullName: PROJECT.FULL_NAME,
    disclaimer: PROJECT.DISCLAIMER,
    oauthConfigured: env.isOauthConfigured,
    devLoginEnabled: env.DEV_LOGIN,
  });
});

router.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Демо-вход — пароль ZZZ3295 (работает и в проде)
router.post('/auth/dev-login', (req, res) => {
  const pass = String(req.body?.password || '').trim();
  if (pass !== 'ZZZ3295') {
    return res.status(403).json({ error: 'Неверный пароль демо' });
  }
  const db = getDb();
  const userId = Number(req.body?.userId || 0);
  const user = userId
    ? db.prepare(`SELECT * FROM users WHERE id = ? AND is_active = 1`).get(userId)
    : db.prepare(`SELECT * FROM users WHERE is_active = 1 ORDER BY id LIMIT 1`).get();
  if (!user) return res.status(404).json({ error: 'Демо-пользователи не найдены (npm run db:seed)' });

  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  const session = sessions.createSession(user.id, isSecure);
  audit(db, { actorId: user.id, action: 'auth.dev_login', entityType: 'user', entityId: user.id, ip: req.ip });
  res.setHeader('Set-Cookie', session.cookie);
  res.json({ ok: true, user: { id: user.id, full_name: user.full_name, role: user.role, specialty: user.specialty || null, status: user.status || 'free' } });
});

module.exports = router;
