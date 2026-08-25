'use strict';

const { DOC_FORMAT } = require('../../shared/constants');

/**
 * Генерация номеров документов в форматах:
 *   карта пациента  ЕМК-YYYY-XXXXXX
 *   талон           Т-YYYYMMDD-NNN
 *   рецепт          Р-YYYY-NNNNNN
 * Номер строится по максимальной существующей серии — безопасно
 * при конкурентных вставках в рамках одного процесса SQLite.
 */

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function nextCardNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `${DOC_FORMAT.CARD_PREFIX}-${year}-`;
  const row = db
    .prepare(`SELECT card_number FROM patients WHERE card_number LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}%`);
  const lastSeq = row ? Number(row.card_number.slice(prefix.length)) : 0;
  return `${prefix}${pad(lastSeq + 1, 6)}`;
}

function nextTicketNumber(db, dateISO) {
  const compact = dateISO.replaceAll('-', ''); // YYYYMMDD
  const prefix = `${DOC_FORMAT.TICKET_PREFIX}-${compact}-`;
  const row = db
    .prepare(
      `SELECT ticket_number FROM appointments WHERE ticket_number LIKE ? ORDER BY id DESC LIMIT 1`
    )
    .get(`${prefix}%`);
  const lastSeq = row ? Number(row.ticket_number.slice(prefix.length)) : 0;
  return `${prefix}${pad(lastSeq + 1, 3)}`;
}

function nextPrescriptionNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `${DOC_FORMAT.PRESCRIPTION_PREFIX}-${year}-`;
  const row = db
    .prepare(
      `SELECT prescription_number FROM prescriptions WHERE prescription_number LIKE ? ORDER BY id DESC LIMIT 1`
    )
    .get(`${prefix}%`);
  const lastSeq = row ? Number(row.prescription_number.slice(prefix.length)) : 0;
  return `${prefix}${pad(lastSeq + 1, 6)}`;
}

module.exports = { nextCardNumber, nextTicketNumber, nextPrescriptionNumber };
