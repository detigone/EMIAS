const express = require('express');
const { prisma } = require('../db/connection');
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

async function isTreatingDoctor(userId, patientId) {
  const appointment = await prisma.appointment.findFirst({
    where: { patientId, doctorId: userId },
    select: { id: true },
  });
  if (appointment) return true;
  const record = await prisma.record.findFirst({
    where: { patientId, doctorId: userId },
    select: { id: true },
  });
  return Boolean(record);
}

function mapPatient(p) {
  if (!p) return null;
  return {
    id: p.id, card_number: p.cardNumber, full_name: p.fullName,
    birth_date: p.birthDate, sex: p.sex, oms_number: p.omsNumber,
    blood_group: p.bloodGroup, allergies: p.allergies, phone: p.phone,
    discord_id: p.discordId, status: p.status, created_by: p.createdBy,
    created_at: p.createdAt,
  };
}

function mapRecord(r) {
  if (!r) return null;
  return {
    id: r.id, patient_id: r.patientId, doctor_id: r.doctorId,
    visit_date: r.visitDate, record_type: r.recordType, complaints: r.complaints,
    diagnosis_code: r.diagnosisCode, diagnosis_text: r.diagnosisText,
    notes: r.notes, sick_leave_days: r.sickLeaveDays, created_at: r.createdAt,
    doctor_name: r.doctor?.fullName,
  };
}

function mapPrescription(p) {
  if (!p) return null;
  return {
    id: p.id, prescription_number: p.prescriptionNumber, patient_id: p.patientId,
    doctor_id: p.doctorId, medication: p.medication, dosage: p.dosage,
    duration_days: p.durationDays, issued_at: p.issuedAt,
    doctor_name: p.doctor?.fullName,
  };
}

router.get('/patients', async (req, res) => {
  const q = String(req.query.query || '').trim();
  const limit = Math.min(Number(req.query.limit || 100), 200);

  let rows;
  if (q) {
    rows = await prisma.patients.findMany({
      where: {
        OR: [
          { fullName: { contains: q } },
          { cardNumber: { contains: q } },
          { omsNumber: { contains: q } },
        ],
      },
      orderBy: { fullName: 'asc' },
      take: limit,
    });
  } else {
    rows = await prisma.patients.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
  res.json({ patients: rows.map(mapPatient) });
});

router.post('/patients', async (req, res) => {
  const { fullName, birthDate, sex, omsNumber, bloodGroup, allergies, phone } = req.body ?? {};

  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: 'Укажите ФИО пациента' });
  }
  if (sex && !['М', 'Ж'].includes(sex)) {
    return res.status(400).json({ error: 'Пол должен быть «М» или «Ж»' });
  }

  if (omsNumber) {
    const dup = await prisma.patients.findFirst({ where: { omsNumber: String(omsNumber).trim() } });
    if (dup) return res.status(409).json({ error: 'Пациент с таким полисом ОМС уже зарегистрирован' });
  }

  const cardNumber = await nextCardNumber();
  const patient = await prisma.patients.create({
    data: {
      cardNumber,
      fullName: String(fullName).trim(),
      birthDate: birthDate || null,
      sex: sex || null,
      omsNumber: omsNumber ? String(omsNumber).trim() : null,
      bloodGroup: bloodGroup || null,
      allergies: allergies || null,
      phone: phone || null,
      createdBy: req.user.id,
    },
  });

  audit({
    actorId: req.user.id, action: 'patient.create', entityType: 'patient',
    entityId: patient.id, details: { cardNumber }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.PATIENT_CREATED, { patientId: patient.id, cardNumber, fullName: patient.fullName, patient: mapPatient(patient) });
  res.status(201).json({ patient: mapPatient(patient) });
});

router.get('/patients/:id', async (req, res) => {
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  const includeMedical = canSeeMedicalData(req.user) &&
    (isAdmin(req.user) || await isTreatingDoctor(req.user.id, patient.id));

  const payload = { patient: mapPatient(patient) };

  if (includeMedical) {
    const records = await prisma.record.findMany({
      where: { patientId: patient.id },
      include: { doctor: { select: { fullName: true } } },
      orderBy: { visitDate: 'desc' },
    });
    payload.records = records.map(mapRecord);

    const prescriptions = await prisma.prescription.findMany({
      where: { patientId: patient.id },
      include: { doctor: { select: { fullName: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    payload.prescriptions = prescriptions.map(mapPrescription);
  } else {
    payload.medicalRestricted = true;
  }

  res.json(payload);
});

router.patch('/patients/:id', async (req, res) => {
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  const fieldMap = {
    full_name: 'fullName', birth_date: 'birthDate', sex: 'sex',
    oms_number: 'omsNumber', blood_group: 'bloodGroup',
    allergies: 'allergies', phone: 'phone',
  };
  const data = {};
  for (const [snake, camel] of Object.entries(fieldMap)) {
    if (snake in (req.body ?? {})) {
      data[camel] = req.body[snake] || null;
    }
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Нет полей для обновления' });

  const updated = await prisma.patients.update({ where: { id: patient.id }, data });
  audit({
    actorId: req.user.id, action: 'patient.update', entityType: 'patient',
    entityId: patient.id, details: { fields: Object.keys(req.body ?? {}) }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.PATIENT_UPDATED, { patientId: patient.id });
  res.json({ patient: mapPatient(updated) });
});

router.post('/patients/:id/records', async (req, res) => {
  if (!canSeeMedicalData(req.user)) {
    return res.status(403).json({ error: 'Добавлять записи в ЭМК могут только врачи' });
  }
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  const { recordType, complaints, diagnosisCode, diagnosisText, notes, sickLeaveDays } = req.body ?? {};
  const type = Object.values(RECORD_TYPES).includes(recordType) ? recordType : RECORD_TYPES.VISIT;

  if (diagnosisCode && !/^[A-ZА-Я]\d{2}(\.\d{1,2})?$/i.test(String(diagnosisCode))) {
    return res.status(400).json({ error: 'Код диагноза должен соответствовать формату МКБ-10 (например J06.9)' });
  }

  const record = await prisma.record.create({
    data: {
      patientId: patient.id,
      doctorId: req.user.id,
      recordType: type,
      complaints: complaints || null,
      diagnosisCode: diagnosisCode ? String(diagnosisCode).toUpperCase() : null,
      diagnosisText: diagnosisText || null,
      notes: notes || null,
      sickLeaveDays: sickLeaveDays ? Number(sickLeaveDays) : null,
    },
    include: { doctor: { select: { fullName: true } } },
  });

  audit({
    actorId: req.user.id, action: 'emr.record.create', entityType: 'emr_record',
    entityId: record.id, details: { patientId: patient.id, diagnosisCode: record.diagnosisCode }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.EMR_UPDATED, { patientId: patient.id });
  res.status(201).json({ record: mapRecord(record) });
});

router.post('/patients/:id/prescriptions', async (req, res) => {
  if (!canSeeMedicalData(req.user)) {
    return res.status(403).json({ error: 'Выписывать рецепты могут только врачи' });
  }
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  const { medication, dosage, durationDays } = req.body ?? {};
  if (!medication || !dosage) {
    return res.status(400).json({ error: 'Укажите препарат и дозировку' });
  }

  const number = await nextPrescriptionNumber();
  const prescription = await prisma.prescription.create({
    data: {
      prescriptionNumber: number,
      patientId: patient.id,
      doctorId: req.user.id,
      medication: String(medication).trim(),
      dosage: String(dosage).trim(),
      durationDays: durationDays ? Number(durationDays) : null,
    },
    include: { doctor: { select: { fullName: true } } },
  });

  audit({
    actorId: req.user.id, action: 'emr.prescription.create', entityType: 'prescription',
    entityId: prescription.id, details: { patientId: patient.id, medication }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.EMR_UPDATED, { patientId: patient.id });
  res.status(201).json({ prescription: mapPrescription(prescription) });
});

module.exports = router;
