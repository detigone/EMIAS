'use strict';

const { SlashCommandBuilder, ActionRowBuilder } = require('discord.js');
const { createAppointmentButton } = require('../../components/buttons/index');
const { createInfoEmbed } = require('../../templates/documentTemplates');

/**
 * Команда /appointment — главное меню регистратуры с кнопками.
 * Вместо подкоманд используется интерактивный контейнер с кнопкой для записи на приём.
 */
const data = new SlashCommandBuilder()
  .setName('appointment')
  .setDescription('Регистратура: запись на приём к врачу.');

async function execute(interaction) {
  const embed = createInfoEmbed(
    '📅 РЕГИСТРАТУРА',
    '**Запись на приём к врачу**\n\n' +
    'Нажмите кнопку ниже, чтобы открыть форму записи.\n' +
    'Вам потребуется указать:\n' +
    '• Специальность врача\n' +
    '• Дату и время приёма\n' +
    '• Жалобы (опционально)'
  );

  const row = new ActionRowBuilder().addComponents(createAppointmentButton());

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}

module.exports = { data, execute };