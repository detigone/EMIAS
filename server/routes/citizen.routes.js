'use strict';

/**
 * Личный кабинет граждан (персонажей).
 *
 * Модель доступа:
 *   Discord-аккаунт (citizen_accounts) → несколько персонажей (patients,
 *   привязанных полем patients.discord_id) → выбор персонажа при каждом входе
 *   (citizen_sessions.patient_id). Все данные выдаются ТОЛЬКО выбранного
 *   персонажа — полной изоляции между аккаунтами.
 *
 * Маршруты:
 *   GET  /api/citizen/state                  — есть ли сессия и выбран ли персонаж
 *   POST /api/citizen/dev-auth               — DEV: сессия дев-аккаунта (опц. сразу персонаж)
 *   GET  /api/citizen/profiles               — персонажи аккаунта (DEV: все активные)
 *   POST /api/citizen/profiles               — создать персонажа
 *   POST /api/citizen/select                 — выбрать персонажа для сессии
 *   POST /api/citizen/logout                 — выход
 *   GET  /api/citizen/bootstrap              — все данные приложения (изоляция!)
 *   POST /api/citizen/appointments           — запись к врачу (сам гражданин)
 *   POST /api/citizen/appointments/:id/cancel— отмена своего талона
 */

const express = require('express');
const env = require('../env');
const citizenSessions = require('../auth/citizen-sessions');
const staffSessions = require('../auth/sessions');
const { getDb } = require('../db/connection');
const { audit } = require('../services/audit');
const { nextCardNumber, nextTicketNumber } = require('../services/documents');
const hub = require('../realtime/hub');
const { WS_EVENTS } = require('../../shared/constants');

const router = express.Router();
const DEV_DISCORD_ID = 'dev-local';
const CLINIC = 'ГП №1, Кутузовский пр-т, д. 34';

/** Ключи специальностей, которые ожидает фронт-бандл гражданина. */
const SPECIALTY_MAP = {
  terapevt: 'therapist',
  terapevt2: 'therapist',
  therapist: 'therapist',
  pediatr: 'pediatrician',
  pediatrician: 'pediatrician',
  hirurg: 'surgeon',
  surgeon: 'surgeon',
  oftalmolog: 'ophthalmologist',
  ophthalmologist: 'ophthalmologist',
  lor: 'ent',
  ent: 'ent',
};
const SPECIALTY_LABELS = {
  therapist: 'Терапевт',
  pediatrician: 'Педиатр',
  surgeon: 'Хирург',
  ophthalmologist: 'Офтальмолог',
  ent: 'ЛОР',
};
const AVATAR_COLORS = [
  'from-blue-500 to-indigo-600',
  'from-pink-500 to-rose-500',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-sky-500 to-cyan-600',
];

function specialtyKey(raw) {
  return SPECIALTY_MAP[String(raw || '').toLowerCase()] || 'therapist';
}
function initialsOf(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function shortName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (parts.length < 3) return parts.slice(0, 2).join(' ') || fullName;
  return `${parts[0]} ${parts[1]?.[0] || ''}. ${parts[2]?.[0] || ''}.`;
}
function doctorShort(fullName) {
  const p = String(fullName || '').split(/\s+/);
  return p.length >= 3 ? `${p[0]} ${p[1][0]}. ${p[2][0]}.` : fullName;
}
function fmtBirth(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}
function sexLabel(sex) {
  if (sex === 'М') return 'Мужской';
  if (sex === 'Ж') return 'Женский';
  return sex || '';
}
function memberShape(p) {
  return {
    id: 'p' + p.id,
    role: 'Персонаж',
    fio: p.full_name,
    short: shortName(p.full_name),
    birth: fmtBirth(p.birth_date),
    sex: sexLabel(p.sex),
    policy: p.oms_number || '',
    clinic: CLINIC,
    phone: p.phone || '',
    blood: p.blood_group || '',
    allergies: p.allergies || '',
    status: p.status,
    avatar: {
      initials: initialsOf(p.full_name),
      color: AVATAR_COLORS[p.id % AVATAR_COLORS.length],
    },
  };
}

function isDevAccount(account) {
  return env.DEV_LOGIN && account && account.discordId === DEV_DISCORD_ID;
}

/** Middleware: требует сессию гражданина (персонаж может быть не выбран). */
function requireCitizen(req, res, next) {
  const s = citizenSessions.getSession(req);
  if (!s) return res.status(401).json({ error: 'Требуется вход гражданина' });
  req.citizen = s;
  next();
}

/** Middleware: требует выбранного активного персонажа. */
function requirePatient(req, res, next) {
  requireCitizen(req, res, function () {
    if (!req.citizen.patient) {
      return res.status(403).json({ error: 'Персонаж не выбран' });
    }
    if (req.citizen.patient.status === 'blocked') {
      return res.status(403).json({ error: 'Аккаунт заблокирован администрацией' });
    }
    next();
  });
}

// ---- Вход по коду из Discord (бот → сайт) ----------------------------------

router.post('/api/citizen/auth/code', (req, res) => {
  const db = getDb();
  // Ensure table exists (for shared DB with Minzdrav)
  db.exec(`CREATE TABLE IF NOT EXISTS site_auth_codes (
    code TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    discord_username TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT
  )`);
  const raw = String(req.body?.code || '').trim();
  if (!raw) return res.status(400).json({ error: 'Укажите код' });
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const row = db.prepare(`SELECT * FROM site_auth_codes WHERE code = ?`).get(code);
  if (!row) return res.status(404).json({ error: 'Код не найден' });
  if (row.used_at) return res.status(409).json({ error: 'Код уже использован' });
  if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'Код истёк (10 мин)' });

  db.prepare(`UPDATE site_auth_codes SET used_at = datetime('now') WHERE code = ?`).run(code);

  let account = db.prepare(`SELECT * FROM citizen_accounts WHERE discord_id = ?`).get(row.discord_id);
  if (!account) {
    const info = db.prepare(`INSERT INTO citizen_accounts (discord_id, discord_username, last_login_at) VALUES (?, ?, datetime('now'))`).run(row.discord_id, row.discord_username || null);
    account = db.prepare(`SELECT * FROM citizen_accounts WHERE id = ?`).get(info.lastInsertRowid);
  } else {
    db.prepare(`UPDATE citizen_accounts SET last_login_at = datetime('now'), discord_username = COALESCE(?, discord_username) WHERE id = ?`).run(row.discord_username || null, account.id);
  }

  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  const session = citizenSessions.createSession(account.id, null, isSecure);

  // Если этот Discord — сотрудник, создаём и staff-сессию чтобы сайт и бот видели один аккаунт
  let staffCookie = null;
  const staffUser = db.prepare(`SELECT * FROM users WHERE discord_id = ? AND is_active = 1`).get(row.discord_id);
  if (staffUser) {
    const staffSess = staffSessions.createSession(staffUser.id, isSecure);
    staffCookie = staffSess.cookie;
    audit(db, { action: 'staff.site_code', entityType: 'user', entityId: staffUser.id, details: { code, discordId: row.discord_id }, ip: req.ip });
  }

  audit(db, { action: 'citizen.site_code', entityType: 'citizen_account', entityId: account.id, details: { code, discordId: row.discord_id }, ip: req.ip });
  // Отдаём оба cookie если есть staff
  if (staffCookie) res.setHeader('Set-Cookie', [session.cookie, staffCookie]);
  else res.setHeader('Set-Cookie', session.cookie);
  res.json({ ok: true, account: { discordId: account.discord_id, username: account.discord_username }, isStaff: !!staffUser });
});

// ---- Состояние сессии -------------------------------------------------------

router.get('/api/citizen/state', (req, res) => {
  const s = citizenSessions.getSession(req);
  if (!s) return res.json({ authed: false });
  res.json({
    authed: true,
    needsPick: !s.patient,
    account: s.account,
    patient: s.patient
      ? { id: s.patient.id, fullName: s.patient.full_name, cardNumber: s.patient.card_number, status: s.patient.status }
      : null,
  });
});

// Демо-вход гражданина — пароль ZZZ3295
router.post('/api/citizen/dev-auth', (req, res) => {
  const pass = String(req.body?.password || '').trim();
  if (pass !== 'ZZZ3295') {
    return res.status(403).json({ error: 'Неверный пароль демо' });
  }
  const db = getDb();
  let account = db.prepare(`SELECT * FROM citizen_accounts WHERE discord_id = ?`).get(DEV_DISCORD_ID);
  if (!account) {
    const info = db
      .prepare(`INSERT INTO citizen_accounts (discord_id, discord_username) VALUES (?, ?)`)
      .run(DEV_DISCORD_ID, 'dev-local');
    account = db.prepare(`SELECT * FROM citizen_accounts WHERE id = ?`).get(info.lastInsertRowid);
  }
  db.prepare(`UPDATE citizen_accounts SET last_login_at = datetime('now') WHERE id = ?`).run(account.id);

  const patientId = Number(req.body?.patientId || 0);
  if (patientId) {
    const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(patientId);
    if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });
    if (patient.status === 'blocked') return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }
  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  const session = citizenSessions.createSession(account.id, patientId || null, isSecure);
  audit(db, { action: 'citizen.dev_login', entityType: 'patient', entityId: patientId || null, ip: req.ip });
  res.setHeader('Set-Cookie', session.cookie);
  res.json({ ok: true });
});

// ---- Персонажи --------------------------------------------------------------

router.get('/api/citizen/profiles', requireCitizen, (req, res) => {
  const db = getDb();
  let rows;
  if (isDevAccount(req.citizen.account)) {
    rows = db.prepare(`SELECT * FROM patients WHERE status != 'blocked' ORDER BY full_name`).all();
  } else {
    rows = db
      .prepare(`SELECT * FROM patients WHERE discord_id = ? AND status != 'blocked' ORDER BY id`)
      .all(req.citizen.account.discordId);
  }
  res.json({
    profiles: rows.map((p) => ({
      id: p.id,
      fullName: p.full_name,
      cardNumber: p.card_number,
      birthDate: p.birth_date,
      sex: p.sex,
      status: p.status,
    })),
  });
});

router.post('/api/citizen/profiles', requireCitizen, (req, res) => {
  const db = getDb();
  const fullName = String(req.body?.fullName || '').trim();
  if (!fullName) return res.status(400).json({ error: 'Укажите ФИО персонажа' });

  const sexRaw = String(req.body?.sex || '').trim();
  const sex = sexRaw === 'Мужской' || sexRaw === 'М' ? 'М' : sexRaw === 'Женский' || sexRaw === 'Ж' ? 'Ж' : null;
  const oms = String(req.body?.omsNumber || '').trim() || null;

  if (oms) {
    const dup = db.prepare(`SELECT id FROM patients WHERE oms_number = ?`).get(oms);
    if (dup) return res.status(409).json({ error: 'Полис ОМС уже привязан к другому персонажу' });
  }

  const cardNumber = nextCardNumber(db);
  const info = db
    .prepare(
      `INSERT INTO patients (card_number, full_name, birth_date, sex, oms_number, phone, discord_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
    )
    .run(
      cardNumber,
      fullName,
      req.body?.birthDate || null,
      sex,
      oms,
      String(req.body?.phone || '').trim() || null,
      req.citizen.account.discordId
    );
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(info.lastInsertRowid);

  audit(db, {
    action: 'citizen.profile.create',
    entityType: 'patient',
    entityId: patient.id,
    details: { fullName },
    ip: req.ip,
  });

  // Сразу выбираем созданного персонажа.
  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  citizenSessions.setPatient(req.citizen.token, patient.id);
  res.status(201).json({
    ok: true,
    profile: { id: patient.id, fullName: patient.full_name, cardNumber: patient.card_number },
    cookieHint: isSecure ? 'secure' : 'insecure',
  });
});

// ---- Выбор персонажа / выход --------------------------------------------------

router.post('/api/citizen/select', requireCitizen, (req, res) => {
  const db = getDb();
  const patientId = Number(req.body?.patientId || 0);
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(patientId);
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });
  if (patient.status === 'blocked') return res.status(403).json({ error: 'Аккаунт заблокирован администрацией' });

  const own =
    isDevAccount(req.citizen.account) || patient.discord_id === req.citizen.account.discordId;
  if (!own) return res.status(403).json({ error: 'Этот персонаж принадлежит другому аккаунту' });

  citizenSessions.setPatient(req.citizen.token, patient.id);
  audit(db, { action: 'citizen.select', entityType: 'patient', entityId: patient.id, ip: req.ip });
  res.json({ ok: true });
});

router.post('/api/citizen/logout', (req, res) => {
  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  citizenSessions.destroy(req);
  res.setHeader('Set-Cookie', citizenSessions.clearCookie(isSecure));
  res.json({ ok: true });
});

// ---- Bootstrap: все данные приложения одного персонажа ------------------------

router.get('/api/citizen/bootstrap', requirePatient, (req, res) => {
  const db = getDb();
  const me = req.citizen.patient;

  // Все персонажи этого Discord (семья), выбранный — первым.
  const family = isDevAccount(req.citizen.account)
    ? db.prepare(`SELECT * FROM patients WHERE status != 'blocked' ORDER BY id`).all()
    : db
        .prepare(`SELECT * FROM patients WHERE discord_id = ? AND status != 'blocked' ORDER BY id`)
        .all(req.citizen.account.discordId);
  const ordered = [me, ...family.filter((p) => p.id !== me.id)];
  const members = ordered.map(memberShape);

  // Врачи по специальностям (формат бандла).
  const staff = db.prepare(`SELECT * FROM users WHERE is_active = 1 ORDER BY full_name`).all();
  const doctors = {};
  for (const u of staff) {
    const key = specialtyKey(u.specialty);
    if (!doctors[key]) doctors[key] = [];
    doctors[key].push({
      id: 'd' + u.id,
      name: u.full_name,
      exp: 5 + ((u.id * 7) % 20),
      rating: Math.round((4.5 + ((u.id % 5) / 10)) * 10) / 10,
      clinic: CLINIC,
      _userId: u.id,
    });
  }

  // Талоны (активные) и медкарта — строго по каждому персонажу семьи.
  const appointments = {};
  const records = {};
  const notifications = {};
  const todayIso = new Date().toISOString().slice(0, 10);

  for (const p of ordered) {
    const key = 'p' + p.id;

    const tickets = db
      .prepare(
        `SELECT a.*, u.full_name AS doctor_name, u.specialty AS doc_spec
           FROM appointments a LEFT JOIN users u ON u.id = a.doctor_id
          WHERE a.patient_id = ? AND a.status IN ('waiting', 'in_room')
          ORDER BY a.date, a.time`
      )
      .all(p.id);
    appointments[key] = tickets.map((t) => {
      const specKey = specialtyKey(t.doc_spec);
      return {
        id: 'a' + t.id,
        specialistId: specKey,
        specialist: SPECIALTY_LABELS[specKey],
        doctorId: t.doctor_id ? 'd' + t.doctor_id : null,
        doctor: t.doctor_name || '',
        date: t.date,
        time: t.time,
        room: t.room || '',
        clinic: CLINIC,
        status: 'upcoming',
      };
    });

    const rowsRec = db
      .prepare(
        `SELECT e.*, u.full_name AS doctor_name, u.specialty AS doc_spec
           FROM emr_records e LEFT JOIN users u ON u.id = e.doctor_id
          WHERE e.patient_id = ? ORDER BY e.visit_date DESC`
      )
      .all(p.id);

    const analyses = [];
    const protocols = [];
    for (const r of rowsRec) {
      const specKey = specialtyKey(r.doc_spec);
      if (r.record_type === 'lab') {
        analyses.push({
          id: 'la' + r.id,
          title: r.diagnosis_text || r.complaints || 'Лабораторное исследование',
          date: String(r.visit_date).slice(0, 10),
          status: 'ready',
          items: [],
        });
      } else {
        const dx = [r.diagnosis_text, r.diagnosis_code ? `(${r.diagnosis_code})` : '']
          .filter(Boolean)
          .join(' ');
        protocols.push({
          id: 'pr' + r.id,
          date: String(r.visit_date).slice(0, 10),
          doctor: r.doctor_name || '',
          specialty: SPECIALTY_LABELS[specKey],
          diagnosis: dx || 'Без диагноза',
          recommendation: r.notes || r.complaints || '',
        });
      }
    }

    const recipes = db
      .prepare(`SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY issued_at DESC`)
      .all(p.id)
      .map((x) => ({
        id: 'r' + x.id,
        drug: x.medication,
        dosage: x.dosage,
        doctor: x.doctor_id ? doctorShort((db.prepare(`SELECT full_name FROM users WHERE id=?`).get(x.doctor_id) || {}).full_name || '') : '',
        issued: String(x.issued_at).slice(0, 10),
        expires: new Date(new Date(String(x.issued_at).replace(' ', 'T')).getTime() + 90 * 864e5)
          .toISOString()
          .slice(0, 10),
        status: 'active',
        qr: 'RX-' + String(x.prescription_number || x.id),
      }));

    records[key] = { analyses, protocols, recipes, vaccines: [] };

    // Уведомления: напоминания о приёмах + готовые анализы + рецепты.
    const notes = [];
    for (const t of appointments[key]) {
      notes.push({
        id: 'n-ap' + t.id,
        type: 'appointment',
        text: `Напоминание: приём${t.doctor ? ' у ' + t.doctor : ''} ${t.date === todayIso ? 'сегодня' : t.date.split('-').reverse().join('.')} в ${t.time}`,
        date: `${t.date} ${t.time}`,
        read: false,
      });
    }
    for (const a of analyses.slice(0, 3)) {
      if (a.status === 'ready')
        notes.push({ id: 'n-an' + a.id, type: 'analysis', text: `Готовы результаты: «${a.title}»`, date: `${a.date} 09:00`, read: false });
    }
    for (const r of recipes.slice(0, 3)) {
      notes.push({ id: 'n-rx' + r.id, type: 'recipe', text: `Выписан электронный рецепт: «${r.drug}»`, date: `${r.issued} 12:00`, read: false });
    }
    notifications[key] = notes;
  }

  res.json({
    account: {
      discordId: req.citizen.account.discordId,
      username: req.citizen.account.username,
      avatar: req.citizen.account.avatar,
      status: me.status,
    },
    activeId: 'p' + me.id,
    members,
    doctors,
    appointments,
    records,
    notifications,
    disclaimer: true,
  });
});

// ---- Привязка Discord через бота ----------------------------------------------

router.get('/api/citizen/link-code', requirePatient, (req, res) => {
  const db = getDb();
  const me = req.citizen.patient;
  // Гасим старые неиспользованные коды персонажа.
  db.prepare(`DELETE FROM link_codes WHERE patient_id = ? AND used_at IS NULL`).run(me.id);
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO link_codes (code, patient_id, expires_at) VALUES (?, ?, ?)`).run(code, me.id, expires);
  audit(db, { action: 'citizen.link_code', entityType: 'patient', entityId: me.id, ip: req.ip });
  res.json({ code, expiresInMin: 15 });
});

// ---- Запись к врачу (создаёт реальный талон в общей БД) ------------------------

router.post('/api/citizen/appointments', requirePatient, (req, res) => {
  const db = getDb();
  const me = req.citizen.patient;
  const date = String(req.body?.date || '');
  const time = String(req.body?.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'Неверный формат даты или времени' });
  }
  if (date < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Нельзя записать на прошедшую дату' });
  }

  let doctor = null;
  const doctorRef = String(req.body?.doctorId || ''); // 'd<num>' из бандла
  if (doctorRef) {
    const userId = Number(doctorRef.replace(/^d/, ''));
    doctor = db.prepare(`SELECT * FROM users WHERE id = ? AND is_active = 1`).get(userId);
    if (!doctor) return res.status(404).json({ error: 'Врач не найден' });
    const conflictDoc = db
      .prepare(
        `SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND time = ? AND status IN ('waiting','in_room')`
      )
      .get(doctor.id, date, time);
    if (conflictDoc) return res.status(409).json({ error: 'У врача уже занято это время' });
  }

  const conflictSelf = db
    .prepare(
      `SELECT id FROM appointments WHERE patient_id = ? AND date = ? AND time = ? AND status IN ('waiting','in_room')`
    )
    .get(me.id, date, time);
  if (conflictSelf) return res.status(409).json({ error: 'У вас уже есть талон на это время' });

  const number = nextTicketNumber(db, date);
  const info = db
    .prepare(
      `INSERT INTO appointments (ticket_number, patient_id, doctor_id, date, time, status, room, created_by)
       VALUES (?, ?, ?, ?, ?, 'waiting', NULL, NULL)`
    )
    .run(number, me.id, doctor ? doctor.id : null, date, time);

  const appointment = db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, p.card_number AS patient_card,
              u.full_name AS doctor_name, u.specialty AS doctor_specialty
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.doctor_id WHERE a.id = ?`
    )
    .get(info.lastInsertRowid);

  audit(db, {
    action: 'citizen.booking',
    entityType: 'appointment',
    entityId: appointment.id,
    details: { ticketNumber: number, patientId: me.id, doctorId: doctor ? doctor.id : null },
    ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_CREATED, { appointment });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date });

  res.status(201).json({ ok: true, appointment });
});

router.post('/api/citizen/appointments/:id/cancel', requirePatient, (req, res) => {
  const db = getDb();
  const me = req.citizen.patient;
  const ticket = db.prepare(`SELECT * FROM appointments WHERE id = ?`).get(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });
  if (ticket.patient_id !== me.id) return res.status(403).json({ error: 'Это не ваш талон' });
  if (ticket.status !== 'waiting') {
    return res.status(409).json({ error: 'Отменить можно только талон в статусе «Ожидание»' });
  }
  db.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(ticket.id);

  audit(db, {
    action: 'citizen.cancel',
    entityType: 'appointment',
    entityId: ticket.id,
    details: { patientId: me.id },
    ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.APPOINTMENT_STATUS_UPDATED, { appointmentId: ticket.id, status: 'cancelled' });
  hub.broadcast(WS_EVENTS.QUEUE_UPDATED, { date: ticket.date });
  res.json({ ok: true });
});

module.exports = router;
