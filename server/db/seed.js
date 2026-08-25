'use strict';

/**
 * Демонстрационные данные для локальной разработки и РП-сценариев.
 * Запуск: npm run db:seed (перед этим npm run db:migrate).
 *
 * ВНИМАНИЕ: все пациенты, врачи и диагнозы — вымышлены (требование
 * юридического стандарта проекта). Discord ID — тестовые.
 */

const { getDb } = require('./connection');
const { runMigrations } = require('./migrate');
const { nextCardNumber, nextTicketNumber, nextPrescriptionNumber } = require('../services/documents');
const { ROLES, TICKET_STATUS } = require('../../shared/constants');

function seed() {
  const db = getDb();
  runMigrations(db);

  const existing = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  if (existing > 0) {
    console.log('[seed] данные уже есть — пропуск (удалите data/emias.db для пересоздания)');
    return;
  }

  const insertUser = db.prepare(
    `INSERT INTO users (discord_id, discord_username, full_name, specialty, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertPatient = db.prepare(
    `INSERT INTO patients (card_number, full_name, birth_date, sex, oms_number, blood_group, allergies, phone)
     VALUES (@card_number, @full_name, @birth_date, @sex, @oms_number, @blood_group, @allergies, @phone)`
  );
  const insertAppointment = db.prepare(
    `INSERT INTO appointments (ticket_number, patient_id, doctor_id, date, time, status, room)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRecord = db.prepare(
    `INSERT INTO emr_records (patient_id, doctor_id, visit_date, record_type, complaints, diagnosis_code, diagnosis_text, notes, sick_leave_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertPrescription = db.prepare(
    `INSERT INTO prescriptions (prescription_number, patient_id, doctor_id, medication, dosage, duration_days)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // ---- Персонал (вымышленный) -------------------------------------------
  const headPhysicianId = insertUser.run('100000000000000001', 'head_physician_rp', 'Громова Елена Викторовна', 'kardiolog', ROLES.HEAD_PHYSICIAN, 'offline').lastInsertRowid;
  const therapist1 = insertUser.run('100000000000000002', 'sokolova_ai', 'Соколова Анна Игоревна', 'terapevt', ROLES.PHYSICIAN, 'free').lastInsertRowid;
  const therapist2 = insertUser.run('100000000000000003', 'morozov_dp', 'Морозов Дмитрий Павлович', 'terapevt', ROLES.PHYSICIAN, 'in_appointment').lastInsertRowid;
  const pediatrician = insertUser.run('100000000000000004', 'kuznetsova_ml', 'Кузнецова Мария Львовна', 'pediatr', ROLES.PHYSICIAN, 'free').lastInsertRowid;
  const surgeon = insertUser.run('100000000000000005', 'gromov_sn', 'Громов Сергей Николаевич', 'hirurg', ROLES.PHYSICIAN, 'offline').lastInsertRowid;
  const registrarId = insertUser.run('100000000000000006', 'registrar_rp', 'Титова Ольга Павловна', null, ROLES.REGISTRAR, 'free').lastInsertRowid;

  // ---- Пациенты (вымышленные) --------------------------------------------
  const patientsData = [
    { full_name: 'Петров Иван Алексеевич', birth_date: '1989-03-14', sex: 'М', oms_number: '7712345678901234', blood_group: 'I (O) Rh+', allergies: 'Нет', phone: '+7 (916) 123-45-67' },
    { full_name: 'Петрова Алиса Игоревна', birth_date: '2019-06-02', sex: 'Ж', oms_number: '7712987654321098', blood_group: 'II (A) Rh+', allergies: 'Пенициллин', phone: '+7 (916) 123-45-67' },
    { full_name: 'Смирнова Наталья Сергеевна', birth_date: '1975-11-23', sex: 'Ж', oms_number: '7700112233445566', blood_group: 'III (B) Rh−', allergies: 'Нет', phone: '+7 (903) 555-10-20' },
    { full_name: 'Волков Артём Дмитриевич', birth_date: '1996-07-30', sex: 'М', oms_number: '7766554433221100', blood_group: 'II (A) Rh−', allergies: 'Полынь', phone: '+7 (925) 777-88-99' },
    { full_name: 'Фёдорова Марина Олеговна', birth_date: '2001-01-09', sex: 'Ж', oms_number: '7755667788990011', blood_group: 'IV (AB) Rh+', allergies: 'Нет', phone: '+7 (999) 010-20-30' },
  ];
  const patientIds = patientsData.map((p) => {
    const card = nextCardNumber(db);
    return insertPatient.run({ card_number: card, ...p }).lastInsertRowid;
  });

  // ---- Талоны на сегодня/завтра ------------------------------------------
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tickets = [
    [patientIds[0], therapist1, fmt(today), '09:00', TICKET_STATUS.DONE, '204'],
    [patientIds[2], therapist1, fmt(today), '09:30', TICKET_STATUS.DONE, '204'],
    [patientIds[3], therapist2, fmt(today), '10:00', TICKET_STATUS.IN_ROOM, '205'],
    [patientIds[4], therapist2, fmt(today), '10:30', TICKET_STATUS.WAITING, '205'],
    [patientIds[1], pediatrician, fmt(today), '11:00', TICKET_STATUS.WAITING, '112'],
    [patientIds[2], surgeon, fmt(tomorrow), '09:15', TICKET_STATUS.WAITING, '301'],
    [patientIds[0], therapist1, fmt(tomorrow), '12:00', TICKET_STATUS.WAITING, '204'],
  ];
  for (const [pid, did, date, time, status, room] of tickets) {
    insertAppointment.run(nextTicketNumber(db, date), pid, did, date, time, status, room);
  }

  // ---- История ЭМК ---------------------------------------------------------
  insertRecord.run(patientIds[0], therapist1, `${fmt(today)} 09:20`, 'visit',
    'Головная боль 3 дня, слабость.', 'J44.8', 'ХОБЛ, обострение', 'Рекомендован постельный режим, контроль АД.', 5);
  insertRecord.run(patientIds[2], therapist1, `${fmt(today)} 09:40`, 'lab',
    'Профилактический осмотр.', 'E66.9', 'Избыточная масса тела', 'Направлена на биохимический анализ крови.', null);
  insertRecord.run(patientIds[1], pediatrician, `${fmt(today)} 11:20`, 'visit',
    'Кашель, температура 37.4.', 'J00', 'Острый назофарингит (насморк)', 'Обильное питьё, симптоматическая терапия.', null);

  insertPrescription.run(nextPrescriptionNumber(db), patientIds[0], therapist1, 'Индапамид', '2.5 мг, 1 раз в сутки утром', 14);
  insertPrescription.run(nextPrescriptionNumber(db), patientIds[1], pediatrician, 'Парацетамол (детский)', '250 мг, при температуре выше 38.0', 3);

  console.log('[seed] демо-данные созданы:');
  console.log(`       персонал: ${db.prepare('SELECT COUNT(*) n FROM users').get().n}`);
  console.log(`       пациентов: ${db.prepare('SELECT COUNT(*) n FROM patients').get().n}`);
  console.log(`       талонов: ${db.prepare('SELECT COUNT(*) n FROM appointments').get().n}`);
}

seed();
