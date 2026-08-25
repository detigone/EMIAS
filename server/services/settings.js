'use strict';

/**
 * Хранилище настроек бота в БД (таблица settings).
 * Используется Discord-ботом, вебхук-сервисом и сервером.
 */

const { getDb } = require('../db/connection');

const DEFAULTS = {
  'webhook.appointments': { value: '', label: 'Вебхук — записи (талоны)' },
  'webhook.cards':        { value: '', label: 'Вебхук — медкарты (форум)' },
  'webhook.cards_forum':  { value: '', label: 'ID канала-форума (импорт)' },
  'log.staff_channel':    { value: '', label: 'Канал логов персонала' },
};

function initDefaults() {
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, label) VALUES (?, ?, ?)`
  );
  for (const [key, def] of Object.entries(DEFAULTS)) {
    ins.run(key, def.value, def.label);
  }
}

function getAll() {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value, label, updated_at FROM settings ORDER BY key`).all();
  const result = {};
  for (const r of rows) result[r.key] = r;
  return result;
}

function get(key) {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : (DEFAULTS[key] && DEFAULTS[key].value) || '';
}

function set(key, value) {
  const db = getDb();
  const label = DEFAULTS[key] && DEFAULTS[key].label || key;
  db.prepare(
    `INSERT INTO settings (key, value, label, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, label = excluded.label, updated_at = excluded.updated_at`
  ).run(key, value || '', label);
}

function del(key) {
  const db = getDb();
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

module.exports = { initDefaults, getAll, get, set, del, DEFAULTS };
