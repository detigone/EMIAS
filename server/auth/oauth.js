'use strict';

/**
 * Discord OAuth2 (Authorization Code Flow) + PKCE (S256) и state (CSRF).
 * Обмен code → token выполняется ТОЛЬКО на сервере; client_secret
 * не покидает переменные окружения.
 */

const crypto = require('node:crypto');
const env = require('../env');

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = ['identify'];

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function codeChallengeS256(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function buildRedirectUri() {
  // Приоритет: явная настройка OAUTH_REDIRECT_URI, иначе PUBLIC_BASE_URL + /auth/callback.
  return env.OAUTH_REDIRECT_URI || `${env.PUBLIC_BASE_URL}/auth/callback`;
}

function buildAuthorizeUrl() {
  const state = randomToken(16);
  const verifier = randomToken(48);
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: buildRedirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    code_challenge: codeChallengeS256(verifier),
    code_challenge_method: 'S256',
    prompt: 'consent',
  });
  return { url: `https://discord.com/oauth2/authorize?${params}`, state, verifier };
}

async function exchangeCode(code, codeVerifier) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: buildRedirectUri(),
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, scope, token_type }
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`fetch user failed: ${res.status}`);
  return res.json(); // { id, username, global_name, avatar, ... }
}

module.exports = { buildAuthorizeUrl, exchangeCode, fetchDiscordUser };
