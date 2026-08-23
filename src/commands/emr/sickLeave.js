'use strict';

const { findPatientByUser } = require('./patientService');
const { issueSickLeave } = require('./emrService');
const { findByCode } = require('../../../config/mkb10');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { officialDocument, errorEmbed } = require('../../utils/embed');
const { normalizeMkbCode } = require('../../utils/validate');
const { formatDate } = require('../../utils/format');
const { getSessionByDiscordId } = require('../auth/authService');
const { audit, logger } = require('../../utils/logger');

const MAX_SICK_LEAVE_DAYS = 15;

/**
 * Подкоманда /emr sick-leave <patient> <days> [diagnosis] [code].
 * Выдаёт листок нетрудоспособности и сохраняет его в ЭМК.
 */
async function execute(interaction) {
  const ok = await requirePermission({ interaction, permission: PERMISSIONS.PRESCRIBE, commandName: 'emr sick-leave' });
  if (!ok) return;

  const user = interaction.options.getUser('patient');
  const patient = findPatientByUser(user);
  if (!patient) {
    await interaction.reply({ embeds: [errorEmbed('Пациент не найден в реестре ЕМИАС.')], ephemeral: true });
    return;
  }

  const days = interaction.options.getInteger('days');
  if (days < 1 || days > MAX_SICK_LEAVE_DAYS) {
    await interaction.reply({
      embeds: [errorEmbed(`Срок нетрудоспособности должен быть от 1 до ${MAX_SICK_LEAVE_DAYS} дней.`)],
      ephemeral: true,
    });
    return;
  }

  const diagnosisInput = interaction.options.getString('diagnosis');
  const codeInput = interaction.options.getString('code');
  const code = codeInput ? normalizeMkbCode(codeInput) : null;
  const known = code ? findByCode(code) : null;
  const diagnosisText = diagnosisInput || (known ? known.name : null);

  const session = getSessionByDiscordId(interaction.user.id);
  const doctorId = session ? session.userId : null;
  const doctorName = session ? session.fullName : interaction.user.username;

  const result = issueSickLeave({
    patientId: patient.patient_id,
    doctorId,
    doctorName,
    diagnosisText,
    days,
  });

  if (!result.ok) {
    await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
    return;
  }

  audit({
    action: 'EMR_SICK_LEAVE',
    discordId: interaction.user.id,
    patientId: patient.patient_id,
    days,
  });
  logger.info(`[EMR] Больничный лист (${days} дн.) пациенту #${patient.patient_id}`);

  const doc = officialDocument({
    title: 'ЛИСТОК НЕТРУДОСПОСОБНОСТИ',
    docNumber: `БН-${String(patient.patient_id).padStart(6, '0')}`,
  });
  doc.addFields(
    { name: '👤 Пациент', value: patient.fullName, inline: true },
    { name: '🧑‍⚕️ Врач', value: doctorName, inline: true },
    { name: '📋 Диагноз', value: `${code ? `\`${code}\` ` : ''}${diagnosisText || '—'}`, inline: false },
    { name: '📅 Период', value: result.record.sickLeave, inline: true },
    { name: '🗓 Явка', value: formatDate(new Date(Date.now() + days * 864e5)), inline: true },
    { name: 'Штамп', value: '✅ УТВЕРЖДЕНО · 🔒 КОНФИДЕНЦИАЛЬНО', inline: false },
  );

  await interaction.reply({ embeds: [doc], ephemeral: true });
}

function build(s) {
  return s
    .setName('sick-leave')
    .setDescription('Выдать листок нетрудоспособности.')
    .addUserOption((o) => o.setName('patient').setDescription('Пользователь-пациент').setRequired(true))
    .addIntegerOption((o) => o.setName('days').setDescription(`Количество дней (1–${MAX_SICK_LEAVE_DAYS})`).setRequired(true))
    .addStringOption((o) => o.setName('diagnosis').setDescription('Диагноз').setRequired(false))
    .addStringOption((o) => o.setName('code').setDescription('Код МКБ-10 (например, J06.9)').setRequired(false));
}

module.exports = { build, execute };