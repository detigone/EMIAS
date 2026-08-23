'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('./core/client');
const { loadCommands, loadButtons, loadModals } = require('./core/commandLoader');
const { migrate } = require('./database/schema');
const { getDb } = require('./database/connection');
const { logger } = require('./utils/logger');

const EVENTS_DIR = path.join(__dirname, 'events');

/**
 * Точка входа бота «ЕМИАС-Discord».
 * Инициализирует БД, загружает команды и обработчики событий, выполняет вход.
 */
async function start() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    logger.error('[START] Переменная DISCORD_TOKEN не задана в .env');
    process.exit(1);
  }

  // Инициализация схемы БД.
  try {
    migrate(getDb());
    logger.info('[START] Схема базы данных проверена/инициализирована.');
  } catch (err) {
    logger.error('[START] Ошибка инициализации БД:', { message: err.message });
    process.exit(1);
  }

  const client = createClient();

  // Загрузка команд, кнопок и модальных окон.
  loadCommands(client);
  loadButtons(client);
  loadModals(client);

  // Загрузка обработчиков событий.
  for (const file of fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith('.js'))) {
    const event = require(path.join(EVENTS_DIR, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }

  // Обработка ошибок клиента.
  client.on('error', (err) => logger.error('[CLIENT] Ошибка Discord:', { message: err.message }));

  await client.login(token);
}

start().catch((err) => {
  logger.error('[START] Критическая ошибка:', { message: err.message, stack: err.stack });
  process.exit(1);
});