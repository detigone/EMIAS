'use strict';

/**
 * Регистратура: талоны и электронная очередь.
 * Роутер монтируется с префиксом /api (см. server/index.js).
 * RBAC:
 *   - создание талонов и управление очередью — врач (свои талоны),
 *     «Регистратор» и «Главный врач» (любые);
 *   - просмотр расписания — весь персонал, врач видит только своё.
 */

const express = require('express');
const { getDb } = require('../db/connection');
const { requireAuth, isAdmin } = require('../middleware/rbac');
const { audit } = require('../services/audit');
const { nextTicketNumber } = require('../services/documents');
const hub = require('../realtime/hub');
const { WS_EVENTS, TICKET_STATUS } = require('../../shared/constants');

const router = express.Router();
router.use(requireAuth);

/** Может ли пользователь управлять данным талоном. */
function canManageTicket(user, ticket) {
  if (isAdmin(user) || user.role === 'Регистратор') return true;
  return ticket.doctor_id === user.id;
}

/** Врач видит только свои талоны; регистратор и главврач — все. */
function scopeFilter(user) {
  if (isAdmin(user) || user.role === 'Регистратор') return { cond: null, params: [] };
  return { cond: 'a.doctor_id = ?', params: [user.id] };
}

const TICKET_SELECT = `
  SELECT a.*, p.full_name AS patient_name, p.card_number AS patient_card,
         u.full_name AS doctor_name, u.specialty AS doctor_specialty
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN users u ON u.id = a.doctor_id`;

// ---- Очередь / расписание ---------------------------------------------------
router.get('/appointments', (req, res) => {
  const db = getDb();
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const status = req.query.status ? String(req.query.status) : null;
  const doctorId = req.query.doctorId ? Number(req.query.doctorId) : null;
  const patientId = req.query.patientId ? Number(req.query.patientId) : null;
  const from = req.query.from ? String(req.query.from) : null;

  const scope = scopeFilter(req.user);
  const conds = [from ? 'a.date >= ?' : 'a.date = ?'];
  if (scope.cond) conds.push(scope.cond);
  const params = [from || date, ...scope.params];
  if (status) { conds.push('a.status = ?'); params.push(status); }
  if (doctorId) { conds.push('a.doctor_id = ?'); params.push(doctorId); }
  if (patientId) { conds.push('a.patient_id = ?'); params.push(patientId); }
  if (from) conds.push("a.status != 'cancelled'");

  const rows = db
    .prepare(`${TICKET_SELECT} WHERE ${conds.join(' AND ')} ORDER BY a.date DESC, a.time`)
    .all(...params);
  res.json({ date: from || date, appointments: rows });
});

// ---- Выдача талона ------------------------------------------------------------
router.post('/appointments', (req, res) => {
  const db = getDb();
  const { patientId, doctorId, date, time, room } = req.body ?? {};

  if (!patientId || !date || !time) {
    return res.status(400).json({ error: 'Укажите пациента, дату и время приёма' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time))) {
    return res.status(400).json({ error: 'Неверный формат даты или времени' });
  }

  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(patientId));
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });

  let doctor = null;
  if (doctorId) {
    doctor = db.prepare(`SELECT * FROM users WHERE id = ? AND is_active = 1`).get(Number(doctorId));
    if (!doctor) return res.status(404).json({ error: 'Врач не найден' });

    // Один активный талон на врача в конкретное время.
    const conflict = db
      .prepare(
        `SELECT id FROM appointments
          WHERE doctor_id = ? AND date = ? AND time = ? AND status IN ('waiting', 'in_room')`
      )
      .get(doctor.id, date, time);
    if (conflict) return res.status(409).json({ error: `У врача уже есть приём на ${time} (${date})` });
  }

  const number = nextTicketNumber(db, date);
  const info = db
    .prepare(
      `INSERT INTO appointments (ticket_number, patient_id, doctor_id, date, time, status, room, created_by)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)`
    )
    .run(number, patient.id, doctor ? doctor.id : null, date, time, room || null, req.user.id);

  const appointment = db.prepare(`${TICKET_SELECT} WHERE a.id = ?`).get(info.lastInsertRowid);

  audit(db, {
    actorId: req.user.id, action: 'registry.ticket.create', entityType: 'appointment',
    entityId: appointment.id, details: { ticketNumber: number, patientId: patient.id }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_CREATED, { appointment });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date });
  res.status(201).json({ appointment });
});

// ---- Вызвать следующего ------------------------------------------------------
router.post('/appointments/call-next', (req, res) => {
  const db = getDb();
  const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
  let doctorId = req.body?.doctorId ? Number(req.body.doctorId) : null;
  if (!doctorId) doctorId = req.user.id;

  const isSelf = doctorId === req.user.id;
  if (!isSelf && !canManageTicket(req.user, { doctor_id: doctorId })) {
    return res.status(403).json({ error: 'Можно вызывать только своих пациентов' });
  }
  const doctor = db.prepare(`SELECT * FROM users WHERE id = ? AND is_active = 1`).get(doctorId);
  if (!doctor) return res.status(404).json({ error: 'Врач не найден' });

  const next = db
    .prepare(
      `${TICKET_SELECT} WHERE a.doctor_id = ? AND a.date = ? AND a.status = 'waiting'
       ORDER BY a.time LIMIT 1`
    )
    .get(doctorId, date);
  if (!next) return res.status(404).json({ error: 'Ожидающих талонов нет' });

  db.prepare(`UPDATE appointments SET status = 'in_room', updated_at = datetime('now') WHERE id = ?`).run(next.id);
  db.prepare(`UPDATE users SET status = 'in_appointment' WHERE id = ?`).run(doctorId);

  const appointment = db.prepare(`${TICKET_SELECT} WHERE a.id = ?`).get(next.id);
  audit(db, {
    actorId: req.user.id, action: 'registry.ticket.call_next', entityType: 'appointment',
    entityId: next.id, details: { ticketNumber: next.ticket_number }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_STATUS_UPDATED, { appointment });
  hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId, status: 'in_appointment' });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date });
  res.json({ appointment });
});

// ---- Смена статуса талона ---------------------------------------------------------
router.post('/appointments/:id/status', (req, res) => {
  const db = getDb();
  const ticket = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(Number(req.params.id));
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
  db.prepare(`UPDATE appointments SET status = ?, room = ?, updated_at = datetime('now') WHERE id = ?`).run(
    nextStatus, room || null, ticket.id
  );

  // Синхронизация статуса врача для очереди/панели.
  if (nextStatus === TICKET_STATUS.IN_ROOM && ticket.doctor_id) {
    db.prepare(`UPDATE users SET status = 'in_appointment' WHERE id = ?`).run(ticket.doctor_id);
    hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: ticket.doctor_id, status: 'in_appointment' });
  }
  if ((nextStatus === TICKET_STATUS.DONE || nextStatus === TICKET_STATUS.CANCELLED) && ticket.doctor_id) {
    const busy = db
      .prepare(`SELECT COUNT(*) n FROM appointments WHERE doctor_id = ? AND status = 'in_room'`)
      .get(ticket.doctor_id).n;
    if (!busy) {
      db.prepare(`UPDATE users SET status = 'free' WHERE id = ?`).run(ticket.doctor_id);
      hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: ticket.doctor_id, status: 'free' });
    }
  }

  const appointment = db.prepare(`${TICKET_SELECT} WHERE a.id = ?`).get(ticket.id);

  audit(db, {
    actorId: req.user.id, action: 'registry.ticket.status', entityType: 'appointment',
    entityId: ticket.id, details: { from: ticket.status, to: nextStatus }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_STATUS_UPDATED, { appointment });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date: ticket.date });
  res.json({ appointment });
});

module.exports = router;
