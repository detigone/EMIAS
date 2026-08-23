'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const BUTTONS_DIR = path.join(__dirname, '..', 'buttons');
const MODALS_DIR = path.join(__dirname, '..', 'modals');

/**
 * Рекурсивно загружает все команды из каталога commands.
 * Каждый модуль должен экспортировать { data, execute }.
 * @param {Client} client
 */
function loadCommands(client) {
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}.`);
      } else if (entry.name.endsWith('.js')) {
        const mod = require(full);
        if (mod.data && typeof mod.execute === 'function') {
          const name = mod.data.name;
          // Именуем команду с учётом подгруппы: auth.register, emr.view
          client.commands.set(`${prefix}${name}`, mod);
          client.commands.set(name, mod); // короткое имя для быстрого поиска
          logger.debug(`[LOAD] Команда загружена: ${prefix}${name}`);
        }
      }
    }
  };
  walk(COMMANDS_DIR, '');
}

/**
 * Загружает обработчики кнопок из каталога buttons.
 * Каждый модуль: { id: string, handler: fn(interaction) }.
 */
function loadButtons(client) {
  if (!fs.existsSync(BUTTONS_DIR)) return;
  for (const file of fs.readdirSync(BUTTONS_DIR).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(BUTTONS_DIR, file));
    if (mod.id && typeof mod.handler === 'function') {
      client.buttons.set(mod.id, mod.handler);
      logger.debug(`[LOAD] Кнопка загружена: ${mod.id}`);
    }
  }
}

/**
 * Загружает обработчики модальных окон из каталога modals.
 * Каждый модуль: { id: string, handler: fn(interaction) }.
 */
function loadModals(client) {
  if (!fs.existsSync(MODALS_DIR)) return;
  for (const file of fs.readdirSync(MODALS_DIR).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(MODALS_DIR, file));
    if (mod.id && typeof mod.handler === 'function') {
      client.modals.set(mod.id, mod.handler);
      logger.debug(`[LOAD] Модалка загружена: ${mod.id}`);
    }
  }
}

/** Возвращает список команд для регистрации (deploy). */
function collectCommandData() {
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        const mod = require(full);
        if (mod.data) results.push(mod.data.toJSON());
      }
    }
  };
  walk(COMMANDS_DIR);
  return results;
}

module.exports = {
  loadCommands,
  loadButtons,
  loadModals,
  collectCommandData,
  COMMANDS_DIR,
};