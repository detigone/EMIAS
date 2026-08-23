'use strict';

const { documentHeader, emrField } = require('./embed');
const { bloodGroup, formatDate } = require('./format');

/**
 * Генерация имитаций официальных медицинских бланков в стиле embed.
 * Воспроизводятся структурные элементы реальных форм без полной передачи формата.
 */

/**
 * Форма 027/у — Выписка из медицинской карты амбулаторного/стационарного больного.
 * @param {object} patient данные пациента
 * @param {object} opts { institution, doctorName, dates, diagnosis, prescriptions, recommendations }
 */
function form027u(patient, opts = {}) {
  const {
    institution = 'ГБУЗ «Городская клиническая больница № 1»',
    doctorName = '—',
    dates = `${formatDate(new Date())} — ${formatDate(new Date(Date.now() + 7 * 864e5))}`,
    diagnosis = '—',
    prescriptions = '—',
    recommendations = '—',
  } = opts;

  const embed = documentHeader({
    title: 'ФОРМА 027/у · ВЫПИСКА ИЗ МЕДИЦИНСКОЙ КАРТЫ',
    docNumber: patient.cardNumber,
  });

  embed.addFields(
    { name: '🏥 Учреждение', value: institution, inline: false },
    emrField('Пациент', '👤', patient.fullName),
    emrField('Дата рождения', '📅', patient.birthDate || '—'),
    emrField('Полис ОМС', '🆔', patient.omsNumber || '—'),
    { name: '🗓 Сроки лечения', value: dates, inline: false },
    { name: '📋 Диагноз', value: diagnosis, inline: false },
    { name: '💊 Назначения', value: prescriptions, inline: false },
    { name: '📝 Рекомендации', value: recommendations, inline: false },
    { name: '🧑‍⚕️ Лечащий врач', value: doctorName, inline: true },
    { name: '📅 Дата выписки', value: formatDate(new Date()), inline: true },
    { name: 'Штамп', value: '✅ УТВЕРЖДЕНО · 🔒 КОНФИДЕНЦИАЛЬНО', inline: false },
  );

  return embed;
}

/**
 * Форма 057/у-04 — Направление на госпитализацию, восстановительное лечение,
 * обследование, консультацию.
 * @param {object} patient
 * @param {object} opts { institution, referringOrg, department, diagnosis, doctorName }
 */
function form057u(patient, opts = {}) {
  const {
    institution = 'ГБУЗ «Городская клиническая больница № 1»',
    referringOrg = 'ГБУЗ «Городская поликлиника № 3»',
    department = 'Терапевтическое отделение',
    diagnosis = '—',
    doctorName = '—',
  } = opts;

  const embed = documentHeader({
    title: 'ФОРМА 057/у-04 · НАПРАВЛЕНИЕ НА ГОСПИТАЛИЗАЦИЮ',
    docNumber: patient.cardNumber,
  });

  embed.addFields(
    { name: '🏥 Учреждение, куда направляется', value: institution, inline: false },
    { name: '🏢 Направляющая организация', value: referringOrg, inline: false },
    emrField('Пациент', '👤', patient.fullName),
    emrField('Дата рождения', '📅', patient.birthDate || '—'),
    emrField('Полис ОМС', '🆔', patient.omsNumber || '—'),
    emrField('Группа крови', '🧬', bloodGroup(patient.bloodGroup)),
    { name: '📋 Диагноз при направлении', value: diagnosis, inline: false },
    { name: '🚑 Отделение / профиль', value: department, inline: true },
    { name: '🧑‍⚕️ Направляющий врач', value: doctorName, inline: true },
    { name: '📅 Дата направления', value: formatDate(new Date()), inline: true },
    { name: 'Штамп', value: '✅ УТВЕРЖДЕНО · 🔒 КОНФИДЕНЦИАЛЬНО', inline: false },
  );

  return embed;
}

/** Список доступных бланков для команды generate-form. */
const FORMS = {
  '027u': { label: '027/у · Выписка из медкарты', builder: form027u },
  '057u': { label: '057/у-04 · Направление на госпитализацию', builder: form057u },
};

module.exports = { form027u, form057u, FORMS };