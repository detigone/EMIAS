'use strict';

const { SlashCommandBuilder, ActionRowBuilder } = require('discord.js');
const { createRegisterPatientButton } = require('../../components/buttons/index');
const { createInfoEmbed } = require('../../templates/documentTemplates');

/**
 * Команда /patient — главное меню реестра пациентов с кнопками.
 * Вместо подкоманд используется интерактивный контейнер с кнопкой для регистрации.
 */
const data = new SlashCommandBuilder()
  .setName('patient')
  .setDescription('Реестр пациентов ЕМИАС.');

async function execute(interaction) {
  const embed = createInfoEmbed(
    '📋 РЕЕСТР ПАЦИЕНТОВ',
    '**Регистрация пациента в системе ЕМИАС**\n\n' +
    'Нажмите кнопку ниже, чтобы открыть форму регистрации.\n' +
    'Вам потребуется указать:\n' +
    '• ФИО пациента\n' +
    '• Дату рождения\n' +
    '• Номер полиса ОМС\n' +
    '• Группу крови (опционально)\n' +
    '• Аллергии (опционально)'
  );

  const row = new ActionRowBuilder().addComponents(createRegisterPatientButton());

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}

module.exports = { data, execute };