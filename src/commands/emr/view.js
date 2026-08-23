'use strict';

const { findPatientByUser } = require('./patientService');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { patientCard, errorEmbed } = require('../../utils/embed');
const { bloodGroup } = require('../../utils/format');
const { audit } = require('../../utils/logger');

/**
 * Подкоманда /emr view <patient>.
 * Выводит стилизованную электронную медицинскую карту пациента.
 */
async function execute(interaction) {
  const ok = await requirePermission({ interaction, permission: PERMISSIONS.VIEW_EMR, commandName: 'emr view' });
  if (!ok) return;

  const user = interaction.options.getUser('patient');
  const patient = findPatientByUser(user);

  if (!patient) {
    audit({
      action: 'EMR_VIEW_FAIL',
      discordId: interaction.user.id,
      targetDiscordId: user ? user.id : null,
      reason: 'Пациент не найден в системе',
    });
    await interaction.reply({
      embeds: [errorEmbed('Карточка пациента не найдена.', {
        reason: 'Пользователь не зарегистрирован в реестре пациентов ЕМИАС. Сначала выполните регистрацию пациента.',
      })],
      ephemeral: true,
    });
    return;
  }

  audit({
    action: 'EMR_VIEW_OK',
    discordId: interaction.user.id,
    username: interaction.user.username,
    patientId: patient.patient_id,
    cardNumber: patient.cardNumber,
  });

  const embed = patientCard(patient, bloodGroup(patient.bloodGroup));
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/** Описание подкоманды для добавления в общий билдер /emr. */
function build(s) {
  return s
    .setName('view')
    .setDescription('Просмотр медицинской карты пациента.')
    .addUserOption((o) => o.setName('patient').setDescription('Пользователь-пациент').setRequired(true));
}

module.exports = { build, execute };