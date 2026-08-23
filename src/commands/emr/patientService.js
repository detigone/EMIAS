'use strict';

const { getDb } = require('../../database/connection');
const { cardNumber } = require('../../utils/format');

/**
 * Сервис работы с пациентами ЭМК.
 */

/**
 * Поиск пациента по Discord-идентификатору или ФИО.
 * @returns {object|null}
 */
function findPatient({ discordId = null, fullName = null }) {
  const db = getDb();
  if (discordId) {
    return db.prepare('SELECT * FROM patients WHERE discordId = ?').get(discordId);
  }
  if (fullName) {
    return db
      .prepare('SELECT * FROM patients WHERE fullName LIKE ? COLLATE NOCASE')
      .get(`%${fullName}%`);
  }
  return null;
}

/**
 * Поиск пациента по Discord-пользователю (объект User/GuildMember).
 */
function findPatientByUser(user) {
  if (!user || !user.id) return null;
  return findPatient({ discordId: user.id });
}

/** Проверка существования пациента в системе. */
function patientExists(discordId) {
  return Boolean(findPatient({ discordId }));
}

/**
 * Создание пациента (используется будущим модулем регистрации пациентов
 * и демонстрацией для /emr view при отсутствии карточки).
 */
function createPatient({ discordId, fullName, birthDate = null, omsNumber = null, bloodGroup = null, allergies = null }) {
  const db = getDb();
  const year = new Date().getFullYear();
  // Определяем следующий порядковый номер карты за текущий год.
  const seqRow = db.prepare("SELECT COUNT(*) AS c FROM patients WHERE cardNumber LIKE ?").get(`ЕМК-${year}-%`);
  const number = cardNumber(year, (seqRow.c || 0) + 1);

  try {
    const info = db
      .prepare(
        `INSERT INTO patients (discordId, fullName, birthDate, omsNumber, bloodGroup, allergies, cardNumber)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(discordId, fullName, birthDate, omsNumber, bloodGroup, allergies, number);
    return db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(Number(info.lastInsertRowid));
  } catch (err) {
    return null;
  }
}

module.exports = { findPatient, findPatientByUser, patientExists, createPatient };