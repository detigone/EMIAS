'use strict';

const { logger } = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    logger.info(`[READY] Бот «ЕМИАС-Discord» онлайн. Загружено команд: ${client.commands.size}.`);
    logger.info(`[READY] Авторизован как: ${client.user.tag}`);
  },
};