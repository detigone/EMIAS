'use strict';

/**
 * Единые константы проекта «ЕМИАС».
 * Используются API-шлюзом, веб-панелью и (в фазе 2) Discord-ботом.
 * Бот и веб-панель — равноправные клиенты одного API, поэтому
 * словари и статусы не должны дублироваться на их стороне.
 */

const PROJECT = {
  NAME: 'ЕМИАС',
  FULL_NAME: 'ЕМИАС · Единая медицинская информационно-аналитическая система (симулятор)',
  /** Обязательная юридическая маркировка — выводится везде, где данные
   *  могут быть приняты за «официальные». */
  DISCLAIMER:
    'Это вымышленный симулятор для ролевой игры. Проект не имеет отношения ' +
    'к Минздраву РФ и реальной системе ЕМИАС. Все данные, пациенты и врачи — вымышлены.',
};

/** Палитра дизайн-стандарта (для веб-панели; бот использует при рендере embeds). */
const PALETTE = {
  PRIMARY: '#0063B0',
  EMK: '#0066CC',
  BG: '#F5F7FA',
  DANGER: '#C0392B',
  SUCCESS: '#2E8B57',
  WARNING: '#D4A017',
  TEXT: '#333333',
};

/** Роли персонала (RBAC). Права проверяются ТОЛЬКО на уровне API. */
const ROLES = {
  HEAD_PHYSICIAN: 'Главный врач',
  PHYSICIAN: 'Врач',
  REGISTRAR: 'Регистратор',
  NURSE: 'Медсестра',
};
const ALL_ROLES = Object.values(ROLES);

/** Статусы талонов (appointments.status). */
const TICKET_STATUS = {
  WAITING: 'waiting',
  IN_ROOM: 'in_room',
  DONE: 'done',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
};
const TICKET_STATUS_LABELS = {
  waiting: 'Ожидание',
  in_room: 'В кабинете',
  done: 'Принят',
  cancelled: 'Отменён',
  no_show: 'Не явился',
};

/** Статусы врача (users.status) — синхронизируются через WebSocket. */
const DOCTOR_STATUS = {
  FREE: 'free',
  IN_APPOINTMENT: 'in_appointment',
  OFFLINE: 'offline',
};
const DOCTOR_STATUS_LABELS = {
  free: 'Свободен',
  in_appointment: 'На приёме',
  offline: 'Не на смене',
};

/** Специальности врачей. */
const SPECIALTIES = [
  { code: 'terapevt', name: 'Терапевт' },
  { code: 'pediatr', name: 'Педиатр' },
  { code: 'hirurg', name: 'Хирург' },
  { code: 'nevrolog', name: 'Невролог' },
  { code: 'oftalmolog', name: 'Офтальмолог' },
  { code: 'lor', name: 'Оториноларинголог' },
  { code: 'kardiolog', name: 'Кардиолог' },
  { code: 'endokrinolog', name: 'Эндокринолог' },
];

/** Форматы номеров документов. */
const DOC_FORMAT = {
  CARD_PREFIX: 'ЕМК',        // карта пациента:      ЕМК-YYYY-XXXXXX
  TICKET_PREFIX: 'Т',        // талон:               Т-YYYYMMDD-NNN
  PRESCRIPTION_PREFIX: 'Р',  // рецепт:              Р-YYYY-NNNNNN
};

/** Типы записей ЭМК. */
const RECORD_TYPES = {
  VISIT: 'visit',
  LAB: 'lab',
  PROCEDURE: 'procedure',
};
const RECORD_TYPE_LABELS = {
  visit: 'Приём (осмотр)',
  lab: 'Лабораторное исследование',
  procedure: 'Медицинская процедура',
};

/** События WebSocket-канала /ws. */
const WS_EVENTS = {
  QUEUE_UPDATED: 'queue.updated',
  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_STATUS_UPDATED: 'appointment.status.updated',
  DOCTOR_STATUS_UPDATED: 'doctor.status.updated',
  PATIENT_CREATED: 'patient.created',
  PATIENT_UPDATED: 'patient.updated',
  EMR_UPDATED: 'emr.updated',
};

module.exports = {
  PROJECT,
  PALETTE,
  ROLES,
  ALL_ROLES,
  TICKET_STATUS,
  TICKET_STATUS_LABELS,
  DOCTOR_STATUS,
  DOCTOR_STATUS_LABELS,
  SPECIALTIES,
  DOC_FORMAT,
  RECORD_TYPES,
  RECORD_TYPE_LABELS,
  WS_EVENTS,
};
