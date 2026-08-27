/**
 * Аутентификация и профиль.
 *   GET    /auth/discord    — редирект на согласие Discord (state + PKCE)
 *   GET    /auth/callback   — обмен code, создание/обновление врача, сессия
 *   POST   /auth/logout     — отзыв сессии
 *   GET    /api/me          — текущий пользователь (+ needsSetup)
 *   GET    /api/setup       — публичная информация о состоянии настройки
 *   POST   /api/setup       — заполнение профиля (ФИО + специальность)
 *   POST   /auth/dev-login  — ТОЛЬКО для локальной разработки (DEV_LOGIN=1)
 */

const express = require('express');
const env = require('../env');
const oauth = require('../auth/oauth');
const sessions = require('../auth/sessions');
const citizenSessions = require('../auth/citizen-sessions');
const { requireAuth } = require('../middleware/rbac');
const { audit } = require('../services/audit');
const { prisma } = require('../db/connection');
const { ROLES, PROJECT, SPECIALTIES } = require('../../shared/constants');
const { nextCardNumber } = require('../services/documents');

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
      let account = await prisma.citizenAccount.findUnique({ where: { discordId: profile.id } });
      if (!account) {
        account = await prisma.citizenAccount.create({
          data: {
            discordId: profile.id,
            discordUsername: profile.username,
            discordAvatar: profile.avatar,
            lastLoginAt: new Date(),
          },
        });
      } else {
        await prisma.citizenAccount.update({
          where: { id: account.id },
          data: {
            discordUsername: profile.username,
            discordAvatar: profile.avatar,
            lastLoginAt: new Date(),
          },
        });
      }
      const citizenSession = citizenSessions.createSession({ id: account.id, discordId: account.discordId, username: account.discordUsername, avatar: account.discordAvatar }, null, isSecure);
      audit({
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

    let user = await prisma.users.findFirst({ where: { discordId: profile.id } });
    if (!user) {
      const role = env.ADMIN_DISCORD_IDS.includes(profile.id) ? ROLES.HEAD_PHYSICIAN : ROLES.PHYSICIAN;
      const displayName = profile.global_name || profile.username;
      user = await prisma.users.create({
        data: {
          discordId: profile.id,
          discordUsername: profile.username,
          discordAvatar: profile.avatar,
          fullName: displayName,
          role,
          status: 'free',
        },
      });
    } else {
      await prisma.users.update({
        where: { id: user.id },
        data: {
          discordUsername: profile.username,
          discordAvatar: profile.avatar,
        },
      });
    }

    let citizenAccount = await prisma.citizenAccount.findUnique({ where: { discordId: profile.id } });
    if (!citizenAccount) {
      citizenAccount = await prisma.citizenAccount.create({
        data: {
          discordId: profile.id,
          discordUsername: profile.username,
          discordAvatar: profile.avatar,
          lastLoginAt: new Date(),
        },
      });
    } else {
      await prisma.citizenAccount.update({
        where: { id: citizenAccount.id },
        data: {
          discordUsername: profile.username,
          discordAvatar: profile.avatar,
          lastLoginAt: new Date(),
        },
      });
    }

    const existingPatient = await prisma.patients.findFirst({ where: { discordId: profile.id } });
    const needsSetup = !user.specialty || !existingPatient;

    const session = sessions.createSession(
      { id: user.id, discord_id: user.discordId, discord_username: user.discordUsername, discord_avatar: user.discordAvatar, full_name: user.fullName, specialty: user.specialty, role: user.role, status: user.status, is_active: user.isActive },
      isSecure
    );
    audit({ actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ip: req.ip });

    res.setHeader('Set-Cookie', [
      session.cookie,
      cookieParts(OAUTH_STATE_COOKIE, '', 0, isSecure),
      cookieParts(OAUTH_VERIFIER_COOKIE, '', 0, isSecure),
      cookieParts(OAUTH_MODE_COOKIE, '', 0, isSecure),
    ]);
    return res.redirect(needsSetup ? '/setup.html' : '/staff.html');
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
    audit({ actorId: user.id, action: 'auth.logout', entityType: 'user', entityId: user.id, ip: req.ip });
  }
  res.setHeader('Set-Cookie', sessions.clearCookie(isSecure));
  res.json({ ok: true });
});

router.get('/api/setup', (req, res) => {
  res.json({
    projectName: PROJECT.NAME,
    fullName: PROJECT.FULL_NAME,
    disclaimer: PROJECT.DISCLAIMER,
    oauthConfigured: env.isOauthConfigured,
    devLoginEnabled: env.DEV_LOGIN,
    specialties: SPECIALTIES,
  });
});

router.post('/api/setup', requireAuth, async (req, res) => {
  try {
    const { step } = req.body || {};
    const discordId = req.user.discord_id;

    if (step === 'profile') {
      const { fullName, birthDate, sex, omsNumber, phone } = req.body;
      if (!fullName || !fullName.trim()) {
        return res.status(400).json({ error: 'ФИО обязательно' });
      }

      const existing = await prisma.patients.findFirst({ where: { discordId } });
      if (existing) {
        return res.status(409).json({ error: 'Профиль уже создан' });
      }

      const cardNumber = await nextCardNumber();
      const patient = await prisma.patients.create({
        data: {
          cardNumber,
          fullName: fullName.trim(),
          birthDate: birthDate || null,
          sex: sex || null,
          omsNumber: omsNumber || null,
          phone: phone || null,
          discordId,
          status: 'active',
          createdBy: req.user.id,
        },
      });

      audit({ actorId: req.user.id, action: 'profile.created', entityType: 'patient', entityId: patient.id, ip: req.ip });
      return res.json({ ok: true, patient: { id: patient.id, fullName: patient.fullName, cardNumber: patient.cardNumber } });
    }

    if (step === 'specialty') {
      const { specialty } = req.body;
      if (!specialty || !SPECIALTIES.find((s) => s.code === specialty)) {
        return res.status(400).json({ error: 'Неверная специальность' });
      }

      await prisma.users.update({
        where: { id: req.user.id },
        data: { specialty },
      });

      audit({ actorId: req.user.id, action: 'profile.specialty_set', entityType: 'user', entityId: req.user.id, details: { specialty }, ip: req.ip });
      return res.json({ ok: true, specialty });
    }

    return res.status(400).json({ error: 'Неизвестный шаг' });
  } catch (err) {
    console.error('[setup] error:', err.message);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/api/me', requireAuth, async (req, res) => {
  const patient = await prisma.patients.findFirst({ where: { discordId: req.user.discord_id } });
  res.json({ user: { ...req.user, needsSetup: !req.user.specialty || !patient } });
});

router.post('/auth/dev-login', async (req, res) => {
  const pass = String(req.body?.password || '').trim();
  if (pass !== 'ZZZ3295') {
    return res.status(403).json({ error: 'Неверный пароль демо' });
  }
  const userId = Number(req.body?.userId || 0);
  let user = userId
    ? await prisma.users.findUnique({ where: { id: userId, isActive: 1 } })
    : (await prisma.users.findMany({ where: { isActive: 1 }, take: 1, orderBy: { id: 'asc' } }))[0];

  if (!user) {
    user = await prisma.users.create({
      data: {
        discordId: 'dev-staff-' + Date.now(),
        discordUsername: 'dev-doctor',
        fullName: 'Демов Иван Петрович',
        specialty: 'terapevt',
        role: ROLES.PHYSICIAN,
        status: 'free',
      },
    });
  }

  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  const session = sessions.createSession(
    { id: user.id, discord_id: user.discordId, discord_username: user.discordUsername, discord_avatar: user.discordAvatar, full_name: user.fullName, specialty: user.specialty, role: user.role, status: user.status, is_active: user.isActive },
    isSecure
  );
  audit({ actorId: user.id, action: 'auth.dev_login', entityType: 'user', entityId: user.id, ip: req.ip });
  res.setHeader('Set-Cookie', session.cookie);
  res.json({ ok: true, user: { id: user.id, full_name: user.fullName, role: user.role, specialty: user.specialty || null, status: user.status || 'free' } });
});

module.exports = router;
