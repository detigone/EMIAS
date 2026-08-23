'use strict';

/**
 * Схема таблиц системы «ЕМИАС-Discord».
 * Модель данных соответствует концепции:
 * users (персонал), patients, tickets (талоны), medical_records, sessions.
 */
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      fullName     TEXT NOT NULL,
      specialty    TEXT,
      discordId    TEXT UNIQUE,
      role         TEXT NOT NULL DEFAULT 'Врач',
      isActive     INTEGER NOT NULL DEFAULT 1,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patients (
      patient_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      discordId    TEXT UNIQUE,
      fullName     TEXT NOT NULL,
      birthDate    TEXT,
      omsNumber    TEXT UNIQUE,
      bloodGroup   TEXT,
      allergies    TEXT,
      cardNumber   TEXT UNIQUE,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      ticket_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      ticketNumber TEXT NOT NULL UNIQUE,
      patientId    INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
      doctorId     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      doctorSpecialty TEXT,
      doctorName   TEXT,
      date         TEXT NOT NULL,
      time         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'waiting',
      room         TEXT,
      createdBy    INTEGER,
      createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS medical_records (
      record_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      patientId      INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
      doctorId       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      doctorName     TEXT,
      date           TEXT NOT NULL DEFAULT (datetime('now')),
      diagnosisCode  TEXT,
      diagnosisText  TEXT,
      prescriptions  TEXT,
      notes          TEXT,
      sickLeave      TEXT,
      followUpDate   TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      discordId  TEXT NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
      expiresAt  TEXT
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      prescription_id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescriptionNumber TEXT NOT NULL UNIQUE,
      patientId      INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
      doctorId       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      medication     TEXT NOT NULL,
      dosage         TEXT NOT NULL,
      duration       TEXT,
      date           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS diagnoses (
      diagnosis_id INTEGER PRIMARY KEY AUTOINCREMENT,
      diagnosisNumber TEXT NOT NULL UNIQUE,
      patientId      INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
      doctorId       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      mkbCode        TEXT NOT NULL,
      diagnosisText  TEXT NOT NULL,
      notes          TEXT,
      date           TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Инициализация схемы (используется при запуске и командой db:init). */
function initSchema(db) {
  migrate(db);
}

module.exports = { migrate, initSchema };
