'use strict';

const { getDb } = require('../database/connection');
const { initSchema } = require('../database/schema');
const { logger } = require('../utils/logger');

/**
 * Инициализация базы данных при старте
 */
function initDatabase() {
  try {
    const db = getDb();
    initSchema(db);
    logger.info('[DB] База данных инициализирована');
    return db;
  } catch (err) {
    logger.error('[DB] Ошибка инициализации БД:', err.message);
    throw err;
  }
}

module.exports = initDatabase;
