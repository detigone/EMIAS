'use strict';

require('dotenv').config();

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const level = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function log(lvl, msg, meta) {
  if (LEVELS[lvl] < level) return;
  const line = `[${ts()}] [${lvl.toUpperCase()}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (lvl === 'error') console.error(line);
  else console.log(line);
}

const logger = {
  debug: (m, meta) => log('debug', m, meta),
  info: (m, meta) => log('info', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  error: (m, meta) => log('error', m, meta),
};

/**
 * Аудит действий пользователей (для последующей проверки).
 * Кто выполнил какую команду, когда и с какими параметрами.
 * @param {object} entry
 */
function audit(entry) {
  logger.info('[AUDIT]', entry);
}

module.exports = { logger, audit };