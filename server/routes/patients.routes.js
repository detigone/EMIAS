'use strict';

/**
 * Пациенты и ЭМК. Роутер монтируется с префиксом /api (см. server/index.js).
 * RBAC:
 *   - список/поиск — весь аутентифицированный персонал (нужно регистратуре);
 *   - медицинские данные (ЭМК, рецепты) — только лечащий врач
 *     (есть его приём/запись у пациента) или «Главный врач».
 */

const express = require('express');
const { getDb } = require('../db/connection');
const { requireAuth, isAdmin } = require('../middleware/rbac');
const { audit } = require('../services/audit');
const { nextCardNumber, nextPrescriptionNumber } = require('../services/documents');
const hub = require('../realtime/hub');
const { WS_EVENTS, RECORD_TYPES } = require('../../shared/constants');

const router = express.Router();
router.use(requireAuth);

function canSeeMedicalData(user) {
  return isAdmin(user) || user.role === 'Врач';
}

/** Является ли user лечащим врачом пациента. */
function isTreatingDoctor(db, userId, patientId) {
  const row = db
    .prepare(
      `SELECT 1 AS x
         FROM (
           SELECT doctor_id FROM appointments WHERE patient_id = ?
           UNION
           SELECT doctor_id FROM emr_records WHERE patient_id = ?
         )
        WHERE doctor_id = ?`
    )
    .get(patientId, patientId, userId);
  return Boolean(row);
}

// ---- Список / поиск -------------------------------------------------------
router.get('/patients', (req, res) => {
  const db = getDb();
  const q = String(req.query.query || '').trim();
  const limit = Math.min(Number(req.query.limit || 100), 200);

  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT id, card_number, full_name, birth_date, sex, oms_number, blood_group, phone, status, discord_id, created_at
           FROM patients
          WHERE full_name LIKE ? OR card_number LIKE ? OR oms_number LIKE ?
          ORDER BY full_name
          LIMIT ?`
      )
      .all(like, like, like, limit);
  } else {
    rows = db
      .prepare(
        `SELECT id, card_number, full_name, birth_date, sex, oms_number, blood_group, phone, status, discord_id, created_at
           FROM patients ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit);
  }
  res.json({ patients: rows });
});

// ---- Регистрация пациента --------------------------------------------------
router.post('/patients', (req, res) => {
  const db = getDb();
  const { fullName, birthDate, sex, omsNumber, bloodGroup, allergies, phone } = req.body ?? {};

  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: 'Укажите ФИО пациента' });
  }
  if (sex && !['М', 'Ж'].includes(sex)) {
    return res.status(400).json({ error: 'Пол должен быть «М» или «Ж»' });
  }

  if (omsNumber) {
    const dup = db.prepare(`SELECT id FROM patients WHERE oms_number = ?`).get(String(omsNumber).trim());
    if (dup) return res.status(409).json({ error: 'Пациент с таким полисом ОМС уже зарегистрирован' });
  }

  const cardNumber = nextCardNumber(db);
  const info = db
    .prepare(
      `INSERT INTO patients (card_number, full_name, birth_date, sex, oms_number, blood_group, allergies, phone, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cardNumber,
      String(fullName).trim(),
      birthDate || null,
      sex || null,
      omsNumber ? String(omsNumber).trim() : null,
      bloodGroup || null,
      allergies || null,
      phone || null,
      req.user.id
    );

  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(info.lastInsertRowid);
  audit(db, {
    actorId: req.user.id, action: 'patient.create', entityType: 'patient',
    entityId: patient.id, details: { cardNumber }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.PATIENT_CREATED, { patientId: patient.id, cardNumber, fullName: patient.full_name, patient });
  res.status(201).json({ patient });
});

// ---- Карточка пациента ------------------------------------------------------
router.get('/patients/:id', (req, res) => {
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  // Демография доступна всему персоналу; медданные — по правилам RBAC выше.
  const includeMedical = canSeeMedicalData(req.user) &&
    (isAdmin(req.user) || isTreatingDoctor(db, req.user.id, patient.id));

  const payload = { patient };

  if (includeMedical) {
    payload.records = db
      .prepare(
        `SELECT r.*, u.full_name AS doctor_name
           FROM emr_records r LEFT JOIN users u ON u.id = r.doctor_id
          WHERE r.patient_id = ? ORDER BY r.visit_date DESC`
      )
      .all(patient.id);
    payload.prescriptions = db
      .prepare(
        `SELECT p.*, u.full_name AS doctor_name
           FROM prescriptions p LEFT JOIN users u ON u.id = p.doctor_id
          WHERE p.patient_id = ? ORDER BY p.issued_at DESC`
      )
      .all(patient.id);
  } else {
    // Признак для клиента: медицинский блок скрыт (нет прав).
    payload.medicalRestricted = true;
  }

  res.json(payload);
});

// ---- Обновление демографии ---------------------------------------------------
router.patch('/patients/:id', (req, res) => {
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  const allowed = ['full_name', 'birth_date', 'sex', 'oms_number', 'blood_group', 'allergies', 'phone'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in (req.body ?? {})) {
      updates.push(`${key} = ?`);
      values.push(req.body[key] || null);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'Нет полей для обновления' });

  values.push(patient.id);
  db.prepare(`UPDATE patients SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(patient.id);
  audit(db, {
    actorId: req.user.id, action: 'patient.update', entityType: 'patient',
    entityId: patient.id, details: { fields: Object.keys(req.body ?? {}) }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.PATIENT_UPDATED, { patientId: patient.id });
  res.json({ patient: updated });
});

// ---- Записи ЭМК -----------------------------------------------------------------
router.post('/patients/:id/records', (req, res) => {
  if (!canSeeMedicalData(req.user)) {
    return res.status(403).json({ error: 'Добавлять записи в ЭМК могут только врачи' });
  }
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  const { recordType, complaints, diagnosisCode, diagnosisText, notes, sickLeaveDays } = req.body ?? {};
  const type = Object.values(RECORD_TYPES).includes(recordType) ? recordType : RECORD_TYPES.VISIT;

  if (diagnosisCode && !/^[A-ZА-Я]\d{2}(\.\d{1,2})?$/i.test(String(diagnosisCode))) {
    return res.status(400).json({ error: 'Код диагноза должен соответствовать формату МКБ-10 (например J06.9)' });
  }

  const info = db
    .prepare(
      `INSERT INTO emr_records (patient_id, doctor_id, record_type, complaints, diagnosis_code, diagnosis_text, notes, sick_leave_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      patient.id, req.user.id, type,
      complaints || null,
      diagnosisCode ? String(diagnosisCode).toUpperCase() : null,
      diagnosisText || null, notes || null,
      sickLeaveDays ? Number(sickLeaveDays) : null
    );

  const record = db
    .prepare(
      `SELECT r.*, u.full_name AS doctor_name FROM emr_records r
        LEFT JOIN users u ON u.id = r.doctor_id WHERE r.id = ?`
    )
    .get(info.lastInsertRowid);

  audit(db, {
    actorId: req.user.id, action: 'emr.record.create', entityType: 'emr_record',
    entityId: record.id, details: { patientId: patient.id, diagnosisCode: record.diagnosis_code }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.EMR_UPDATED, { patientId: patient.id });
  res.status(201).json({ record });
});

// ---- Рецепты ----------------------------------------------------------------------
router.post('/patients/:id/prescriptions', (req, res) => {
  if (!canSeeMedicalData(req.user)) {
    return res.status(403).json({ error: 'Выписывать рецепты могут только врачи' });
  }
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  const { medication, dosage, durationDays } = req.body ?? {};
  if (!medication || !dosage) {
    return res.status(400).json({ error: 'Укажите препарат и дозировку' });
  }

  const number = nextPrescriptionNumber(db);
  const info = db
    .prepare(
      `INSERT INTO prescriptions (prescription_number, patient_id, doctor_id, medication, dosage, duration_days)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(number, patient.id, req.user.id, String(medication).trim(), String(dosage).trim(), durationDays ? Number(durationDays) : null);

  const prescription = db
    .prepare(
      `SELECT p.*, u.full_name AS doctor_name FROM prescriptions p
        LEFT JOIN users u ON u.id = p.doctor_id WHERE p.id = ?`
    )
    .get(info.lastInsertRowid);

  audit(db, {
    actorId: req.user.id, action: 'emr.prescription.create', entityType: 'prescription',
    entityId: prescription.id, details: { patientId: patient.id, medication }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.EMR_UPDATED, { patientId: patient.id });
  res.status(201).json({ prescription });
});

module.exports = router;
