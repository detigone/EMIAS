'use strict';

const { SlashCommandBuilder, ActionRowBuilder } = require('discord.js');
const { createLoginButton } = require('../../components/buttons/index');
const { createInfoEmbed } = require('../../templates/documentTemplates');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('login')
    .setDescription('Вход в систему ЕМИАС.'),

  async execute(interaction) {
    const embed = createInfoEmbed(
      '🔐 АВТОРИЗАЦИЯ В СИСТЕМЕ',
      '**Для входа в систему ЕМИАС нажмите кнопку ниже**\n\n' +
      'В открывшемся окне введите ваш логин и пароль.\n' +
      'После успешной аутентификации вы получите доступ к функциям системы.'
    );

    const row = new ActionRowBuilder().addComponents(createLoginButton());

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  },
};
