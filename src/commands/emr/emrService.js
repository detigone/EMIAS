'use strict';

const { getDb } = require('../../database/connection');
const { formatDateTime } = require('../../utils/format');

/**
 * Сервис медицинских записей ЭМК: история обращений, диагнозы, назначения.
 */

/**
 * История обращений пациента (сортировка по дате, обратный порядок).
 * @param {number} patientId
 * @returns {Array}
 */
function getPatientRecords(patientId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, u.fullName AS doctorFullName
       FROM medical_records r
       LEFT JOIN users u ON u.user_id = r.doctorId
       WHERE r.patientId = ?
       ORDER BY r.date DESC`,
    )
    .all(patientId);

  return rows.map((r) => ({ ...r, doctorDisplay: r.doctorFullName || r.doctorName || '—' }));
}

/**
 * Добавление записи диагноза.
 * @param {object} p { patientId, doctorId?, doctorName?, diagnosisCode, diagnosisText, notes? }
 * @returns {object} { ok, record?, reason? }
 */
function addDiagnosis({ patientId, doctorId = null, doctorName, diagnosisCode, diagnosisText, notes = null }) {
  const db = getDb();
  try {
    const info = db
      .prepare(
        `INSERT INTO medical_records (patientId, doctorId, doctorName, diagnosisCode, diagnosisText, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(patientId, doctorId, doctorName, diagnosisCode, diagnosisText, notes);
    return { ok: true, record: getRecordById(Number(info.lastInsertRowid)) };
  } catch (err) {
    return { ok: false, reason: `Ошибка базы данных: ${err.message}` };
  }
}

/**
 * Выписка лекарственного назначения (добавляет/дополняет поле prescriptions).
 * @param {object} p { patientId, doctorId?, doctorName?, medication, dosage, course?, notes? }
 */
function prescribe({ patientId, doctorId = null, doctorName, medication, dosage, course = null, notes = null }) {
  const db = getDb();
  const line = `${medication} — ${dosage}${course ? ` (${course})` : ''}`;
  try {
    const info = db
      .prepare(
        `INSERT INTO medical_records (patientId, doctorId, doctorName, prescriptions, notes)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(patientId, doctorId, doctorName, line, notes);
    return { ok: true, record: getRecordById(Number(info.lastInsertRowid)) };
  } catch (err) {
    return { ok: false, reason: `Ошибка базы данных: ${err.message}` };
  }
}

/**
 * Выдача больничного листа (листка нетрудоспособности).
 * @param {object} p { patientId, doctorId?, doctorName?, diagnosisText?, days }
 * @returns {object} { ok, record?, reason? }
 */
function issueSickLeave({ patientId, doctorId = null, doctorName, diagnosisText = null, days }) {
  const db = getDb();
  const start = new Date();
  const end = new Date(start.getTime() + Number(days) * 864e5);

  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);
  const sickLeave = `${startISO} — ${endISO} (${days} дн.)`;

  try {
    const info = db
      .prepare(
        `INSERT INTO medical_records (patientId, doctorId, doctorName, diagnosisText, sickLeave, followUpDate)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(patientId, doctorId, doctorName, diagnosisText, sickLeave, endISO);
    return { ok: true, record: getRecordById(Number(info.lastInsertRowid)) };
  } catch (err) {
    return { ok: false, reason: `Ошибка базы данных: ${err.message}` };
  }
}

function getRecordById(recordId) {
  const db = getDb();
  return db.prepare('SELECT * FROM medical_records WHERE record_id = ?').get(recordId) || null;
}

/** Форматирование даты записи для отображения в истории. */
function recordDateLabel(record) {
  return formatDateTime(record.date);
}

module.exports = {
  getPatientRecords,
  addDiagnosis,
  prescribe,
  issueSickLeave,
  getRecordById,
  recordDateLabel,
};