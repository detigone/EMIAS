'use strict';

const { SlashCommandBuilder, ActionRowBuilder } = require('discord.js');
const { createRegisterButton } = require('../../components/buttons/index');
const { createInfoEmbed } = require('../../templates/documentTemplates');

/**
 * Команда /register — регистрация сотрудника в системе ЕМИАС.
 * Вместо ввода параметров в подкомандах используется кнопка для вызова модального окна.
 */
const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Регистрация сотрудника в системе ЕМИАС (требует роль «Медицинский персонал»).');

async function execute(interaction) {
  const embed = createInfoEmbed(
    '🆕 РЕГИСТРАЦИЯ СОТРУДНИКА',
    '**Регистрация медицинского персонала в системе ЕМИАС**\n\n' +
    'Нажмите кнопку ниже, чтобы открыть форму регистрации.\n' +
    'Вам потребуется указать:\n' +
    '• Логин пользователя\n' +
    '• Пароль (мин. 8 символов)\n' +
    '• ФИО сотрудника\n' +
    '• Специальность (опционально)\n\n' +
    '⚠️ Требуется роль «Медицинский персонал»'
  );

  const row = new ActionRowBuilder().addComponents(createRegisterButton());

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}

module.exports = { data, execute };
