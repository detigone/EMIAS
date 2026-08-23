'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { logoutUser } = require('./authService');
const { infoEmbed } = require('../../utils/embed');
const { audit } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logout')
    .setDescription('Завершение сессии в системе ЕМИАС.'),

  async execute(interaction) {
    const result = logoutUser({ discordId: interaction.user.id });
    audit({
      action: 'LOGOUT',
      discordId: interaction.user.id,
      hadSession: result.ok,
    });
    await interaction.reply({
      embeds: [infoEmbed(
        'ЗАВЕРШЕНИЕ СЕССИИ',
        result.ok
          ? 'Ваша сессия в системе ЕМИАС закрыта.'
          : 'Активная сессия не найдена.',
      )],
      ephemeral: true,
    });
  },
};