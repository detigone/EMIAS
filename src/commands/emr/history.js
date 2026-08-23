'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { findPatientByUser } = require('./patientService');
const { getPatientRecords } = require('./emrService');
const { requirePermission, PERMISSIONS } = require('../../core/permissionGuard');
const { documentHeader, errorEmbed, infoEmbed, historyRecord } = require('../../utils/embed');
const { audit } = require('../../utils/logger');

const PAGE_SIZE = 5;

/**
 * Подкоманда /emr history <patient> — история обращений с пагинацией.
 */
async function execute(interaction) {
  const ok = await requirePermission({ interaction, permission: PERMISSIONS.VIEW_EMR, commandName: 'emr history' });
  if (!ok) return;

  const user = interaction.options.getUser('patient');
  const patient = findPatientByUser(user);

  if (!patient) {
    await interaction.reply({
      embeds: [errorEmbed('Карточка пациента не найдена.', {
        reason: 'Пользователь не зарегистрирован в реестре пациентов ЕМИАС.',
      })],
      ephemeral: true,
    });
    return;
  }

  const records = getPatientRecords(patient.patient_id);
  audit({ action: 'EMR_HISTORY', discordId: interaction.user.id, patientId: patient.patient_id, count: records.length });

  if (records.length === 0) {
    await interaction.reply({
      embeds: [infoEmbed('ИСТОРИЯ ОБРАЩЕНИЙ', `У пациента **${patient.fullName}** нет записей об обращении.`)],
      ephemeral: true,
    });
    return;
  }

  const totalPages = Math.ceil(records.length / PAGE_SIZE);
  const payload = buildPayload(0, patient.patient_id, interaction);
  await interaction.reply(payload);
}

/**
 * Формирует payload (embed + кнопки) для страницы истории.
 * @param {number} pageIndex 0-based
 * @param {number} patientId
 * @param {object} interaction контекст (для patientCard-совместимости)
 */
function buildPayload(pageIndex, patientId) {
  const { getDb } = require('../../database/connection');
  const db = getDb();
  const patient = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(patientId);
  if (!patient) return { embeds: [errorEmbed('Пациент не найден.')], components: [] };

  const records = getPatientRecords(patientId);
  if (records.length === 0) {
    return { embeds: [infoEmbed('ИСТОРИЯ ОБРАЩЕНИЙ', 'Нет записей.')], components: [] };
  }

  const totalPages = Math.ceil(records.length / PAGE_SIZE);
  const clamped = Math.max(0, Math.min(pageIndex, totalPages - 1));

  const embed = documentHeader({
    title: `ИСТОРИЯ ОБРАЩЕНИЙ · ${patient.fullName}`,
    docNumber: patient.cardNumber,
  });
  embed.setDescription(`Страница **${clamped + 1}** из **${totalPages}**. Сортировка: от новых к старым.`);

  const slice = records.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);
  for (const rec of slice) {
    embed.addFields(historyRecord(rec, rec.doctorDisplay));
  }

  const prev = new ButtonBuilder()
    .setCustomId(`hist_${clamped - 1}_${patientId}`)
    .setLabel('◀ Предыдущая')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(clamped === 0);

  const next = new ButtonBuilder()
    .setCustomId(`hist_${clamped + 1}_${patientId}`)
    .setLabel('Следующая ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(clamped >= totalPages - 1);

  const row = new ActionRowBuilder().addComponents(prev, next);
  return { embeds: [embed], components: [row] };
}

function build(s) {
  return s
    .setName('history')
    .setDescription('История обращений пациента (с пагинацией).')
    .addUserOption((o) => o.setName('patient').setDescription('Пользователь-пациент').setRequired(true));
}

module.exports = { build, execute, buildPayload, PAGE_SIZE };