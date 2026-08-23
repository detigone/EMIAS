'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/**
 * Загрузчик модальных окон (обработчиков модалок)
 */
function registerModals(client) {
  const modalsDir = path.join(__dirname, '../components/modals');
  
  if (!fs.existsSync(modalsDir)) {
    logger.warn('[MODALS] Директория модальных окон не найдена');
    return;
  }

  const files = fs.readdirSync(modalsDir).filter(f => f.endsWith('.js'));
  
  for (const file of files) {
    try {
      const handler = require(path.join(modalsDir, file));
      
      // Извлекаем customId из имени файла или экспорта
      let customId;
      if (handler.customId) {
        customId = handler.customId;
      } else {
        // Преобразуем имя файла в customId (loginModal.js -> login-modal)
        customId = file.replace('.js', '').replace(/([A-Z])/g, '-$1').toLowerCase().replace('-modal', '-modal');
      }
      
      client.modals.set(customId, handler.default || handler);
      logger.info(`[MODALS] Загружено модальное окно: ${customId}`);
    } catch (err) {
      logger.error(`[MODALS] Ошибка загрузки модалки ${file}:`, err.message);
    }
  }

  logger.info(`[MODALS] Загружено модальных окон: ${client.modals.size}`);
}

module.exports = { registerModals };
