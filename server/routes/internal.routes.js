const express = require('express');
const env = require('../env');
const { prisma } = require('../db/connection');
const { audit } = require('../services/audit');
const { nextTicketNumber, nextCardNumber } = require('../services/documents');
const hub = require('../realtime/hub');
const { WS_EVENTS } = require('../../shared/constants');
const settingsStore = require('../services/settings');

const router = express.Router();

router.use('/internal', (req, res, next) => {
  if (!env.INTERNAL_API_KEY || req.get('x-api-key') !== env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Внутренний API: неверный ключ' });
  }
  next();
});

function mapTicket(a) {
  if (!a) return null;
  return {
    id: a.id, ticket_number: a.ticketNumber, patient_id: a.patientId,
    doctor_id: a.doctorId, date: a.date, time: a.time, status: a.status,
    room: a.room, created_by: a.createdBy, created_at: a.createdAt, updated_at: a.updatedAt,
    patient_name: a.patient?.fullName, patient_card: a.patient?.cardNumber,
    patient_discord_id: a.patient?.discordId,
    doctor_name: a.doctor?.fullName, doctor_specialty: a.doctor?.specialty,
  };
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

router.get('/internal/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

router.post('/internal/link', async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const discordId = String(req.body?.discordId || '').trim();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return res.status(400).json({ error: 'Неверный формат кода' });
  if (!/^\d{5,25}$/.test(discordId)) return res.status(400).json({ error: 'Неверный Discord ID' });

  const row = await prisma.linkCode.findUnique({ where: { code } });
  if (!row || row.usedAt) return res.status(404).json({ error: 'Код не найден или уже использован' });
  if (row.expiresAt < new Date().toISOString()) return res.status(410).json({ error: 'Код истёк, получите новый на сайте' });

  const patient = await prisma.patients.findUnique({ where: { id: row.patientId } });
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });

  await prisma.linkCode.update({ where: { code }, data: { usedAt: new Date() } });
  await prisma.patients.update({ where: { id: patient.id }, data: { discordId } });

  audit({
    action: 'bot.link', entityType: 'patient', entityId: patient.id,
    details: { discordId }, ip: req.ip,
  });
  res.json({
    ok: true,
    patient: { id: patient.id, fullName: patient.fullName, cardNumber: patient.cardNumber },
  });
});

router.post('/internal/patients/:id/block', async (req, res) => {
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });
  const blocked = !!req.body?.blocked;
  await prisma.patients.update({ where: { id: patient.id }, data: { status: blocked ? 'blocked' : 'active' } });
  audit({
    action: blocked ? 'bot.patient.block' : 'bot.patient.unblock',
    entityType: 'patient', entityId: patient.id, ip: req.ip,
  });
  res.json({ ok: true, status: blocked ? 'blocked' : 'active' });
});

router.post('/internal/doctors/status', async (req, res) => {
  const discordId = String(req.body?.discordId || '');
  const status = String(req.body?.status || '');
  if (!['free', 'in_appointment', 'offline'].includes(status)) {
    return res.status(400).json({ error: 'Статус: free | in_appointment | offline' });
  }
  const user = await prisma.users.findFirst({ where: { discordId, isActive: true } });
  if (!user) return res.status(403).json({ error: 'Вы не сотрудник больницы' });
  await prisma.users.update({ where: { id: user.id }, data: { status } });
  hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: user.id, status });
  res.json({ ok: true, status });
});

router.get('/internal/schedule', async (req, res) => {
  const date = String(req.query.date || todayIso());
  const doctorId = Number(req.query.doctorId || 0);
  if (!doctorId) return res.status(400).json({ error: 'doctorId обязателен' });
  const rows = await prisma.appointment.findMany({
    where: { doctorId, date, status: { in: ['waiting', 'in_room'] } },
    include: { patient: true, doctor: true },
    orderBy: { time: 'asc' },
  });
  res.json({ date, schedule: rows.map(mapTicket) });
});

router.get('/internal/doctors', async (req, res) => {
  const rows = await prisma.users.findMany({
    where: { isActive: true },
    orderBy: { fullName: 'asc' },
    select: { id: true, discordId: true, fullName: true, specialty: true, role: true, status: true },
  });
  res.json({
    doctors: rows.map(u => ({
      id: u.id, discord_id: u.discordId, full_name: u.fullName,
      specialty: u.specialty, role: u.role, status: u.status,
    })),
  });
});

router.get('/internal/staff/:discordId', async (req, res) => {
  const row = await prisma.users.findFirst({
    where: { discordId: String(req.params.discordId), isActive: true },
    select: { id: true, discordId: true, fullName: true, role: true },
  });
  res.json({
    staff: row ? { id: row.id, discord_id: row.discordId, full_name: row.fullName, role: row.role } : null,
  });
});

router.get('/internal/patients', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = await prisma.patients.findMany({
    orderBy: { id: 'desc' },
    take: 200,
    select: { id: true, cardNumber: true, fullName: true, status: true },
  });
  rows = rows.map(p => ({
    id: p.id, card_number: p.cardNumber, full_name: p.fullName, status: p.status,
  }));
  if (q) {
    rows = rows.filter((r) => r.full_name.toLowerCase().includes(q) || r.card_number.toLowerCase().includes(q));
  }
  res.json({ patients: rows });
});

router.get('/internal/citizens/:discordId', async (req, res) => {
  const rows = await prisma.patients.findMany({
    where: { discordId: String(req.params.discordId) },
    orderBy: { id: 'asc' },
    select: {
      id: true, cardNumber: true, fullName: true, birthDate: true,
      sex: true, omsNumber: true, phone: true, bloodGroup: true,
      allergies: true, status: true,
    },
  });
  res.json({
    citizens: rows.map(p => ({
      id: p.id, card_number: p.cardNumber, full_name: p.fullName,
      birth_date: p.birthDate, sex: p.sex, oms_number: p.omsNumber,
      phone: p.phone, blood_group: p.bloodGroup, allergies: p.allergies, status: p.status,
    })),
  });
});

router.get('/internal/patients/:id/card', async (req, res) => {
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });

  const tickets = await prisma.appointment.findMany({
    where: { patientId: patient.id, status: { in: ['waiting', 'in_room'] } },
    include: { patient: true, doctor: true },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });

  const protocols = await prisma.record.findMany({
    where: { patientId: patient.id, recordType: { not: 'lab' } },
    include: { doctor: { select: { fullName: true } } },
    orderBy: { visitDate: 'desc' },
    take: 5,
  });

  const prescriptions = await prisma.prescription.findMany({
    where: { patientId: patient.id },
    select: { medication: true, dosage: true, issuedAt: true },
    orderBy: { issuedAt: 'desc' },
    take: 5,
  });

  res.json({
    patient: {
      id: patient.id, fullName: patient.fullName, cardNumber: patient.cardNumber,
      birthDate: patient.birthDate, sex: patient.sex, status: patient.status,
      omsNumber: patient.omsNumber, bloodGroup: patient.bloodGroup,
      allergies: patient.allergies, discordId: patient.discordId,
    },
    tickets: tickets.map(mapTicket),
    protocols: protocols.map(r => ({
      visit_date: r.visitDate, record_type: r.recordType,
      diagnosis_code: r.diagnosisCode, diagnosis_text: r.diagnosisText,
      notes: r.notes, doctor_name: r.doctor?.fullName,
    })),
    prescriptions: prescriptions.map(p => ({
      medication: p.medication, dosage: p.dosage, issued_at: p.issuedAt,
    })),
  });
});

router.post('/internal/patients/:id/tickets', async (req, res) => {
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });
  if (patient.status === 'blocked') return res.status(403).json({ error: 'Аккаунт заблокирован администрацией' });

  const date = String(req.body?.date || '');
  const time = String(req.body?.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'Формат: дата ГГГГ-ММ-ДД, время ЧЧ:ММ' });
  }
  if (date < todayIso()) return res.status(400).json({ error: 'Нельзя записать на прошедшую дату' });

  let doctor = null;
  const doctorId = Number(req.body?.doctorId || 0);
  if (doctorId) {
    doctor = await prisma.users.findFirst({ where: { id: doctorId, isActive: true } });
    if (!doctor) return res.status(404).json({ error: 'Врач не найден' });
    const conflictDoc = await prisma.appointment.findFirst({
      where: { doctorId: doctor.id, date, time, status: { in: ['waiting', 'in_room'] } },
    });
    if (conflictDoc) return res.status(409).json({ error: `У врача занято ${time}` });
  }

  const conflictSelf = await prisma.appointment.findFirst({
    where: { patientId: patient.id, date, time, status: { in: ['waiting', 'in_room'] } },
  });
  if (conflictSelf) return res.status(409).json({ error: 'У персонажа уже есть талон на это время' });

  const number = await nextTicketNumber(date);
  const appointment = await prisma.appointment.create({
    data: {
      ticketNumber: number, patientId: patient.id,
      doctorId: doctor ? doctor.id : null, date, time, status: 'waiting',
    },
    include: { patient: true, doctor: true },
  });

  audit({
    action: 'bot.ticket.create', entityType: 'appointment', entityId: appointment.id,
    details: { ticketNumber: number, patientId: patient.id, viaDiscordId: req.body?.viaDiscordId }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_CREATED, { appointment: mapTicket(appointment) });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date });
  res.status(201).json({ ok: true, appointment: mapTicket(appointment) });
});

router.post('/internal/tickets/:id/cancel', async (req, res) => {
  const ticket = await prisma.appointment.findUnique({
    where: { id: Number(req.params.id) },
    include: { patient: true, doctor: true },
  });
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

  let allowed = false;
  const viaDiscordId = String(req.body?.viaDiscordId || '');
  if (viaDiscordId && ticket.patient?.discordId === viaDiscordId) allowed = true;
  if (viaDiscordId) {
    const staff = await prisma.users.findFirst({ where: { discordId: viaDiscordId, isActive: true } });
    if (staff) allowed = true;
  }
  if (!allowed) return res.status(403).json({ error: 'Нет прав на этот талон' });
  if (ticket.status !== 'waiting') return res.status(409).json({ error: 'Отменить можно только «Ожидание»' });

  await prisma.appointment.update({ where: { id: ticket.id }, data: { status: 'cancelled' } });
  audit({
    action: 'bot.ticket.cancel', entityType: 'appointment', entityId: ticket.id,
    details: { viaDiscordId }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_STATUS_UPDATED, { appointmentId: ticket.id, status: 'cancelled' });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date: ticket.date });
  res.json({ ok: true });
});

router.get('/internal/queue', async (req, res) => {
  const date = String(req.query.date || todayIso());
  const rows = await prisma.appointment.findMany({
    where: { date, status: { not: 'cancelled' } },
    include: { patient: true, doctor: true },
    orderBy: { time: 'asc' },
  });
  res.json({ date, queue: rows.map(mapTicket) });
});

router.get('/internal/reminders', async (req, res) => {
  const minutes = Math.min(Math.max(Number(req.query.minutes || 60), 1), 1500);
  const now = new Date();
  const limit = new Date(now.getTime() + minutes * 60000);
  const fmt = (d) => String(d).padStart(2, '0');
  const nowT = `${fmt(now.getHours())}:${fmt(now.getMinutes())}`;
  const limT = `${fmt(limit.getHours())}:${fmt(limit.getMinutes())}`;

  const rows = await prisma.appointment.findMany({
    where: {
      date: todayIso(), status: 'waiting',
      time: { gte: nowT, lte: limT },
      patient: { discordId: { notIn: [null, ''] } },
    },
    include: { patient: true, doctor: true },
    orderBy: { time: 'asc' },
  });
  res.json({
    reminders: rows.map(r => ({
      id: r.id, date: r.date, time: r.time, room: r.room,
      ticket_number: r.ticketNumber,
      patient_name: r.patient?.fullName, discord_id: r.patient?.discordId,
      doctor_name: r.doctor?.fullName,
    })),
  });
});

router.post('/internal/patients', async (req, res) => {
  const { fullName, cardNumber, birthDate, sex, omsNumber, bloodGroup, allergies, phone } = req.body;

  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: 'fullName обязателен' });
  }

  if (cardNumber) {
    const existing = await prisma.patients.findFirst({
      where: { cardNumber: String(cardNumber).trim() },
      select: { id: true, cardNumber: true, fullName: true },
    });
    if (existing) {
      return res.status(409).json({
        error: 'Карта уже существует',
        existing: { id: existing.id, card_number: existing.cardNumber, full_name: existing.fullName },
      });
    }
  }
  if (omsNumber) {
    const existing = await prisma.patients.findFirst({
      where: { omsNumber: String(omsNumber).trim() },
      select: { id: true, cardNumber: true, fullName: true },
    });
    if (existing) {
      return res.status(409).json({
        error: 'Пациент с таким ОМС уже существует',
        existing: { id: existing.id, card_number: existing.cardNumber, full_name: existing.fullName },
      });
    }
  }

  const finalCard = (cardNumber && String(cardNumber).trim()) || await nextCardNumber();

  const patient = await prisma.patients.create({
    data: {
      cardNumber: finalCard,
      fullName: String(fullName).trim(),
      birthDate: birthDate || null,
      sex: sex || null,
      omsNumber: omsNumber ? String(omsNumber).trim() : null,
      bloodGroup: bloodGroup || null,
      allergies: allergies || null,
      phone: phone ? String(phone).trim() : null,
    },
  });

  audit({
    actorId: null, action: 'bot.patient.import', entityType: 'patient',
    entityId: patient.id, details: { cardNumber: finalCard, source: 'discord-forum' }, ip: null,
  });
  hub.broadcast(WS_EVENTS.PATIENT_CREATED, {
    patientId: patient.id, cardNumber: finalCard, fullName: patient.fullName, patient,
  });
  res.status(201).json({ ok: true, patient });
});

router.get('/internal/settings', (req, res) => {
  res.json({ settings: settingsStore.getAll() });
});

router.put('/internal/settings', (req, res) => {
  const { key, value } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'key обязателен' });
  }
  settingsStore.set(key, String(value || ''));
  res.json({ ok: true, key, value: settingsStore.get(key) });
});

module.exports = router;
