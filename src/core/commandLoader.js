'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/**
 * Рекурсивно загружает все команды из каталога commands.
 * Каждый модуль должен экспортировать { data, execute }.
 * @param {Client} client
 */
function registerCommands(client) {
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}.`);
      } else if (entry.name.endsWith('.js')) {
        const mod = require(full);
        if (mod.data && typeof mod.execute === 'function') {
          const name = mod.data.name;
          client.commands.set(name, mod);
          logger.debug(`[LOAD] Команда загружена: ${prefix}${name}`);
        }
      }
    }
  };

  if (!fs.existsSync(COMMANDS_DIR)) {
    logger.warn('[COMMANDS] Директория команд не найдена');
    return;
  }

  walk(COMMANDS_DIR, '');
  logger.info(`[COMMANDS] Загружено команд: ${client.commands.size}`);
}

module.exports = { registerCommands };
