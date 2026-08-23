'use strict';

const { findPatientByUser } = require('./patientService');
const { getPatientRecords } = require('./emrService');
const { FORMS } = require('../../utils/forms');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { errorEmbed, infoEmbed } = require('../../utils/embed');
const { getSessionByDiscordId } = require('../auth/authService');
const { audit, logger } = require('../../utils/logger');

/**
 * Подкоманда /emr generate-form <patient> <form>.
 * Генерирует имитацию официального бланка (027/у или 057/у-04).
 */
async function execute(interaction) {
  const ok = await requirePermission({ interaction, permission: PERMISSIONS.PRESCRIBE, commandName: 'emr generate-form' });
  if (!ok) return;

  const user = interaction.options.getUser('patient');
  const patient = findPatientByUser(user);
  if (!patient) {
    await interaction.reply({ embeds: [errorEmbed('Пациент не найден в реестре ЕМИАС.')], ephemeral: true });
    return;
  }

  const formKey = interaction.options.getString('form');
  const form = FORMS[formKey];
  if (!form) {
    await interaction.reply({ embeds: [errorEmbed('Неизвестная форма. Доступно: 027u, 057u.')], ephemeral: true });
    return;
  }

  const session = getSessionByDiscordId(interaction.user.id);
  const doctorName = session ? session.fullName : interaction.user.username;

  // Последний диагноз пациента для заполнения бланка.
  const records = getPatientRecords(patient.patient_id);
  const last = records[0];

  let embed;
  if (formKey === '027u') {
    embed = FORMS['027u'].builder(patient, {
      doctorName,
      diagnosis: last
        ? `${last.diagnosisCode ? `\`${last.diagnosisCode}\` ` : ''}${last.diagnosisText || '—'}`
        : '—',
      prescriptions: last && last.prescriptions ? last.prescriptions : '—',
    });
  } else {
    embed = FORMS['057u'].builder(patient, {
      doctorName,
      diagnosis: last
        ? `${last.diagnosisCode ? `\`${last.diagnosisCode}\` ` : ''}${last.diagnosisText || '—'}`
        : '—',
    });
  }

  audit({ action: 'EMR_GENERATE_FORM', discordId: interaction.user.id, patientId: patient.patient_id, form: formKey });
  logger.info(`[EMR] Сгенерирован бланк ${formKey} для пациента #${patient.patient_id}`);

  await interaction.reply({
    embeds: [embed, infoEmbed('ИНФОРМАЦИЯ', `Сформирован документ: **${form.label}**.`)],
    ephemeral: true,
  });
}

function build(s) {
  return s
    .setName('generate-form')
    .setDescription('Сгенерировать официальный бланк.')
    .addUserOption((o) => o.setName('patient').setDescription('Пользователь-пациент').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('form')
        .setDescription('Тип бланка')
        .setRequired(true)
        .addChoices(
          { name: '027/у · Выписка из медкарты', value: '027u' },
          { name: '057/у-04 · Направление на госпитализацию', value: '057u' },
        ),
    );
}

module.exports = { build, execute };