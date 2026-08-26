const express = require('express');
const { prisma } = require('../db/connection');
const { requireAuth, isAdmin } = require('../middleware/rbac');
const { audit } = require('../services/audit');
const { nextTicketNumber } = require('../services/documents');
const hub = require('../realtime/hub');
const { WS_EVENTS, TICKET_STATUS } = require('../../shared/constants');

const router = express.Router();
router.use(requireAuth);

function canManageTicket(user, ticket) {
  if (isAdmin(user) || user.role === 'Регистратор') return true;
  return ticket.doctorId === user.id;
}

function scopeWhere(user) {
  if (isAdmin(user) || user.role === 'Регистратор') return {};
  return { doctorId: user.id };
}

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

router.get('/appointments', async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const status = req.query.status ? String(req.query.status) : null;
  const doctorId = req.query.doctorId ? Number(req.query.doctorId) : null;
  const patientId = req.query.patientId ? Number(req.query.patientId) : null;
  const from = req.query.from ? String(req.query.from) : null;

  const where = {};
  if (from) {
    where.date = { gte: from };
    if (!status) where.status = { not: 'cancelled' };
  } else {
    where.date = date;
  }
  Object.assign(where, scopeWhere(req.user));
  if (status) where.status = status;
  if (doctorId) where.doctorId = doctorId;
  if (patientId) where.patientId = patientId;

  const rows = await prisma.appointment.findMany({
    where,
    include: { patient: true, doctor: true },
    orderBy: [{ date: 'desc' }, { time: 'asc' }],
  });

  res.json({ date: from || date, appointments: rows.map(mapTicket) });
});

router.post('/appointments', async (req, res) => {
  const { patientId, doctorId, date, time, room } = req.body ?? {};

  if (!patientId || !date || !time) {
    return res.status(400).json({ error: 'Укажите пациента, дату и время приёма' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time))) {
    return res.status(400).json({ error: 'Неверный формат даты или времени' });
  }

  const patient = await prisma.patients.findUnique({ where: { id: Number(patientId) } });
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  let doctor = null;
  if (doctorId) {
    doctor = await prisma.users.findFirst({ where: { id: Number(doctorId), isActive: true } });
    if (!doctor) return res.status(404).json({ error: 'Врач не найден' });

    const conflict = await prisma.appointment.findFirst({
      where: { doctorId: doctor.id, date, time, status: { in: ['waiting', 'in_room'] } },
    });
    if (conflict) return res.status(409).json({ error: `У врача уже есть приём на ${time} (${date})` });
  }

  const number = await nextTicketNumber(date);
  const appointment = await prisma.appointment.create({
    data: {
      ticketNumber: number,
      patientId: patient.id,
      doctorId: doctor ? doctor.id : null,
      date, time,
      status: 'waiting',
      room: room || null,
      createdBy: req.user.id,
    },
    include: { patient: true, doctor: true },
  });

  audit({
    actorId: req.user.id, action: 'registry.ticket.create', entityType: 'appointment',
    entityId: appointment.id, details: { ticketNumber: number, patientId: patient.id }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_CREATED, { appointment: mapTicket(appointment) });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date });
  res.status(201).json({ appointment: mapTicket(appointment) });
});

router.post('/appointments/call-next', async (req, res) => {
  const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
  let doctorId = req.body?.doctorId ? Number(req.body.doctorId) : null;
  if (!doctorId) doctorId = req.user.id;

  const isSelf = doctorId === req.user.id;
  if (!isSelf && !canManageTicket(req.user, { doctorId })) {
    return res.status(403).json({ error: 'Можно вызывать только своих пациентов' });
  }
  const doctor = await prisma.users.findFirst({ where: { id: doctorId, isActive: true } });
  if (!doctor) return res.status(404).json({ error: 'Врач не найден' });

  const next = await prisma.appointment.findFirst({
    where: { doctorId, date, status: 'waiting' },
    include: { patient: true, doctor: true },
    orderBy: { time: 'asc' },
  });
  if (!next) return res.status(404).json({ error: 'Ожидающих талонов нет' });

  await prisma.appointment.update({ where: { id: next.id }, data: { status: 'in_room' } });
  await prisma.users.update({ where: { id: doctorId }, data: { status: 'in_appointment' } });

  const appointment = await prisma.appointment.findUnique({
    where: { id: next.id },
    include: { patient: true, doctor: true },
  });
  audit({
    actorId: req.user.id, action: 'registry.ticket.call_next', entityType: 'appointment',
    entityId: next.id, details: { ticketNumber: next.ticketNumber }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_STATUS_UPDATED, { appointment: mapTicket(appointment) });
  hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId, status: 'in_appointment' });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date });
  res.json({ appointment: mapTicket(appointment) });
});

router.post('/appointments/:id/status', async (req, res) => {
  const ticket = await prisma.appointment.findUnique({ where: { id: Number(req.params.id) } });
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });
  if (!canManageTicket(req.user, ticket)) {
    return res.status(403).json({ error: 'Нет прав на управление этим талоном' });
  }

  const nextStatus = String(req.body?.status || '');
  if (!Object.values(TICKET_STATUS).includes(nextStatus)) {
    return res.status(400).json({ error: 'Недопустимый статус' });
  }

  const allowed = {
    waiting: ['in_room', 'cancelled', 'no_show'],
    in_room: ['done', 'cancelled'],
    done: [],
    cancelled: [],
    no_show: [],
  };
  if (!allowed[ticket.status].includes(nextStatus)) {
    return res.status(409).json({ error: `Переход «${ticket.status}» → «${nextStatus}» невозможен` });
  }

  const room = req.body?.room !== undefined ? req.body.room : ticket.room;
  await prisma.appointment.update({
    where: { id: ticket.id },
    data: { status: nextStatus, room: room || null },
  });

  if (nextStatus === TICKET_STATUS.IN_ROOM && ticket.doctorId) {
    await prisma.users.update({ where: { id: ticket.doctorId }, data: { status: 'in_appointment' } });
    hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: ticket.doctorId, status: 'in_appointment' });
  }
  if ((nextStatus === TICKET_STATUS.DONE || nextStatus === TICKET_STATUS.CANCELLED) && ticket.doctorId) {
    const busy = await prisma.appointment.count({
      where: { doctorId: ticket.doctorId, status: 'in_room' },
    });
    if (!busy) {
      await prisma.users.update({ where: { id: ticket.doctorId }, data: { status: 'free' } });
      hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: ticket.doctorId, status: 'free' });
    }
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: ticket.id },
    include: { patient: true, doctor: true },
  });

  audit({
    actorId: req.user.id, action: 'registry.ticket.status', entityType: 'appointment',
    entityId: ticket.id, details: { from: ticket.status, to: nextStatus }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_STATUS_UPDATED, { appointment: mapTicket(appointment) });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date: ticket.date });
  res.json({ appointment: mapTicket(appointment) });
});

module.exports = router;
