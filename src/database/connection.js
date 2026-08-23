'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'emias.db');

/**
 * Создаёт и возвращает единственное подключение к SQLite.
 * Используется встроенный модуль Node.js `node:sqlite` (DatabaseSync),
 * что исключает необходимость нативной компиляции (без node-gyp/VS Build Tools).
 *
 * Все запросы выполняются параметризованными prepared statements,
 * что исключает SQL-инъекции.
 */
function createConnection() {
  const dbPath = process.env.DB_PATH || DEFAULT_PATH;

  // Гарантируем наличие каталога для файла БД.
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  return db;
}

let db = null;

/** Ленивая инициализация синглтона. */
function getDb() {
  if (!db) {
    db = createConnection();
  }
  return db;
}

module.exports = { getDb, createConnection };