'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/**
 * Загрузчик событий Discord
 */
function loadEvents(client) {
  const eventsDir = path.join(__dirname, '../events');
  
  if (!fs.existsSync(eventsDir)) {
    logger.warn('[EVENTS] Директория событий не найдена');
    return;
  }

  const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));
  
  for (const file of files) {
    try {
      const event = require(path.join(eventsDir, file));
      
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
      } else {
        client.on(event.name, (...args) => event.execute(...args));
      }
      
      logger.info(`[EVENTS] Загружено событие: ${event.name}`);
    } catch (err) {
      logger.error(`[EVENTS] Ошибка загрузки события ${file}:`, err.message);
    }
  }

  logger.info(`[EVENTS] Загружено событий: ${files.length}`);
}

module.exports = { loadEvents };
