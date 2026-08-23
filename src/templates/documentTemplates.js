'use strict';

const { EmbedBuilder } = require('discord.js');
const { COLORS, DOC, BOT } = require('../../config/index');

/**
 * Система шаблонов документов ЕМИАС.
 * Все документы оформляются по единому стандарту с шапкой Минздрава,
 * основными полями и штампами.
 */

/**
 * Базовая шапка документа Минздрава
 */
function createDocumentHeader(title, docNumber = null, color = COLORS.PRIMARY) {
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
 * Шаблон документа «ОФИЦИАЛЬНОЕ СООБЩЕНИЕ»
 */
function createOfficialDocument({ title, content, docNumber = null, stamp = null, color = COLORS.PRIMARY }) {
  const embed = createDocumentHeader(title, docNumber, color);
  
  if (content) {
    embed.setDescription(content);
  }
  
  if (stamp) {
    embed.addFields({ name: '🔖 Штамп', value: stamp, inline: false });
  }
  
  return embed;
}

/**
 * Шаблон карточки пациента (ЭМК)
 */
function createPatientCard(patient, bloodType = null) {
  const embed = createDocumentHeader(
    'ЭЛЕКТРОННАЯ МЕДИЦИНСКАЯ КАРТА',
    patient.cardNumber || 'не присвоен',
    COLORS.PRIMARY
  );

  embed.addFields(
    { name: `${BOT.EMOJI.PATIENT} ФИО`, value: patient.fullName || '—', inline: true },
    { name: `${BOT.EMOJI.DATE} Дата рождения`, value: patient.birthDate || '—', inline: true },
    { name: `${BOT.EMOJI.ID} Полис ОМС`, value: patient.omsNumber || '—', inline: true },
    { name: `${BOT.EMOJI.ID} Группа крови`, value: bloodType || '—', inline: true },
    { name: `${BOT.EMOJI.WARN} Аллергии`, value: patient.allergies || 'Не выявлено', inline: false }
  );

  return embed;
}

/**
 * Шаблон талона на приём
 */
function createTicketEmbed(ticket, patientName, doctorName) {
  const statusEmojis = {
    waiting: '⏳ Ожидание',
    in_progress: '🩺 Приём идёт',
    completed: '✅ Завершён',
    cancelled: '❌ Отменён',
    moved: '🔄 Перенесён',
  };

  const embed = createDocumentHeader(
    'ТАЛОН НА ПРИЁМ',
    ticket.ticketNumber,
    COLORS.PRIMARY
  );

  embed.addFields(
    { name: `${BOT.EMOJI.PATIENT} Пациент`, value: patientName, inline: true },
    { name: `${BOT.EMOJI.DOCTOR} Врач`, value: doctorName, inline: true },
    { name: `${BOT.EMOJI.DATE} Дата`, value: ticket.date || '—', inline: true },
    { name: `${BOT.EMOJI.TIME} Время`, value: ticket.time || '—', inline: true },
    { name: `${BOT.EMOJI.ROOM} Кабинет`, value: ticket.room || 'Определяется при визите', inline: true },
    { name: `${BOT.EMOJI.CLOCK} Статус`, value: statusEmojis[ticket.status] || ticket.status || '—', inline: true }
  );

  return embed;
}

/**
 * Шаблон истории болезни (запись в ЭМК)
 */
function createHistoryRecord(record, doctorName = null) {
  return {
    name: `📅 ${record.date}`,
    value: `**Врач:** ${doctorName || record.doctorName || '—'}\n` +
           `**Диагноз:** ${record.diagnosisCode ? `\`${record.diagnosisCode}\`` : ''} ${record.diagnosisText || '—'}\n` +
           `**Назначения:** ${record.prescriptions || '—'}\n` +
           (record.notes ? `**Заметки:** ${record.notes}\n` : ''),
    inline: false,
  };
}

/**
 * Шаблон рецепта
 */
function createPrescriptionEmbed(prescription, patientName, doctorName) {
  const embed = createDocumentHeader(
    'РЕЦЕПТУРНЫЙ БЛАНК',
    prescription.prescriptionNumber || null,
    COLORS.SUCCESS
  );

  embed.addFields(
    { name: `${BOT.EMOJI.PATIENT} Пациент`, value: patientName, inline: true },
    { name: `${BOT.EMOJI.DOCTOR} Врач`, value: doctorName, inline: true },
    { name: `${BOT.EMOJI.DATE} Дата выдачи`, value: prescription.date || '—', inline: true },
    { name: `${BOT.EMOJI.MED} Препарат`, value: prescription.medication || '—', inline: false },
    { name: '💊 Дозировка', value: prescription.dosage || '—', inline: false },
    { name: '⏳ Длительность курса', value: prescription.duration || 'Не указано', inline: false }
  );

  embed.setFooter({ text: `${DOC.STAMPS.CONFIDENTIAL} · № ${prescription.prescriptionNumber || '—'}` });

  return embed;
}

/**
 * Шаблон диагноза (МКБ-10)
 */
function createDiagnosisEmbed(diagnosis, patientName) {
  const embed = createDocumentHeader(
    'ДИAGНОЗ (МКБ-10)',
    diagnosis.diagnosisNumber || null,
    COLORS.WARNING
  );

  embed.addFields(
    { name: `${BOT.EMOJI.PATIENT} Пациент`, value: patientName, inline: true },
    { name: `${BOT.EMOJI.DATE} Дата установки`, value: diagnosis.date || '—', inline: true },
    { name: '🔖 Код МКБ-10', value: `\`${diagnosis.mkbCode}\``, inline: true },
    { name: '📝 Текст диагноза', value: diagnosis.diagnosisText || '—', inline: false },
    { name: '📋 Примечания', value: diagnosis.notes || '—', inline: false }
  );

  return embed;
}

/**
 * Шаблон сообщения об ошибке
 */
function createErrorEmbed(message, reason = null) {
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

/**
 * Шаблон сообщения об успехе
 */
function createSuccessEmbed(title, message, docNumber = null) {
  const embed = createDocumentHeader(title, docNumber, COLORS.SUCCESS);
  embed.setDescription(message);
  return embed;
}

/**
 * Шаблон информационного сообщения
 */
function createInfoEmbed(title, message) {
  const embed = createDocumentHeader(title, null, COLORS.NEUTRAL);
  embed.setDescription(message);
  return embed;
}

/**
 * Шаблон главного меню ЕМИАС
 */
function createMainMenuEmbed(user) {
  const embed = createDocumentHeader(
    'ГЛАВНОЕ МЕНЮ ЕМИАС',
    null,
    COLORS.PRIMARY
  );

  const menuContent = `**Добро пожаловать, ${user.fullName}!**\n\n` +
    `**Ваши данные**:\n` +
    `${BOT.EMOJI.ID} Логин: \`${user.username}\`\n` +
    `${BOT.EMOJI.PATIENT} Роль: **${user.role}**\n\n` +
    `**Доступные разделы**:\n` +
    `${BOT.EMOJI.PATIENT} **ЭМК** — электронная медицинская карта\n` +
    `${BOT.EMOJI.DOCTOR} **Регистратура** — запись к врачу\n` +
    `${BOT.EMOJI.MED} **Справочники** — МКБ-10, лекарства\n` +
    `${BOT.EMOJI.LOCK} **Настройки** — управление доступом`;

  embed.setDescription(menuContent);
  embed.setFooter({ text: `${DOC.STAMPS.CONFIDENTIAL} · Сессия активна` });

  return embed;
}

module.exports = {
  createDocumentHeader,
  createOfficialDocument,
  createPatientCard,
  createTicketEmbed,
  createHistoryRecord,
  createPrescriptionEmbed,
  createDiagnosisEmbed,
  createErrorEmbed,
  createSuccessEmbed,
  createInfoEmbed,
  createMainMenuEmbed,
};
