'use strict';

const { getDb } = require('../../database/connection');
const { ticketNumber } = require('../../utils/format');
const { parseDate, parseTime } = require('../../utils/validate');

/**
 * Сервис регистратуры: создание, отмена, перенос, список талонов.
 * Реализует ключевые правила регистрации (проверка свободных слотов).
 */

/** Активные статусы, при которых слот считается занятым. */
const BUSY_STATUSES = ['waiting', 'in_progress'];

/**
 * Подбор врача по специальности.
 * Если специалист не найден — дежурный врач.
 * @returns {object} { id, name, specialty }
 */
function findDoctor(specialty) {
  const db = getDb();
  const s = String(specialty || '').trim().toLowerCase();
  let row = null;
  if (s) {
    row = db
      .prepare(
        "SELECT user_id AS id, fullName AS name, specialty FROM users WHERE isActive = 1 AND LOWER(specialty) = ? LIMIT 1",
      )
      .get(s);
  }
  if (!row) {
    row = db
      .prepare(
        "SELECT user_id AS id, fullName AS name, specialty FROM users WHERE isActive = 1 ORDER BY user_id LIMIT 1",
      )
      .get();
  }
  return row || { id: null, name: 'Дежурный врач', specialty: specialty || 'терапевт' };
}

/**
 * Проверка занятости слота «дата-время».
 */
function isSlotFree(date, time) {
  const db = getDb();
  const busy = db
    .prepare('SELECT ticket_id FROM tickets WHERE date = ? AND time = ? AND status IN (?, ?)')
    .get(date, time, ...BUSY_STATUSES);
  return !busy;
}

/** Лимит пропущенных приёмов без отмены, после которого запись блокируется. */
const MAX_MISSED_APPOINTMENTS = 2;

/**
 * Количество пропущенных без отмены приёмов пациента.
 */
function countMissedAppointments(patientId) {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE patientId = ? AND status = 'missed'").get(patientId);
  return row ? Number(row.c) : 0;
}

/**
 * Создание талона на приём.
 * @param {object} p { patientId, specialty, date:'YYYY-MM-DD', time:'HH:MM' }
 * @returns {object} { ok, ticket?, reason? }
 */
function createTicket({ patientId, specialty, date, time }) {
  const db = getDb();

  // Правило: пациент с двумя пропущенными приёмами без отмены временно лишается записи.
  const missed = countMissedAppointments(patientId);
  if (missed >= MAX_MISSED_APPOINTMENTS) {
    return {
      ok: false,
      reason: `Запись заблокирована: у пациента ${missed} пропущенных приёма(ов) без отмены. Обратитесь в регистратуру для разблокировки.`,
    };
  }

  if (!isSlotFree(date, time)) {
    return { ok: false, reason: 'Выбранное время уже занято. Укажите другой слот.' };
  }

  const doctor = findDoctor(specialty);

  // Номер талона: Т-YYYY-MM-DD-NNNN (счётчик по дате приёма).
  const cntRow = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE date = ?").get(date);
  const number = ticketNumber(date, (cntRow.c || 0) + 1);

  try {
    const info = db
      .prepare(
        `INSERT INTO tickets (ticketNumber, patientId, doctorId, doctorSpecialty, doctorName, date, time, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')`,
      )
      .run(number, patientId, doctor.id, specialty, doctor.name, date, time);

    const ticket = db
      .prepare('SELECT * FROM tickets WHERE ticket_id = ?')
      .get(Number(info.lastInsertRowid));

    return { ok: true, ticket };
  } catch (err) {
    return { ok: false, reason: `Ошибка базы данных: ${err.message}` };
  }
}

/**
 * Поиск талона по номеру.
 */
function findTicketByNumber(ticketNumberValue) {
  const db = getDb();
  return db.prepare('SELECT * FROM tickets WHERE ticketNumber = ?').get(ticketNumberValue) || null;
}

/**
 * Отмена талона.
 * @returns {object} { ok, reason? }
 */
function cancelTicket(ticketNumberValue) {
  const db = getDb();
  const info = db
    .prepare("UPDATE tickets SET status = 'cancelled' WHERE ticketNumber = ?")
    .run(ticketNumberValue);
  if (info.changes === 0) {
    return { ok: false, reason: 'Талон не найден.' };
  }
  return { ok: true };
}

/**
 * Перенос талона на новые дату/время с проверкой доступности слота.
 * Старая запись помечается как перенесённая, создаётся новая.
 * @returns {object} { ok, ticket?, oldTicket?, reason? }
 */
function rescheduleTicket(ticketNumberValue, { date, time, specialty }) {
  const db = getDb();
  const old = findTicketByNumber(ticketNumberValue);
  if (!old) return { ok: false, reason: 'Талон не найден.' };

  if (!isSlotFree(date, time)) {
    return { ok: false, reason: 'Выбранное время уже занято. Укажите другой слот.' };
  }

  const doctor = findDoctor(specialty || old.doctorSpecialty);
  const cntRow = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE date = ?").get(date);
  const number = ticketNumber(date, (cntRow.c || 0) + 1);

  const tx = db.transaction(() => {
    db.prepare("UPDATE tickets SET status = 'moved' WHERE ticketNumber = ?").run(ticketNumberValue);
    const info = db
      .prepare(
        `INSERT INTO tickets (ticketNumber, patientId, doctorId, doctorSpecialty, doctorName, date, time, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')`,
      )
      .run(number, old.patientId, doctor.id, specialty || old.doctorSpecialty, doctor.name, date, time);
    return db.prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(Number(info.lastInsertRowid));
  });

  const newTicket = tx();
  return { ok: true, ticket: newTicket };
}

/**
 * Список талонов за дату (по умолчанию — сегодня).
 * @param {string} date 'YYYY-MM-DD'
 */
function listTickets(date) {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.*, p.fullName AS patientName
       FROM tickets t
       LEFT JOIN patients p ON p.patient_id = t.patientId
       WHERE t.date = ?
       ORDER BY t.time`,
    )
    .all(date);
}

/** Сегодняшняя дата в формате YYYY-MM-DD. */
function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Обновление статуса талона.
 * @returns {object} { ok, reason? }
 */
function updateTicketStatus(ticketNumberValue, status) {
  const db = getDb();
  const info = db.prepare('UPDATE tickets SET status = ? WHERE ticketNumber = ?').run(status, ticketNumberValue);
  if (info.changes === 0) return { ok: false, reason: 'Талон не найден.' };
  return { ok: true };
}

module.exports = {
  createTicket,
  cancelTicket,
  rescheduleTicket,
  findTicketByNumber,
  findDoctor,
  isSlotFree,
  listTickets,
  todayISO,
  updateTicketStatus,
  countMissedAppointments,
  MAX_MISSED_APPOINTMENTS,
  BUSY_STATUSES,
};