'use strict';

/**
 * Отправка уведомлений в Discord через вебхуки:
 *   DISCORD_WEBHOOK_APPOINTMENTS — текстовый канал: новые талоны
 *   DISCORD_WEBHOOK_CARDS — канал-форум: медкарты (посты-треды)
 */

const env = require('../env');
const hub = require('../realtime/hub');
const { WS_EVENTS, SPECIALTIES } = require('../../shared/constants');
const settingsStore = require('./settings');

const SPEC_MAP = {};
SPECIALTIES.forEach((s) => { SPEC_MAP[s.code] = s.name; });

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.split('-').reverse().join('.');
}

function fmtDT(date, time) {
  return fmtDate(date) + (time ? ' ' + time : '');
}

function roleName(role) {
  const m = { 'Главный врач': 'Врач (главный)', 'Врач': 'Врач', 'Медсестра': 'Медсестра', 'Регистратор': 'Регистратор' };
  return m[role] || role;
}

function post(url, payload) {
  if (!url) return Promise.resolve();
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => { console.error('[webhook] ошибка отправки:', e.message); });
}

function embed(fields, title, color) {
  return {
    username: 'ЕМИАС',
    embeds: [{
      title,
      color,
      fields,
      timestamp: new Date().toISOString(),
    }],
  };
}

function field(name, value, inline) {
  return { name, value: String(value || '—'), inline: inline !== false };
}

/* ─── Новая запись (талон) ───────────────────────────── */
function appointmentCreated(a) {
  const url = settingsStore.get('webhook.appointments') || env.DISCORD_WEBHOOK_APPOINTMENTS;
  if (!url) return;

  const doctorDisplay = a.doctor_name
    ? `${a.doctor_name}${a.doctor_specialty ? ' · ' + SPEC_MAP[a.doctor_specialty] : ''}`
    : 'Не назначен';

  const source = a.created_by ? 'Регистратура' : 'Онлайн-запись';

  const fields = [
    field('Пациент', a.patient_name || `#${a.patient_id}`, true),
    field('Пациент — карта', a.patient_card || '—', true),
    field('\u200B', '\u200B', true),
    field('Врач', doctorDisplay, true),
    field('Кабинет', a.room || '—', true),
    field('Источник', source, true),
    field('Когда', fmtDT(a.date, a.time), true),
    field('Талон', a.ticket_number || '—', true),
    field('\u200B', '\u200B', true),
  ];

  return post(url, embed(fields, '📋 Новая запись к врачу', 0x3498DB));
}

/* ─── Медкарта (пост в канале-форуме) ─────────────────── */
function patientCreated(p) {
  const url = settingsStore.get('webhook.cards') || env.DISCORD_WEBHOOK_CARDS;
  if (!url) return;

  const sex = p.sex === 'М' ? 'Мужской' : p.sex === 'Ж' ? 'Женский' : '—';

  const fields = [
    field('Карта', p.card_number, true),
    field('ФИО', p.full_name, true),
    field('\u200B', '\u200B', true),
    field('Дата рождения', fmtDate(p.birth_date), true),
    field('Пол', sex, true),
    field('\u200B', '\u200B', true),
    field('ОМС', p.oms_number, true),
    field('Телефон', p.phone, true),
    field('Группа крови', p.blood_group, true),
    field('Аллергии', p.allergies, false),
  ];

  const threadName = `${p.full_name} · ${p.card_number}`;

  return post(url, {
    username: 'ЕМИАС',
    thread_name: threadName,
    embeds: [{
      title: '🩺 Медкарта создана',
      color: 0x2E8B57,
      fields,
      timestamp: new Date().toISOString(),
    }],
  });
}

/* ─── Инициализация подписки ───────────────────────────── */
function init() {
  try { settingsStore.initDefaults(); } catch (_) {}
  hub.on((event, data) => {
    if (event === WS_EVENTS.APPOINTMENT_CREATED && data.appointment) {
      appointmentCreated(data.appointment);
    }
    if (event === WS_EVENTS.PATIENT_CREATED && data.patient) {
      patientCreated(data.patient);
    }
  });
  const wa = settingsStore.get('webhook.appointments') || env.DISCORD_WEBHOOK_APPOINTMENTS;
  const wc = settingsStore.get('webhook.cards') || env.DISCORD_WEBHOOK_CARDS;
  console.log('[webhook] подписан на события' +
    (wa ? ' (записи)' : '') +
    (wc ? ' (медкарты)' : '') ||
    ' (URL не заданы — уведомления отключены)');
}

module.exports = { init, appointmentCreated, patientCreated };
