/**
 * Личный кабинет граждан (персонажей).
 *
 * Модель доступа:
 *   Discord-аккаунт (citizen_accounts) → несколько персонажей (patients,
 *   привязанных полем patients.discordId) → выбор персонажа при каждом входе
 *   (citizen_sessions.patientId). Все данные выдаются ТОЛЬКО выбранного
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
const { prisma } = require('../db/connection');
const { audit } = require('../services/audit');
const { nextCardNumber, nextTicketNumber } = require('../services/documents');
const hub = require('../realtime/hub');
const { WS_EVENTS } = require('../../shared/constants');

const router = express.Router();
const DEV_DISCORD_ID = 'dev-local';
const CLINIC = 'ГП №1, Кутузовский пр-т, д. 34';

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
    fio: p.fullName,
    short: shortName(p.fullName),
    birth: fmtBirth(p.birthDate),
    sex: sexLabel(p.sex),
    policy: p.omsNumber || '',
    clinic: CLINIC,
    phone: p.phone || '',
    blood: p.bloodGroup || '',
    allergies: p.allergies || '',
    status: p.status,
    avatar: {
      initials: initialsOf(p.fullName),
      color: AVATAR_COLORS[p.id % AVATAR_COLORS.length],
    },
  };
}

function isDevAccount(account) {
  return env.DEV_LOGIN && account && account.discordId === DEV_DISCORD_ID;
}

function requireCitizen(req, res, next) {
  const s = citizenSessions.getSession(req);
  if (!s) return res.status(401).json({ error: 'Требуется вход гражданина' });
  req.citizen = s;
  next();
}

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

router.post('/api/citizen/auth/code', async (req, res) => {
  const raw = String(req.body?.code || '').trim();
  if (!raw) return res.status(400).json({ error: 'Укажите код' });
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const row = await prisma.siteAuthCode.findUnique({ where: { code } });
  if (!row) return res.status(404).json({ error: 'Код не найден' });
  if (row.usedAt) return res.status(409).json({ error: 'Код уже использован' });
  if (new Date(row.expiresAt) < new Date()) return res.status(410).json({ error: 'Код истёк (10 мин)' });

  await prisma.siteAuthCode.update({ where: { code }, data: { usedAt: new Date() } });

  let account = await prisma.citizenAccount.findUnique({ where: { discordId: row.discordId } });
  if (!account) {
    account = await prisma.citizenAccount.create({
      data: {
        discordId: row.discordId,
        discordUsername: row.discordUsername || null,
        lastLoginAt: new Date(),
      },
    });
  } else {
    account = await prisma.citizenAccount.update({
      where: { id: account.id },
      data: {
        lastLoginAt: new Date(),
        discordUsername: row.discordUsername || account.discordUsername,
      },
    });
  }

  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  const sessionAccount = { id: account.id, discordId: account.discordId, username: account.discordUsername, avatar: null };
  const session = citizenSessions.createSession(sessionAccount, null, isSecure);

  let staffCookie = null;
  const staffUser = await prisma.users.findUnique({ where: { discordId: row.discordId } });
  if (staffUser && staffUser.isActive) {
    const staffSess = staffSessions.createSession(staffUser.id, isSecure);
    staffCookie = staffSess.cookie;
    audit({ action: 'staff.site_code', entityType: 'user', entityId: staffUser.id, details: { code, discordId: row.discordId }, ip: req.ip });
  }

  audit({ action: 'citizen.site_code', entityType: 'citizen_account', entityId: account.id, details: { code, discordId: row.discordId }, ip: req.ip });
  if (staffCookie) res.setHeader('Set-Cookie', [session.cookie, staffCookie]);
  else res.setHeader('Set-Cookie', session.cookie);
  res.json({ ok: true, account: { discordId: account.discordId, username: account.discordUsername }, isStaff: !!staffUser });
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
      ? { id: s.patient.id, fullName: s.patient.fullName, cardNumber: s.patient.cardNumber, status: s.patient.status }
      : null,
  });
});

// Демо-вход гражданина — пароль ZZZ3295
router.post('/api/citizen/dev-auth', async (req, res) => {
  const pass = String(req.body?.password || '').trim();
  if (pass !== 'ZZZ3295') {
    return res.status(403).json({ error: 'Неверный пароль демо' });
  }

  let account = await prisma.citizenAccount.findUnique({ where: { discordId: DEV_DISCORD_ID } });
  if (!account) {
    account = await prisma.citizenAccount.create({
      data: { discordId: DEV_DISCORD_ID, discordUsername: 'dev-local' },
    });
  } else {
    await prisma.citizenAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });
  }

  const patientId = Number(req.body?.patientId || 0);
  let sessionPatient = null;
  if (patientId) {
    sessionPatient = await prisma.patients.findUnique({ where: { id: patientId } });
    if (!sessionPatient) return res.status(404).json({ error: 'Персонаж не найден' });
    if (sessionPatient.status === 'blocked') return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }

  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  const sessionAccount = { id: account.id, discordId: account.discordId, username: account.discordUsername, avatar: null };
  const session = citizenSessions.createSession(sessionAccount, sessionPatient, isSecure);
  audit({ action: 'citizen.dev_login', entityType: 'patient', entityId: patientId || null, ip: req.ip });
  res.setHeader('Set-Cookie', session.cookie);
  res.json({ ok: true });
});

// ---- Персонажи --------------------------------------------------------------

router.get('/api/citizen/profiles', requireCitizen, async (req, res) => {
  let rows;
  if (isDevAccount(req.citizen.account)) {
    rows = await prisma.patients.findMany({ where: { status: { not: 'blocked' } }, orderBy: { fullName: 'asc' } });
  } else {
    rows = await prisma.patients.findMany({
      where: { discordId: req.citizen.account.discordId, status: { not: 'blocked' } },
      orderBy: { id: 'asc' },
    });
  }
  res.json({
    profiles: rows.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      cardNumber: p.cardNumber,
      birthDate: p.birthDate,
      sex: p.sex,
      status: p.status,
    })),
  });
});

router.post('/api/citizen/profiles', requireCitizen, async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  if (!fullName) return res.status(400).json({ error: 'Укажите ФИО персонажа' });

  const sexRaw = String(req.body?.sex || '').trim();
  const sex = sexRaw === 'Мужской' || sexRaw === 'М' ? 'М' : sexRaw === 'Женский' || sexRaw === 'Ж' ? 'Ж' : null;
  const oms = String(req.body?.omsNumber || '').trim() || null;

  if (oms) {
    const dup = await prisma.patients.findFirst({ where: { omsNumber: oms } });
    if (dup) return res.status(409).json({ error: 'Полис ОМС уже привязан к другому персонажу' });
  }

  const cardNumber = await nextCardNumber();
  const patient = await prisma.patients.create({
    data: {
      cardNumber,
      fullName,
      birthDate: req.body?.birthDate || null,
      sex,
      omsNumber: oms,
      phone: String(req.body?.phone || '').trim() || null,
      discordId: req.citizen.account.discordId,
      status: 'active',
    },
  });

  audit({
    action: 'citizen.profile.create',
    entityType: 'patient',
    entityId: patient.id,
    details: { fullName },
    ip: req.ip,
  });

  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  citizenSessions.setPatient(req.citizen.token, patient);
  res.status(201).json({
    ok: true,
    profile: { id: patient.id, fullName: patient.fullName, cardNumber: patient.cardNumber },
    cookieHint: isSecure ? 'secure' : 'insecure',
  });
});

// ---- Выбор персонажа / выход --------------------------------------------------

router.post('/api/citizen/select', requireCitizen, async (req, res) => {
  const patientId = Number(req.body?.patientId || 0);
  const patient = await prisma.patients.findUnique({ where: { id: patientId } });
  if (!patient) return res.status(404).json({ error: 'Персонаж не найден' });
  if (patient.status === 'blocked') return res.status(403).json({ error: 'Аккаунт заблокирован администрацией' });

  const own = isDevAccount(req.citizen.account) || patient.discordId === req.citizen.account.discordId;
  if (!own) return res.status(403).json({ error: 'Этот персонаж принадлежит другому аккаунту' });

  citizenSessions.setPatient(req.citizen.token, patient);
  audit({ action: 'citizen.select', entityType: 'patient', entityId: patient.id, ip: req.ip });
  res.json({ ok: true });
});

router.post('/api/citizen/logout', (req, res) => {
  const isSecure = env.PUBLIC_BASE_URL.startsWith('https');
  citizenSessions.destroy(req);
  res.setHeader('Set-Cookie', citizenSessions.clearCookie(isSecure));
  res.json({ ok: true });
});

// ---- Bootstrap: все данные приложения одного персонажа ------------------------

router.get('/api/citizen/bootstrap', requirePatient, async (req, res) => {
  const me = req.citizen.patient;

  const family = isDevAccount(req.citizen.account)
    ? await prisma.patients.findMany({ where: { status: { not: 'blocked' } }, orderBy: { id: 'asc' } })
    : await prisma.patients.findMany({
        where: { discordId: req.citizen.account.discordId, status: { not: 'blocked' } },
        orderBy: { id: 'asc' },
      });
  const ordered = [me, ...family.filter((p) => p.id !== me.id)];
  const members = ordered.map(memberShape);

  const staff = await prisma.users.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' } });
  const doctors = {};
  for (const u of staff) {
    const key = specialtyKey(u.specialty);
    if (!doctors[key]) doctors[key] = [];
    doctors[key].push({
      id: 'd' + u.id,
      name: u.fullName,
      exp: 5 + ((u.id * 7) % 20),
      rating: Math.round((4.5 + ((u.id % 5) / 10)) * 10) / 10,
      clinic: CLINIC,
      _userId: u.id,
    });
  }

  const appointments = {};
  const records = {};
  const notifications = {};
  const todayIso = new Date().toISOString().slice(0, 10);

  for (const p of ordered) {
    const key = 'p' + p.id;

    const tickets = await prisma.appointment.findMany({
      where: { patientId: p.id, status: { in: ['waiting', 'in_room'] } },
      include: { doctor: true },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
    });
    appointments[key] = tickets.map((t) => {
      const specKey = specialtyKey(t.doctor?.specialty);
      return {
        id: 'a' + t.id,
        specialistId: specKey,
        specialist: SPECIALTY_LABELS[specKey],
        doctorId: t.doctorId ? 'd' + t.doctorId : null,
        doctor: t.doctor?.fullName || '',
        date: t.date,
        time: t.time,
        room: t.room || '',
        clinic: CLINIC,
        status: 'upcoming',
      };
    });

    const rowsRec = await prisma.record.findMany({
      where: { patientId: p.id },
      include: { doctor: true },
      orderBy: { visitDate: 'desc' },
    });

    const analyses = [];
    const protocols = [];
    for (const r of rowsRec) {
      const specKey = specialtyKey(r.doctor?.specialty);
      if (r.recordType === 'lab') {
        analyses.push({
          id: 'la' + r.id,
          title: r.diagnosisText || r.complaints || 'Лабораторное исследование',
          date: String(r.visitDate).slice(0, 10),
          status: 'ready',
          items: [],
        });
      } else {
        const dx = [r.diagnosisText, r.diagnosisCode ? `(${r.diagnosisCode})` : '']
          .filter(Boolean)
          .join(' ');
        protocols.push({
          id: 'pr' + r.id,
          date: String(r.visitDate).slice(0, 10),
          doctor: r.doctor?.fullName || '',
          specialty: SPECIALTY_LABELS[specKey],
          diagnosis: dx || 'Без диагноза',
          recommendation: r.notes || r.complaints || '',
        });
      }
    }

    const prescriptions = await prisma.prescription.findMany({
      where: { patientId: p.id },
      orderBy: { issuedAt: 'desc' },
    });

    const prescDoctorIds = [...new Set(prescriptions.map((x) => x.doctorId).filter(Boolean))];
    const prescDoctors = prescDoctorIds.length
      ? await prisma.users.findMany({ where: { id: { in: prescDoctorIds } }, select: { id: true, fullName: true } })
      : [];
    const prescDoctorMap = Object.fromEntries(prescDoctors.map((d) => [d.id, d.fullName]));

    const recipes = prescriptions.map((x) => ({
      id: 'r' + x.id,
      drug: x.medication,
      dosage: x.dosage,
      doctor: x.doctorId ? doctorShort(prescDoctorMap[x.doctorId] || '') : '',
      issued: String(x.issuedAt).slice(0, 10),
      expires: new Date(new Date(String(x.issuedAt).replace(' ', 'T')).getTime() + 90 * 864e5)
        .toISOString()
        .slice(0, 10),
      status: 'active',
      qr: 'RX-' + String(x.prescriptionNumber || x.id),
    }));

    records[key] = { analyses, protocols, recipes, vaccines: [] };

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

router.get('/api/citizen/link-code', requirePatient, async (req, res) => {
  const me = req.citizen.patient;
  await prisma.linkCode.deleteMany({ where: { patientId: me.id, usedAt: null } });
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await prisma.linkCode.create({
    data: { code, patientId: me.id, expiresAt: expires },
  });
  audit({ action: 'citizen.link_code', entityType: 'patient', entityId: me.id, ip: req.ip });
  res.json({ code, expiresInMin: 15 });
});

// ---- Запись к врачу (создаёт реальный талон в общей БД) ------------------------

router.post('/api/citizen/appointments', requirePatient, async (req, res) => {
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
  const doctorRef = String(req.body?.doctorId || '');
  if (doctorRef) {
    const userId = Number(doctorRef.replace(/^d/, ''));
    doctor = await prisma.users.findFirst({ where: { id: userId, isActive: true } });
    if (!doctor) return res.status(404).json({ error: 'Врач не найден' });
    const conflictDoc = await prisma.appointment.findFirst({
      where: { doctorId: doctor.id, date, time, status: { in: ['waiting', 'in_room'] } },
    });
    if (conflictDoc) return res.status(409).json({ error: 'У врача уже занято это время' });
  }

  const conflictSelf = await prisma.appointment.findFirst({
    where: { patientId: me.id, date, time, status: { in: ['waiting', 'in_room'] } },
  });
  if (conflictSelf) return res.status(409).json({ error: 'У вас уже есть талон на это время' });

  const number = await nextTicketNumber(date);
  const appointment = await prisma.appointment.create({
    data: {
      ticketNumber: number,
      patientId: me.id,
      doctorId: doctor ? doctor.id : null,
      date,
      time,
      status: 'waiting',
    },
    include: { patient: true, doctor: true },
  });

  audit({
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

router.post('/api/citizen/appointments/:id/cancel', requirePatient, async (req, res) => {
  const me = req.citizen.patient;
  const ticket = await prisma.appointment.findUnique({ where: { id: Number(req.params.id) } });
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });
  if (ticket.patientId !== me.id) return res.status(403).json({ error: 'Это не ваш талон' });
  if (ticket.status !== 'waiting') {
    return res.status(409).json({ error: 'Отменить можно только талон в статусе «Ожидание»' });
  }
  await prisma.appointment.update({
    where: { id: ticket.id },
    data: { status: 'cancelled', updatedAt: new Date() },
  });

  audit({
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
