const express = require('express');
const { prisma } = require('../db/connection');
const { requireAuth, requireRole, isAdmin } = require('../middleware/rbac');
const { audit, recent: recentAudit } = require('../services/audit');
const hub = require('../realtime/hub');
const { WS_EVENTS, DOCTOR_STATUS, ROLES } = require('../../shared/constants');
const { MKB10 } = require('../../shared/mkb10');

const router = express.Router();

router.get('/staff', requireAuth, async (req, res) => {
  const rows = await prisma.users.findMany({
    where: { isActive: 1, role: { in: [ROLES.PHYSICIAN, ROLES.HEAD_PHYSICIAN] } },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, specialty: true, role: true, status: true },
  });
  res.json({
    staff: rows.map(u => ({
      id: u.id, full_name: u.fullName, specialty: u.specialty,
      role: u.role, status: u.status,
    })),
  });
});

router.post('/staff/:id/status', requireAuth, async (req, res) => {
  if (Number(req.params.id) !== req.user.id && !isAdmin(req.user)) {
    return res.status(403).json({ error: 'Можно менять только свой статус' });
  }
  const status = String(req.body?.status || '');
  if (!Object.values(DOCTOR_STATUS).includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус' });
  }
  const user = await prisma.users.findUnique({ where: { id: Number(req.params.id) } });
  if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });

  await prisma.users.update({ where: { id: user.id }, data: { status } });
  audit({
    actorId: req.user.id, action: 'staff.status', entityType: 'user',
    entityId: user.id, details: { status }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: user.id, status });
  res.json({ ok: true, doctorId: user.id, status });
});

router.get('/mkb10', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const result = q
    ? MKB10.filter(
        (e) =>
          e.code.toLowerCase().startsWith(q) ||
          e.name.toLowerCase().includes(q)
      ).slice(0, 20)
    : MKB10.slice(0, 20);
  res.json({ entries: result });
});

router.get('/stats', requireAuth, requireRole(ROLES.HEAD_PHYSICIAN), async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const cnt = await prisma.appointment.count({
      where: { date: d, status: { not: 'cancelled' } },
    });
    days.push({ date: d, cnt });
  }

  const monthPrefix = new Date().toISOString().slice(0, 7);

  const [patientsTotal, patientsBlocked, staffTotal, ticketsToday, waitingToday, doneToday, recordsMonth] =
    await Promise.all([
      prisma.patients.count(),
      prisma.patients.count({ where: { status: 'blocked' } }),
      prisma.users.count({ where: { isActive: 1 } }),
      prisma.appointment.count({ where: { date: today } }),
      prisma.appointment.count({ where: { date: today, status: 'waiting' } }),
      prisma.appointment.count({ where: { date: today, status: 'done' } }),
      prisma.record.count({ where: { visitDate: { startsWith: monthPrefix } } }),
    ]);

  const appsForSpecialty = await prisma.appointment.findMany({
    where: { date: today },
    include: { doctor: { select: { specialty: true } } },
  });
  const specialtyMap = {};
  for (const a of appsForSpecialty) {
    const spec = a.doctor?.specialty || '—';
    specialtyMap[spec] = (specialtyMap[spec] || 0) + 1;
  }
  const loadBySpecialty = Object.entries(specialtyMap)
    .map(([specialty, cnt]) => ({ specialty, cnt }))
    .sort((a, b) => b.cnt - a.cnt);

  const diagRecords = await prisma.record.findMany({
    where: { diagnosisCode: { not: null } },
    select: { diagnosisCode: true, diagnosisText: true },
  });
  const diagMap = {};
  for (const r of diagRecords) {
    const key = r.diagnosisCode;
    if (!diagMap[key]) diagMap[key] = { code: r.diagnosisCode, name: r.diagnosisText, cnt: 0 };
    diagMap[key].cnt++;
  }
  const topDiagnoses = Object.values(diagMap)
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 5);

  const stats = {
    patientsTotal, patientsBlocked, staffTotal,
    ticketsToday, waitingToday, doneToday, recordsMonth,
    visitsByDay: days,
    loadBySpecialty,
    topDiagnoses,
  };

  res.json({ stats });
});

router.post('/patients/:id/block', requireAuth, requireRole(ROLES.HEAD_PHYSICIAN), async (req, res) => {
  const patient = await prisma.patients.findUnique({ where: { id: Number(req.params.id) } });
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });
  const blocked = Boolean(req.body?.blocked);
  await prisma.patients.update({
    where: { id: patient.id },
    data: { status: blocked ? 'blocked' : 'active' },
  });
  audit({
    actorId: req.user.id, action: blocked ? 'patient.block' : 'patient.unblock',
    entityType: 'patient', entityId: patient.id, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.PATIENT_UPDATED, { patientId: patient.id });
  res.json({ ok: true, status: blocked ? 'blocked' : 'active' });
});

router.get('/audit', requireAuth, requireRole(ROLES.HEAD_PHYSICIAN), async (req, res) => {
  const entries = await recentAudit(Math.min(Number(req.query.limit || 50), 200));
  res.json({ entries });
});

module.exports = router;
