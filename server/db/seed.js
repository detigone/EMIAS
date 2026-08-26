/**
 * Демонстрационные данные для локальной разработки и РП-сценариев.
 * Запуск: node server/db/seed.js
 *
 * ВНИМАНИЕ: все пациенты, врачи и диагнозы — вымышлены.
 */

const { prisma } = require('./connection');
const { ROLES, TICKET_STATUS } = require('../../shared/constants');

function pad(n, w) { return String(n).padStart(w, '0'); }

async function nextCardNumber() {
  const year = new Date().getFullYear();
  const prefix = `ЕМК-${year}-`;
  const row = await prisma.patients.findFirst({ where: { cardNumber: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { cardNumber: true } });
  return `${prefix}${pad((row ? Number(row.cardNumber.slice(prefix.length)) : 0) + 1, 6)}`;
}

async function nextTicketNumber(dateISO) {
  const prefix = `Т-${dateISO.replaceAll('-', '')}-`;
  const row = await prisma.appointment.findFirst({ where: { ticketNumber: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { ticketNumber: true } });
  return `${prefix}${pad((row ? Number(row.ticketNumber.slice(prefix.length)) : 0) + 1, 3)}`;
}

async function nextPrescriptionNumber() {
  const year = new Date().getFullYear();
  const prefix = `Р-${year}-`;
  const row = await prisma.prescription.findFirst({ where: { prescriptionNumber: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { prescriptionNumber: true } });
  return `${prefix}${pad((row ? Number(row.prescriptionNumber.slice(prefix.length)) : 0) + 1, 6)}`;
}

async function seed() {
  const existing = await prisma.users.count();
  if (existing > 0) {
    console.log('[seed] данные уже есть — пропуск');
    return;
  }

  const h = await prisma.users.create({ data: { discordId: '100000000000000001', discordUsername: 'head_physician_rp', fullName: 'Громова Елена Викторовна', specialty: 'kardiolog', role: ROLES.HEAD_PHYSICIAN, status: 'offline' } });
  const t1 = await prisma.users.create({ data: { discordId: '100000000000000002', discordUsername: 'sokolova_ai', fullName: 'Соколова Анна Игоревна', specialty: 'terapevt', role: ROLES.PHYSICIAN, status: 'free' } });
  const t2 = await prisma.users.create({ data: { discordId: '100000000000000003', discordUsername: 'morozov_dp', fullName: 'Морозов Дмитрий Павлович', specialty: 'terapevt', role: ROLES.PHYSICIAN, status: 'in_appointment' } });
  const ped = await prisma.users.create({ data: { discordId: '100000000000000004', discordUsername: 'kuznetsova_ml', fullName: 'Кузнецова Мария Львовна', specialty: 'pediatr', role: ROLES.PHYSICIAN, status: 'free' } });
  const sur = await prisma.users.create({ data: { discordId: '100000000000000005', discordUsername: 'gromov_sn', fullName: 'Громов Сергей Николаевич', specialty: 'hirurg', role: ROLES.PHYSICIAN, status: 'offline' } });
  const reg = await prisma.users.create({ data: { discordId: '100000000000000006', discordUsername: 'registrar_rp', fullName: 'Титова Ольга Павловна', role: ROLES.REGISTRAR, status: 'free' } });

  const pData = [
    { fullName: 'Петров Иван Алексеевич', birthDate: '1989-03-14', sex: 'М', omsNumber: '7712345678901234', bloodGroup: 'I (O) Rh+', allergies: 'Нет', phone: '+7 (916) 123-45-67' },
    { fullName: 'Петрова Алиса Игоревна', birthDate: '2019-06-02', sex: 'Ж', omsNumber: '7712987654321098', bloodGroup: 'II (A) Rh+', allergies: 'Пенициллин', phone: '+7 (916) 123-45-67' },
    { fullName: 'Смирнова Наталья Сергеевна', birthDate: '1975-11-23', sex: 'Ж', omsNumber: '7700112233445566', bloodGroup: 'III (B) Rh−', allergies: 'Нет', phone: '+7 (903) 555-10-20' },
    { fullName: 'Волков Артём Дмитриевич', birthDate: '1996-07-30', sex: 'М', omsNumber: '7766554433221100', bloodGroup: 'II (A) Rh−', allergies: 'Полынь', phone: '+7 (925) 777-88-99' },
    { fullName: 'Фёдорова Марина Олеговна', birthDate: '2001-01-09', sex: 'Ж', omsNumber: '7755667788990011', bloodGroup: 'IV (AB) Rh+', allergies: 'Нет', phone: '+7 (999) 010-20-30' },
  ];
  const pIds = [];
  for (const p of pData) {
    const card = await nextCardNumber();
    const created = await prisma.patients.create({ data: { cardNumber: card, ...p } });
    pIds.push(created.id);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tmr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const tickets = [
    [pIds[0], t1.id, today, '09:00', 'done', '204'],
    [pIds[2], t1.id, today, '09:30', 'done', '204'],
    [pIds[3], t2.id, today, '10:00', 'in_room', '205'],
    [pIds[4], t2.id, today, '10:30', 'waiting', '205'],
    [pIds[1], ped.id, today, '11:00', 'waiting', '112'],
    [pIds[2], sur.id, tmr, '09:15', 'waiting', '301'],
    [pIds[0], t1.id, tmr, '12:00', 'waiting', '204'],
  ];
  for (const [pid, did, date, time, status, room] of tickets) {
    const num = await nextTicketNumber(date);
    await prisma.appointment.create({ data: { ticketNumber: num, patientId: pid, doctorId: did, date, time, status, room } });
  }

  await prisma.record.create({ data: { patientId: pIds[0], doctorId: t1.id, visitDate: new Date(`${today}T09:20:00`), recordType: 'visit', complaints: 'Головная боль 3 дня, слабость.', diagnosisCode: 'J44.8', diagnosisText: 'ХОБЛ, обострение', notes: 'Рекомендован постельный режим, контроль АД.', sickLeaveDays: 5 } });
  await prisma.record.create({ data: { patientId: pIds[2], doctorId: t1.id, visitDate: new Date(`${today}T09:40:00`), recordType: 'lab', complaints: 'Профилактический осмотр.', diagnosisCode: 'E66.9', diagnosisText: 'Избыточная масса тела', notes: 'Направлена на биохимический анализ крови.' } });
  await prisma.record.create({ data: { patientId: pIds[1], doctorId: ped.id, visitDate: new Date(`${today}T11:20:00`), recordType: 'visit', complaints: 'Кашель, температура 37.4.', diagnosisCode: 'J00', diagnosisText: 'Острый назофарингит (насморк)', notes: 'Обильное питьё, симптоматическая терапия.' } });

  await prisma.prescription.create({ data: { prescriptionNumber: await nextPrescriptionNumber(), patientId: pIds[0], doctorId: t1.id, medication: 'Индапамид', dosage: '2.5 мг, 1 раз в сутки утром', durationDays: 14 } });
  await prisma.prescription.create({ data: { prescriptionNumber: await nextPrescriptionNumber(), patientId: pIds[1], doctorId: ped.id, medication: 'Парацетамол (детский)', dosage: '250 мг, при температуре выше 38.0', durationDays: 3 } });

  console.log('[seed] демо-данные созданы');
  console.log(`  персонал: ${await prisma.users.count()}`);
  console.log(`  пациентов: ${await prisma.patients.count()}`);
  console.log(`  талонов: ${await prisma.appointment.count()}`);
}

seed().catch(e => { console.error('[seed] ошибка:', e.message); process.exit(1); });
