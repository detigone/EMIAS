'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/**
 * Загрузчик кнопок (обработчиков кнопок)
 */
function registerButtons(client) {
  const buttonsDir = path.join(__dirname, '../components/buttons');
  
  if (!fs.existsSync(buttonsDir)) {
    logger.warn('[BUTTONS] Директория кнопок не найдена');
    return;
  }

  const files = fs.readdirSync(buttonsDir).filter(f => f.endsWith('.js'));
  
  for (const file of files) {
    try {
      const handler = require(path.join(buttonsDir, file));
      
      // Извлекаем customId из имени файла или экспорта
      let customId;
      if (handler.customId) {
        customId = handler.customId;
      } else {
        // Преобразуем имя файла в customId (loginButton.js -> login-btn)
        customId = file.replace('.js', '').replace(/([A-Z])/g, '-$1').toLowerCase().replace('-button', '-btn');
      }
      
      client.buttons.set(customId, handler.default || handler);
      logger.info(`[BUTTONS] Загружена кнопка: ${customId}`);
    } catch (err) {
      logger.error(`[BUTTONS] Ошибка загрузки кнопки ${file}:`, err.message);
    }
  }

  logger.info(`[BUTTONS] Загружено кнопок: ${client.buttons.size}`);
}

module.exports = { registerButtons };
