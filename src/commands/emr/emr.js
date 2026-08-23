'use strict';

const { SlashCommandBuilder, ActionRowBuilder } = require('discord.js');
const { createViewEMRButton, createAddDiagnosisButton, createPrescribeButton } = require('../../components/buttons/index');
const { createInfoEmbed } = require('../../templates/documentTemplates');

/**
 * Команда /emr — главное меню ЭМК с кнопками для действий.
 * Вместо подкоманд используется интерактивный контейнер с кнопками.
 */
const data = new SlashCommandBuilder()
  .setName('emr')
  .setDescription('Электронная медицинская карта (ЭМК) — главное меню.');

async function execute(interaction) {
  const embed = createInfoEmbed(
    '📄 ЭЛЕКТРОННАЯ МЕДИЦИНСКАЯ КАРТА',
    '**Выберите действие с помощью кнопок ниже:**\n\n' +
    '🔍 **Просмотр ЭМК** — электронная медицинская карта пациента\n' +
    '📋 **История болезни** — все записи о приёмах\n' +
    '🏥 **Добавить диагноз** — ввод кода МКБ-10\n' +
    '💊 **Назначить рецепт** — выписка лекарственных препаратов'
  );

  // Создаём ряд кнопок (максимум 5 кнопок в ряду)
  const row1 = new ActionRowBuilder().addComponents(
    createViewEMRButton(),
    createAddDiagnosisButton(),
    createPrescribeButton()
  );

  await interaction.reply({
    embeds: [embed],
    components: [row1],
    ephemeral: true,
  });
}

module.exports = { data, execute };