'use strict';

const { findPatientByUser } = require('./patientService');
const { addDiagnosis } = require('./emrService');
const { MKB10, findByCode, search } = require('../../../config/mkb10');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { officialDocument, errorEmbed } = require('../../utils/embed');
const { normalizeMkbCode } = require('../../utils/validate');
const { getSessionByDiscordId } = require('../auth/authService');
const { audit, logger } = require('../../utils/logger');

/**
 * Подкоманда /emr add-diagnosis <patient> <code> <text> [notes].
 * Вносит диагноз по МКБ-10 в ЭМК пациента.
 */
async function execute(interaction) {
  const ok = await requirePermission({ interaction, permission: PERMISSIONS.PRESCRIBE, commandName: 'emr add-diagnosis' });
  if (!ok) return;

  const user = interaction.options.getUser('patient');
  const patient = findPatientByUser(user);
  if (!patient) {
    await interaction.reply({ embeds: [errorEmbed('Пациент не найден в реестре ЕМИАС.')], ephemeral: true });
    return;
  }

  const codeInput = interaction.options.getString('code');
  const textInput = interaction.options.getString('text');
  const notes = interaction.options.getString('notes');

  const code = normalizeMkbCode(codeInput);

  // Проверка кода по справочнику МКБ-10 (с мягким предупреждением).
  const known = findByCode(code);
  let diagnosisText = textInput;
  if (!known && !textInput) {
    await interaction.reply({
      embeds: [errorEmbed('Укажите расшифровку диагноза, либо проверьте код по справочнику МКБ-10.')],
      ephemeral: true,
    });
    return;
  }

  // Определяем врача из активной сессии, иначе берём инициатора команды.
  const session = getSessionByDiscordId(interaction.user.id);
  const doctorId = session ? session.userId : null;
  const doctorName = session ? session.fullName : interaction.user.username;

  const result = addDiagnosis({
    patientId: patient.patient_id,
    doctorId,
    doctorName,
    diagnosisCode: code,
    diagnosisText,
    notes,
  });

  if (!result.ok) {
    await interaction.reply({ embeds: [errorEmbed(result.reason)], ephemeral: true });
    return;
  }

  audit({
    action: 'EMR_ADD_DIAGNOSIS',
    discordId: interaction.user.id,
    patientId: patient.patient_id,
    code,
  });
  logger.info(`[EMR] Диагноз ${code} внесён пациенту #${patient.patient_id}`);

  const doc = officialDocument({
    title: 'ДИАГНОЗ И НАЗНАЧЕНИЯ',
    docNumber: patient.cardNumber,
  });
  doc.addFields(
    { name: '👤 Пациент', value: patient.fullName, inline: true },
    { name: '🧑‍⚕️ Врач', value: doctorName, inline: true },
    { name: '🆔 Код МКБ-10', value: `\`${code}\``, inline: true },
    { name: '📋 Диагноз', value: diagnosisText || (known ? known.name : '—'), inline: false },
    { name: '📝 Заметки', value: notes || '—', inline: false },
  );
  doc.addFields({ name: 'Штамп', value: '✅ УТВЕРЖДЕНО · 🔒 КОНФИДЕНЦИАЛЬНО', inline: false });

  // Подсказка, если код не найден в справочнике.
  const similar = search(code, 3);
  if (!known && similar.length > 0) {
    doc.addFields({
      name: 'ℹ️ Возможно вы имели в виду',
      value: similar.map((x) => `\`${x.code}\` ${x.name}`).join('\n'),
      inline: false,
    });
  }

  await interaction.reply({ embeds: [doc], ephemeral: true });
}

function build(s) {
  return s
    .setName('add-diagnosis')
    .setDescription('Внести диагноз по МКБ-10 в ЭМК пациента.')
    .addUserOption((o) => o.setName('patient').setDescription('Пользователь-пациент').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('code')
        .setDescription('Код МКБ-10 (например, J06.9)')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((o) => o.setName('text').setDescription('Расшифровка диагноза').setRequired(false))
    .addStringOption((o) => o.setName('notes').setDescription('Заметки / рекомендации').setRequired(false));
}

/**
 * Обработчик autocomplete для кода МКБ-10.
 */
async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value || '').trim();
  const results = query ? search(query, 25) : MKB10.slice(0, 25);

  await interaction.respond(
    results.map((d) => ({ name: `${d.code} — ${d.name}`, value: d.code })),
  );
}

module.exports = { build, execute, autocomplete };