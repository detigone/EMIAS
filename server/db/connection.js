'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const env = require('../env');

let instance = null;

/**
 * Единственное подключение к SQLite (встроенный модуль node:sqlite,
 * без нативной компиляции). Все запросы в приложении — параметризованные
 * prepared statements.
 */
function getDb() {
  if (instance) return instance;

  const dbPath = path.resolve(env.DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  instance = new DatabaseSync(dbPath);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');

  return instance;
}

module.exports = { getDb };
