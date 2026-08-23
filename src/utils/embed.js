'use strict';

const { EmbedBuilder } = require('discord.js');
const { COLORS, DOC, BOT } = require('../../config/index');

/**
 * Конструкторы стилизованных embed-контейнеров в стиле Минздрава РФ.
 * Каждый документ имеет шапку с реквизитами ведомства, основную часть
 * с полями (эмодзи-идентификаторами) и «штампы» в футере.
 */

/**
 * Базовая «шапка» документа: ведомство, система, номер документа.
 * @param {string} title название бланка/документа
 * @param {string|null} docNumber уникальный номер документа
 * @param {number} color цвет embed
 * @returns {EmbedBuilder}
 */
function documentHeader({ title, docNumber = null, color = COLORS.PRIMARY }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`${DOC.MINISTRY}\n${DOC.SYSTEM}`)
    .setTimestamp();

  if (docNumber) {
    embed.setFooter({ text: `№ ${docNumber} · ${DOC.STAMPS.GENERATED}` });
  } else {
    embed.setFooter({ text: DOC.STAMPS.GENERATED });
  }

  return embed;
}

/**
 * Базовый шаблон официального документа с общим оформлением.
 * @param {object} opts
 * @returns {EmbedBuilder}
 */
function officialDocument(opts) {
  const { title, docNumber = null, color = COLORS.PRIMARY, stamp = null } = opts;
  const embed = documentHeader({ title, docNumber, color });

  if (stamp) {
    embed.addFields({ name: 'Штамп', value: stamp, inline: false });
  }
  return embed;
}

/** Поле записи ЭМК. */
function emrField(label, emoji, value, inline = true) {
  return { name: `${emoji} ${label}`, value: value || '—', inline };
}

/**
 * Карточка пациента (Embed ЭМК).
 * @param {object} p данные пациента из таблицы patients
 * @param {string} blood текст группы крови
 */
function patientCard(p, bloodText) {
  const embed = documentHeader({
    title: 'ЭЛЕКТРОННАЯ МЕДИЦИНСКАЯ КАРТА',
    docNumber: p.cardNumber || 'не присвоен',
  });

  embed.setThumbnail(null); // при необходимости можно задать URL логотипа

  embed.addFields(
    emrField('ФИО', BOT.EMOJI.PATIENT, p.fullName),
    emrField('Дата рождения', BOT.EMOJI.DATE, p.birthDate || '—'),
    emrField('Полис ОМС', BOT.EMOJI.ID, p.omsNumber || '—'),
    emrField('Группа крови', BOT.EMOJI.ID, bloodText || '—'),
    emrField('Аллергии', BOT.EMOJI.WARN, p.allergies || 'Не выявлено'),
  );

  return embed;
}

/** Сообщение об ошибке в стилизованном виде. */
function errorEmbed(message, { reason = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.DANGER)
    .setTitle('❌ Операция отклонена')
    .setDescription(message);

  if (reason) {
    embed.addFields({ name: 'Основание', value: reason, inline: false });
  }
  embed.setFooter({ text: DOC.STAMPS.CONFIDENTIAL });
  return embed;
}

/** Сообщение об успехе. */
function successEmbed(title, message, docNumber = null) {
  const embed = documentHeader({ title, docNumber, color: COLORS.SUCCESS });
  embed.setDescription(message);
  return embed;
}

/** Информационное сообщение. */
function infoEmbed(title, message) {
  const embed = documentHeader({ title, color: COLORS.NEUTRAL });
  embed.setDescription(message);
  return embed;
}

/** Человекочитаемый статус талона с эмодзи. */
const TICKET_STATUS = {
  waiting: '⏳ Ожидание',
  in_progress: '🩺 Приём идёт',
  completed: '✅ Завершён',
  cancelled: '❌ Отменён',
  moved: '🔄 Перенесён',
};

/**
 * Талон на приём (Embed документа «ТАЛОН НА ПРИЁМ»).
 * @param {object} t данные талона
 * @param {string} patientName ФИО пациента
 * @param {string} doctorName ФИО врача
 */
function ticketEmbed(t, patientName, doctorName) {
  const embed = documentHeader({
    title: 'ТАЛОН НА ПРИЁМ',
    docNumber: t.ticketNumber,
    color: COLORS.PRIMARY,
  });

  embed.addFields(
    emrField('Пациент', BOT.EMOJI.PATIENT, patientName),
    emrField('Врач', BOT.EMOJI.DOCTOR, doctorName),
    emrField('Дата', BOT.EMOJI.DATE, t.date || '—'),
    emrField('Время', BOT.EMOJI.TIME, t.time || '—'),
    emrField('Кабинет', BOT.EMOJI.ROOM, t.room || 'Определяется при визите'),
    emrField('Статус', BOT.EMOJI.CLOCK, TICKET_STATUS[t.status] || t.status || '—'),
  );

  return embed;
}

/** Поле записи обращения в ЭМК (история визитов). */
function historyRecord(rec, doctorName) {
  return {
    name: `📅 ${rec.date}`,
    value:
      `**Врач:** ${doctorName || rec.doctorName || '—'}\n` +
      `**Диагноз:** ${rec.diagnosisCode ? `\`${rec.diagnosisCode}\`` : ''} ${rec.diagnosisText || '—'}\n` +
      `**Назначения:** ${rec.prescriptions || '—'}\n` +
      (rec.notes ? `**Заметки:** ${rec.notes}\n` : ''),
    inline: false,
  };
}

module.exports = {
  documentHeader,
  officialDocument,
  patientCard,
  errorEmbed,
  successEmbed,
  infoEmbed,
  ticketEmbed,
  historyRecord,
  TICKET_STATUS,
};