'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { findPatientByUser, createPatient } = require('../emr/patientService');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { officialDocument, errorEmbed } = require('../../utils/embed');
const { parseDate } = require('../../utils/validate');
const { bloodGroup } = require('../../utils/format');
const { audit, logger } = require('../../utils/logger');

const BLOOD_CHOICES = [
  ['0 (I) Rh+', '0(I)'],
  ['0 (I) Rh−', '0(I)-'],
  ['A (II) Rh+', 'A(II)'],
  ['A (II) Rh−', 'A(II)-'],
  ['B (III) Rh+', 'B(III)'],
  ['B (III) Rh−', 'B(III)-'],
  ['AB (IV) Rh+', 'AB(IV)'],
  ['AB (IV) Rh−', 'AB(IV)-'],
];

/**
 * Команда /patient register — регистрация пациента в реестре ЕМИАС.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('patient')
    .setDescription('Реестр пациентов ЕМИАС.')
    .addSubcommand((s) =>
      s
        .setName('register')
        .setDescription('Зарегистрировать пациента.')
        .addUserOption((o) => o.setName('patient').setDescription('Пользователь-пациент (Discord)').setRequired(true))
        .addStringOption((o) => o.setName('fullname').setDescription('ФИО пациента').setRequired(true))
        .addStringOption((o) => o.setName('birthdate').setDescription('Дата рождения ДД.ММ.ГГГГ').setRequired(false))
        .addStringOption((o) => o.setName('oms').setDescription('Номер полиса ОМС').setRequired(false))
        .addStringOption((o) =>
          o
            .setName('blood')
            .setDescription('Группа крови')
            .setRequired(false)
            .addChoices(...BLOOD_CHOICES.map(([name, value]) => ({ name, value }))),
        )
        .addStringOption((o) => o.setName('allergies').setDescription('Аллергии через запятую').setRequired(false)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'register') return;

    const ok = await requirePermission({ interaction, permission: PERMISSIONS.CREATE_APPOINTMENT, commandName: 'patient register' });
    if (!ok) return;

    const patientUser = interaction.options.getUser('patient');
    const fullName = interaction.options.getString('fullname');
    const oms = interaction.options.getString('oms');
    const blood = interaction.options.getString('blood');
    const allergies = interaction.options.getString('allergies');
    const birthInput = interaction.options.getString('birthdate');

    // Проверка на дубликат.
    if (findPatientByUser(patientUser)) {
      await interaction.reply({
        embeds: [errorEmbed('Пациент уже зарегистрирован в системе.')],
        ephemeral: true,
      });
      return;
    }

    let birthDate = null;
    if (birthInput) {
      const b = parseDate(birthInput);
      if (!b.ok) {
        await interaction.reply({ embeds: [errorEmbed(b.reason)], ephemeral: true });
        return;
      }
      birthDate = b.value;
    }

    const patient = createPatient({
      discordId: patientUser.id,
      fullName,
      birthDate,
      omsNumber: oms,
      bloodGroup: blood,
      allergies,
    });

    if (!patient) {
      await interaction.reply({ embeds: [errorEmbed('Не удалось зарегистрировать пациента (возможно, полис ОМС уже используется).')], ephemeral: true });
      return;
    }

    audit({ action: 'PATIENT_REGISTER', discordId: interaction.user.id, patientId: patient.patient_id, cardNumber: patient.cardNumber });
    logger.info(`[PATIENT] Зарегистрирован ${fullName} — ${patient.cardNumber}`);

    const doc = officialDocument({
      title: 'РЕГИСТРАЦИЯ ПАЦИЕНТА',
      docNumber: patient.cardNumber,
    });
    doc.addFields(
      { name: '👤 ФИО', value: patient.fullName, inline: true },
      { name: '📅 Дата рождения', value: patient.birthDate ? formatDateFromISO(patient.birthDate) : '—', inline: true },
      { name: '🆔 Полис ОМС', value: patient.omsNumber || '—', inline: true },
      { name: '🧬 Группа крови', value: bloodGroup(patient.bloodGroup), inline: true },
      { name: '⚠️ Аллергии', value: patient.allergies || 'Не выявлено', inline: false },
    );
    doc.addFields({ name: 'Штамп', value: '✅ УТВЕРЖДЕНО · 🔒 КОНФИДЕНЦИАЛЬНО', inline: false });

    await interaction.reply({ embeds: [doc], ephemeral: true });
  },
};

function formatDateFromISO(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}