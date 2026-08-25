'use strict';

/**
 * Персонал, статусы врачей, справочники, аналитика и аудит.
 * Роутер монтируется с префиксом /api (см. server/index.js).
 */

const express = require('express');
const { getDb } = require('../db/connection');
const { requireAuth, requireRole, isAdmin } = require('../middleware/rbac');
const { audit, recent: recentAudit } = require('../services/audit');
const hub = require('../realtime/hub');
const { WS_EVENTS, DOCTOR_STATUS, ROLES } = require('../../shared/constants');
const { MKB10 } = require('../../shared/mkb10');

const router = express.Router();

// ---- Персонал (для расписания и назначения талонов) ----------------------------
router.get('/staff', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, full_name, specialty, role, status
         FROM users WHERE is_active = 1 AND role IN (?, ?)
        ORDER BY full_name`
    )
    .all(ROLES.PHYSICIAN, ROLES.HEAD_PHYSICIAN);
  res.json({ staff: rows });
});

// ---- Статус врача («Начать/завершить приём») -------------------------------------
router.post('/staff/:id/status', requireAuth, (req, res) => {
  if (Number(req.params.id) !== req.user.id && !isAdmin(req.user)) {
    return res.status(403).json({ error: 'Можно менять только свой статус' });
  }
  const status = String(req.body?.status || '');
  if (!Object.values(DOCTOR_STATUS).includes(status)) {
    return res.status(400).json({ error: 'Недопустимый статус' });
  }
  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });

  db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, user.id);
  audit(db, {
    actorId: req.user.id, action: 'staff.status', entityType: 'user',
    entityId: user.id, details: { status }, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.DOCTOR_STATUS_UPDATED, { doctorId: user.id, status });
  res.json({ ok: true, doctorId: user.id, status });
});

// ---- Справочник МКБ-10 (автодополнение диагнозов) -----------------------------------
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

// ---- Аналитика (только «Главный врач») ------------------------------------------------
router.get('/stats', requireAuth, requireRole(ROLES.HEAD_PHYSICIAN), (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push({
      date: d,
      cnt: db.prepare(`SELECT COUNT(*) n FROM appointments WHERE date = ? AND status != 'cancelled'`).get(d).n,
    });
  }

  const stats = {
    patientsTotal: db.prepare(`SELECT COUNT(*) n FROM patients`).get().n,
    patientsBlocked: db.prepare(`SELECT COUNT(*) n FROM patients WHERE status = 'blocked'`).get().n,
    staffTotal: db.prepare(`SELECT COUNT(*) n FROM users WHERE is_active = 1`).get().n,
    ticketsToday: db.prepare(`SELECT COUNT(*) n FROM appointments WHERE date = ?`).get(today).n,
    waitingToday: db.prepare(`SELECT COUNT(*) n FROM appointments WHERE date = ? AND status = 'waiting'`).get(today).n,
    doneToday: db.prepare(`SELECT COUNT(*) n FROM appointments WHERE date = ? AND status = 'done'`).get(today).n,
    recordsMonth: db
      .prepare(`SELECT COUNT(*) n FROM emr_records WHERE substr(visit_date, 1, 7) = ?`)
      .get(new Date().toISOString().slice(0, 7)).n,
    visitsByDay: days,
    loadBySpecialty: db
      .prepare(
        `SELECT COALESCE(NULLIF(u.specialty, ''), '—') AS specialty, COUNT(*) cnt
           FROM appointments a JOIN users u ON u.id = a.doctor_id
          WHERE a.date = ? GROUP BY specialty ORDER BY cnt DESC`
      )
      .all(today),
    topDiagnoses: db
      .prepare(
        `SELECT diagnosis_code AS code, diagnosis_text AS name, COUNT(*) cnt
           FROM emr_records WHERE diagnosis_code IS NOT NULL
          GROUP BY diagnosis_code ORDER BY cnt DESC LIMIT 5`
      )
      .all(),
  };

  res.json({ stats });
});

// ---- Блокировка пациента (только «Главный врач») --------------------------------
router.post('/patients/:id/block', requireAuth, requireRole(ROLES.HEAD_PHYSICIAN), (req, res) => {
  const db = getDb();
  const patient = db.prepare(`SELECT * FROM patients WHERE id = ?`).get(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Пациент не найден' });
  const blocked = Boolean(req.body?.blocked);
  db.prepare(`UPDATE patients SET status = ? WHERE id = ?`).run(blocked ? 'blocked' : 'active', patient.id);
  audit(db, {
    actorId: req.user.id, action: blocked ? 'patient.block' : 'patient.unblock',
    entityType: 'patient', entityId: patient.id, ip: req.ip,
  });
  hub.broadcast(WS_EVENTS.PATIENT_UPDATED, { patientId: patient.id });
  res.json({ ok: true, status: blocked ? 'blocked' : 'active' });
});

// ---- Журнал аудита (только «Главный врач») -------------------------------------------------
router.get('/audit', requireAuth, requireRole(ROLES.HEAD_PHYSICIAN), (req, res) => {
  res.json({ entries: recentAudit(getDb(), Math.min(Number(req.query.limit || 50), 200)) });
});

module.exports = router;
