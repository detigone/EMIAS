'use strict';

const { findPatientByUser } = require('./patientService');
const { prescribe } = require('./emrService');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { officialDocument, errorEmbed } = require('../../utils/embed');
const { getSessionByDiscordId } = require('../auth/authService');
const { audit, logger } = require('../../utils/logger');

/**
 * Подкоманда /emr prescribe <patient> <medication> <dosage> [course] [notes].
 * Выписка лекарственного назначения в ЭМК пациента.
 */
async function execute(interaction) {
  const ok = await requirePermission({ interaction, permission: PERMISSIONS.PRESCRIBE, commandName: 'emr prescribe' });
  if (!ok) return;

  const user = interaction.options.getUser('patient');
  const patient = findPatientByUser(user);
  if (!patient) {
    await interaction.reply({ embeds: [errorEmbed('Пациент не найден в реестре ЕМИАС.')], ephemeral: true });
    return;
  }

  const medication = interaction.options.getString('medication');
  const dosage = interaction.options.getString('dosage');
  const course = interaction.options.getString('course');
  const notes = interaction.options.getString('notes');

  const session = getSessionByDiscordId(interaction.user.id);
  const doctorId = session ? session.userId : null;
  const doctorName = session ? session.fullName : interaction.user.username;

  const result = prescribe({
    patientId: patient.patient_id,
    doctorId,
    doctorName,
    medication,
    dosage,
    course,
    notes,
  });

  if (!result.ok) {
    await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
    return;
  }

  audit({
    action: 'EMR_PRESCRIBE',
    discordId: interaction.user.id,
    patientId: patient.patient_id,
    medication,
  });
  logger.info(`[EMR] Назначение «${medication}» пациенту #${patient.patient_id}`);

  const doc = officialDocument({
    title: 'ЛИСТ НАЗНАЧЕНИЙ',
    docNumber: patient.cardNumber,
  });
  doc.addFields(
    { name: '👤 Пациент', value: patient.fullName, inline: true },
    { name: '🧑‍⚕️ Врач', value: doctorName, inline: true },
    { name: '💊 Препарат', value: medication, inline: true },
    { name: '⚖️ Дозировка', value: dosage, inline: true },
    { name: '📅 Курс', value: course || '—', inline: true },
    { name: '📝 Заметки', value: notes || '—', inline: false },
  );
  doc.addFields({ name: 'Штамп', value: '✅ УТВЕРЖДЕНО · 🔒 КОНФИДЕНЦИАЛЬНО', inline: false });

  await interaction.reply({ embeds: [doc], ephemeral: true });
}

function build(s) {
  return s
    .setName('prescribe')
    .setDescription('Выписать лекарственное назначение в ЭМК пациента.')
    .addUserOption((o) => o.setName('patient').setDescription('Пользователь-пациент').setRequired(true))
    .addStringOption((o) => o.setName('medication').setDescription('Наименование препарата').setRequired(true))
    .addStringOption((o) => o.setName('dosage').setDescription('Дозировка (например, 500 мг 2 раза в день)').setRequired(true))
    .addStringOption((o) => o.setName('course').setDescription('Продолжительность курса').setRequired(false))
    .addStringOption((o) => o.setName('notes').setDescription('Заметки / рекомендации').setRequired(false));
}

module.exports = { build, execute };