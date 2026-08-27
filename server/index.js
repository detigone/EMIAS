'use strict';

/**
 * ЕМИАС — API-шлюз.
 * Единственная точка доступа к данным: REST /api/* + WebSocket /ws +
 * статика веб-панели (web/). Discord-бот (фаза 2) подключается к тому же
 * API равноправным клиентом и не имеет прямого доступа к БД.
 */

const path = require('node:path');
const http = require('node:http');
const express = require('express');

const env = require('./env');
const { getDb } = require('./db/connection');
const { runMigrations } = require('./db/migrate');
const hub = require('./realtime/hub');
const { PROJECT } = require('../shared/constants');

const authRoutes = require('./routes/auth.routes');
const patientsRoutes = require('./routes/patients.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const staffRoutes = require('./routes/staff.routes');
const citizenRoutes = require('./routes/citizen.routes');
const internalRoutes = require('./routes/internal.routes');
const discordWebhook = require('./services/discord-webhook');

function createApp() {
  const db = getDb();
  runMigrations(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Простое логирование запросов.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      res.on('finish', () => {
        console.log(`[http] ${req.method} ${req.originalUrl} → ${res.statusCode}`);
      });
    }
    next();
  });

  app.use(authRoutes);
  app.use(citizenRoutes);
  app.use(internalRoutes);
  app.use('/api', patientsRoutes);
  app.use('/api', appointmentsRoutes);
  app.use('/api', staffRoutes);

  // Статика веб-панели.
  const webDir = path.join(__dirname, '..', 'web');
  app.use(express.static(webDir, { index: 'index.html', extensions: ['html'] }));

  // Неизвестные API-маршруты — JSON 404 (не HTML).
  app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не найден' }));

  // Централизованный обработчик ошибок.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[http] ошибка:', err.message);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
}

function main() {
  const app = createApp();
  const server = http.createServer(app);
  hub.attach(server);
  discordWebhook.init();

  server.listen(env.PORT, () => {
    console.log('='.repeat(64));
    console.log(`${PROJECT.FULL_NAME}`);
    console.log(`API-шлюз запущен: ${env.PUBLIC_BASE_URL} (порт ${env.PORT})`);
    console.log(`OAuth2 Discord: ${env.isOauthConfigured ? 'настроен' : 'НЕ настроен (.env)'}`);
    if (env.DEV_LOGIN) {
      console.log('Режим DEV_LOGIN включён: POST /auth/dev-login (только локально!)');
    }
    console.log(PROJECT.DISCLAIMER);
    console.log('='.repeat(64));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[server] Порт ${env.PORT} уже занят.`);
      console.error('  Другой экземпляр сервера запущен? Останови его:');
      console.error(`  PowerShell: Get-NetTCPConnection -LocalPort ${env.PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
      process.exit(1);
    }
    throw err;
  });

  const shutdown = () => {
    console.log('\n[server] остановка…');
    hub.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main();
}

module.exports = { createApp };
