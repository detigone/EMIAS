'use strict';

/**
 * Внутренний API для Discord-бота. Бот — равноправный клиент без прямого
 * доступа к БД (см. шапку server/index.js). Каждый запрос обязан содержать
 * заголовок x-api-key со значением INTERNAL_API_KEY из .env.
 *
 *   GET  /internal/health
 *   GET  /internal/doctors                       — активные врачи
 *   GET  /internal/staff/:discordId              — сотрудник по Discord ID
 *   GET  /internal/citizens/:discordId           — персонажи Discord-аккаунта
 *   GET  /internal/patients/:id/card             — карточка: талоны/протоколы/рецепты
 *   POST /internal/patients/:id/tickets          — запись к врачу {doctorId?,date,time}
 *   POST /internal/tickets/:id/cancel            — отмена талона владельцем
 *   GET  /internal/queue?date=                   — очередь дня (для персонала в боте)
 *   GET  /internal/reminders?minutes=60          — приёмы, о которых пора напомнить
 */

const express = require('express');
const env = require('../env');
const { getDb } = require('../db/connection');
const { audit } = require('../services/audit');
const { nextTicketNumber } = require('../services/documents');
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

const TICKET_SELECT = `
  SELECT a.*, p.full_name AS patient_name, p.card_number AS patient_card,
         p.discord_id AS patient_discord_id,
         u.full_name AS doctor_name, u.specialty AS doctor_specialty
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN users u ON u.id = a.doctor_id`;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

router.get('/internal/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ---- Привязка персонажа к Discord по коду с сайта -------------------------------

router.post('/internal/link', (req, res) => {
  const db = getDb();
  const code = String(req.body?.code || '').trim().toUpperCase();
  const discordId = String(req.body?.discordId || '').trim();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return res.status(400).json({ error: 'Неверный формат кода' });
  if (!/^\d{5,25}$/.test(discordId)) return res.status(400).json({ error: 'Неверный Discord ID' });

  const row = db.prepare(`SELECT * FROM link_codes WHERE code = ?`).get(code);
  if (!row || row.used_at) return res.status(404).json({ error: 'Код не найден или уже использован' });
  if (row.expires_at < new Date().toISOString()) return res.status(410).json({ error: 'Код истёк, получите новый на сайте' });

  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(row.patient_id);
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });

  db.prepare(`UPDATE link_codes SET used_at = datetime('now') WHERE code = ?`).run(code);
  db.prepare(`UPDATE patients SET discord_id = ? WHERE id = ?`).run(discordId, patient.id);

  audit(db, {
    action: 'bot.link',
    entityType: 'patient',
    entityId: patient.id,
    details: { discordId },
    ip: req.ip,
  });
  res.json({
    ok: true,
    patient: { id: patient.id, fullName: patient.full_name, cardNumber: patient.card_number },
  });
});

// ---- Блокировка персонажа (админ через бота) --------------------------------------

router.post('/internal/patients/:id/block', (req, res) => {
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });
  const blocked = !!req.body?.blocked;
  db.prepare(`UPDATE patients SET status = ? WHERE id = ?`).run(blocked ? 'blocked' : 'active', patient.id);
  audit(db, {
    action: blocked ? 'bot.patient.block' : 'bot.patient.unblock',
    entityType: 'patient',
    entityId: patient.id,
    ip: req.ip,
  });
  res.json({ ok: true, status: blocked ? 'blocked' : 'active' });
});

// ---- Статус врача (сам врач через бота) + расписание ------------------------------

router.post('/internal/doctors/status', (req, res) => {
  const db = getDb();
  const discordId = String(req.body?.discordId || '');
  const status = String(req.body?.status || '');
  if (!['free', 'in_appointment', 'offline'].includes(status)) {
    return res.status(400).json({ error: 'Статус: free | in_appointment | offline' });
  }
  const user = db.prepare(`SELECT * FROM users WHERE discord_id = ? AND is_active = 1`).get(discordId);
  if (!user) return res.status(403).json({ error: 'Вы не сотрудник больницы' });
  db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, user.id);
  hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: user.id, status });
  res.json({ ok: true, status });
});

router.get('/internal/schedule', (req, res) => {
  const db = getDb();
  const date = String(req.query.date || todayIso());
  const doctorId = Number(req.query.doctorId || 0);
  if (!doctorId) return res.status(400).json({ error: 'doctorId обязателен' });
  const rows = db
    .prepare(`${TICKET_SELECT} WHERE a.doctor_id = ? AND a.date = ? AND a.status IN ('waiting','in_room') ORDER BY a.time`)
    .all(doctorId, date);
  res.json({ date, schedule: rows });
});

router.get('/internal/doctors', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, discord_id, full_name, specialty, role, status FROM users WHERE is_active = 1 ORDER BY full_name`)
    .all();
  res.json({ doctors: rows });
});

router.get('/internal/staff/:discordId', (req, res) => {
  const row = getDb()
    .prepare(`SELECT id, discord_id, full_name, role FROM users WHERE discord_id = ? AND is_active = 1`)
    .get(String(req.params.discordId));
  res.json({ staff: row || null });
});

router.get('/internal/patients', (req, res) => {
  const db = getDb();
  const q = String(req.query.q || '').trim().toLowerCase();
  let rows = db
    .prepare(`SELECT id, card_number, full_name, status FROM patients ORDER BY id DESC LIMIT 200`)
    .all();
  if (q) {
    rows = rows.filter((r) => r.full_name.toLowerCase().includes(q) || r.card_number.toLowerCase().includes(q));
  }
  res.json({ patients: rows });
});

router.get('/internal/citizens/:discordId', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, card_number, full_name, birth_date, sex, oms_number, phone, blood_group, allergies, status
         FROM patients WHERE discord_id = ? ORDER BY id`
    )
    .all(String(req.params.discordId));
  res.json({ citizens: rows });
});

router.get('/internal/patients/:id/card', (req, res) => {
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });

  const tickets = db
    .prepare(`${TICKET_SELECT} WHERE a.patient_id = ? AND a.status IN ('waiting','in_room') ORDER BY a.date, a.time`)
    .all(patient.id);
  const protocols = db
    .prepare(
      `SELECT e.visit_date, e.record_type, e.diagnosis_code, e.diagnosis_text, e.notes,
              u.full_name AS doctor_name
         FROM emr_records e LEFT JOIN users u ON u.id = e.doctor_id
        WHERE e.patient_id = ? AND e.record_type != 'lab'
        ORDER BY e.visit_date DESC LIMIT 5`
    )
    .all(patient.id);
  const prescriptions = db
    .prepare(`SELECT medication, dosage, issued_at FROM prescriptions WHERE patient_id = ? ORDER BY issued_at DESC LIMIT 5`)
    .all(patient.id);

  res.json({
    patient: {
      id: patient.id, fullName: patient.full_name, cardNumber: patient.card_number,
      birthDate: patient.birth_date, sex: patient.sex, status: patient.status,
      omsNumber: patient.oms_number, bloodGroup: patient.blood_group, allergies: patient.allergies,
      discordId: patient.discord_id,
    },
    tickets,
    protocols,
    prescriptions,
  });
});

router.post('/internal/patients/:id/tickets', (req, res) => {
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
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
    doctor = db.prepare(`SELECT * FROM users WHERE id = ? AND is_active = 1`).get(doctorId);
    if (!doctor) return res.status(404).json({ error: 'Врач не найден' });
    const conflictDoc = db
      .prepare(`SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND time = ? AND status IN ('waiting','in_room')`)
      .get(doctor.id, date, time);
    if (conflictDoc) return res.status(409).json({ error: `У врача занято ${time}` });
  }

  const conflictSelf = db
    .prepare(`SELECT id FROM appointments WHERE patient_id = ? AND date = ? AND time = ? AND status IN ('waiting','in_room')`)
    .get(patient.id, date, time);
  if (conflictSelf) return res.status(409).json({ error: 'У персонажа уже есть талон на это время' });

  const number = nextTicketNumber(db, date);
  const info = db
    .prepare(
      `INSERT INTO appointments (ticket_number, patient_id, doctor_id, date, time, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'waiting', NULL)`
    )
    .run(number, patient.id, doctor ? doctor.id : null, date, time);
  const appointment = db.prepare(`${TICKET_SELECT} WHERE a.id = ?`).get(info.lastInsertRowid);

  audit(db, {
    action: 'bot.ticket.create',
    entityType: 'appointment',
    entityId: appointment.id,
    details: { ticketNumber: number, patientId: patient.id, viaDiscordId: req.body?.viaDiscordId },
    ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_CREATED, { appointment });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date });

  res.status(201).json({ ok: true, appointment });
});

router.post('/internal/tickets/:id/cancel', (req, res) => {
  const db = getDb();
  const ticket = db.prepare(`${TICKET_SELECT} WHERE a.id = ?`).get(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

  // Владелец: персонаж Discord-аккаунта ИЛИ любой сотрудник по Discord ID.
  let allowed = false;
  const viaDiscordId = String(req.body?.viaDiscordId || '');
  if (viaDiscordId && ticket.patient_discord_id === viaDiscordId) allowed = true;
  if (viaDiscordId) {
    const staff = db.prepare(`SELECT role FROM users WHERE discord_id = ? AND is_active = 1`).get(viaDiscordId);
    if (staff) allowed = true;
  }
  if (!allowed) return res.status(403).json({ error: 'Нет прав на этот талон' });
  if (ticket.status !== 'waiting') return res.status(409).json({ error: 'Отменить можно только «Ожидание»' });

  db.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(ticket.id);
  audit(getDb(), {
    action: 'bot.ticket.cancel',
    entityType: 'appointment',
    entityId: ticket.id,
    details: { viaDiscordId },
    ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_STATUS_UPDATED, { appointmentId: ticket.id, status: 'cancelled' });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date: ticket.date });
  res.json({ ok: true });
});

router.get('/internal/queue', (req, res) => {
  const db = getDb();
  const date = String(req.query.date || todayIso());
  const rows = db
    .prepare(`${TICKET_SELECT} WHERE a.date = ? AND a.status != 'cancelled' ORDER BY a.time`)
    .all(date);
  res.json({ date, queue: rows });
});

router.get('/internal/reminders', (req, res) => {
  const db = getDb();
  const minutes = Math.min(Math.max(Number(req.query.minutes || 60), 1), 1500);
  const now = new Date();
  const limit = new Date(now.getTime() + minutes * 60000);
  const fmt = (d) => String(d).padStart(2, '0');
  const nowT = `${fmt(now.getHours())}:${fmt(now.getMinutes())}`;
  const limT = `${fmt(limit.getHours())}:${fmt(limit.getMinutes())}`;

  const rows = db
    .prepare(
      `SELECT a.id, a.date, a.time, a.room, a.ticket_number,
              p.full_name AS patient_name, p.discord_id,
              u.full_name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.doctor_id
        WHERE a.date = ? AND a.status = 'waiting'
          AND a.time >= ? AND a.time <= ?
          AND p.discord_id IS NOT NULL AND p.discord_id != ''
        ORDER BY a.time`
    )
    .all(todayIso(), nowT, limT);
  res.json({ reminders: rows });
});

// ---- Импорт медкарты (из Discord-форума через бота) -------------------------
router.post('/internal/patients', (req, res) => {
  const db = getDb();
  const { fullName, cardNumber, birthDate, sex, omsNumber, bloodGroup, allergies, phone } = req.body;

  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: 'fullName обязателен' });
  }

  // Дедупликация: по cardNumber (если указан) или OMS
  if (cardNumber) {
    const existing = db.prepare(`SELECT id, card_number, full_name FROM patients WHERE card_number = ?`).get(String(cardNumber).trim());
    if (existing) {
      return res.status(409).json({ error: 'Карта уже существует', existing });
    }
  }
  if (omsNumber) {
    const existing = db.prepare(`SELECT id, card_number, full_name FROM patients WHERE oms_number = ?`).get(String(omsNumber).trim());
    if (existing) {
      return res.status(409).json({ error: 'Пациент с таким ОМС уже существует', existing });
    }
  }

  const { nextCardNumber: genCard } = require('../services/documents');
  const finalCard = (cardNumber && String(cardNumber).trim()) || genCard(db);

  const info = db.prepare(
    `INSERT INTO patients (card_number, full_name, birth_date, sex, oms_number, blood_group, allergies, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    finalCard,
    String(fullName).trim(),
    birthDate || null,
    sex || null,
    omsNumber ? String(omsNumber).trim() : null,
    bloodGroup || null,
    allergies || null,
    phone ? String(phone).trim() : null,
  );

  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(info.lastInsertRowid);
  audit(db, {
    actorId: null, action: 'bot.patient.import', entityType: 'patient',
    entityId: patient.id, details: { cardNumber: finalCard, source: 'discord-forum' }, ip: null,
  });
  hub.broadcast(WS_EVENTS.PATIENT_CREATED, { patientId: patient.id, cardNumber: finalCard, fullName: patient.full_name, patient });

  res.status(201).json({ ok: true, patient });
});

// ---- Настройки бота (GET/PUT) ------------------------------------------------
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
