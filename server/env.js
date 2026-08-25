'use strict';

require('dotenv').config();

/** Конфигурация сервера из переменных окружения. Секреты читаются ТОЛЬКО здесь. */
const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3000),
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  // Для хостинга (не локально): установите DATABASE_URL
  //   Postgres: postgresql://user:pass@host:5432/db
  //   SQLite:   file:./data/emias.db  (относительно cwd)
  // Локально можно оставить DB_PATH (совместимость) — приоритет у DATABASE_URL
  DB_PATH: (() => {
    const url = process.env.DATABASE_URL || '';
    if (url.startsWith('file:')) return url.slice(5).split('?')[0];
    return process.env.DB_PATH || './data/emias.db';
  })(),
  DATABASE_URL: process.env.DATABASE_URL || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
  OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI || '',
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
  STAFF_LOG_CHANNEL_ID: process.env.STAFF_LOG_CHANNEL_ID || '',
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY || '',

  DISCORD_WEBHOOK_APPOINTMENTS: process.env.DISCORD_WEBHOOK_APPOINTMENTS || '',
  DISCORD_WEBHOOK_CARDS: process.env.DISCORD_WEBHOOK_CARDS || '',
  CARD_FORUM_CHANNEL_ID: process.env.CARD_FORUM_CHANNEL_ID || '',

  /** Список Discord ID через запятую — получают роль «Главный врач» при первом входе. */
  ADMIN_DISCORD_IDS: (process.env.ADMIN_DISCORD_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /**
   * Дев-автовход без OAuth2. Разрешён только вне production.
   * В production флаг игнорируется независимо от значения.
   */
  DEV_LOGIN: process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === '1',
};

env.isOauthConfigured = Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
env.isProduction = env.NODE_ENV === 'production';

module.exports = env;
